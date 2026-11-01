import { useEffect, useRef } from "react";

// Touch-only horizontal swipes. Leave scrolling, zoom and browser edge gestures native.
export function useSwipe(onSwipe: (direction: "left" | "right") => void, enabled = true, onHold?: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const action = useRef(onSwipe);
  action.current = onSwipe;
  const hold = useRef(onHold);
  hold.current = onHold;
  const suppressClickUntil = useRef(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const freshTouch = () => { suppressClickUntil.current = 0; };
    const click = (event: MouseEvent) => {
      if (event.detail > 0 && Date.now() < suppressClickUntil.current) {
        suppressClickUntil.current = 0;
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    element.addEventListener("click", click, true);
    element.addEventListener("touchstart", freshTouch, { passive: true });
    return () => {
      element.removeEventListener("click", click, true);
      element.removeEventListener("touchstart", freshTouch);
    };
  }, []);
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    const win = element.ownerDocument.defaultView!;
    let start: { id: number; x: number; y: number; at: number; horizontal: boolean; held?: boolean } | undefined;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    const clearHold = () => { clearTimeout(holdTimer); holdTimer = undefined; };
    const cancel = () => { clearHold(); start = undefined; };
    const selected = () => !!win.getSelection()?.toString();
    const begin = (event: TouchEvent) => {
      cancel();
      if (event.defaultPrevented || event.touches.length !== 1 || selected() || element.closest("[inert]") || (win.visualViewport?.scale ?? 1) > 1) return;
      const target = event.target as Element;
      const mailSurface = target.closest("[data-mail-gestures]");
      if (mailSurface && mailSurface !== element) return;
      if (target.closest('a, button:not(.row), input, select, textarea, summary, label, dialog, [role="dialog"], [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="menu"], .toast-stack') && !element.classList.contains("toast")) return;
      if (element.classList.contains("toast") && target.closest("button, a, summary, label")) return;
      // A horizontally scrollable table or tab strip owns its own gesture.
      for (let node: Element | null = target; node; node = node.parentElement) {
        if (node.scrollWidth > node.clientWidth + 1 && /auto|scroll/.test(win.getComputedStyle(node).overflowX)) return;
        if (node === element) break;
      }
      const touch = event.touches[0];
      if (touch.clientX < 24 || touch.clientX > win.innerWidth - 24) return;
      start = { id: touch.identifier, x: touch.clientX, y: touch.clientY, at: Date.now(), horizontal: false };
      if (hold.current) holdTimer = setTimeout(() => {
        if (!start || selected() || !element.isConnected || element.closest("[inert]")) return;
        start.held = true;
        suppressClickUntil.current = Date.now() + 500;
        hold.current?.();
      }, 450);
    };
    const move = (event: TouchEvent) => {
      if (!start) return;
      if (event.touches.length !== 1 || selected()) { cancel(); return; }
      const touch = event.touches[0];
      if (touch.identifier !== start.id) { cancel(); return; }
      const dx = Math.abs(touch.clientX - start.x), dy = Math.abs(touch.clientY - start.y);
      if (Math.max(dx, dy) >= 10) clearHold();
      if (start.held) { if (event.cancelable) event.preventDefault(); return; }
      if (!start.horizontal && Math.max(dx, dy) >= 12) {
        if (dx < dy * 2) { cancel(); return; }
        start.horizontal = true;
      }
      if (start.horizontal) {
        if (!event.cancelable) { cancel(); return; }
        event.preventDefault();
      }
    };
    const end = (event: TouchEvent) => {
      const initial = start;
      cancel();
      if (!initial || event.touches.length || selected()) return;
      if (initial.held) {
        suppressClickUntil.current = Date.now() + 500;
        if (event.cancelable) event.preventDefault();
        return;
      }
      const touch = Array.from(event.changedTouches).find(value => value.identifier === initial.id);
      if (!touch) return;
      const dx = touch.clientX - initial.x, dy = touch.clientY - initial.y;
      if (!initial.horizontal || Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - initial.at > 700) return;
      suppressClickUntil.current = Date.now() + 500;
      if (event.cancelable) event.preventDefault();
      action.current(dx > 0 ? "right" : "left");
    };
    const context = (event: MouseEvent) => {
      if (hold.current && (start || Date.now() < suppressClickUntil.current)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    element.addEventListener("touchstart", begin, { passive: true });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end, { passive: false });
    element.addEventListener("touchcancel", cancel);
    element.addEventListener("contextmenu", context, true);
    win.addEventListener("blur", cancel);
    return () => {
      cancel();
      element.removeEventListener("touchstart", begin);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", cancel);
      element.removeEventListener("contextmenu", context, true);
      win.removeEventListener("blur", cancel);
    };
  }, [enabled]);
  return ref;
}
