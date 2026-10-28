import * as THREE from "three";
import { assetUrl } from "../data/projects";

// Time of day keyframes. `p` is the day phase: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
const KEYS = [
  { p: 0.0, zenith: "#03050c", horizon: "#0b1226", deep: "#01040a" },
  { p: 0.17, zenith: "#060b1e", horizon: "#1a2244", deep: "#02060f" },
  { p: 0.215, zenith: "#14204a", horizon: "#5a3f66", deep: "#060d1e" },
  { p: 0.25, zenith: "#34518c", horizon: "#ff9a5a", deep: "#0b1a2e" },
  { p: 0.31, zenith: "#4f84c4", horizon: "#f3cba4", deep: "#12324d" },
  { p: 0.4, zenith: "#3f7fd0", horizon: "#c9e0f2", deep: "#154160" },
  { p: 0.5, zenith: "#3a7bd5", horizon: "#d2e6f5", deep: "#164666" },
  { p: 0.62, zenith: "#4278c4", horizon: "#e8dcc0", deep: "#153f5c" },
  { p: 0.71, zenith: "#3b5d9a", horizon: "#ffb066", deep: "#12304a" },
  { p: 0.75, zenith: "#283a6b", horizon: "#ff6f3c", deep: "#0d1f36" },
  { p: 0.79, zenith: "#121a3d", horizon: "#6b3a5e", deep: "#070f20" },
  { p: 0.86, zenith: "#04070f", horizon: "#0e1530", deep: "#02060d" },
  { p: 1.0, zenith: "#03050c", horizon: "#0b1226", deep: "#01040a" },
].map((k) => ({ p: k.p, zenith: new THREE.Color(k.zenith), horizon: new THREE.Color(k.horizon), deep: new THREE.Color(k.deep) }));

const MAX_ELEVATION = THREE.MathUtils.degToRad(14); // low arc keeps the sun in the strip above the cards
const AZIMUTH_RANGE = THREE.MathUtils.degToRad(90); // rises at +45° (right), sets at -45° (left)
const SUN_WARM = new THREE.Color("#ffae6b");
const SUN_WHITE = new THREE.Color("#fff2dc");
const MOON = new THREE.Color("#c9d6ff");
const MOON_RADIUS = THREE.MathUtils.degToRad(0.95);
const NIGHT_TINT = new THREE.Color(0.72, 0.78, 0.95);
const GOLD_TINT = new THREE.Color(1.0, 0.88, 0.78);

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
// White and black text have equal contrast at ~0.18 relative luminance; switch there.
const tone = (l: number) => clamp01((l - 0.16) / 0.04);

function arcDirection(phase: number, out: THREE.Vector3) {
  phase = ((phase % 1) + 1) % 1;
  const s = Math.sin(2 * Math.PI * (phase - 0.25)); // -1..1, sun height
  const elevation = s * MAX_ELEVATION;
  const azimuth = (0.5 - phase) * 2 * AZIMUTH_RANGE;
  return out.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation));
}

