import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { projects } from "../data/projects";
import { Engine } from "../scene/engine";
import type { View } from "../scene/engine";
import styles from "./Stage.module.css";

interface Props {
  capture: boolean;
  engineRef: RefObject<Engine | null>;
  onProgress: (pct: number) => void;
  onReady: () => void;
  onOpen: (index: number | null) => void;
  onView: (view: View) => void;
}

export default function Stage({ capture, engineRef, onProgress, onReady, onOpen, onView }: Props) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Created here (not in JSX) so StrictMode's double-mount gets a fresh canvas and a fresh WebGL context each time.
    const canvas = document.createElement("canvas");
    canvas.className = styles.canvas;
    canvas.setAttribute("aria-label", "Featured cases carousel. Drag, scroll or use the arrow keys to browse.");
    host.current!.appendChild(canvas);
    const list = document.querySelector<HTMLElement>("ul[data-full-list]")!;
    const tone = Array.from(document.querySelectorAll<HTMLElement>("[data-tone]"));
    const engine = new Engine({ canvas, list, tone, projects, capture, onProgress, onReady, onOpen, onView });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
      canvas.remove();
    };
  }, [capture, engineRef, onProgress, onReady, onOpen, onView]);

  return <div ref={host} />;
}
