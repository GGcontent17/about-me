import * as THREE from "three";
import type { Project } from "../data/projects";
import type { MediaLibrary } from "./media";
import { Sky } from "./sky";
import { WaterSim, createWaterSurface } from "./water";
import { Particles } from "./particles";
import type { Reflector } from "three/examples/jsm/objects/Reflector.js";

// Card size in world units (16:10 to match the case videos).
const W = 1.6;
const H = 1.0;
const GAP = 0.045;
export const STEP = W + GAP;
const CORNER = 0.05;
const LABEL_GAP = 0.05; // space between a card and its title underneath
const LABEL_H = 0.11; // height of the title strip
export const FOV = 36;
const WATER_Y = -H / 2 - 0.12; // the surface; cards (raised by `lift`) and their titles float above it
// Day phase at the first card (0 midnight, 0.25 sunrise, 0.5 noon). One full loop = one day.
const START_PHASE = 0.32;

export const SHAPE = {
  lift: 0.18, // how high the ribbon floats
  baseAmp: 0.78, // resting S-curve depth
  baseFreq: 0.5,
  basePhase: 0,
  drift: 0.05, // slow idle undulation (rad/s)
  concave: 0.15, // edges bow away from the viewer
  twist: 0.88, // max twist (rad) at full scroll energy
  twistFreq: 0.53,
  twistSpeed: 1.1,
  waveZ: 0, // depth waves at full scroll energy
  waveZFreq: 0.85,
  waveY: 0.28, // lift at full scroll energy (only ever upward, so it never dips into the water)
  waveYFreq: 1.35,
  energy: 0.17, // how much scroll speed turns into ribbon energy
  energyMax: 1.1,
  energyRise: 5, // how fast the energy builds…
  energySettle: 2.2, // …and how slowly it calms down
};
const HIT_GX = 12;
const HIT_GY = 8;
const damp = (a: number, b: number, lambda: number, dt: number) => a + (b - a) * (1 - Math.exp(-lambda * dt));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const canHover = window.matchMedia("(hover: hover)").matches; // touch: the centred card plays instead

const ribbonGLSL = /* glsl */ `
uniform float uOffset;
uniform float uTime;
uniform float uAmp;
uniform float uDir;
uniform vec4 uBase;  // amp, freq, phase, concave
uniform vec4 uDyn;   // twist, twistFreq, twistSpeed, waveZ
uniform vec3 uDyn2;  // waveZFreq, waveY, waveYFreq
uniform float uLift;

vec3 ribbon(vec2 local) {
  float u = uOffset + local.x;
  float side = 0.3 + smoothstep(0.2, 2.4, abs(u));
  float tw = uAmp * uDir * uDyn.x * side * sin(u * uDyn.y - uTime * uDyn.z + 0.6);
  vec3 p;
  p.x = u;
  p.y = local.y * cos(tw);
  p.z = local.y * sin(tw);
  p.z += uBase.x * sin(u * uBase.y + uBase.z) - uBase.w * u * u;
  p.z += uAmp * uDyn.w * sin(u * uDyn2.x + uTime * 0.8);
  // Lift only: the strip rises off the water when moving fast but never dips into it.
  p.y += uAmp * uDyn2.y * (0.5 + 0.5 * sin(u * uDyn2.z - uTime * 1.3));
  p.y += uLift;
  return p;
}
`;