const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform float uMoonVis;
uniform float uMoonRadius;
uniform sampler2D uMoonMap;
uniform float uNight;
uniform float uTime;
uniform float uFade;
varying vec3 vWorld;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  // Direction from whichever camera is rendering (main view or the water's mirror camera).
  vec3 dir = normalize(vWorld - cameraPosition);
  float h = max(dir.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.45));

  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.18 + pow(sd, 60.0) * 0.45);
  col += uSunColor * smoothstep(0.99986, 0.99993, sd) * 6.0;

  // Moon: colour map wrapped on a sphere, near side facing us.
  vec3 m = uMoonDir;
  vec3 right = normalize(cross(m, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, m);
  vec2 q = vec2(dot(dir, right), dot(dir, up)) / uMoonRadius;
  float rq = length(q);
  float facing = step(0.0, dot(dir, m));
  float moonMask = (1.0 - smoothstep(1.0 - max(fwidth(rq) * 1.5, 0.05), 1.0, rq)) * facing;
  vec3 n = vec3(q, sqrt(max(0.0, 1.0 - rq * rq)));
  vec2 moonUv = vec2(0.5 + atan(n.x, n.z) / 6.2831853, 0.5 + asin(clamp(n.y, -1.0, 1.0)) / 3.1415927);
  vec3 albedo = texture2D(uMoonMap, moonUv).rgb;
  vec3 L = normalize(vec3(0.33, 0.1, 0.94));
  float mu0 = max(dot(n, L), 0.0);
  float lit = 2.0 * mu0 / (mu0 + n.z + 1e-3); // Lommel–Seeliger
  vec3 moon = (1.0 - exp(-albedo * lit * 6.0)) * vec3(1.0, 0.97, 0.9) + albedo * 0.015;
  float ang = acos(clamp(dot(dir, m), -1.0, 1.0));
  float edge = max(ang - uMoonRadius, 0.0);
  float glow = exp(-edge * 70.0) * 0.45 + exp(-edge * 14.0) * 0.16 + exp(-ang * 3.0) * 0.07;
  col += uMoonColor * glow * facing;
  col = mix(col, moon, moonMask * uMoonVis);

  // Stars: one random point per lattice cell around the view sphere.
  vec3 sp = dir * 260.0;
  vec3 id = floor(sp);
  float r = hash13(id);
  vec3 jitter = vec3(hash13(id + 7.1), hash13(id + 3.7), hash13(id + 1.3)) - 0.5;
  float star = step(0.985, r) * smoothstep(0.22, 0.0, length(fract(sp) - 0.5 - jitter * 0.5));
  star *= 0.55 + 0.45 * sin(uTime * (1.5 + r * 3.0) + r * 60.0);
  col += star * uNight * smoothstep(0.0, 0.12, dir.y) * 1.4 * (1.0 - min(moonMask + glow * 3.0, 1.0) * uMoonVis);

  gl_FragColor = vec4(col * uFade, 1.0);
  #include <colorspace_fragment>
}
`;

/** Sky dome, and every colour in the scene that depends on the time of day. */
export class Sky {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  deep = new THREE.Color();
  glintDir = new THREE.Vector3(0, 1, 0);
  glintColor = new THREE.Color();
  tint = new THREE.Color(1, 1, 1);
  particleColor = new THREE.Color();
  uiTone = 0;
  labelTone = 0;
  private c = new THREE.Color();
  private moonMap: THREE.Texture;

  constructor(fade: THREE.IUniform<number>) {
    this.moonMap = new THREE.TextureLoader().load(assetUrl("moon.jpg"));
    this.moonMap.colorSpace = THREE.SRGBColorSpace;
    this.moonMap.wrapS = THREE.RepeatWrapping;
    this.moonMap.anisotropy = 4;
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3() },
      uSunColor: { value: new THREE.Color() },
      uMoonDir: { value: new THREE.Vector3() },
      uMoonColor: { value: new THREE.Color() },
      uMoonVis: { value: 0 },
      uMoonRadius: { value: Math.sin(MOON_RADIUS) },
      uMoonMap: { value: this.moonMap },
      uNight: { value: 0 },
      uTime: { value: 0 },
      uFade: fade,
    };
    const material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(150, 48, 24), material);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }

  setPhase(phase: number, time: number) {
    const p = ((phase % 1) + 1) % 1;
    let i = 0;
    while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = smooth(clamp01((p - a.p) / (b.p - a.p)));

    const u = this.uniforms;
    (u.uZenith.value as THREE.Color).copy(a.zenith).lerp(b.zenith, t);
    (u.uHorizon.value as THREE.Color).copy(a.horizon).lerp(b.horizon, t);
    this.deep.copy(a.deep).lerp(b.deep, t);
    u.uTime.value = time;

    const s = Math.sin(2 * Math.PI * (p - 0.25));
    arcDirection(p, u.uSunDir.value as THREE.Vector3);
    arcDirection(p + 0.5, u.uMoonDir.value as THREE.Vector3);
    const sunUp = clamp01((s + 0.04) / 0.12);
    (u.uSunColor.value as THREE.Color).copy(SUN_WARM).lerp(SUN_WHITE, clamp01(s / 0.45)).multiplyScalar(sunUp);
    const night = clamp01((0.1 - s) / 0.45);
    u.uNight.value = night;
    const moonVis = clamp01((-s - 0.02) / 0.1);
    u.uMoonVis.value = moonVis;
    (u.uMoonColor.value as THREE.Color).copy(MOON).multiplyScalar(moonVis);

    // Water glint follows the sun by day and the moon by night.
    if (s > -0.02) {
      this.glintDir.copy(u.uSunDir.value as THREE.Vector3);
      this.glintColor.copy(u.uSunColor.value as THREE.Color);
    } else {
      this.glintDir.copy(u.uMoonDir.value as THREE.Vector3);
      this.glintColor.copy(u.uMoonColor.value as THREE.Color).multiplyScalar(0.6);
    }

    // Cards pick up a little of the light: cool at night, warm around sunrise/sunset.
    const golden = clamp01(1 - Math.abs(s) / 0.3) * (1 - night);
    this.tint.setRGB(1, 1, 1).lerp(NIGHT_TINT, night * 0.8).multiply(this.c.setRGB(1, 1, 1).lerp(GOLD_TINT, golden * 0.7));

    // Floating motes: faint warm dust by day, golden at sunrise/sunset, cool sparkles at night.
    this.particleColor
      .setRGB(1.0, 0.95, 0.86)
      .multiplyScalar(0.5)
      .lerp(this.c.setRGB(1.0, 0.7, 0.4).multiplyScalar(1.0), golden)
      .lerp(this.c.setRGB(0.62, 0.76, 1.0).multiplyScalar(0.9), night);

    // Sky brightness where the corner text sits (~15° up) decides light vs dark text.
    const c = this.c.copy(u.uHorizon.value as THREE.Color).lerp(u.uZenith.value as THREE.Color, Math.pow(Math.sin(0.26), 0.45));
    this.uiTone = tone(lum(c));
    // Just below the horizon the water mostly mirrors the horizon colour, with a little depth showing.
    this.labelTone = tone(lum(c.copy(u.uHorizon.value as THREE.Color).lerp(this.deep, 0.25)));
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.moonMap.dispose();
  }
}
