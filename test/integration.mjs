import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
const HTTP_NU = "/root/http-nu-pty-projection/target/release/http-nu";
const SERVE_NU = "/root/ghostty-web-nu-projection/serve.nu";
const CHROMIUM = "/root/.cache/ms-playwright/chromium-1181/chrome-linux/chrome";
const PORT = 5099, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(HTTP_NU, [`127.0.0.1:${PORT}`, SERVE_NU], { stdio: ["ignore","pipe","pipe"] });
process.on("exit", () => { try { srv.kill("SIGKILL"); } catch {} });
for (let i=0;i<50;i++){ try { if ((await fetch(BASE)).ok) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
const page = await (await browser.newContext({ viewport:{width:1200,height:600} })).newPage();
page.on("pageerror", e => console.log("[err]", e.message));
await page.goto(BASE);
await page.waitForFunction(() => window.__sid, { timeout: 5000 });
await new Promise(r=>setTimeout(r,500));
await page.evaluate(async () => {
  await fetch('/pty/input?sid='+encodeURIComponent(window.__sid), {method:'POST',headers:{'content-type':'application/octet-stream'},body:'ls | first 5\r'});
});
await new Promise(r=>setTimeout(r,800));
const r = await page.evaluate(() => {
  const s = document.getElementById("screen"), g = document.getElementById("grid");
  const cw = parseInt(g.dataset.cols), cellW = (g.querySelector(".row")?.getBoundingClientRect && 8.4);
  return {
    fontLoaded: document.fonts.check('14px JetBrainsMonoNerd'),
    cols: g.dataset.cols, rows: g.dataset.rows,
    screenClientW: s.clientWidth,
    screenScrollW: s.scrollWidth,
    horizOverflow: s.scrollWidth > s.clientWidth,
    status: document.getElementById("status").textContent,
    hasBoxRow: Array.from(g.querySelectorAll(".row")).some(r => r.textContent.includes("│")),
  };
});
console.log(JSON.stringify(r,null,2));
await browser.close();
process.exit(0);
