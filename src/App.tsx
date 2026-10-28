import { useCallback, useEffect, useRef, useState } from "react";
import { projects } from "./data/projects";
import type { Engine, View } from "./scene/engine";
import Stage from "./components/Stage";
import FullList from "./components/FullList";
import Chrome from "./components/Chrome";
import CaseView from "./components/CaseView";
import Loader from "./components/Loader";

export default function App({ capture }: { capture: boolean }) {
  const [pct, setPct] = useState(0);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("featured");
  const [caseIndex, setCaseIndex] = useState<number | null>(null);
  const engineRef = useRef<Engine | null>(null);

  const onReady = useCallback(() => setLoading(false), []);
  const onClose = useCallback(() => setCaseIndex(null), []);
  const onStep = useCallback((dir: number) => {
    const n = projects.length;
    setCaseIndex((i) => (i === null ? i : (((i + dir) % n) + n) % n));
  }, []);

  useEffect(() => {
    engineRef.current?.setCaseOpen(caseIndex !== null);
  }, [caseIndex]);

  return (
    <>
      <Stage capture={capture} engineRef={engineRef} onProgress={setPct} onReady={onReady} onOpen={setCaseIndex} onView={setView} />
      <FullList view={view} engineRef={engineRef} />
      <Chrome view={view} loading={loading} engineRef={engineRef} />
      <CaseView projects={projects} index={caseIndex} onClose={onClose} onStep={onStep} />
      <Loader pct={pct} loading={loading} />
    </>
  );
}
