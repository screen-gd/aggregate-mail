import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const bundle = (await build({ entryPoints: [fileURLToPath(new URL("../src/phone-auth.ts", import.meta.url))], bundle: true, platform: "browser", target: "es2022", minify: true, write: false })).outputFiles[0].text;
test("pairing client clears the fragment before its first request and sends it only in the POST body", async () => {
  const token = "a".repeat(43);
  const dom = new JSDOM('<p id="passkey-status"></p><p id="pair-code"></p><ol id="pair-steps"><li>Compare on host</li></ol><button id="passkey-register" disabled></button>', { url: `https://mail.synthetic-tailnet.ts.net:8444/auth/pair#${token}`, runScripts: "outside-only" });
  const calls = [];
  dom.window.AbortSignal.timeout = () => new AbortController().signal;
  dom.window.fetch = async (url, options) => {
    assert.equal(dom.window.location.hash, "");
    assert.ok(!String(url).includes(token));
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ code: "123456", approved: true }) };
  };
  try {
    dom.window.eval(bundle);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls[0], { url: "/auth/passkey/pair", body: { token } });
    assert.equal(dom.window.document.getElementById("pair-code").hidden, true);
    assert.equal(dom.window.document.getElementById("pair-steps").hidden, true);
    assert.equal(dom.window.document.getElementById("passkey-register").disabled, false);
    assert.ok(!dom.window.document.body.innerHTML.includes(token));
  } finally { dom.window.close(); }
});
test("invalid invitations do not make requests or offer registration", () => {
  const dom = new JSDOM('<p id="passkey-status"></p><button id="passkey-register" disabled></button>', { url: "https://mail.synthetic-tailnet.ts.net:8444/auth/pair#invalid", runScripts: "outside-only" });
  dom.window.fetch = () => assert.fail("invalid invitation must not make requests");
  try {
    dom.window.eval(bundle);
    assert.equal(dom.window.location.hash, "");
    assert.equal(dom.window.document.getElementById("passkey-register").disabled, true);
    assert.match(dom.window.document.getElementById("passkey-status").textContent, /Connect this device/);
  } finally { dom.window.close(); }
});

test("phone-initiated setup recovers an expired page and waits for host approval", async () => {
  const dom = new JSDOM('<p id="passkey-status"></p><p id="pair-code"></p><ol id="pair-steps"><li>Compare on host</li></ol><button id="passkey-connect" hidden></button><button id="passkey-register" disabled></button>', {url:"https://mail.synthetic-tailnet.ts.net:8444/auth/pair",runScripts:"outside-only"});
  const calls=[]; let requested=false;
  dom.window.AbortSignal.timeout=()=>new AbortController().signal;
  dom.window.fetch=async (url)=>{
    calls.push(url);
    if(url.endsWith("/request")){requested=true;return {ok:true,json:async()=>({code:"654321",approved:false})};}
    return requested?{ok:true,json:async()=>({code:"654321",approved:true})}:{ok:false};
  };
  try {
    dom.window.eval(bundle);await new Promise(resolve=>setImmediate(resolve));
    const connect=dom.window.document.getElementById("passkey-connect");
    assert.equal(connect.hidden,false);
    connect.click();await new Promise(resolve=>setImmediate(resolve));
    assert.ok(calls.includes("/auth/passkey/request"));
    assert.equal(connect.hidden,true);
    assert.equal(dom.window.document.getElementById("pair-code").hidden,true);
    assert.equal(dom.window.document.getElementById("passkey-register").disabled,false);
  } finally {dom.window.close();}
});

test("a fresh invitation in the same pairing tab is claimed without a page reload", async () => {
  const token = "b".repeat(43);
  const dom = new JSDOM('<p id="passkey-status"></p><p id="pair-code"></p><button id="passkey-connect" hidden></button><button id="passkey-register" disabled></button>', {
    url: "https://mail.synthetic-tailnet.ts.net:8444/auth/pair", runScripts: "outside-only",
  });
  const claims = [];
  let claimed = false;
  dom.window.AbortSignal.timeout = () => new AbortController().signal;
  dom.window.fetch = async (url, options) => {
    if (url.endsWith("/pair")) {
      assert.equal(dom.window.location.hash, "", "remove the new token before making requests");
      claims.push(JSON.parse(options.body).token); claimed = true;
    }
    return claimed ? { ok: true, json: async () => ({ code: "123456", approved: true }) } : { ok: false };
  };
  try {
    dom.window.eval(bundle);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dom.window.document.getElementById("passkey-register").disabled, true);
    const navigated = new Promise(resolve => dom.window.addEventListener("hashchange", resolve, { once: true }));
    dom.window.location.hash = token;
    await navigated;
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(claims, [token]);
    assert.equal(dom.window.document.getElementById("passkey-register").disabled, false);
  } finally { dom.window.close(); }
});

