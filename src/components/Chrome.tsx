import type { RefObject } from "react";
import type { Engine, View } from "../scene/engine";
import styles from "./Chrome.module.css";

interface Props {
  view: View;
  loading: boolean;
  engineRef: RefObject<Engine | null>;
}

export default function Chrome({ view, loading, engineRef }: Props) {
  return (
    <header className={`${styles.header} ${loading ? styles.loading : ""}`}>
      <a className={`${styles.item} ${styles.tl} ${styles.link}`} href="./" data-tone>
        Godspeed Guinto
      </a>
      <a className={`${styles.item} ${styles.tr} ${styles.link}`} href="mailto:guinto.business@gmail.com" data-tone>
        Contact
      </a>
      <nav className={`${styles.item} ${styles.br} ${styles.switch}`} aria-label="Links">
        <a href="https://www.linkedin.com/in/godspeed-guinto-cpe-42a569302/" target="_blank" rel="noopener noreferrer">
          LinkedIn
        </a>
        <span aria-hidden="true">/</span>
        <a href="tel:09615943774">09615-943-774</a>
      </nav>
      <nav className={`${styles.item} ${styles.bl} ${styles.switch}`} aria-label="View">
        <button aria-pressed={view === "featured"} onClick={() => engineRef.current?.setView("featured")}>
          Featured
        </button>
        <span aria-hidden="true">/</span>
        <button aria-pressed={view === "full"} onClick={() => engineRef.current?.setView("full")}>
          Full
        </button>
      </nav>
    </header>
  );
}
