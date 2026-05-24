// Verify a page reload reattaches to the prior pty sid via sessionStorage.

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

await page.goto(BASE);
await page.waitForFunction(() => window.__sid, { timeout: 5000 });
const sid1 = await page.evaluate(() => window.__sid);
const stored1 = await page.evaluate(() => sessionStorage.getItem("sid"));
console.log("first load sid:", sid1, "stored:", stored1);

// Write a marker into the pty so we can prove it's the same one after reload
await page.evaluate(async () => {
  await fetch("/pty/input?sid=" + encodeURIComponent(window.__sid), {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: 'echo MARKER_BEFORE_RELOAD\r',
  });
});
await new Promise((r) => setTimeout(r, 500));

await page.reload();
await page.waitForFunction(() => window.__sid, { timeout: 5000 });
const sid2 = await page.evaluate(() => window.__sid);
const stored2 = await page.evaluate(() => sessionStorage.getItem("sid"));
console.log("after reload sid:", sid2, "stored:", stored2);

await new Promise((r) => setTimeout(r, 500));
const hasMarker = await page.evaluate(() =>
  [...document.querySelectorAll("#grid .row")].some((r) => r.textContent.includes("MARKER_BEFORE_RELOAD"))
);
console.log("sid matches:", sid1 === sid2, "marker visible after reload:", hasMarker);

// Now simulate a stale sid: clear sessionStorage manually and check that we
// don't try to reattach to nothing
await page.evaluate(() => sessionStorage.setItem("sid", "totally-bogus-sid"));
await page.reload();
await page.waitForFunction(() => window.__sid, { timeout: 5000 });
const sid3 = await page.evaluate(() => window.__sid);
console.log("after bogus stored sid: got fresh sid?", sid3 !== "totally-bogus-sid", "sid3=", sid3);

await browser.close();
cleanup();
process.exit(0);
