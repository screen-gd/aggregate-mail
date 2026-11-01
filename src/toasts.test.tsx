import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { PrivacyContext } from "./ui/Privacy";
import { ToastStack, useToasts } from "./ui/Toasts";

test("notice stacks scroll within both viewport anchors with room for shadows and animations", () => {
  const css = readFileSync(new URL("./styles/mail-features.css", import.meta.url), "utf8");
  const rule = (selector: string) => css.slice(css.indexOf(`${selector} {`)).split("}")[0];
  const stack = rule(".toast-stack");
  assert.match(stack, /max-height:\s*calc\(100dvh - 44px\)/);
  assert.match(stack, /overflow-y:\s*auto/);
  assert.match(stack, /pointer-events:\s*none/, "clicks in the padding reach mail controls underneath");
  assert.match(rule(".toast"), /pointer-events:\s*auto/, "notices take clicks and wheel input, which scrolls the stack");
  assert.match(stack, /padding:\s*20px/, "shadows have room inside the scroll container");
  assert.match(stack, /bottom:\s*0/);
  assert.match(stack, /flex-direction:\s*column/);
  assert.match(rule(".toast-stack:empty"), /display:\s*none/, "empty padding does not block mail controls");
  const top = rule(".toast-stack-top-right");
  assert.match(top, /bottom:\s*auto/);
  assert.match(top, /top:\s*44px/, "padding leaves the first notice below the toolbar");
  assert.match(top, /flex-direction:\s*column-reverse/);
  assert.match(rule(".toast-stack-bottom-center"), /translateX\(-50%\)/);
  assert.match(rule(".toast-slot"), /flex-shrink:\s*0/, "multiline notices retain their full scrollable height");
  assert.match(rule(".toast-heading"), /flex-shrink:\s*0/, "the count and Dismiss all remain scrollable");
  assert.match(css, /animation: toast-slot-in 200ms/);
  assert.match(css, /\.toast-slot\.leaving\s*\{\s*grid-template-rows: 0fr/);
});

test("toasts queue without dropping errors, deduplicate, redact, pause expiry and dismiss", async (context) => {
  const dom = new JSDOM('<button id="opener">Mail</button><div id="root"></div>');
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  context.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  let notices!: ReturnType<typeof useToasts>;
  function Harness() {
    notices = useToasts();
    return <PrivacyContext.Provider value={{ on: true, revealed: new Set(), toggle() {} }}>
      <ToastStack toasts={notices.toasts} onDismiss={notices.dismiss} />
    </PrivacyContext.Provider>;
  }
  const tick = async (ms: number) => { await act(async () => context.mock.timers.tick(ms)); };
  try {
    document.getElementById("opener")!.focus();
    await act(async () => root.render(<Harness />));
    await act(async () => {
      notices.push("Saved reader@example.com", "success"); notices.push("Saved reader@example.com", "success");
      notices.push("Could not save", "error"); notices.push("Synced"); notices.push("Archived", "success"); notices.push("Uncertain delivery", "error");
    });
    assert.equal(notices.toasts.length, 5); assert.equal(document.querySelectorAll(".toast").length, 4);
    assert.equal(document.querySelectorAll('[role="alert"]').length, 1);
    assert.equal(document.querySelector(".toast-pending")!.textContent, "1 more notification");
    assert.equal(document.body.innerHTML.includes("reader@example.com"), false);
    assert.equal(document.activeElement?.id, "opener");
    await tick(2000);
    const first = document.querySelector(".toast")!;
    await act(async () => first.dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true })));
    // Mock ticks jump the clock before running timers, so exit timers start at the end of each tick.
    await tick(5000); await tick(200);
    assert.ok(notices.toasts.some((toast) => toast.kind === "success"));
    assert.equal(document.querySelectorAll('[role="alert"]').length, 2);
    await act(async () => first.dispatchEvent(new dom.window.MouseEvent("mouseout", { bubbles: true })));
    const dismiss = first.querySelector("button")!;
    await act(async () => dismiss.focus());
    await tick(5000); assert.ok(document.body.contains(first));
    await act(async () => document.getElementById("opener")!.focus());
    await tick(3999); assert.ok(document.body.contains(first));
    await tick(1);
    const slot = first.closest(".toast-slot")!;
    assert.ok(slot.classList.contains("leaving") && slot.hasAttribute("inert"), "an expired notice animates out before it unmounts");
    await tick(199); assert.ok(document.body.contains(first));
    await tick(1); assert.equal(document.body.contains(first), false);
    await tick(10000); await tick(200); assert.equal(notices.toasts.length, 2);
    const dismissButton = document.querySelector<HTMLButtonElement>(".toast .toast-dismiss")!;
    assert.equal(dismissButton.getAttribute("aria-label"), "Dismiss notification");
    assert.equal(dismissButton.getAttribute("title"), "Dismiss notification");
    await act(async () => dismissButton.click());
    await act(async () => dismissButton.click());
    assert.equal(notices.toasts.length, 2, "Dismiss waits for the exit animation");
    await tick(200);
    assert.equal(notices.toasts.length, 1, "a repeated click dismisses only once");
    assert.equal(document.querySelector('[role="alert"]')!.textContent, "Uncertain delivery");
    await act(async () => {
      notices.push("1 new unread email.", "info", "arrival:1");
      notices.push("1 new unread email.", "info", "arrival:2");
      notices.push("1 new unread email.", "info", "arrival:2");
    });
    assert.equal(notices.toasts.length, 3, "distinct arrivals survive text deduplication; repeated event stays silent");
    assert.equal(document.querySelector(".toast-info .toast-title")!.textContent, "1 new unread email");
    assert.equal(document.querySelector(".toast-info [role=status]")!.textContent, "1 new unread email", "the count is announced once without a generic Update heading");
    assert.equal(document.querySelector(".toast-heading span")!.textContent, "3 notifications");
    await act(async () => (document.querySelector(".toast-heading button") as HTMLButtonElement).click());
    assert.equal(document.querySelectorAll(".toast-slot.leaving").length, 3);
    await tick(200);
    assert.equal(notices.toasts.length, 0, "Dismiss all clears only in-app notices");
  } finally {
    await act(async () => root.unmount()); context.mock.timers.reset(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

test("configured durations, no expiry, permanent errors and filtering survive preference changes", async (context) => {
  const dom = new JSDOM('<div id="root"></div>');
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import("react-dom/client");
  const { notificationDefaults } = await import("./notifications");
  const root = createRoot(document.getElementById("root")!);
  context.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  let preferences = { ...notificationDefaults, duration: 3000 as typeof notificationDefaults.duration };
  let notices!: ReturnType<typeof useToasts>;
  function Harness() {
    notices = useToasts(preferences);
    return <ToastStack toasts={notices.toasts} onDismiss={notices.dismiss} position={preferences.position} />;
  }
  const render = async () => { await act(async () => root.render(<Harness />)); };
  const tick = async (ms: number) => { await act(async () => context.mock.timers.tick(ms)); };
  try {
    await render();
    await act(async () => notices.push("Three seconds", "success"));
    await tick(1000);
    preferences = { ...preferences, duration: 10000 }; await render();
    await act(async () => notices.push("Ten seconds"));
    await tick(1999); assert.equal(notices.toasts.length, 2);
    await tick(1); await tick(200); assert.deepEqual(notices.toasts.map((toast) => toast.text), ["Ten seconds"]);
    await tick(7800); assert.equal(notices.toasts.length, 1);
    await tick(200); assert.equal(notices.toasts.length, 0);
    preferences = { ...preferences, duration: 0, confirmations: false, newMail: false }; await render();
    await act(async () => {
      notices.push("Hidden arrival", "info", "arrival:1"); notices.push("Hidden success", "success");
      notices.push("Preview"); notices.push("Delivery uncertain", "error");
    });
    assert.deepEqual(notices.toasts.map((toast) => toast.text), ["Preview", "Delivery uncertain"]);
    preferences = { ...preferences, duration: 3000 }; await render();
    await tick(100000);
    assert.deepEqual(notices.toasts.map((toast) => toast.text), ["Preview", "Delivery uncertain"]);
    await act(async () => notices.dismiss(notices.toasts[0].id));
    await act(async () => notices.push("Ordinary info"));
    await tick(3000); await tick(200);
    assert.deepEqual(notices.toasts.map((toast) => toast.text), ["Delivery uncertain"]);
    assert.equal(document.querySelector('[role="alert"]')?.textContent, "Delivery uncertain");
  } finally {
    await act(async () => root.unmount()); context.mock.timers.reset(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

test("page feedback uses one private notification stack and follows the active dialog", async () => {
  const { Notice, NotificationProvider } = await import("./ui/Toasts");
  const { Dialog } = await import("./ui/Dialog");
  const dom = new JSDOM('<div id="root"></div>');
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  let notices!: ReturnType<typeof useToasts>;
  function Harness({ error, dialog = false }: { error: string; dialog?: boolean }) {
    notices = useToasts();
    const form = <main><input aria-label="Name" aria-describedby="name-error" /><Notice text={error} id="name-error" /><button>Retry</button></main>;
    return <PrivacyContext.Provider value={{ on: true, revealed: new Set(), toggle() {} }}><NotificationProvider push={notices.push}>
      <ToastStack toasts={notices.toasts} onDismiss={notices.dismiss} />
      {dialog ? <Dialog title="Edit" onClose={() => {}}>{form}</Dialog> : form}
    </NotificationProvider></PrivacyContext.Provider>;
  }
  try {
    await act(async () => root.render(<Harness error="Could not save reader@example.com" />));
    assert.equal(document.querySelector('main [role="alert"]'), null);
    assert.equal(document.querySelectorAll('.toast [role="alert"]').length, 1);
    assert.equal(document.querySelector('#name-error')?.className, "visually-hidden");
    assert.doesNotMatch(document.body.innerHTML, /reader@example\.com/);
    await act(async () => root.render(<Harness error="Could not save reader@example.com" dialog />));
    assert.equal(notices.toasts.length, 1, "opening a dialog does not duplicate feedback");
    assert.equal(document.querySelectorAll('[role="dialog"] .toast-stack').length, 1, "notices remain inside modal accessibility and keyboard scope");
    const dismiss = document.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]')!;
    const first = document.querySelector<HTMLInputElement>('input')!;
    await act(async () => { dismiss.focus(); window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true })); });
    assert.equal(document.activeElement?.getAttribute("aria-label"), "Close dialog", "Tab from last notification wraps inside the dialog");
    assert.ok(first.isConnected);
    await act(async () => root.render(<Harness error="" />));
    assert.equal(document.querySelectorAll('.toast-stack').length, 1);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(notices.toasts.length, 1, "an error survives leaving its form");
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

test("browser chime waits for interaction, coalesces bursts and releases audio", async () => {
  const { notificationSound } = await import("./ui/notification-sound");
  const dom = new JSDOM("");
  let starts = 0, disconnected = 0, closed = 0;
  let context!: FakeAudio;
  class FakeAudio {
    state = "running";
    currentTime = 1;
    destination = {};
    constructor() { context = this; }
    async resume() {}
    async close() { closed++; }
    createOscillator() { return { frequency: { value: 0 }, connect() {}, disconnect() { disconnected++; }, onended: () => {}, start() { starts++; }, stop() { this.onended(); } }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() { disconnected++; } }; }
  }
  Object.defineProperty(dom.window, "AudioContext", { value: FakeAudio });
  const sound = notificationSound(dom.window as unknown as Window & typeof globalThis);
  sound.play(); assert.equal(starts, 0, "no audio before interaction");
  dom.window.dispatchEvent(new dom.window.Event("pointerdown"));
  sound.play(); sound.play(); assert.equal(starts, 1, "a notification burst plays once");
  context.currentTime = 2; sound.play(); assert.equal(starts, 2);
  assert.equal(disconnected, 4, "completed tones release their nodes");
  sound.close(); assert.equal(closed, 1);
  dom.window.close();
});

test("dialog changes preserve pending notices and identical invalid attempts notify again", async (context) => {
  const { NotificationProvider, Notice, useFeedbackState } = await import("./ui/Toasts");
  const { Dialog } = await import("./ui/Dialog");
  const { useEffect } = await import("react");
  const { createPortal } = await import("react-dom");
  const dom = new JSDOM('<div id="root"></div>');
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  context.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  let notices!: ReturnType<typeof useToasts>, report!: (value: string) => void;
  let mounts = 0, cleanups = 0;
  function OutboxProbe() {
    useEffect(() => { mounts++; return () => { cleanups++; }; }, []);
    return <button>Pending action</button>;
  }
  function Form() {
    const [error, setError] = useFeedbackState(); report = setError;
    return <Notice text={error} />;
  }
  function Harness({ dialogs = 0 }: { dialogs?: number }) {
    notices = useToasts();
    return <NotificationProvider push={notices.push}>
      <ToastStack toasts={notices.toasts} onDismiss={notices.dismiss} outbox={<OutboxProbe />} />
      <Form />
      {dialogs > 0 && <Dialog title="Outer" onClose={() => {}}><input aria-label="Outer field" />
        {dialogs > 1 && createPortal(<Dialog title="Inner" onClose={() => {}}><input aria-label="Inner field" /></Dialog>, document.body)}
      </Dialog>}
    </NotificationProvider>;
  }
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => notices.push("Saved", "success"));
    const toast = document.querySelector('.toast')!;
    await act(async () => context.mock.timers.tick(5500));
    for (const dialogs of [1, 2, 1, 0]) {
      await act(async () => root.render(<Harness dialogs={dialogs} />));
      assert.ok(document.querySelector('.toast') === toast, "the same notification node moves without remounting");
      assert.equal(mounts, 1); assert.equal(cleanups, 0);
      if (dialogs) {
        const stack = document.querySelector('.toast-stack')!;
        assert.ok(stack.closest('.dialog') === null, "stack stays outside the filtered scrolling panel");
        assert.equal(stack.closest('[role="dialog"]')?.getAttribute('aria-label'), dialogs === 2 ? "Inner" : "Outer");
      }
    }
    await act(async () => context.mock.timers.tick(500));
    await act(async () => context.mock.timers.tick(200));
    assert.equal(notices.toasts.length, 0, "opening dialogs does not restart expiry");
    await act(async () => report("Choose a valid time."));
    assert.equal(notices.toasts.length, 1);
    await act(async () => notices.dismiss(notices.toasts[0].id));
    assert.equal(notices.toasts.length, 0);
    await act(async () => report("Choose a valid time."));
    assert.equal(notices.toasts.length, 1, "identical invalid input reports a new attempt");
    await act(async () => report(""));
    assert.equal(notices.toasts.length, 1, "corrected input does not create an extra notification");
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
