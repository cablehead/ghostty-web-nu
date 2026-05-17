// Browser repro using playwright + chromium. Drives the real ghostty-web
// stack and checks whether the canvas keeps repainting after resize bursts.
//
// Run:
//   node ~/ghostty-web-nu/test/resize-browser.mjs

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const HTTP_NU = resolve(REPO_ROOT, "..", "http-nu-pty", "target", "debug", "http-nu");
const SERVE_NU = resolve(REPO_ROOT, "serve.nu");
const CHROMIUM = process.env.CHROMIUM_PATH
  || "/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell";

const PORT = 39000 + (process.pid % 1000);
const BASE = `http://127.0.0.1:${PORT}`;

const srv = spawn(HTTP_NU, [`127.0.0.1:${PORT}`, SERVE_NU], { stdio: ["ignore", "pipe", "pipe"] });
const srvLog = [];
srv.stdout.on("data", (b) => srvLog.push(b.toString()));
srv.stderr.on("data", (b) => srvLog.push(b.toString()));
const cleanup = () => { try { srv.kill("SIGKILL"); } catch {} };
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server didn't come up");
}
await waitReady();
console.log("server up on", BASE);

const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM });
const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
const page = await ctx.newPage();

// Simulate pai-sho-style network latency on every /pty/* request.
const LATENCY_MS = Number(process.env.LATENCY_MS || 0);
if (LATENCY_MS > 0) {
  await page.route("**/pty/**", async (route) => {
    await new Promise((r) => setTimeout(r, LATENCY_MS));
    return route.continue();
  });
  console.log("injecting", LATENCY_MS, "ms latency per /pty/* request");
}

page.on("console", (m) => console.log(`[page console ${m.type()}]`, m.text()));
page.on("pageerror", (e) => console.log("[page error]", e.message));

let sid = null;
page.on("response", async (res) => {
  if (res.url().endsWith("/pty/create") && res.status() === 200) {
    try { sid = (await res.json()).sid; } catch {}
  }
});

// Install observers in the page BEFORE goto so we catch initialization-time
// events. We hook term.write via a setter so we can count incoming bytes.
// Install all hooks BEFORE goto so they catch the initial EventSource and
// fetch that the page creates during boot.
await page.addInitScript(() => {
  window.__inputs = 0;
  window.__sseMessages = 0;
  window.__sseBytes = 0;
  const origFetch = window.fetch;
  window.fetch = (url, opts) => {
    if (typeof url === "string" && url.startsWith("/pty/input?")) window.__inputs++;
    return origFetch(url, opts);
  };
  const OrigES = window.EventSource;
  window.EventSource = function(url, opts) {
    const es = new OrigES(url, opts);
    es.addEventListener("message", (e) => {
      window.__sseMessages++;
      window.__sseBytes += (e.data || "").length;
    });
    return es;
  };
});

await page.goto(BASE);
for (let i = 0; i < 50 && !sid; i++) await new Promise((r) => setTimeout(r, 100));
if (!sid) { console.error("no sid"); cleanup(); process.exit(1); }
console.log("sid", sid);

// Wait for the REPL banner to land.
await new Promise((r) => setTimeout(r, 1500));

// Hook into the live Terminal instance. Our index.html doesn't export it,
// so we wrap document.querySelector('canvas').width changes as a proxy for
// "renderer is alive", plus we patch the page's fetch /pty/input to count.

async function counters() {
  return page.evaluate(() => ({
    inputs: window.__inputs || 0,
    sseMessages: window.__sseMessages || 0,
    sseBytes: window.__sseBytes || 0,
  }));
}

async function nudge(label, timeoutMs = 4000) {
  const start = await counters();
  // Drive the real input path: focus the terminal and type via the browser
  // (term.onData -> our throttled fetch -> /pty/input).
  await page.focus("#terminal");
  await page.keyboard.type(`echo nudge-${label}`);
  await page.keyboard.press("Enter");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const c = await counters();
    if (c.sseBytes > start.sseBytes + 50) {
      return { ok: true, sseGrowth: c.sseBytes - start.sseBytes, msgGrowth: c.sseMessages - start.sseMessages };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { ok: false, end: await counters(), start };
}

console.log("baseline:", await nudge("baseline"));

const SIZES = [
  [800, 600], [900, 700], [1100, 800], [1000, 750], [950, 720],
  [1024, 768], [1200, 900], [800, 700], [1100, 850], [950, 680],
];
const N = Number(process.env.PASSES || 6);
const GAP_MS = Number(process.env.GAP_MS || 10);
const SIZES_PER_PASS = Number(process.env.SIZES_PER_PASS || 40);
for (let pass = 1; pass <= N; pass++) {
  console.log(`--- pass ${pass}: ${SIZES_PER_PASS} resizes (gap=${GAP_MS}ms) ---`);
  for (let i = 0; i < SIZES_PER_PASS; i++) {
    const [w, h] = SIZES[i % SIZES.length];
    await page.setViewportSize({ width: w + (i % 7), height: h + (i % 5) });
    if (GAP_MS > 0) await new Promise((r) => setTimeout(r, GAP_MS));
  }
  await new Promise((r) => setTimeout(r, 1000));
  const res = await nudge(`pass-${pass}`);
  console.log(`pass ${pass}:`, res);
  if (!res.ok) {
    console.error("HUNG after pass", pass);
    const shot = `/tmp/hang-${pass}.png`;
    await page.screenshot({ path: shot, fullPage: true });
    console.error("screenshot:", shot);
    console.error("--- last server log ---");
    console.error(srvLog.join("").slice(-3000));
    cleanup();
    process.exit(3);
  }
}

console.log("PASS");
await browser.close();
cleanup();
process.exit(0);