const cardVert = /* glsl */ `
${ribbonGLSL}
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;

void main() {
  vUv = uv;
  vec2 local = position.xy;
  const float e = 0.004;
  vec3 p = ribbon(local);
  vec3 px = ribbon(local + vec2(e, 0.0));
  vec3 py = ribbon(local + vec2(0.0, e));
  vNormal = normalize(normalMatrix * cross(px - p, py - p));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const cardFrag = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uSize;
uniform float uRadius;
uniform float uFade;
uniform float uAmp;
uniform vec3 uTint;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 p = (vUv - 0.5) * uSize;
  float d = sdRoundBox(p, uSize * 0.5, uRadius);
  // Edge AA ramp sits fully inside the plane, so no MSAA is needed.
  float aa = fwidth(d) * 1.5;
  float alpha = 1.0 - smoothstep(-aa, 0.0, d);
  if (alpha < 0.002) discard;

  vec3 col = texture2D(uMap, vUv).rgb;

  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(vView);
  float facing = clamp(dot(N, V), 0.0, 1.0);
  // A card facing you shows its footage untouched; only parts twisted away get darker.
  col *= mix(0.3, 1.0, smoothstep(0.1, 0.85, facing));
  // A glint rolls across the cards only while the ribbon is moving.
  vec3 L = normalize(vec3(-0.35, 0.55, 0.8));
  float spec = pow(clamp(dot(N, normalize(L + V)), 0.0, 1.0), 48.0);
  col += spec * 0.15 * uAmp;
  if (!gl_FrontFacing) col *= 0.3;
  col *= uTint;

  gl_FragColor = vec4(col * uFade, alpha);
  #include <colorspace_fragment>
}
`;

const titleVert = /* glsl */ `
${ribbonGLSL}
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(ribbon(position.xy), 1.0);
}
`;

const titleFrag = /* glsl */ `
uniform sampler2D uLabel;
uniform vec3 uLabelColor;
uniform float uFade;
varying vec2 vUv;
void main() {
  float a = texture2D(uLabel, vUv).a * uFade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uLabelColor, a);
  #include <colorspace_fragment>
}
`;

/** White text on a transparent canvas, aligned with the card's left edge; the shader tints it. */
function makeLabel(title: string, anisotropy: number) {
  const w = 2048;
  const h = Math.round((w * LABEL_H) / W);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const size = Math.round(h * 0.62);
  const baseline = Math.round(h * 0.74);
  ctx.font = `400 ${size}px "Inter Tight", "Helvetica Neue", Arial, sans-serif`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "-2px";
  ctx.fillStyle = "#fff";
  ctx.fillText(title, 4, baseline);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = anisotropy;
  return tex;
}

function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Depth of the point inside triangle (ia, ib, ic) of the projected grid, or Infinity if outside. */
function triDepth(p: THREE.Vector2, g: Float32Array, ia: number, ib: number, ic: number) {
  const ax = g[ia * 3], ay = g[ia * 3 + 1];
  const bx = g[ib * 3], by = g[ib * 3 + 1];
  const cx = g[ic * 3], cy = g[ic * 3 + 1];
  const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(det) < 1e-9) return Infinity;
  const w0 = ((by - cy) * (p.x - cx) + (cx - bx) * (p.y - cy)) / det;
  const w1 = ((cy - ay) * (p.x - cx) + (ax - cx) * (p.y - cy)) / det;
  const w2 = 1 - w0 - w1;
  if (w0 < 0 || w1 < 0 || w2 < 0) return Infinity;
  return w0 * g[ia * 3 + 2] + w1 * g[ib * 3 + 2] + w2 * g[ic * 3 + 2];
}

interface Card {
  index: number;
  mesh: THREE.Mesh;
  labelMesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  labelMaterial: THREE.ShaderMaterial;
  labelTexture: THREE.CanvasTexture;
  offset: number;
  visible: boolean;
}

interface Drag {
  id: number;
  x: number;
  moved: number;
  vx: number;
  t: number;
  card: Card | null;
}

interface Options {
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  media: MediaLibrary;
  projects: Project[];
  isBlocked: () => boolean;
  onOpen: (index: number) => void;
}

