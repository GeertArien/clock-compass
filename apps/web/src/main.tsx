import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { BrowserRouter } from "react-router";
import { Root } from "./App";
import "./app.css";

registerSW({ immediate: true });

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    {/* Every screen has its own path (/clock/today, /compass/people, …); see
        lib/nav.ts. Notification links (/?go=…) redirect on launch, and the
        service worker's "navigate" message is routed in useScreenEffects. */}
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </StrictMode>,
);
