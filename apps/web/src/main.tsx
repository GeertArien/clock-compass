import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { BrowserRouter } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { Root } from "./App";
import { historyLayers } from "@/lib/use-history-layer";
import { queryClient } from "@/lib/query-client";
// Starts following the device's mode when the choice is "Follow the device" (#95).
import "@/lib/theme";
// Reports this device's zone to the server, now and on return to the foreground (#136).
import "@/lib/time-zone";
import "./app.css";

registerSW({ immediate: true });

// A sheet that was open before a reload left its history entry behind; step
// off it so the next back navigates.
historyLayers.start();

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    {/* Every screen has its own path (/clock/today, /compass/people, …); see
        lib/nav.ts. Notification links (/?go=…) redirect on launch, and the
        service worker's "navigate" message is routed in useScreenEffects. */}
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Root />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
