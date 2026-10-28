/*
 * Water simulation + surface shading ported to three.js from WebGL Water —
 * http://madebyevan.com/webgl-water/ (https://github.com/evanw/webgl-water)
 * Copyright 2011 Evan Wallace, released under the MIT license.
 * Changes from the original: the heightfield wraps (so it can tile across open water instead of filling a pool),
 * and the surface reflects the live scene through a planar Reflector instead of ray-tracing pool walls and a sky cubemap.
 */
import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";

const SIM_SIZE = 256;
const TILE = 10; // world units per tile

const QUAD_VERT = /* glsl */ `
varying vec2 coord;
void main() {
  coord = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
const DROP_FRAG = /* glsl */ `
const float PI = 3.141592653589793;
uniform sampler2D tex;
uniform vec2 center;
uniform float radius;
uniform float strength;
varying vec2 coord;
void main() {
  vec4 info = texture2D(tex, coord);
  vec2 d = coord - center;
  d -= floor(d + 0.5); // the distance wraps: the field tiles
  float drop = max(0.0, 1.0 - length(d) / radius);
  drop = 0.5 - cos(drop * PI) * 0.5;
  info.r += drop * strength;
  gl_FragColor = info;
}
`;
const UPDATE_FRAG = /* glsl */ `
uniform sampler2D tex;
uniform vec2 delta;
varying vec2 coord;
void main() {
  vec4 info = texture2D(tex, coord);
  vec2 dx = vec2(delta.x, 0.0);
  vec2 dy = vec2(0.0, delta.y);
  float average = (
    texture2D(tex, coord - dx).r +
    texture2D(tex, coord - dy).r +
    texture2D(tex, coord + dx).r +
    texture2D(tex, coord + dy).r
  ) * 0.25;
  info.g += (average - info.r) * 2.0;
  info.g *= 0.995;
  info.r += info.g;
  gl_FragColor = info;
}
`;
const NORMAL_FRAG = /* glsl */ `
uniform sampler2D tex;
uniform vec2 delta;
varying vec2 coord;
void main() {
  vec4 info = texture2D(tex, coord);
  vec3 dx = vec3(delta.x, texture2D(tex, vec2(coord.x + delta.x, coord.y)).r - info.r, 0.0);
  vec3 dy = vec3(0.0, texture2D(tex, vec2(coord.x, coord.y + delta.y)).r - info.r, delta.y);
  info.ba = normalize(cross(dy, dx)).xz;
  gl_FragColor = info;
}
`;

export class WaterSim {
  private renderer: THREE.WebGLRenderer;
  private textureA: THREE.WebGLRenderTarget;
  private textureB: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private plane: THREE.Mesh;
  private dropShader: THREE.ShaderMaterial;
  private updateShader: THREE.ShaderMaterial;
  private normalShader: THREE.ShaderMaterial;
  private drops: number[] = [];
  private accumulator = 0;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    const make = () =>
      new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, {
        type: THREE.HalfFloatType,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        generateMipmaps: false,
      });
    this.textureA = make();
    this.textureB = make();
    const delta = () => new THREE.Vector2(1 / SIM_SIZE, 1 / SIM_SIZE);
    const mat = (fragmentShader: string, extra: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader,
        uniforms: { tex: { value: null }, delta: { value: delta() }, ...extra },
        depthTest: false,
        depthWrite: false,
      });
    this.dropShader = mat(DROP_FRAG, { center: { value: new THREE.Vector2() }, radius: { value: 0.03 }, strength: { value: 0.01 } });
    this.updateShader = mat(UPDATE_FRAG, {});
    this.normalShader = mat(NORMAL_FRAG, {});
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.updateShader);
    this.plane.frustumCulled = false;
    this.scene.add(this.plane);
  }

  get texture(): THREE.Texture {
    return this.textureA.texture;
  }

  /** World-space drop (x, z). Applied on the next step. */
  addDrop(x: number, z: number, radius: number, strength: number) {
    this.drops.push(x / TILE + 0.5, z / TILE + 0.5, radius, strength);
  }

  private draw(material: THREE.ShaderMaterial) {
    // render A through `material` into B, then swap
    material.uniforms.tex.value = this.textureA.texture;
    this.plane.material = material;
    this.renderer.setRenderTarget(this.textureB);
    this.renderer.render(this.scene, this.camera);
    [this.textureA, this.textureB] = [this.textureB, this.textureA];
  }

  /** Advance at a fixed 60 Hz (two sub-steps per tick, as in the original). */
  update(dt: number) {
    const prev = this.renderer.getRenderTarget();
    const d = this.drops;
    for (let i = 0; i < d.length; i += 4) {
      this.dropShader.uniforms.center.value.set(d[i], d[i + 1]);
      this.dropShader.uniforms.radius.value = d[i + 2];
      this.dropShader.uniforms.strength.value = d[i + 3];
      this.draw(this.dropShader);
    }
    d.length = 0;
    this.accumulator = Math.min(this.accumulator + dt, 3 / 60);
    let stepped = false;
    while (this.accumulator >= 1 / 60) {
      this.accumulator -= 1 / 60;
      this.draw(this.updateShader);
      this.draw(this.updateShader);
      stepped = true;
    }
    if (stepped) this.draw(this.normalShader);
    this.renderer.setRenderTarget(prev);
  }

  dispose() {
    this.textureA.dispose();
    this.textureB.dispose();
    this.plane.geometry.dispose();
    this.dropShader.dispose();
    this.updateShader.dispose();
    this.normalShader.dispose();
  }
}

const SURFACE_VERT = /* glsl */ `
uniform mat4 textureMatrix;
varying vec4 vReflUv;
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vReflUv = textureMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const SURFACE_FRAG = /* glsl */ `
uniform vec3 color; // required by Reflector, unused
uniform sampler2D tDiffuse; // planar reflection of the scene
uniform sampler2D tWater;
uniform float uTile;
uniform float uDistort;
uniform vec3 uGlintDir;
uniform vec3 uGlintColor;
uniform vec3 uDeep;
uniform vec3 uHorizon;
uniform float uFade;
varying vec4 vReflUv;
varying vec3 vWorld;

void main() {
  float dist = length(vWorld.xz - cameraPosition.xz);
  vec2 coord = vWorld.xz / uTile + 0.5;
  vec4 info = texture2D(tWater, coord);

  /* make water look more "peaked" */
  for (int i = 0; i < 5; i++) {
    coord += info.ba * 0.005;
    info = texture2D(tWater, coord);
  }

  /* far tiles shrink below a pixel and shimmer, so calm them */
  vec2 slope = info.ba * (1.0 - smoothstep(5.0, 18.0, dist));
  vec3 normal = vec3(slope.x, sqrt(max(0.0, 1.0 - dot(slope, slope))), slope.y);
  vec3 incomingRay = normalize(vWorld - cameraPosition);

  vec3 reflectedRay = reflect(incomingRay, normal);
  float fresnel = mix(0.25, 1.0, pow(1.0 - dot(normal, -incomingRay), 3.0));

  vec4 uv = vReflUv;
  uv.xy += normal.xz * uDistort * uv.w;
  vec3 reflectedColor = texture2DProj(tDiffuse, uv).rgb;
  float glint = max(0.0, dot(uGlintDir, reflectedRay));
  reflectedColor += vec3(pow(glint, 5000.0)) * vec3(10.0, 8.0, 6.0) * uGlintColor;
  /* broader lobe: the shimmering path of light under the sun or moon */
  reflectedColor += pow(glint, 260.0) * 0.5 * uGlintColor;
  vec3 refractedColor = uDeep;

  vec3 col = mix(refractedColor, reflectedColor, fresnel);
  col = mix(col, uHorizon, smoothstep(14.0, 90.0, dist));
  gl_FragColor = vec4(col * uFade, 1.0);
  #include <colorspace_fragment>
}
`;

export function createWaterSurface(waterY: number): Reflector {
  const surface = new Reflector(new THREE.PlaneGeometry(400, 400), {
    textureWidth: 512,
    textureHeight: 512,
    clipBias: 0.003,
    multisample: 0,
    shader: {
      name: "WebGLWaterSurface",
      uniforms: {
        color: { value: null },
        tDiffuse: { value: null },
        textureMatrix: { value: null },
        tWater: { value: null },
        uTile: { value: TILE },
        uDistort: { value: 0.25 },
        uGlintDir: { value: new THREE.Vector3(0, 1, 0) },
        uGlintColor: { value: new THREE.Color(0, 0, 0) },
        uDeep: { value: new THREE.Color(0, 0, 0) },
        uHorizon: { value: new THREE.Color(0, 0, 0) },
        uFade: { value: 0 },
      },
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
    },
  });
  surface.rotation.x = -Math.PI / 2;
  surface.position.set(0, waterY, -150);
  return surface;
}
