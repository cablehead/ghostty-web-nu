import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
const HTTP_NU = "/root/http-nu-pty-projection/target/release/http-nu";
const SERVE = "/root/ghostty-web-nu-projection/serve-sessions.nu";
const CHROMIUM = "/root/.cache/ms-playwright/chromium-1181/chrome-linux/chrome";
const PORT = 5097, BASE = `http://127.0.0.1:${PORT}`, STORE = "/tmp/xs-persist";
import { rmSync } from "node:fs";
rmSync(STORE, { recursive: true, force: true });

function start() {
  const s = spawn(HTTP_NU, ["--datastar", "--store", STORE, `127.0.0.1:${PORT}`, SERVE], { stdio: ["ignore","pipe","pipe"] });
  return s;
}
async function waitUp() { for (let i=0;i<60;i++){ try { if ((await fetch(BASE)).ok) return; } catch {} await new Promise(r=>setTimeout(r,100)); } throw new Error("no server"); }

let srv = start();
process.on("exit", () => { try { srv.kill("SIGKILL"); } catch {} });
await waitUp();

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
let page = await (await browser.newContext({ viewport:{width:1100,height:600} })).newPage();
await page.goto(BASE);
await page.waitForFunction(() => document.querySelectorAll('#sessions-list li').length >= 1 && document.querySelector('#doc .pane [data-cols]'), { timeout: 8000 });
await new Promise(r=>setTimeout(r,600));
const sessions = (pg) => pg.evaluate(() => document.querySelectorAll('#sessions-list li').length);
console.log("fresh start sessions:", await sessions(page));

// Make a second session (Alt+T opens the picker; choose Terminal)
await page.keyboard.press('Alt+t');
await page.waitForSelector('.modal-backdrop[data-show] .picker', { state:'visible', timeout:3000 }).catch(()=>{});
await page.click('.picker-row:has-text("Terminal")');
await page.waitForFunction(() => document.querySelectorAll('#sessions-list li').length >= 2, { timeout: 5000 });
console.log("after Alt+T sessions:", await sessions(page));

await page.close();
// Restart the server with the SAME store
srv.kill("SIGKILL");
await new Promise(r=>setTimeout(r,500));
srv = start();
await waitUp();

page = await (await browser.newContext({ viewport:{width:1100,height:600} })).newPage();
await page.goto(BASE);
await page.waitForFunction(() => document.querySelectorAll('#sessions-list li').length >= 1 && document.querySelector('#doc .pane [data-cols]'), { timeout: 8000 });
await new Promise(r=>setTimeout(r,800));
console.log("after RESTART sessions (want 2):", await sessions(page));

// Close one; it should not come back on next restart
await page.keyboard.press('Alt+d');
await new Promise(r=>setTimeout(r,500));
console.log("after Alt+D sessions:", await sessions(page));
await page.close();
srv.kill("SIGKILL"); await new Promise(r=>setTimeout(r,500)); srv = start(); await waitUp();
page = await (await browser.newContext({ viewport:{width:1100,height:600} })).newPage();
await page.goto(BASE);
await page.waitForFunction(() => document.querySelectorAll('#sessions-list li').length >= 1, { timeout: 8000 });
await new Promise(r=>setTimeout(r,800));
console.log("after RESTART post-close sessions (want 1):", await sessions(page));

await browser.close();
process.exit(0);
