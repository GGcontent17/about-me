import * as THREE from "three";

export interface ViewRef {
  scene: THREE.Scene;
  camera: THREE.Camera;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// A wobbly liquid-glass blob grows from the centre. Inside it: the incoming view.
// Its rim refracts the outgoing view with a chromatic split; outside, the outgoing view gets dragged toward the edge.
const FRAG = /* glsl */ `
uniform sampler2D tFrom;
uniform sampler2D tTo;
uniform float uProgress;
uniform float uTime;
uniform float uAspect;
varying vec2 vUv;

float easeInOut(float t) {
  return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) * 0.5;
}

vec3 split(sampler2D t, vec2 uv, vec2 off) {
  return vec3(texture2D(t, uv + off).r, texture2D(t, uv).g, texture2D(t, uv - off).b);
}

void main() {
  float p = easeInOut(clamp(uProgress, 0.0, 1.0));
  float pulse = sin(p * 3.14159265);
  vec2 asp = vec2(uAspect, 1.0);
  vec2 q = (vUv - 0.5) * asp;
  float len = length(q);
  vec2 dir = q / max(len, 1e-4);
  vec2 dirUv = dir / asp;
  float ang = atan(q.y, q.x);

  float wob = 0.17 * sin(ang * 3.0 + uTime * 1.6)
            + 0.09 * sin(ang * 5.0 - uTime * 1.1 + 1.3)
            + 0.05 * sin(ang * 2.0 + uTime * 0.7);
  float maxR = length(asp) * 0.5 * 1.5;
  float R = p * maxR * (1.0 + wob * (1.0 - 0.6 * p));
  float d = len - R; // < 0 inside the blob

  float ca = (0.003 + 0.014 * pulse) * exp(-abs(d) / 0.06);

  // Outside: outgoing view, pulled toward the advancing edge.
  float pull = exp(-max(d, 0.0) / 0.14) * 0.1 * pulse;
  vec3 from = split(tFrom, vUv - dirUv * pull, dirUv * ca);

  // Inside: incoming view, magnified toward the rim like a lens.
  float rim = 0.05 + 0.07 * pulse;
  float lens = smoothstep(-rim * 3.0, 0.0, d);
  vec3 to = split(tTo, vUv - dirUv * lens * 0.06 * pulse, dirUv * ca);

  // Glass band just inside the edge: the outgoing view, refracted and compressed.
  float band = smoothstep(-rim, -rim * 0.25, d);
  float t = clamp((d + rim) / rim, 0.0, 1.0);
  vec3 glass = split(tFrom, vUv + dirUv * (1.0 - t) * 0.16 * pulse, dirUv * ca * 2.5);

  float inside = 1.0 - smoothstep(-0.002, 0.002, d);
  vec3 col = mix(from, to, inside);
  col = mix(col, glass, band * inside * 0.85 * pulse);
  col += exp(-abs(d) / 0.004) * 0.22 * pulse;

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Featured ↔ Full: both views render into their own targets, then a glass blob reveals the new one. */
export class Transition {
  active = false;
  private from: ViewRef | null = null;
  private to: ViewRef | null = null;
  private progress = 0;
  private duration = 1.5;
  private rtFrom: THREE.WebGLRenderTarget;
  private rtTo: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;

  constructor() {
    const make = () => new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
    this.rtFrom = make();
    this.rtTo = make();
    this.material = new THREE.ShaderMaterial({
      uniforms: { tFrom: { value: null }, tTo: { value: null }, uProgress: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  resize(width: number, height: number, dpr: number) {
    const w = Math.max(2, Math.round(width * dpr));
    const h = Math.max(2, Math.round(height * dpr));
    this.rtFrom.setSize(w, h);
    this.rtTo.setSize(w, h);
    this.material.uniforms.uAspect.value = width / height;
  }

  start(from: ViewRef, to: ViewRef) {
    this.from = from;
    this.to = to;
    this.progress = 0;
    this.duration = reducedMotion ? 0.5 : 1.5;
    this.active = true;
  }

  render(renderer: THREE.WebGLRenderer, dt: number, time: number) {
    if (!this.from || !this.to) {
      this.active = false;
      return;
    }
    this.progress = Math.min(1, this.progress + dt / this.duration);
    renderer.setRenderTarget(this.rtFrom);
    renderer.render(this.from.scene, this.from.camera);
    renderer.setRenderTarget(this.rtTo);
    renderer.render(this.to.scene, this.to.camera);
    renderer.setRenderTarget(null);
    const u = this.material.uniforms;
    u.tFrom.value = this.rtFrom.texture;
    u.tTo.value = this.rtTo.texture;
    u.uProgress.value = this.progress;
    u.uTime.value = time;
    renderer.render(this.quadScene, this.quadCamera);
    if (this.progress >= 1) this.active = false; // this last frame still went through the blob (it shows the new view)
  }

  dispose() {
    this.rtFrom.dispose();
    this.rtTo.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
