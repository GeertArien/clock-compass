import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { navStore } from "@/lib/stores/nav";
import "./app.css";

registerSW({ immediate: true });

// Notification deep links: "/?go=compass.people" opens the People screen, both
// on launch and when the service worker asks an open tab to navigate.
navStore.navigateTo(location.href, location.origin);
navigator.serviceWorker?.addEventListener("message", (event) => {
  if (event.data?.type === "navigate" && typeof event.data.url === "string") {
    navStore.navigateTo(event.data.url, location.origin);
  }
});

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
