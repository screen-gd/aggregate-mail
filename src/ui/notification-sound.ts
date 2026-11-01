// Browsers unlock audio only after a gesture. Never delay an alert for audio.
export function notificationSound(target: Window & typeof globalThis) {
  let context: AudioContext | undefined;
  let last = -Infinity;
  const unlock = () => {
    if (context) { if (context.state === "suspended") void context.resume().catch(() => {}); return; }
    if (!target.AudioContext) return;
    try { context = new target.AudioContext(); void context.resume().catch(() => {}); } catch { /* Audio is optional. */ }
  };
  target.addEventListener("pointerdown", unlock);
  target.addEventListener("keydown", unlock);
  return {
    play() {
      if (!context || context.state !== "running" || context.currentTime - last < 0.5) return;
      try {
        last = context.currentTime;
        const tone = context.createOscillator(), gain = context.createGain();
        tone.frequency.value = 880;
        gain.gain.setValueAtTime(0, last);
        gain.gain.linearRampToValueAtTime(0.06, last + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, last + 0.18);
        tone.connect(gain); gain.connect(context.destination);
        tone.onended = () => { tone.disconnect(); gain.disconnect(); };
        tone.start(last); tone.stop(last + 0.2);
      } catch { /* Notification text remains available if audio fails. */ }
    },
    close() {
      target.removeEventListener("pointerdown", unlock);
      target.removeEventListener("keydown", unlock);
      if (context) void context.close().catch(() => {});
    },
  };
}
