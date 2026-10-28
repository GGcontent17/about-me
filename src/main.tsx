import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/global.css";
import App from "./App";

const capture = new URLSearchParams(location.search).has("capture");
if (capture) document.documentElement.classList.add("capture");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App capture={capture} />
  </StrictMode>,
);
