import * as THREE from "three";
import type { MediaLibrary } from "./media";

const damp = (a: number, b: number, lambda: number, dt: number) => a + (b - a) * (1 - Math.exp(-lambda * dt));

const PREVIEW_VERT = /* glsl */ `
uniform vec2 uVel;
uniform float uReveal;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  // Bow away from the direction of travel, like a card dragged through water.
  p.x -= sin(uv.y * 3.14159) * uVel.x * 0.16;
  p.y -= sin(uv.x * 3.14159) * uVel.y * 0.16;
  p.xy *= mix(0.72, 1.0, uReveal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const PREVIEW_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uSize;
uniform float uRadius;
uniform float uReveal;
varying vec2 vUv;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 p = (vUv - 0.5) * uSize;
  float d = sdRoundBox(p, uSize * 0.5, uRadius);
  float alpha = 1.0 - smoothstep(-1.5, 0.0, d);
  // Circular wipe in from the cursor.
  float r = length(p) / length(uSize * 0.5);
  alpha *= 1.0 - smoothstep(uReveal * 1.25 - 0.15, uReveal * 1.25, r);
  if (alpha < 0.002) discard;
  vec3 col = texture2D(uMap, vUv).rgb;
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

/** The Full view: the index painted onto a canvas exactly where the (transparent) DOM text sits, plus a cursor-following preview. */
export class FullView {
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);

  private listEl: HTMLElement;
  private media: MediaLibrary;
  private links: HTMLElement[];
  private width = 1;
  private height = 1;
  private dpr = 1;
  private dirty = true;
  private pointer = new THREE.Vector2(-9999, -9999);
  private pos = new THREE.Vector2(0, 0);
  private vel = new THREE.Vector2(0, 0);
  private reveal = 0;
  private hovered = -1;
  private shown = 0;

  private listCanvas = document.createElement("canvas");
  private listTex: THREE.CanvasTexture;
  private listMesh: THREE.Mesh;
  private hiCanvas = document.createElement("canvas");
  private hiTex: THREE.CanvasTexture;
  private hiMesh: THREE.Mesh;
  private preview: THREE.Mesh;
  private previewUniforms: { uMap: THREE.IUniform<THREE.Texture>; uSize: THREE.IUniform<THREE.Vector2>; uRadius: THREE.IUniform<number>; uReveal: THREE.IUniform<number>; uVel: THREE.IUniform<THREE.Vector2> };
  private geometry = new THREE.PlaneGeometry(1, 1);
  private previewGeometry = new THREE.PlaneGeometry(1, 1, 24, 24);

  constructor(listEl: HTMLElement, media: MediaLibrary) {
    this.listEl = listEl;
    this.media = media;
    this.links = Array.from(listEl.querySelectorAll<HTMLElement>("a"));
    this.camera.position.z = 5;

    const tex = (canvas: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      return t;
    };
    this.listTex = tex(this.listCanvas);
    this.hiTex = tex(this.hiCanvas);
    this.listMesh = new THREE.Mesh(this.geometry, new THREE.MeshBasicMaterial({ map: this.listTex, transparent: true }));
    this.hiMesh = new THREE.Mesh(this.geometry, new THREE.MeshBasicMaterial({ map: this.hiTex, transparent: true }));
    this.hiMesh.position.z = 2;
    this.hiMesh.visible = false;

    this.previewUniforms = {
      uMap: { value: media.get(0).texture },
      uSize: { value: new THREE.Vector2(300, 187.5) },
      uRadius: { value: 14 },
      uReveal: { value: 0 },
      uVel: { value: new THREE.Vector2() },
    };
    this.preview = new THREE.Mesh(
      this.previewGeometry,
      new THREE.ShaderMaterial({ uniforms: this.previewUniforms, vertexShader: PREVIEW_VERT, fragmentShader: PREVIEW_FRAG, transparent: true }),
    );
    this.preview.position.z = 1;
    this.preview.visible = false;
    this.scene.add(this.listMesh, this.preview, this.hiMesh);

    window.addEventListener("pointermove", this.onPointer);
  }

  private onPointer = (e: PointerEvent) => {
    this.pointer.set(e.clientX, e.clientY);
  };

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.camera.left = -width / 2;
    this.camera.right = width / 2;
    this.camera.top = height / 2;
    this.camera.bottom = -height / 2;
    this.camera.updateProjectionMatrix();
    this.listCanvas.width = Math.round(width * dpr);
    this.listCanvas.height = Math.round(height * dpr);
    this.listTex.dispose(); // a resized canvas needs a fresh GPU texture
    this.listMesh.scale.set(width, height, 1);
    const pw = Math.min(Math.max(width * (width < 700 ? 0.6 : 0.24), 220), 480);
    this.previewUniforms.uSize.value.set(pw, pw / 1.6);
    this.preview.scale.set(pw, pw / 1.6, 1);
    this.dirty = true;
  }

  /** Mark the painted list stale (e.g. after fonts load or the DOM list reflows). */
  invalidate() {
    this.links = Array.from(this.listEl.querySelectorAll<HTMLElement>("a"));
    this.dirty = true;
  }

  setHovered(index: number) {
    if (index === this.hovered) return;
    if (index >= 0 && this.reveal < 0.05) {
      // Appear right where the cursor is instead of sliding in from the last spot.
      this.pos.copy(this.pointer);
    }
    this.hovered = index;
    if (index >= 0) this.shown = index;
    this.drawHighlight();
  }

  /** Capture helper: put the pointer on the centre of a link, then hover it. */
  hoverLinkCentre(index: number) {
    const el = this.links[index];
    if (!el) return this.setHovered(-1);
    const r = el.getBoundingClientRect();
    this.pointer.set(r.left + r.width / 2, r.top + r.height / 2);
    this.setHovered(index);
  }

  /** Paint the list exactly where the (transparent) DOM text sits. */
  private draw() {
    const ctx = this.listCanvas.getContext("2d")!;
    // Drop separators left dangling at the end of a wrapped line.
    const items = this.links.flatMap((a, i): Element[] => {
      const sep = a.nextElementSibling;
      const next = this.links[i + 1];
      if (!sep || !next) return [a];
      const sameLine = Math.abs(sep.getBoundingClientRect().top - next.getBoundingClientRect().top) < 2;
      return sameLine ? [a, sep] : [a];
    });
    this.paint(ctx, items, 0, 0, this.width, this.height);
    this.listTex.needsUpdate = true;
    this.drawHighlight();
    this.dirty = false;
  }

  /** The hovered name, redrawn above the preview. Its texture only covers that name. */
  private drawHighlight() {
    if (!this.width) return;
    this.hiMesh.visible = this.hovered >= 0;
    if (!this.hiMesh.visible) return;
    const el = this.links[this.hovered];
    const r = el.getBoundingClientRect();
    const pad = 4;
    const x = r.left - pad;
    const y = r.top - pad;
    const w = r.width + pad * 2;
    const h = r.height + pad * 2;
    this.hiCanvas.width = Math.ceil(w * this.dpr);
    this.hiCanvas.height = Math.ceil(h * this.dpr);
    this.paint(this.hiCanvas.getContext("2d")!, [el], x, y, w, h);
    this.hiTex.dispose();
    this.hiTex.needsUpdate = true;
    this.hiMesh.scale.set(w, h, 1);
    this.hiMesh.position.set(x + w / 2 - this.width / 2, this.height / 2 - (y + h / 2), 2);
  }

  /** Draw elements at their on-screen spots, with (x, y) as the canvas origin. */
  private paint(ctx: CanvasRenderingContext2D, elements: Element[], x: number, y: number, w: number, h: number) {
    const cs = getComputedStyle(this.listEl);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, -x * this.dpr, -y * this.dpr);
    ctx.clearRect(x, y, w, h);
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if ("letterSpacing" in ctx && cs.letterSpacing !== "normal") ctx.letterSpacing = cs.letterSpacing;
    ctx.fillStyle = "#f2f2f2";
    ctx.textBaseline = "alphabetic";
    const ascent = ctx.measureText("Hg").fontBoundingBoxAscent;
    for (const el of elements) {
      const r = el.getBoundingClientRect();
      ctx.fillText(el.textContent ?? "", r.left, r.top + ascent);
    }
  }

  update(dt: number) {
    if (this.dirty) this.draw();
    const active = this.hovered >= 0;
    this.reveal = damp(this.reveal, active ? 1 : 0, active ? 7 : 9, dt);
    if (this.reveal > 0.01) this.media.want(this.shown);

    const px = this.pos.x;
    const py = this.pos.y;
    this.pos.x = damp(px, this.pointer.x, 10, dt);
    this.pos.y = damp(py, this.pointer.y, 10, dt);
    const inv = 1 / Math.max(dt, 1e-4);
    this.vel.x = damp(this.vel.x, THREE.MathUtils.clamp(((this.pos.x - px) * inv) / 2500, -1, 1), 8, dt);
    this.vel.y = damp(this.vel.y, THREE.MathUtils.clamp((-(this.pos.y - py) * inv) / 2500, -1, 1), 8, dt);

    this.preview.position.x = this.pos.x - this.width / 2;
    this.preview.position.y = this.height / 2 - this.pos.y;
    this.preview.rotation.z = -this.vel.x * 0.12;
    this.preview.visible = this.reveal > 0.002;
    this.previewUniforms.uReveal.value = this.reveal;
    this.previewUniforms.uVel.value.copy(this.vel);
    this.previewUniforms.uMap.value = this.media.get(this.shown).texture;
  }

  dispose() {
    window.removeEventListener("pointermove", this.onPointer);
    this.geometry.dispose();
    this.previewGeometry.dispose();
    (this.listMesh.material as THREE.Material).dispose();
    (this.hiMesh.material as THREE.Material).dispose();
    (this.preview.material as THREE.Material).dispose();
    this.listTex.dispose();
    this.hiTex.dispose();
  }
}