/** The Featured scene: a bending ribbon of video cards floating over a reflective sea. */
export class Carousel {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);
  readonly stepSize: number;

  private canvas: HTMLCanvasElement;
  private media: MediaLibrary;
  private isBlocked: () => boolean;
  private onOpen: (index: number) => void;
  private shape = { ...SHAPE };
  private shared = {
    uTime: { value: 0 },
    uAmp: { value: 0 },
    uDir: { value: 0 },
    uFade: { value: 0 },
    uBase: { value: new THREE.Vector4() },
    uDyn: { value: new THREE.Vector4() },
    uDyn2: { value: new THREE.Vector3() },
    uSize: { value: new THREE.Vector2(W, H) },
    uRadius: { value: CORNER },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uLift: { value: SHAPE.lift },
    uLabelColor: { value: new THREE.Color(0.95, 0.95, 0.95) },
  };
  private cards: Card[] = [];
  private cardGeometry: THREE.PlaneGeometry;
  private labelGeometry: THREE.PlaneGeometry;
  private sky: Sky;
  private water: WaterSim;
  private surface: Reflector;
  private particles: Particles;
  private scroll = { current: 0, last: 0, target: 0 };
  private vel = 0;
  private amp = 0;
  private dir = 0;
  private fade = 0;
  private aspect = 1;
  private distance = 5;
  private visibleHalf = 3;
  private unitsPerPx = 0.003;
  private width = 1;
  private height = 1;
  private loop: number;
  private pointer = { ndc: new THREE.Vector2(), inside: false };
  private drag: Drag | null = null;
  private hovered: Card | null = null;
  private nextDrop = 0;
  private grid = new Float32Array((HIT_GX + 1) * (HIT_GY + 1) * 3);
  private v = new THREE.Vector3();
  private projects: Project[];

  constructor(o: Options) {
    this.canvas = o.canvas;
    this.media = o.media;
    this.isBlocked = o.isBlocked;
    this.onOpen = o.onOpen;
    this.projects = o.projects;
    this.stepSize = STEP;
    this.loop = o.projects.length * STEP;

    this.cardGeometry = new THREE.PlaneGeometry(W, H, 64, 40);
    this.labelGeometry = new THREE.PlaneGeometry(W, LABEL_H, 64, 1);
    this.labelGeometry.translate(0, -(H / 2 + LABEL_GAP + LABEL_H / 2), 0);
    const aniso = o.renderer.capabilities.getMaxAnisotropy();

    o.projects.forEach((p, index) => {
      void p;
      const offset = { value: 0 };
      const material = new THREE.ShaderMaterial({
        uniforms: { ...this.shared, uMap: { value: this.media.get(index).texture }, uOffset: offset },
        vertexShader: cardVert,
        fragmentShader: cardFrag,
        transparent: true,
        side: THREE.DoubleSide,
        forceSinglePass: true,
      });
      const mesh = new THREE.Mesh(this.cardGeometry, material);
      mesh.frustumCulled = false;
      this.scene.add(mesh);

      const labelTexture = makeLabel(p.title, aniso);
      const labelMaterial = new THREE.ShaderMaterial({
        uniforms: { ...this.shared, uLabel: { value: labelTexture }, uOffset: offset },
        vertexShader: titleVert,
        fragmentShader: titleFrag,
        transparent: true,
        depthWrite: false,
      });
      const labelMesh = new THREE.Mesh(this.labelGeometry, labelMaterial);
      labelMesh.frustumCulled = false;
      this.scene.add(labelMesh);
      this.cards.push({ index, mesh, labelMesh, material, labelMaterial, labelTexture, offset: 0, visible: true });
    });

    this.sky = new Sky(this.shared.uFade);
    this.scene.add(this.sky.mesh);

    this.water = new WaterSim(o.renderer);
    this.surface = createWaterSurface(WATER_Y);
    this.scene.add(this.surface);
    for (let i = 0; i < 20; i++) {
      this.water.addDrop((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, 0.03, i & 1 ? 0.004 : -0.004);
    }

    this.particles = new Particles({
      count: 260,
      min: new THREE.Vector3(-6, WATER_Y + 0.08, -3.5),
      max: new THREE.Vector3(6, 1.6, 2.3),
      fade: this.shared.uFade,
    });
    this.scene.add(this.particles.points);

    this.applyShape();
    this.bind();
  }

  get uiTone() {
    return this.sky.uiTone;
  }

  private applyShape() {
    const s = this.shape;
    const baseAmp = this.aspect < 1 ? s.baseAmp / 3 : s.baseAmp; // narrow screens: flatten the S-curve
    this.shared.uBase.value.set(baseAmp, s.baseFreq, s.basePhase, s.concave);
    this.shared.uDyn.value.set(s.twist, s.twistFreq, s.twistSpeed, s.waveZ);
    this.shared.uDyn2.value.set(s.waveZFreq, s.waveY, s.waveYFreq);
    this.shared.uLift.value = s.lift;
  }

  resize(width: number, height: number, dpr: number) {
    const aspect = width / height;
    this.camera.aspect = aspect;
    this.aspect = aspect;
    // Wider than 16:9 also capped by height, or the near card on the right reaches up behind the top-right corner text.
    const frac = aspect < 1 ? 0.82 : Math.min(clamp(0.48 - (aspect - 1.3) * 0.08, 0.36, 0.48), 0.79 / aspect);
    const visibleW = W / frac;
    const visibleH = visibleW / aspect;
    this.distance = visibleH / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    this.visibleHalf = visibleW / 2;
    this.unitsPerPx = visibleW / width;
    this.camera.updateProjectionMatrix();
    this.width = width;
    this.height = height;
    this.applyShape();
    this.particles.resize(height * dpr, FOV);
    // Reflection at half resolution: the ripples hide the softness.
    this.surface.getRenderTarget().setSize(Math.round(width * dpr * 0.5), Math.round(height * dpr * 0.5));
  }

  /** Cards sweep in from the right while everything fades up from black. */
  intro() {
    this.scroll.current = this.scroll.last = -3 * STEP;
    this.scroll.target = 0;
    this.fade = 0;
  }

  centerIndex() {
    const n = this.cards.length;
    return ((Math.round(this.scroll.current / STEP) % n) + n) % n;
  }

  // ---- capture helpers
  scrollTo(target: number) {
    this.scroll.target = target;
  }
  setPointerNdc(x: number, y: number) {
    this.pointer.ndc.set(x, y);
    this.pointer.inside = true;
  }
  leave() {
    this.pointer.inside = false;
  }

  // ---- input
  private setPointer(e: PointerEvent) {
    this.pointer.ndc.set((e.clientX / this.width) * 2 - 1, -(e.clientY / this.height) * 2 + 1);
    this.pointer.inside = true;
  }

  private onWheel = (e: WheelEvent) => {
    if (this.isBlocked()) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.width : 1;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    this.scroll.target += d * unit * 0.0026;
  };

  private onDown = (e: PointerEvent) => {
    if (this.isBlocked() || e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.setPointer(e);
    this.drag = { id: e.pointerId, x: e.clientX, moved: 0, vx: 0, t: performance.now(), card: this.hitTest(this.pointer.ndc) };
  };

  private onMove = (e: PointerEvent) => {
    if (this.isBlocked()) return;
    this.setPointer(e);
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const now = performance.now();
    const dx = e.clientX - d.x;
    const dt = Math.max((now - d.t) / 1000, 1 / 240);
    d.vx = damp(d.vx, dx / dt, 18, dt);
    d.x = e.clientX;
    d.t = now;
    d.moved += Math.abs(dx);
    if (d.moved > 6) this.canvas.dataset.dragging = "";
    this.scroll.target -= dx * this.unitsPerPx * 1.1;
  };

  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    delete this.canvas.dataset.dragging;
    if (e.pointerType !== "mouse") this.pointer.inside = false;
    if (d.moved < 6) {
      if (d.card) this.onOpen(d.card.index);
    } else if (performance.now() - d.t < 80) {
      this.scroll.target -= d.vx * this.unitsPerPx * 0.22; // throw
    }
  };

  private onLeave = () => {
    this.pointer.inside = false;
  };

  private onKey = (e: KeyboardEvent) => {
    if (this.isBlocked()) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowRight") this.scroll.target = (Math.round(this.scroll.target / STEP) + 1) * STEP;
    else if (e.key === "ArrowLeft") this.scroll.target = (Math.round(this.scroll.target / STEP) - 1) * STEP;
    else if (e.key === "Enter" && document.activeElement === document.body) this.onOpen(this.centerIndex());
  };

  private bind() {
    window.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("pointerdown", this.onDown);
    this.canvas.addEventListener("pointermove", this.onMove);
    this.canvas.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("pointercancel", this.onUp);
    this.canvas.addEventListener("pointerleave", this.onLeave);
    window.addEventListener("keydown", this.onKey);
  }

  // ---- per frame
  update(dt: number, time: number, interactive: boolean) {
    const s = this.scroll;
    const shape = this.shape;
    const motion = reducedMotion ? 0.3 : 1;

    s.current = damp(s.current, s.target, this.drag ? 14 : 6, dt);
    const vel = (s.current - s.last) / Math.max(dt, 1e-4);
    s.last = s.current;
    this.vel = damp(this.vel, vel, 10, dt);

    const ampTarget = Math.min(Math.abs(this.vel) * shape.energy, shape.energyMax) * motion + 0.03;
    this.amp = damp(this.amp, ampTarget, ampTarget > this.amp ? shape.energyRise : shape.energySettle, dt);
    this.dir = damp(this.dir, clamp(this.vel * 2.5, -1, 1), 3, dt);
    this.fade = damp(this.fade, 1, 1.6, dt);

    const u = this.shared;
    u.uTime.value = time;
    u.uAmp.value = this.amp;
    u.uDir.value = this.dir;
    u.uFade.value = this.fade;
    u.uBase.value.z = shape.basePhase + Math.sin(time * shape.drift) * 0.5;

    this.camera.position.set(0, 0.03, this.distance);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();

    this.updateEnvironment(dt, time);

    const range = this.visibleHalf + STEP * 1.25;
    for (const card of this.cards) {
      const raw = card.index * STEP - s.current + this.loop / 2;
      card.offset = (((raw % this.loop) + this.loop) % this.loop) - this.loop / 2;
      card.visible = Math.abs(card.offset) < range;
      card.mesh.visible = card.visible;
      card.labelMesh.visible = card.visible;
      card.material.uniforms.uOffset.value = card.offset;
      if (card.visible) {
        this.media.prefetch(card.index); // buffered, so hover starts instantly
        card.material.uniforms.uMap.value = this.media.get(card.index).texture;
      }
    }

    // Cards move under a still cursor too, so re-test every frame.
    this.hovered = interactive && this.pointer.inside && !this.drag ? this.hitTest(this.pointer.ndc) : null;
    if (interactive) {
      if (this.hovered) this.canvas.dataset.hover = "card";
      else if (this.canvas.dataset.hover === "card") delete this.canvas.dataset.hover;
    }
    if (this.hovered) {
      this.media.want(this.hovered.index);
    } else if (!canHover && interactive && !this.drag && Math.abs(this.vel) < 0.05) {
      this.media.want(this.centerIndex());
    }
  }

  private updateEnvironment(dt: number, time: number) {
    const sky = this.sky;
    sky.setPhase(START_PHASE + this.scroll.current / this.loop, time);
    this.shared.uTint.value.copy(sky.tint);

    // Titles: dark text over a bright horizon, light over a dark one.
    const target = sky.labelTone > 0.5 ? 0.06 : 0.95;
    const k = 1 - Math.exp(-4 * dt);
    const lc = this.shared.uLabelColor.value;
    lc.r += (target - lc.r) * k;
    lc.g += (target - lc.g) * k;
    lc.b += (target - lc.b) * k;

    this.particles.update(time, this.scroll.current, sky.particleColor);

    const w = (this.surface.material as THREE.ShaderMaterial).uniforms;
    w.tWater.value = this.water.texture;
    w.uGlintDir.value.copy(sky.glintDir);
    w.uGlintColor.value.copy(sky.glintColor);
    w.uDeep.value.copy(sky.deep);
    w.uHorizon.value.copy(sky.uniforms.uHorizon.value as THREE.Color);
    w.uFade.value = this.fade;

    // An occasional soft drop under the cards keeps the surface from looking frozen.
    if (time > this.nextDrop) {
      this.nextDrop = time + 0.5 + Math.random() * 1.0;
      const x = (Math.random() - 0.5) * this.visibleHalf * 2.4;
      const z = -0.7 + Math.random() * 2.2;
      this.water.addDrop(x, z, 0.02 + Math.random() * 0.01, (Math.random() < 0.5 ? 1 : -1) * 0.004);
    }

    // Fast scrolling drags soft wakes along the bottom edge of the moving cards.
    if (this.amp > 0.35) {
      const base = this.shared.uBase.value;
      for (const card of this.cards) {
        if (!card.visible || Math.abs(card.offset) > this.visibleHalf + W * 0.5) continue;
        if (Math.random() > this.amp * 0.2) continue;
        const x = card.offset + (Math.random() - 0.5) * W;
        const z = base.x * Math.sin(x * base.y + base.z) - base.w * x * x;
        this.water.addDrop(x, z + 0.05, 0.02, -0.004 * Math.min(this.amp, 1));
      }
    }
    this.water.update(dt);
  }

  /** CPU twin of the vertex shader — keep in sync with ribbonGLSL. */
  private ribbonPoint(lx: number, ly: number, offset: number, out: THREE.Vector3) {
    const amp = this.shared.uAmp.value;
    const dir = this.shared.uDir.value;
    const t = this.shared.uTime.value;
    const base = this.shared.uBase.value;
    const s = this.shape;
    const u = offset + lx;
    const side = 0.3 + smoothstep(0.2, 2.4, Math.abs(u));
    const tw = amp * dir * s.twist * side * Math.sin(u * s.twistFreq - t * s.twistSpeed + 0.6);
    let y = ly * Math.cos(tw);
    let z = ly * Math.sin(tw);
    z += base.x * Math.sin(u * base.y + base.z) - base.w * u * u;
    z += amp * s.waveZ * Math.sin(u * s.waveZFreq + t * 0.8);
    y += amp * s.waveY * (0.5 + 0.5 * Math.sin(u * s.waveYFreq - t * 1.3));
    y += s.lift;
    return out.set(u, y, z);
  }

  /** Card under the given NDC point (nearest wins), or null. Its title underneath counts as the card. */
  private hitTest(ndc: THREE.Vector2): Card | null {
    let best: Card | null = null;
    let bestZ = Infinity;
    const g = this.grid;
    const v = this.v;
    const row = HIT_GX + 1;
    for (const card of this.cards) {
      if (!card.visible) continue;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let j = 0; j <= HIT_GY; j++) {
        for (let i = 0; i <= HIT_GX; i++) {
          const ly = H / 2 - (j / HIT_GY) * (H + LABEL_GAP + LABEL_H);
          this.ribbonPoint((i / HIT_GX - 0.5) * W, ly, card.offset, v).project(this.camera);
          const k = (j * row + i) * 3;
          g[k] = v.x;
          g[k + 1] = v.y;
          g[k + 2] = v.z;
          if (v.x < minX) minX = v.x;
          if (v.x > maxX) maxX = v.x;
          if (v.y < minY) minY = v.y;
          if (v.y > maxY) maxY = v.y;
        }
      }
      if (ndc.x < minX || ndc.x > maxX || ndc.y < minY || ndc.y > maxY) continue;
      for (let j = 0; j < HIT_GY; j++) {
        for (let i = 0; i < HIT_GX; i++) {
          const a = j * row + i;
          const z = Math.min(triDepth(ndc, g, a, a + 1, a + row + 1), triDepth(ndc, g, a, a + row + 1, a + row));
          if (z < bestZ) {
            bestZ = z;
            best = card;
          }
        }
      }
    }
    return best;
  }

  dispose() {
    window.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onUp);
    this.canvas.removeEventListener("pointerleave", this.onLeave);
    window.removeEventListener("keydown", this.onKey);
    this.cardGeometry.dispose();
    this.labelGeometry.dispose();
    for (const c of this.cards) {
      c.material.dispose();
      c.labelMaterial.dispose();
      c.labelTexture.dispose();
    }
    this.sky.dispose();
    this.water.dispose();
    this.surface.getRenderTarget().dispose();
    this.surface.geometry.dispose();
    (this.surface.material as THREE.Material).dispose();
    this.particles.dispose();
    void this.projects;
  }
}