test("a late failure from the previous page state cannot disable a fresh approved claim", async () => {
  const dom = new JSDOM('<p id="passkey-status"></p><button id="passkey-register" disabled></button>', {
    url: "https://mail.synthetic-tailnet.ts.net:8444/auth/pair", runScripts: "outside-only",
  });
  let rejectOld, first = true;
  dom.window.AbortSignal.timeout = () => new AbortController().signal;
  dom.window.fetch = async () => {
    if (first) { first = false; return new Promise((_, reject) => rejectOld = reject); }
    return { ok: true, json: async () => ({ code: "123456", approved: true }) };
  };
  try {
    dom.window.eval(bundle);
    const navigated = new Promise(resolve => dom.window.addEventListener("hashchange", resolve, { once: true }));
    dom.window.location.hash = "c".repeat(43);
    await navigated; await new Promise(resolve => setImmediate(resolve));
    rejectOld(new TypeError("Synthetic connection ended"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dom.window.document.getElementById("passkey-register").disabled, false);
    assert.match(dom.window.document.getElementById("passkey-status").textContent, /Ready to connect/);
  } finally { dom.window.close(); }
});

test("restoring the pairing tab resumes approval without replaying its invitation", async () => {
  const dom = new JSDOM('<p id="passkey-status"></p><button id="passkey-register" disabled></button>', {
    url: `https://mail.synthetic-tailnet.ts.net:8444/auth/pair#${"d".repeat(43)}`, runScripts: "outside-only",
  });
  const routes = []; let approved = false;
  dom.window.AbortSignal.timeout = () => new AbortController().signal;
  dom.window.fetch = async url => { routes.push(url); return { ok: true, json: async () => ({ code: "123456", approved }) }; };
  try {
    dom.window.eval(bundle); await new Promise(resolve => setImmediate(resolve));
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent("pagehide", { persisted: true }));
    approved = true;
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent("pageshow", { persisted: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(routes.filter(route => route === "/auth/passkey/pair").length, 1);
    assert.equal(routes.at(-1), "/auth/passkey/pair/status");
    assert.equal(dom.window.document.getElementById("passkey-register").disabled, false);
  } finally { dom.window.close(); }
});

test("a connection failure does not claim that another setup exists", async () => {
  const dom = new JSDOM('<p id="passkey-status"></p><button id="passkey-connect" hidden></button><button id="passkey-register" disabled></button>', {
    url: "https://mail.synthetic-tailnet.ts.net:8444/auth/pair", runScripts: "outside-only",
  });
  dom.window.AbortSignal.timeout = () => new AbortController().signal;
  dom.window.fetch = async () => { throw new TypeError("Synthetic offline failure"); };
  try {
    dom.window.eval(bundle); await new Promise(resolve => setImmediate(resolve));
    dom.window.document.getElementById("passkey-connect").click();
    await new Promise(resolve => setImmediate(resolve));
    assert.match(dom.window.document.getElementById("passkey-status").textContent, /Could not start setup/);
    assert.doesNotMatch(dom.window.document.getElementById("passkey-status").textContent, /Another setup|cancel it/);
    assert.equal(dom.window.document.getElementById("passkey-connect").disabled, false);
    assert.equal(dom.window.document.getElementById("passkey-register").disabled, true);
  } finally { dom.window.close(); }
});

test("restoring the sign-in page re-enables Connect and ignores its old request", async () => {
  const dom = new JSDOM('<p id="passkey-status"></p><button id="passkey-connect">Connect this device</button>', {
    url: "https://mail.synthetic-tailnet.ts.net:8444/auth", runScripts: "outside-only",
  });
  let rejectOld;
  dom.window.AbortSignal.timeout = () => new AbortController().signal;
  dom.window.fetch = () => new Promise((_, reject) => { rejectOld = reject; });
  try {
    dom.window.eval(bundle);
    const connect = dom.window.document.getElementById("passkey-connect");
    connect.click();
    assert.equal(connect.disabled, true);
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent("pagehide", { persisted: true }));
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent("pageshow", { persisted: true }));
    assert.equal(connect.disabled, false);
    const restoredMessage = dom.window.document.getElementById("passkey-status").textContent;
    rejectOld(new TypeError("Synthetic old request ended"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(connect.disabled, false);
    assert.equal(dom.window.document.getElementById("passkey-status").textContent, restoredMessage);
  } finally { dom.window.close(); }
});
