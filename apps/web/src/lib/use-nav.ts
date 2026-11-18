import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router";
import {
  appPathFor,
  pathFor,
  resolvePath,
  titleFor,
  type Mode,
  type NavState,
  type Sub,
} from "./nav";

const HOME: NavState = { mode: "clock", sub: "today" };

/**
 * The screen the URL points at. The app shell only renders on resolved paths
 * (see Root in App.tsx), so the fallback is never shown; it keeps the type
 * simple for components below the shell.
 */
export function useScreen(): NavState {
  const { pathname } = useLocation();
  const resolved = resolvePath(pathname);
  return "screen" in resolved ? resolved.screen : HOME;
}

/**
 * Go to a screen; without `sub`, the mode's default sub-tab. Going to the
 * screen already shown adds no history entry.
 */
export function useGo(): (mode: Mode, sub?: Sub) => void {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return useCallback(
    (mode: Mode, sub?: Sub) => {
      const to = pathFor(mode, sub);
      if (to !== pathname) navigate(to);
    },
    [navigate, pathname],
  );
}

const SCROLL_KEY = "cc-scroll";

function readPositions(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function writePosition(key: string, y: number): void {
  try {
    const positions = readPositions();
    positions[key] = y;
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify(positions));
  } catch {
    // Storage full or unavailable: scroll simply isn't restored.
  }
}

/**
 * Per-screen effects of the current location:
 * - the tab title names the screen;
 * - a new navigation starts at the top, while back/forward (and a reload)
 *   restore that history entry's scroll position;
 * - the service worker's "navigate" message (a tapped notification, with the
 *   app already open) goes through the router.
 */
export function useScreenEffects(screen: NavState): void {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = titleFor(screen);
  }, [screen]);

  // The browser would restore scroll before the screen has rendered; do it here.
  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  }, []);

  // Remember the current entry's position as the user scrolls. One listener,
  // writing to whichever entry is current: a listener per entry would let the
  // scroll-to-top of the next screen overwrite the previous entry's position.
  const currentKey = useRef(location.key);
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => writePosition(currentKey.current, window.scrollY));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Restore on POP (back/forward, reload), top on PUSH/REPLACE. Data may still
  // be arriving after a reload, so retry for a moment until the page is tall
  // enough to reach the saved position.
  useLayoutEffect(() => {
    currentKey.current = location.key;
    const target = navigationType === "POP" ? (readPositions()[location.key] ?? 0) : 0;
    window.scrollTo(0, target);
    if (target === 0) return;
    let frame = 0;
    const deadline = performance.now() + 1500;
    const retry = () => {
      if (Math.abs(window.scrollY - target) < 2 || performance.now() > deadline) return;
      window.scrollTo(0, target);
      frame = requestAnimationFrame(retry);
    };
    frame = requestAnimationFrame(retry);
    return () => cancelAnimationFrame(frame);
  }, [location.key, navigationType]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "navigate" && typeof event.data.url === "string") {
        navigate(appPathFor(event.data.url, window.location.origin));
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, [navigate]);
}
