import * as THREE from "three";
import type { Project } from "../data/projects";
import { Carousel } from "./carousel";
import { FullView } from "./full";
import { MediaLibrary } from "./media";
import { Transition } from "./transition";

export type View = "featured" | "full";

export interface CaptureApi {
  stepSize: number;
  setView(view: View): void;
  scrollTo(target: number): void;
  hoverCard(x: number, y: number): void;
  leave(): void;
  hoverName(index: number): void;
  step(dt: number): Promise<void>;
}

declare global {
  interface Window {
    __capture?: CaptureApi;
  }
}

interface Options {
  canvas: HTMLCanvasElement;
  list: HTMLElement;
  tone: HTMLElement[];
  projects: Project[];
  capture: boolean;
  onProgress: (pct: number) => void;
  onReady: () => void;
  onOpen: (index: number | null) => void;
  onView: (view: View) => void;
}

const LIGHT = [242, 242, 242];
const DARK = [14, 16, 20]; // corner text over a bright sky (M6)
const delay = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** Owns the renderer and the loop; React talks to it through setView / setCaseOpen / hoverName / openName. */
export class Engine {
  private o: Options;
  private renderer: THREE.WebGLRenderer;
  private timer = new THREE.Timer();
  private manager: THREE.LoadingManager;
  private loaded: Promise<void>;
  private media: MediaLibrary;
  private transition = new Transition();
  private carousel: Carousel | null = null;
  private full: FullView | null = null;
  private view: View = "featured";
  private caseOpen = false;
  private disposed = false;
  private toneValue = 0;
  private toneApplied = -1;
  private captureTime = 0;

  constructor(o: Options) {
    this.o = o;
    this.renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: o.capture });
    this.renderer.setClearColor(0x000000, 1);

    this.manager = new THREE.LoadingManager();
    this.loaded = new Promise<void>((resolve) => {
      this.manager.onLoad = () => resolve();
    });
    this.manager.onProgress = (_url, loaded, total) => o.onProgress(Math.round((loaded / total) * 100));
    this.media = new MediaLibrary(this.renderer, o.projects, this.manager);
    if (o.capture) this.media.manual = true;

    void this.start();
  }

  private get blocked() {
    return this.caseOpen || this.transition.active;
  }

  private async start() {
    // Titles and the list are painted to canvas, so the font must be there.
    await Promise.race([
      (async () => {
        await document.fonts.load('400 64px "Inter Tight"');
        await document.fonts.ready;
      })(),
      delay(2500),
    ]);
    if (this.disposed) return;

    this.carousel = new Carousel({
      renderer: this.renderer,
      canvas: this.o.canvas,
      media: this.media,
      projects: this.o.projects,
      isBlocked: () => this.view !== "featured" || this.blocked,
      onOpen: (i) => this.o.onOpen(i),
    });
    this.full = new FullView(this.o.list, this.media);
    window.addEventListener("resize", this.onResize);
    this.onResize();

    this.timer.connect(document); // no giant delta after a hidden tab
    if (!this.o.capture) {
      this.renderer.setAnimationLoop((timestamp: number) => {
        this.timer.update(timestamp);
        this.frame(Math.min(this.timer.getDelta(), 1 / 20), this.timer.getElapsed());
      });
    }

    await Promise.race([this.loaded, delay(6000)]);
    if (this.disposed) return;
    this.o.onReady();
    this.carousel.intro();
    this.full.invalidate();
    if (this.o.capture) this.exposeCapture();
  }

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio, 1.75);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.carousel?.resize(w, h, dpr);
    this.full?.resize(w, h, dpr);
    this.transition.resize(w, h, dpr);
  };

  setView(next: View) {
    const { carousel, full } = this;
    if (!carousel || !full || next === this.view || this.transition.active) return;
    const prev = this.view;
    this.view = next;
    delete this.o.canvas.dataset.hover;
    if (prev === "full") full.setHovered(-1);
    const ref = (v: View) => (v === "featured" ? { scene: carousel.scene, camera: carousel.camera } : { scene: full.scene, camera: full.camera });
    this.transition.start(ref(prev), ref(next));
    this.o.onView(next);
  }

  setCaseOpen(open: boolean) {
    this.caseOpen = open;
    if (open) {
      this.carousel?.leave();
      delete this.o.canvas.dataset.hover;
    }
  }

  hoverName(index: number) {
    if (this.view !== "full") return;
    this.full?.setHovered(index);
  }

  openName(index: number) {
    if (this.caseOpen || this.transition.active || this.view !== "full") return;
    this.o.onOpen(index);
  }

  private frame(dt: number, time: number) {
    const { carousel, full, transition, renderer } = this;
    if (!carousel || !full) return;
    if (this.view === "featured" || transition.active) carousel.update(dt, time, this.view === "featured" && !this.blocked);
    if (this.view === "full" || transition.active) full.update(dt);
    this.media.enabled = !this.caseOpen;
    this.media.update();
    this.updateTone(dt, carousel);
    if (transition.active) {
      transition.render(renderer, dt, time);
    } else {
      const v = this.view === "featured" ? carousel : full;
      renderer.render(v.scene, v.camera);
    }
  }

  /** M6: the two top corner links follow the light of the sky. */
  private updateTone(dt: number, carousel: Carousel) {
    const live = this.view === "featured" && !this.transition.active && !this.caseOpen;
    const target = live ? carousel.uiTone : 0;
    this.toneValue += (target - this.toneValue) * (1 - Math.exp(-6 * dt));
    if (Math.abs(this.toneValue - this.toneApplied) < 0.01) return;
    this.toneApplied = this.toneValue;
    const c = LIGHT.map((l, i) => Math.round(l + (DARK[i] - l) * this.toneValue)).join(", ");
    for (const el of this.o.tone) {
      el.style.setProperty("--fg", `rgb(${c})`);
      el.style.setProperty("--muted", `rgba(${c}, 0.5)`);
    }
  }

  private exposeCapture() {
    const carousel = this.carousel!;
    const full = this.full!;
    window.__capture = {
      stepSize: carousel.stepSize,
      setView: (v) => this.setView(v),
      scrollTo: (t) => carousel.scrollTo(t),
      hoverCard: (x, y) => carousel.setPointerNdc(x, y),
      leave: () => carousel.leave(),
      hoverName: (i) => (i < 0 ? full.setHovered(-1) : full.hoverLinkCentre(i)),
      step: async (dt) => {
        this.captureTime += dt;
        await this.media.advance(dt);
        this.frame(dt, this.captureTime);
      },
    };
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener("resize", this.onResize);
    delete window.__capture;
    this.timer.dispose();
    this.carousel?.dispose();
    this.full?.dispose();
    this.transition.dispose();
    this.media.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
