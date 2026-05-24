// After filling past the viewport and sticking to the bottom, the top
// visible row should be whole -- i.e. scrollTop should land on a row
// boundary so nothing is clipped under the top edge.

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";

const HTTP_NU = "/root/http-nu-pty-projection/target/release/http-nu";
const SERVE_NU = "/root/ghostty-web-nu-projection/serve.nu";
const CHROMIUM = "/root/.cache/ms-playwright/chromium-1181/chrome-linux/chrome";

const PORT = 5099;
const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(HTTP_NU, [`127.0.0.1:${PORT}`, SERVE_NU], { stdio: ["ignore", "pipe", "pipe"] });
const cleanup = () => { try { srv.kill("SIGKILL"); } catch {} };
process.on("exit", cleanup);
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 100));
}

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
// Pick a viewport height that is deliberately NOT a multiple of the row
// height so we'd see clipping if the grid weren't row-aligned.
const ctx = await browser.newContext({ viewport: { width: 1000, height: 611 } });
const page = await ctx.newPage();
await page.goto(BASE);
await page.waitForFunction(() => document.getElementById("grid")?.dataset.cols, { timeout: 5000 });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 400));

await page.evaluate(async () => {
  await fetch("/pty/input?sid=" + encodeURIComponent(window.__sid), {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: 'for i in 1..80 { print $"row($i)" }\r',
  });
});
await new Promise((r) => setTimeout(r, 700));

const info = await page.evaluate(() => {
  const s = document.getElementById("screen");
  const g = document.getElementById("grid");
  const rowH = g.querySelector(".row")?.getBoundingClientRect().height || 0;
  // Vertical offset of the first visible row's top relative to the scroll
  // container's top edge -- this is what gets clipped under the top.
  const screenTop = s.getBoundingClientRect().top;
  const firstVisible = [...g.querySelectorAll(".row")].find((r) => {
    return r.getBoundingClientRect().top >= screenTop - 0.5;
  });
  const firstTop = firstVisible ? firstVisible.getBoundingClientRect().top : null;
  return {
    screenHeightPx: Number(s.getBoundingClientRect().height.toFixed(3)),
    rowH: Number(rowH.toFixed(3)),
    rowsFit: Number((s.getBoundingClientRect().height / rowH).toFixed(3)),
    scrollTop: Number(s.scrollTop.toFixed(3)),
    scrollTopModRow: Number((s.scrollTop % rowH).toFixed(3)),
    clipAtTop: firstTop != null ? Number((firstTop - screenTop).toFixed(3)) : null,
  };
});
console.log(JSON.stringify(info, null, 2));

await browser.close();
cleanup();
process.exit(0);
