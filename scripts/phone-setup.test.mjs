import assert from "node:assert/strict";
import { once } from "node:events";
import { Readable } from "node:stream";
import { test } from "node:test";
import express from "express";
import { browserAccess } from "../server/browser-access.ts";
import { createPhoneSetupLink, phoneSetup } from "./phone-setup.mjs";

const password = "synthetic-recovery-passphrase";
const origin = "http://127.0.0.1:3001";
const csrf = "c".repeat(64);
const session = "emc2_browser_session=" + "b".repeat(64);
const link = "https://mail.synthetic-tailnet.ts.net:8444/auth/pair#" + "a".repeat(43);
const response = (status, body, headers = {}) => new Response(body == null ? null : JSON.stringify(body), { status, headers });
function sequence(overrides = {}) {
  const calls = [];
  const request = async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({ path, options });
    assert.equal(new URL(url).origin, origin);
    assert.equal(options.redirect, "manual");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Origin, origin);
    if (overrides[path]) return overrides[path]();
    if (path === "/auth/login") return response(303, null, { Location: origin, "Set-Cookie": session + "; Path=/; HttpOnly" });
    assert.equal(options.headers.Cookie, session);
    if (path === "/api/bootstrap") return response(200, { csrf });
    if (path === "/api/phone-devices/setup-link") {
      assert.equal(options.headers["X-CSRF-Token"], csrf);
      assert.deepEqual(JSON.parse(options.body), { confirm: true });
      return response(200, { pairing: { url: link } });
    }
    assert.equal(path, "/auth/lock");
    return response(303, null, { Location: "/auth" });
  };
  return { calls, request };
}

test("setup CLI performs localhost login, CSRF, one creation and logout without following redirects", async () => {
  const f = sequence();
  assert.equal(await createPhoneSetupLink({ origin, password, fetch: f.request }), link);
  assert.deepEqual(f.calls.map(call => call.path), ["/auth/login", "/api/bootstrap", "/api/phone-devices/setup-link", "/auth/lock"]);
  assert.equal(new URLSearchParams(f.calls[0].options.body).get("password"), password);
  assert.ok(f.calls.slice(1).every(call => !String(call.options.body).includes(password)));
});

test("failed login, bad CSRF, redirect, oversized response and uncertain creation fail closed without retries", async () => {
  for (const [path, result, count] of [
    ["/auth/login", () => response(401, { secret: password }), 1],
    ["/auth/login", () => response(303, null, { Location: "https://foreign.example", "Set-Cookie": session }), 2],
    ["/api/bootstrap", () => response(200, { csrf: "bad" }), 3],
    ["/api/bootstrap", () => response(200, { text: "x".repeat(70_000) }), 3],
    ["/api/phone-devices/setup-link", () => response(302, null, { Location: "https://foreign.example" }), 4],
    ["/api/phone-devices/setup-link", () => { throw new Error(password); }, 4],
    ["/api/phone-devices/setup-link", () => response(200, { pairing: { url: "https://foreign.example/#token" } }), 4],
    ["/auth/lock", () => response(302, null, { Location: "https://foreign.example" }), 4],
  ]) {
    const f = sequence({ [path]: result });
    await assert.rejects(createPhoneSetupLink({ origin, password, fetch: f.request }), error => !error.message.includes(password));
    assert.equal(f.calls.length, count, path);
    if (path !== "/auth/login" || count === 2) assert.equal(f.calls.at(-1).path, "/auth/lock");
  }
  for (const target of ["https://remote.example", "http://127.0.0.1:3001/path", "http://user@localhost:3001", "http://localhost:80", "http://127.0.0.1:3001?next=bad"]) {
    await assert.rejects(createPhoneSetupLink({ origin: target, password, fetch: () => assert.fail("must not request") }));
  }
});

test("CLI accepts piped recovery input without echo and revokes its real browser-gate session", async t => {
  const app = express();
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const local = `http://127.0.0.1:${server.address().port}`;
  const gate = browserAccess(password, local);
  let created = 0, cookie = "";
  app.use(gate); app.use(express.json());
  app.get("/api/bootstrap", (req, res) => { cookie = req.headers.cookie; res.json({ csrf }); });
  app.post("/api/phone-devices/setup-link", (req, res) => {
    assert.equal(req.headers["x-csrf-token"], csrf); assert.equal(req.body.confirm, true);
    created++; res.json({ pairing: { url: link } });
  });
  let output = "", error = "";
  const io = { output: { write: value => { output += value; } }, error: { write: value => { error += value; } } };
  assert.equal(await phoneSetup({ args: ["--password-stdin"], env: { APP_URL: local }, input: Readable.from([password + "\n"]), ...io }), 0);
  assert.equal(created, 1); assert.match(output, /one-time link/); assert.ok(output.includes(link));
  assert.equal(error, ""); assert.ok(!output.includes(password));
  const locked = await fetch(local + "/api/bootstrap", { headers: { Cookie: cookie } });
  assert.equal(locked.status, 401); await locked.body.cancel();
  output = "";
  assert.equal(await phoneSetup({ args: [password], env: {}, ...io }), 1);
  assert.equal(output, ""); assert.ok(!error.includes(password));
});
