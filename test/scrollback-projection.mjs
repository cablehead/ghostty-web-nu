// Verify scrollback render + auto-stick-to-bottom in the projection.
//
// Run:
//   node ~/ghostty-web-nu/test/scrollback-projection.mjs

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";

const HTTP_NU = "/root/http-nu-pty-projection/target/release/http-nu";
const SERVE_NU = "/root/ghostty-web-nu-projection/serve.nu";
const CHROMIUM = "/root/.cache/ms-playwright/chromium-1181/chrome-linux/chrome";

const PORT = 5099;
const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(HTTP_NU, [`127.0.0.1:${PORT}`, SERVE_NU], {
  stdio: ["ignore", "pipe", "pipe"],
});
const cleanup = () => { try { srv.kill("SIGKILL"); } catch {} };
process.on("exit", cleanup);

for (let i = 0; i < 50; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 100));
}

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("[con err]", m.text()); });

await page.goto(BASE);
await page.waitForFunction(() => document.getElementById("grid")?.dataset.cols, { timeout: 5000 });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 300));

async function probe(label) {
  const i = await page.evaluate(() => {
    const g = document.getElementById("screen"); const gr = document.getElementById("grid");
    const status = document.getElementById("status");
    return {
      dims: `${gr.dataset.cols}x${gr.dataset.rows}`,
      total: gr.dataset.total,
      rowsRendered: gr.querySelectorAll(".row").length,
      scrollTop: Math.round(g.scrollTop),
      scrollHeight: Math.round(g.scrollHeight),
      clientHeight: Math.round(g.clientHeight),
      gap: Math.round(g.scrollHeight - g.scrollTop - g.clientHeight),
      status: status.textContent,
    };
  });
  console.log(label, JSON.stringify(i));
}

await probe("initial");

console.log("\n--- resize larger ---");
await page.setViewportSize({ width: 1400, height: 900 });
await new Promise((r) => setTimeout(r, 400));
await probe("after enlarge");

console.log("\n--- send 60 lines through pty ---");
await page.evaluate(async () => {
  await fetch("/pty/input?sid=" + encodeURIComponent(window.__sid), {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: 'for i in 1..60 { print $"L($i)" }\r',
  });
});
await new Promise((r) => setTimeout(r, 600));
await probe("after 60 lines of output (should auto-scroll to bottom)");

console.log("\n--- scroll up by 200px ---");
await page.evaluate(() => {
  const g = document.getElementById("screen"); const gr = document.getElementById("grid");
  g.scrollTop = Math.max(0, g.scrollTop - 200);
});
await new Promise((r) => setTimeout(r, 100));
await probe("after user scroll up");

console.log("\n--- send 10 more lines while scrolled up ---");
await page.evaluate(async () => {
  await fetch("/pty/input?sid=" + encodeURIComponent(window.__sid), {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: 'for i in 1..10 { print $"M($i)" }\r',
  });
});
await new Promise((r) => setTimeout(r, 600));
await probe("after output while scrolled up (gap should grow, stickToBottom=false)");

console.log("\n--- scroll back to bottom manually ---");
await page.evaluate(() => {
  const g = document.getElementById("screen"); const gr = document.getElementById("grid");
  g.scrollTop = g.scrollHeight;
});
await new Promise((r) => setTimeout(r, 200));
await probe("after scroll to bottom");

console.log("\n--- send 5 more lines: auto-stick should resume ---");
await page.evaluate(async () => {
  await fetch("/pty/input?sid=" + encodeURIComponent(window.__sid), {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: 'for i in 1..5 { print $"N($i)" }\r',
  });
});
await new Promise((r) => setTimeout(r, 600));
await probe("after more output at bottom (gap should ~= 0)");

await browser.close();
cleanup();
console.log("done");
