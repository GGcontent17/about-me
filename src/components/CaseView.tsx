import { useEffect, useRef, useState } from "react";
import type { Project } from "../data/projects";
import { posterUrl, videoUrl } from "../data/projects";
import styles from "./CaseView.module.css";

interface Props {
  projects: Project[];
  index: number | null;
  onClose: () => void;
  onStep: (dir: number) => void;
}

export default function CaseView({ projects, index, onClose, onStep }: Props) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const isOpen = index !== null;

  useEffect(() => {
    if (index === null) return;
    setShown(index);
  }, [index]);

  // Open / close
  useEffect(() => {
    if (isOpen) {
      window.clearTimeout(hideTimer.current);
      if (!mounted) returnFocus.current = document.activeElement;
      setMounted(true);
      const id = requestAnimationFrame(() => {
        setOpen(true);
        closeBtn.current?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(id);
    }
    if (mounted) {
      setOpen(false);
      video.current?.pause();
      (returnFocus.current as HTMLElement | null)?.focus?.({ preventScroll: true });
      hideTimer.current = window.setTimeout(() => {
        const v = video.current;
        if (v) {
          v.removeAttribute("src");
          v.load();
        }
        setMounted(false);
      }, 500);
      return () => window.clearTimeout(hideTimer.current);
    }
  }, [isOpen, mounted]);

  // Play whenever the shown case changes
  useEffect(() => {
    if (isOpen && mounted) video.current?.play().catch(() => {});
  }, [shown, isOpen, mounted]);

  // Keys
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onStep(1);
      else if (e.key === "ArrowLeft") onStep(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose, onStep]);

  const project = projects[shown];

  return (
    <div
      ref={root}
      className={`${styles.root} ${open ? styles.open : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="case-title"
      hidden={!mounted}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.frame}>
        {mounted && <img className={styles.layer} alt="" crossOrigin="anonymous" src={posterUrl(project, 1440)} />}
        {mounted && (
          <video
            key={project.slug}
            ref={video}
            className={styles.layer}
            muted
            loop
            playsInline
            preload="auto"
            crossOrigin="anonymous"
            src={videoUrl(project)}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              v.currentTime = Math.min(project.start, v.duration);
              v.play().catch(() => {});
            }}
          />
        )}
      </div>
      <div className={styles.meta}>
        <span className={styles.no}>Case {String(project.no).padStart(2, "0")}</span>
        <h2 id="case-title">{project.title}</h2>
      </div>
      <div className={styles.step}>
        <button aria-label="Previous case" onClick={() => onStep(-1)}>
          Prev
        </button>
        <span aria-hidden="true">/</span>
        <button aria-label="Next case" onClick={() => onStep(1)}>
          Next
        </button>
      </div>
      <button ref={closeBtn} className={styles.close} onClick={onClose}>
        Close
      </button>
    </div>
  );
}
