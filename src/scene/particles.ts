import * as THREE from "three";

interface Options {
  count: number;
  min: THREE.Vector3;
  max: THREE.Vector3;
  fade: THREE.IUniform<number>;
}

const VERT = /* glsl */ `
attribute vec4 seed;
uniform float uTime;
uniform float uOffset;
uniform float uSize;
uniform float uScale;
uniform vec3 uMin;
uniform vec3 uExtent;
varying float vAlpha;

void main() {
  vec3 p = uMin + position * uExtent;
  // Slow drift, plus a share of the scroll so nearer motes slide past faster (parallax).
  p.x += uTime * (0.015 + seed.x * 0.035) + uOffset * (0.3 + 0.7 * position.z);
  float ex = fract((p.x - uMin.x) / uExtent.x);
  p.x = uMin.x + ex * uExtent.x;
  p.y += sin(uTime * (0.25 + seed.y * 0.35) + seed.z * 6.2831) * 0.05;
  p.z += cos(uTime * (0.2 + seed.w * 0.3) + seed.x * 6.2831) * 0.04;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.4 + seed.w) * uScale / -mv.z;

  float twinkle = pow(0.5 + 0.5 * sin(uTime * (0.6 + seed.y * 1.8) + seed.x * 40.0), 3.0);
  vAlpha = (0.35 + 0.65 * twinkle) * smoothstep(0.0, 0.08, ex) * smoothstep(1.0, 0.92, ex);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uFade;
varying float vAlpha;

void main() {
  float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(uColor * a * a * vAlpha * uFade, 1.0);
  #include <colorspace_fragment>
}
`;

/** Floating motes drifting over the water. */
export class Particles {
  points: THREE.Points;
  private uniforms: Record<string, THREE.IUniform>;

  constructor(o: Options) {
    const positions = new Float32Array(o.count * 3);
    const seeds = new Float32Array(o.count * 4);
    for (let i = 0; i < o.count; i++) {
      positions.set([Math.random(), Math.random(), Math.random()], i * 3);
      seeds.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 4));
    this.uniforms = {
      uTime: { value: 0 },
      uOffset: { value: 0 },
      uSize: { value: 0.026 },
      uScale: { value: 500 },
      uMin: { value: o.min.clone() },
      uExtent: { value: o.max.clone().sub(o.min) },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uFade: o.fade,
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
  }

  resize(heightPx: number, fov: number) {
    this.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
  }

  update(time: number, scroll: number, color: THREE.Color) {
    this.uniforms.uTime.value = time;
    this.uniforms.uOffset.value = -scroll * 0.35;
    (this.uniforms.uColor.value as THREE.Color).copy(color);
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
