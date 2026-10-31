import { pathToFileURL } from "node:url";

const failure = () => new Error("Phone setup failed. Check the local host, recovery passphrase and Phone access route. No request was retried.");

// No redirect is followed, including after login. Credentials stay on loopback.
export async function createPhoneSetupLink({ origin, password, fetch: request = globalThis.fetch }) {
  let cookie = "";
  try {
    const url = new URL(origin);
    if (url.origin !== origin || url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.username || url.password || !Number.isInteger(Number(url.port)) || Number(url.port) < 1024 || Number(url.port) > 65535 ||
        typeof password !== "string" || password.length < 16 || password.length > 256) throw failure();
    const call = (route, options = {}) => request(origin + route, { ...options, redirect: "manual", cache: "no-store",
      signal: AbortSignal.timeout(10_000), headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });
    const json = async response => {
      if (response.status !== 200) { await response.body?.cancel(); throw failure(); }
      let text = "";
      const reader = response.body?.getReader();
      if (!reader) throw failure();
      let bytes = 0;
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 65_536) throw failure();
          text += decoder.decode(value, { stream: true });
        }
        return JSON.parse(text + decoder.decode());
      } finally { await reader.cancel(); }
    };
    try {
      const login = await call("/auth/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ password }) });
      const cookies = login.headers.getSetCookie().map(value => value.split(";")[0]).filter(value => /^emc2_browser_session=[a-f0-9]{64}$/.test(value));
      // Capture the session before validating Location so cleanup also runs on a malformed redirect.
      if (login.status === 303 && cookies.length === 1) cookie = cookies[0];
      await login.body?.cancel();
      if (!cookie || login.headers.get("location") !== origin) throw failure();
      const { csrf } = await json(await call("/api/bootstrap"));
      if (typeof csrf !== "string" || !/^[a-f0-9]{64}$/.test(csrf)) throw failure();
      const result = await json(await call("/api/phone-devices/setup-link", { method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ confirm: true }) }));
      const link = new URL(result.pairing?.url);
      if (link.protocol !== "https:" || !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(link.hostname) || link.username || link.password ||
          link.pathname !== "/auth/pair" || link.search || !/^#[A-Za-z0-9_-]{43}$/.test(link.hash)) throw failure();
      return link.href;
    } finally {
      if (cookie) {
        const logout = await call("/auth/lock", { method: "POST" });
        await logout.body?.cancel();
        if (logout.status !== 303 || logout.headers.get("location") !== "/auth") throw failure();
      }
    }
  } catch { throw failure(); }
}

export async function phoneSetup({ args = process.argv.slice(2), env = process.env, input = process.stdin, output = process.stdout, error = process.stderr } = {}) {
  if (args.length === 1 && args[0] === "--help") {
    output.write("Usage: npm run phone:link [-- --password-stdin]\nUse the host launch environment (MAIL_WEB_PASSWORD, APP_URL or MAIL_WEB_PORT).\nShare the one-time link privately; open it within two minutes, then save a passkey.\n");
    return 0;
  }
  try {
    if (args.length > 1 || (args.length && args[0] !== "--password-stdin")) throw failure();
    let password = env.MAIL_WEB_PASSWORD;
    if (args[0] === "--password-stdin") {
      if (input.isTTY) throw failure();
      password = "";
      const timer = setTimeout(() => input.destroy(failure()), 10_000);
      try {
        for await (const chunk of input) { password += chunk.toString(); if (Buffer.byteLength(password) > 1024) throw failure(); }
        password = password.replace(/\r?\n$/, "");
      } finally { clearTimeout(timer); }
    }
    const origin = env.APP_URL || `http://127.0.0.1:${env.MAIL_WEB_PORT || 3001}`;
    const link = await createPhoneSetupLink({ origin, password });
    output.write(`Open this one-time link on your phone within two minutes, then save a passkey. Share it privately.\n${link}\n`);
    return 0;
  } catch { error.write(failure().message + "\n"); return 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await phoneSetup();
