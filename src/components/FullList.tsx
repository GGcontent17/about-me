import { Fragment } from "react";
import type { RefObject } from "react";
import { projects } from "../data/projects";
import type { Engine, View } from "../scene/engine";
import styles from "./FullList.module.css";

interface Props {
  view: View;
  engineRef: RefObject<Engine | null>;
}

export default function FullList({ view, engineRef }: Props) {
  const hover = (i: number) => engineRef.current?.hoverName(i);
  return (
    <section className={`${styles.root} ${view === "full" ? styles.on : ""}`} aria-label="All cases" aria-hidden={view !== "full"}>
      <ul className={styles.list} data-full-list>
        {projects.map((p, i) => (
          <Fragment key={p.slug}>
            <li style={{ display: "inline" }}>
              <a
                className={styles.link}
                href={`#${p.slug}`}
                onPointerEnter={() => hover(i)}
                onFocus={() => hover(i)}
                onPointerLeave={() => hover(-1)}
                onBlur={() => hover(-1)}
                onClick={(e) => {
                  e.preventDefault();
                  engineRef.current?.openName(i);
                }}
              >
                {p.title}
              </a>
              {i < projects.length - 1 && (
                <span className={styles.sep} aria-hidden="true">
                  ·
                </span>
              )}
            </li>{" "}
          </Fragment>
        ))}
      </ul>
    </section>
  );
}
