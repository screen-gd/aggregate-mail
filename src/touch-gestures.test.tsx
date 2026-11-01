import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { useSwipe } from "./ui/useSwipe";
import { ToastStack } from "./ui/Toasts";

test("touch swipes preserve scrolling, controls, zoom, selection and browser edges", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  const actions: string[] = [];
  let clicks = 0;
  function Harness({ enabled = true, name = "", onHold }: { enabled?: boolean; name?: string; onHold?: () => void }) {
    const ref = useSwipe(direction => actions.push(name + direction), enabled, onHold);
    return <div ref={ref} className={name === "toast:" ? "toast" : ""}><span id="surface">Surface</span>
      <button className="row" onClick={() => clicks++}>Mail</button><button id="control" onClick={() => clicks++}>Action</button>
      <div role="dialog"><span id="dialog-content">Filter options</span></div>
      <details><summary>Options</summary></details><label>Field</label>
      <input /><div id="horizontal" style={{ overflowX: "auto" }}>Scrollable</div></div>;
  }
  const point = (x: number, y: number, identifier = 1) => ({ clientX: x, clientY: y, identifier });
  const touch = (target: Element, type: string, points: ReturnType<typeof point>[]) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { touches: { value: type === "touchend" ? [] : points }, changedTouches: { value: points } });
    target.dispatchEvent(event);
    return event;
  };
  try {
    await act(async () => root.render(<Harness />));
    const surface = dom.window.document.getElementById("surface")!;
    const swipe = (target: Element = surface, x = 100, y = 100, endX = 200, endY = 100) => {
      touch(target, "touchstart", [point(x, y)]);
      const move = touch(target, "touchmove", [point(endX, endY)]);
      touch(target, "touchend", [point(endX, endY)]);
      return move.defaultPrevented;
    };
    assert.equal(swipe(), true);
    swipe(surface, 200, 100, 100, 100);
    assert.deepEqual(actions, ["right", "left"]);
    actions.length = 0;
    assert.equal(swipe(surface, 100, 100, 105, 220), false, "vertical scroll stays native");
    swipe(surface, 100, 100, 200, 180);
    swipe(surface, 10, 100, 110, 100);
    swipe(surface, 100, 100, 140, 100);
    swipe(dom.window.document.getElementById("control")!);
    swipe(dom.window.document.querySelector("input")!);
    swipe(dom.window.document.getElementById("dialog-content")!);
    swipe(dom.window.document.querySelector("summary")!);
    swipe(dom.window.document.querySelector("label")!);
    const scroll = dom.window.document.getElementById("horizontal")!;
    Object.defineProperties(scroll, { scrollWidth: { value: 400 }, clientWidth: { value: 100 } });
    swipe(scroll);
    touch(surface, "touchstart", [point(100, 100)]);
    assert.equal(touch(surface, "touchmove", [point(200, 100), point(220, 100, 2)]).defaultPrevented, false);
    touch(surface, "touchend", [point(200, 100)]);
    touch(surface, "touchstart", [point(100, 100)]);
    touch(surface, "touchcancel", []);
    touch(surface, "touchend", [point(200, 100)]);
    const range = dom.window.document.createRange(); range.selectNodeContents(surface);
    dom.window.getSelection()!.addRange(range); swipe(); dom.window.getSelection()!.removeAllRanges();
    Object.defineProperty(dom.window, "visualViewport", { configurable: true, value: { scale: 2 } });
    swipe();
    Object.defineProperty(dom.window, "visualViewport", { configurable: true, value: undefined });
    assert.deepEqual(actions, [], "rejected gestures do not navigate");
    const row = dom.window.document.querySelector(".row")!;
    swipe(row);
    row.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    assert.equal(clicks, 0, "swiping a row must not also open it");
    row.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, detail: 0 }));
    assert.equal(clicks, 1, "keyboard activation still works");
    swipe(row);
    const control = dom.window.document.getElementById("control")!;
    touch(control, "touchstart", [point(150, 100)]);
    touch(control, "touchend", [point(150, 100)]);
    control.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    assert.equal(clicks, 2, "a fresh tap after a swipe is never swallowed");
    actions.length = 0;
    await act(async () => root.render(<Harness enabled={false} />)); swipe();
    assert.deepEqual(actions, []);
    await act(async () => root.render(<Harness name="toast:" />)); swipe();
    assert.deepEqual(actions, ["toast:right"], "current callback is used after rerender");
    actions.length = 0;
    swipe(dom.window.document.getElementById("control")!);
    assert.deepEqual(actions, [], "toast action controls remain taps");
    let holds = 0;
    const onHold = () => { holds++; };
    await act(async () => root.render(<Harness onHold={onHold} />));
    const holdRow = dom.window.document.querySelector(".row")!;
    await act(async () => {
      touch(holdRow, "touchstart", [point(150, 100)]);
      await new Promise(resolve => setTimeout(resolve, 480));
    });
    assert.equal(holds, 1);
    touch(holdRow, "touchend", [point(150, 100)]);
    const beforeClick = clicks;
    // Disabling after a gesture must retain suppression of its synthesized click.
    await act(async () => root.render(<Harness enabled={false} onHold={onHold} />));
    holdRow.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    assert.equal(clicks, beforeClick);
    for (const cancelKind of ["scroll", "cancel", "blur", "disable", "pinch", "inert"] as const) {
      await act(async () => root.render(<Harness onHold={onHold} />));
      const target = dom.window.document.querySelector(".row")!;
      if (cancelKind === "inert") target.parentElement!.setAttribute("inert", "");
      touch(target, "touchstart", [point(150, 100)]);
      if (cancelKind === "scroll") touch(target, "touchmove", [point(150, 130)]);
      if (cancelKind === "cancel") touch(target, "touchcancel", []);
      if (cancelKind === "blur") dom.window.dispatchEvent(new dom.window.Event("blur"));
      if (cancelKind === "pinch") touch(target, "touchstart", [point(150, 100), point(170, 100, 2)]);
      if (cancelKind === "disable") await act(async () => root.render(<Harness enabled={false} onHold={onHold} />));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 480)); });
      touch(target, "touchend", [point(150, 100)]);
      target.parentElement!.removeAttribute("inert");
      assert.equal(holds, 1, cancelKind + " cancels the hold");
    }
    const dismissed: number[] = [];
    dom.window.matchMedia = (() => ({ matches: true })) as unknown as typeof dom.window.matchMedia;
    await act(async () => root.render(<div role="dialog"><ToastStack toasts={[{ id: 42, text: "Needs attention", kind: "error", duration: 0 }]}
      onDismiss={id => dismissed.push(id)} /></div>));
    await act(async () => { swipe(dom.window.document.querySelector(".toast-text")!); });
    assert.deepEqual(dismissed, [42], "a real notification swipe uses its existing dismissal action");
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
});
