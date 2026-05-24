// Verify paste delivers clipboard contents to the pty in one chunk.

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
const ctx = await browser.newContext({
  viewport: { width: 1000, height: 600 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();
await page.goto(BASE);
await page.waitForFunction(() => document.getElementById("grid")?.dataset.cols, { timeout: 5000 });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 400));

// Dispatch a paste event directly. ClipboardEvent constructors aren't
// straightforward to populate, so we manually fire one with our own
// clipboardData.
const result = await page.evaluate(async () => {
  const text = "echo PASTED_VALUE";
  const dt = new DataTransfer();
  dt.setData("text/plain", text);
  const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true });
  window.dispatchEvent(ev);
  // Wait for the POST to reach the pty + a render to morph in.
  await new Promise((r) => setTimeout(r, 600));
  const text2 = "\r"; // Enter to execute it
  const dt2 = new DataTransfer();
  dt2.setData("text/plain", text2);
  window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt2, bubbles: true }));
  await new Promise((r) => setTimeout(r, 600));
  const rows = [...document.querySelectorAll("#grid .row")]
    .map((r) => r.textContent.replace(/\s+$/, ""))
    .filter((s) => s.length > 0);
  return {
    sawPastedValue: rows.some((r) => r.includes("PASTED_VALUE")),
    lastFew: rows.slice(-6),
  };
});
console.log(JSON.stringify(result, null, 2));

await browser.close();
cleanup();
process.exit(0);
