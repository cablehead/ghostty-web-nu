// Check that browser text selection survives a Datastar morph and that
// Ctrl+C copies the selection without sending SIGINT to the pty.

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

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  headless: true,
  args: ["--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({
  viewport: { width: 1000, height: 600 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));

console.log("goto");
await page.goto(BASE);
await page.waitForFunction(() => document.getElementById("grid")?.dataset.cols, { timeout: 5000 });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 300));
console.log("ready");

await page.evaluate(async () => {
  await fetch("/pty/input?sid=" + encodeURIComponent(window.__sid), {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: 'echo "HELLOWORLD"\r',
  });
});
await new Promise((r) => setTimeout(r, 600));

const sel0 = await page.evaluate(() => {
  const rows = document.querySelectorAll("#grid .row");
  for (const row of rows) {
    if (row.textContent.includes("HELLOWORLD")) {
      const range = document.createRange();
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      const idx = row.textContent.indexOf("HELLOWORLD");
      let off = 0, startNode = null, startOff = 0, endNode = null, endOff = 0, node;
      while ((node = walker.nextNode())) {
        const len = node.nodeValue.length;
        if (!startNode && off + len > idx) { startNode = node; startOff = idx - off; }
        if (startNode && off + len >= idx + 10) { endNode = node; endOff = idx + 10 - off; break; }
        off += len;
      }
      if (startNode && endNode) {
        range.setStart(startNode, startOff);
        range.setEnd(endNode, endOff);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(range);
        return s.toString();
      }
    }
  }
  return null;
});
console.log("selected:", JSON.stringify(sel0));

await page.evaluate(async () => {
  await fetch("/pty/input?sid=" + encodeURIComponent(window.__sid), {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: 'echo MORE\r',
  });
});
await new Promise((r) => setTimeout(r, 600));

const sel1 = await page.evaluate(() => window.getSelection().toString());
console.log("after morph:", JSON.stringify(sel1));

await page.evaluate(() => {
  const rows = document.querySelectorAll("#grid .row");
  for (const row of rows) {
    if (row.textContent.includes("HELLOWORLD")) {
      const r = document.createRange();
      r.selectNodeContents(row);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return;
    }
  }
});
await page.keyboard.press("Control+c");
await new Promise((r) => setTimeout(r, 200));

const clip = await page.evaluate(() => navigator.clipboard.readText().catch((e) => "<denied:" + e.message + ">"));
console.log("clipboard:", JSON.stringify(clip));

await browser.close();
cleanup();
console.log("done");
process.exit(0);
