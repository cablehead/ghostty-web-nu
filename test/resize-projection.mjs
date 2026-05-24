// Reproduce browser resize against the projection surface. Opens the page,
// reads the rendered grid's data-cols/data-rows, resizes the viewport, then
// re-reads. If the server is doing its job and the client is wired right,
// the displayed dims should track the viewport.
//
// Run:
//   node ~/ghostty-web-nu/test/resize-projection.mjs

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const HTTP_NU = "/root/http-nu-pty-projection/target/release/http-nu";
const SERVE_NU = resolve(REPO_ROOT, "serve.nu");
const CHROMIUM_PATH = "/root/.cache/ms-playwright/chromium-1181/chrome-linux/chrome";

const PORT = 39000 + (process.pid % 1000);
const BASE = `http://127.0.0.1:${PORT}`;

const srv = spawn(HTTP_NU, [`127.0.0.1:${PORT}`, SERVE_NU], {
  stdio: ["ignore", "pipe", "pipe"],
});
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

const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true });
const page = await browser.newContext({ viewport: { width: 1000, height: 600 } }).then((c) => c.newPage());

page.on("console", (m) => console.log("[page]", m.type(), m.text()));
page.on("pageerror", (e) => console.log("[page error]", e.message));
page.on("requestfailed", (r) => console.log("[req failed]", r.url(), r.failure()?.errorText));

await page.goto(`${BASE}/`);
await page.waitForFunction(() => {
  const g = document.getElementById("grid");
  return g && g.dataset.cols && g.dataset.rows;
}, { timeout: 5000 });

async function probe(label) {
  const info = await page.evaluate(() => {
    const g = document.getElementById("grid");
    const rect = g ? g.getBoundingClientRect() : null;
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;font-family:inherit;font-size:inherit;white-space:pre;";
    probe.textContent = "M".repeat(40);
    document.body.appendChild(probe);
    const cellW = probe.getBoundingClientRect().width / 40;
    const cellH = probe.getBoundingClientRect().height;
    probe.remove();
    return {
      cols: g?.dataset.cols,
      rows: g?.dataset.rows,
      window: { w: innerWidth, h: innerHeight },
      gridRect: rect ? { w: rect.width, h: rect.height } : null,
      cellW: Number(cellW.toFixed(3)),
      cellH: Number(cellH.toFixed(3)),
      rowsRendered: document.querySelectorAll("#grid .row").length,
      fontsReady: document.fonts.status,
    };
  });
  console.log(label, JSON.stringify(info));
}

await probe("initial");

// Wait for fonts so we can compare measurements
await page.evaluate(() => document.fonts.ready);
await probe("after fonts.ready");

await page.setViewportSize({ width: 1400, height: 900 });
await new Promise((r) => setTimeout(r, 500));
await probe("after enlarge to 1400x900");

await page.setViewportSize({ width: 800, height: 400 });
await new Promise((r) => setTimeout(r, 500));
await probe("after shrink to 800x400");

await browser.close();
cleanup();
console.log("done");
