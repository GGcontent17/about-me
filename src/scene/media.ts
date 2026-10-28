import * as THREE from "three";
import type { Project } from "../data/projects";
import { posterUrl, videoUrl } from "../data/projects";

interface Item {
  project: Project;
  poster: THREE.Texture;
  video: HTMLVideoElement;
  videoTexture: THREE.VideoTexture;
  loaded: boolean; // its src is set
  ready: boolean; // the video has started playing at least once
  lastWanted: number;
  lastWantedFrame: number;
}

const waitFor = (target: EventTarget, type: string, ms: number) =>
  new Promise<void>((resolve) => {
    const done = () => {
      window.clearTimeout(t);
      target.removeEventListener(type, done);
      resolve();
    };
    const t = window.setTimeout(done, ms);
    target.addEventListener(type, done, { once: true });
  });

/** One poster texture and one <video> (with its texture) per case, shared by the Featured and Full views. */
export class MediaLibrary {
  enabled = true;
  manual = false; // capture mode: no automatic play / pause
  private items: Item[];
  private frameCount = 0;

  constructor(renderer: THREE.WebGLRenderer, projects: Project[], manager: THREE.LoadingManager) {
    const loader = new THREE.TextureLoader(manager);
    const aniso = renderer.capabilities.getMaxAnisotropy();
    this.items = projects.map((project) => {
      const poster = loader.load(posterUrl(project));
      poster.colorSpace = THREE.SRGBColorSpace;
      poster.anisotropy = aniso;
      const video = document.createElement("video");
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.crossOrigin = "anonymous";
      video.preload = "none";
      video.setAttribute("muted", "");
      video.setAttribute("playsinline", "");
      const videoTexture = new THREE.VideoTexture(video);
      videoTexture.colorSpace = THREE.SRGBColorSpace;
      videoTexture.minFilter = THREE.LinearFilter;
      videoTexture.magFilter = THREE.LinearFilter;
      videoTexture.generateMipmaps = false;
      const item: Item = { project, poster, video, videoTexture, loaded: false, ready: false, lastWanted: -1, lastWantedFrame: -10 };
      video.addEventListener("loadedmetadata", () => {
        video.currentTime = Math.min(project.start, video.duration);
      });
      video.addEventListener("playing", () => {
        item.ready = true;
      });
      return item;
    });
  }

  get(i: number): { texture: THREE.Texture } {
    const it = this.items[i];
    return { texture: it.ready ? it.videoTexture : it.poster };
  }

  prefetch(i: number) {
    const it = this.items[i];
    if (it.loaded) return;
    it.loaded = true;
    it.video.preload = "auto";
    it.video.src = videoUrl(it.project);
  }

  want(i: number) {
    this.prefetch(i);
    const it = this.items[i];
    it.lastWanted = performance.now() / 1000;
    it.lastWantedFrame = this.frameCount;
  }

  /** At most one wanted video decodes at a time. */
  update() {
    if (this.manual) return;
    const now = performance.now() / 1000;
    for (const it of this.items) {
      const wanted = this.enabled && now - it.lastWanted < 0.1;
      if (wanted && it.loaded && it.video.paused) it.video.play().catch(() => {});
      else if (!wanted && !it.video.paused) it.video.pause();
    }
  }

  /** Capture mode: step every wanted video by dt, frame-exact. */
  async advance(dt: number) {
    this.frameCount++;
    const jobs: Promise<void>[] = [];
    for (const it of this.items) {
      if (!this.enabled || !it.loaded || it.lastWantedFrame < this.frameCount - 1) continue;
      jobs.push(
        (async () => {
          const v = it.video;
          if (v.readyState < 2) await waitFor(v, "loadeddata", 8000);
          if (v.seeking) await waitFor(v, "seeked", 4000);
          if (!v.duration) return;
          v.currentTime = (v.currentTime + dt) % v.duration;
          await waitFor(v, "seeked", 4000);
          it.ready = true;
          it.videoTexture.needsUpdate = true;
        })(),
      );
    }
    await Promise.all(jobs);
  }

  dispose() {
    for (const it of this.items) {
      it.video.pause();
      it.video.removeAttribute("src");
      it.video.load();
      it.poster.dispose();
      it.videoTexture.dispose();
    }
  }
}
