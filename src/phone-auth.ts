import { startRegistration, startAuthentication } from "@simplewebauthn/browser";

// Capture and remove the invitation before rendering or making any network request.
const takeInvitation = () => {
  const value = location.pathname === "/auth/pair" ? location.hash.slice(1) : "";
  if (location.hash) history.replaceState(null, "", location.pathname);
  return value;
};
let invite = takeInvitation();
const status = document.getElementById("passkey-status");
const register = document.getElementById("passkey-register") as HTMLButtonElement | null;
const connect = document.getElementById("passkey-connect") as HTMLButtonElement | null;
const unlock = document.getElementById("passkey-unlock") as HTMLButtonElement | null;
let stopped = false;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const message = (value: string) => { if (status) status.textContent = value; };
const post = async <T>(route: string, body: unknown = {}): Promise<T> => {
  const response = await fetch(`/auth/passkey/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!response.ok) throw new Error("verification");
  return await response.json() as T;
};
const failed = (current = generation) => { if (current !== generation) return; if (connect) connect.hidden = false; if (register) register.disabled = true; const code = document.getElementById("pair-code"); if (code) code.textContent = ""; stopped = true; invite = ""; if (timer) clearTimeout(timer); message("This invitation expired or setup was interrupted. Tap Connect this device to start again, or open a fresh setup link."); };
const showClaim = (value: { code: string; approved: boolean }) => {
  if (connect) connect.hidden = true;
  const code = document.getElementById("pair-code");
  if (code) { code.textContent = value.approved ? "" : `Matching code: ${value.code}`; code.hidden = value.approved; }
  const steps = document.getElementById("pair-steps");
  if (steps) steps.hidden = value.approved;
  if (value.approved) { message("Ready to connect. Save a passkey using your phone's screen lock."); if (register) register.disabled = false; }
  else message("Compare this code with the host, then approve it there.");
};
const poll = async (current = generation) => {
  if (stopped || current !== generation) return;
  try {
    const value = await post<{ code: string; approved: boolean }>("pair/status");
    if (stopped || current !== generation) return;
    showClaim(value);
    if (!value.approved) timer = setTimeout(() => void poll(current), 2000);
  } catch { failed(current); }
};
const beginPairing = (token: string) => {
  const current = ++generation;
  stopped = false;
  if (timer) clearTimeout(timer);
  if (register) register.disabled = true;
  if (connect) { connect.disabled = false; connect.hidden = true; }
  message("Checking invitation…");
  if (!token) void poll(current);
  else if (!/^[A-Za-z0-9_-]{43}$/.test(token)) failed(current);
  else void post<{ code: string; approved: boolean }>("pair", { token }).then(value => {
    if (stopped || current !== generation) return;
    showClaim(value); void poll(current);
  }).catch(() => failed(current));
};
if (register) {
  beginPairing(invite); invite = "";
  // Chrome can navigate to a new invitation in this tab without reloading it.
  window.addEventListener("hashchange", () => beginPairing(takeInvitation()));
  register.onclick = async () => {
    const current = generation;
    register.disabled = true;
    try {
      const optionsJSON = await post<Parameters<typeof startRegistration>[0]["optionsJSON"]>("register/options");
      if (stopped || current !== generation) return;
      const response = await startRegistration({ optionsJSON });
      if (stopped || current !== generation) return;
      await post("register/verify", response);
      if (stopped || current !== generation) return;
      stopped = true; location.replace("/");
    } catch { failed(current); }
  };
}
if (unlock) unlock.onclick = async () => {
  unlock.disabled = true;
  try {
    message("Unlock with your phone's screen lock.");
    const optionsJSON = await post<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("login/options");
    const response = await startAuthentication({ optionsJSON });
    await post("login/verify", response);
    location.replace("/");
  } catch { message("Could not unlock. Try again, or reconnect this phone from Settings on the host."); unlock.disabled = false; }
};
window.addEventListener("pagehide", () => { stopped = true; generation++; invite = ""; if (timer) clearTimeout(timer); });
window.addEventListener("pageshow", event => {
  if (!event.persisted) return;
  if (register) beginPairing(takeInvitation());
  else if (connect) { stopped = false; generation++; connect.disabled = false; message(""); }
});

if (connect) connect.onclick = async () => {
  const current = ++generation;
  stopped = false;
  if (timer) clearTimeout(timer);
  connect.disabled = true;
  if (register) register.disabled = true;
  try {
    const value = await post<{ code: string; approved: boolean }>("request");
    if (stopped || current !== generation) return;
    if (!register) { location.assign("/auth/pair"); return; }
    showClaim(value); void poll(current);
  } catch { if (current === generation) message("Could not start setup. Check the private connection or open a fresh setup link from the host."); }
  finally { if (current === generation) connect.disabled = false; }
};
