import styles from "./Loader.module.css";

export default function Loader({ pct, loading }: { pct: number; loading: boolean }) {
  return (
    <div className={`${styles.root} ${loading ? "" : styles.done}`} aria-hidden="true">
      <span>Godspeed Guinto</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{pct}</span>
    </div>
  );
}
