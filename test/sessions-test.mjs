import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
const HTTP_NU = "/root/http-nu-pty-projection/target/release/http-nu";
const SERVE = "/root/ghostty-web-nu-projection/serve-sessions.nu";
const CHROMIUM = "/root/.cache/ms-playwright/chromium-1181/chrome-linux/chrome";
const PORT = 5098, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(HTTP_NU, ["--datastar", "--store", "/tmp/xs-"+PORT, `127.0.0.1:${PORT}`, SERVE], { stdio: ["ignore","pipe","pipe"] });
process.on("exit", () => { try { srv.kill("SIGKILL"); } catch {} });
for (let i=0;i<50;i++){ try { if ((await fetch(BASE)).ok) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
const page = await (await browser.newContext({ viewport:{width:1200,height:700} })).newPage();
page.on("pageerror", e => console.log("[err]", e.message));

await page.goto(BASE);
await page.waitForFunction(() => {
  return document.querySelectorAll('#sessions-list li').length >= 1 && document.getElementById('grid')?.dataset.cols;
}, { timeout: 8000 });
await new Promise(r=>setTimeout(r,700));

const gridText = () => page.evaluate(() => document.getElementById('grid').textContent);
const sessions = () => page.evaluate(() => document.querySelectorAll('#sessions-list li').length);
const focus = async () => { await page.keyboard.press('Enter'); await new Promise(r=>setTimeout(r,200)); };
const nav = async () => { await page.keyboard.press('Alt+Escape'); await new Promise(r=>setTimeout(r,200)); };

console.log("initial sessions:", await sessions());

// Focus tab one, type a marker
await focus();
await page.keyboard.type('echo TAB_ONE');
await page.keyboard.press('Enter');
await new Promise(r=>setTimeout(r,600));
console.log("TAB_ONE visible in tab one:", (await gridText()).includes('TAB_ONE'));

// Back to navigate, new session via Alt+T
await nav();
const s1 = await sessions();
await page.keyboard.press('Alt+t');
await page.waitForFunction((p) => document.querySelectorAll('#sessions-list li').length > p, s1, { timeout: 5000 });
await new Promise(r=>setTimeout(r,700));
console.log("after Alt+T sessions:", await sessions());

// New tab should be fresh (no TAB_ONE)
console.log("new tab fresh (no TAB_ONE):", !(await gridText()).includes('TAB_ONE'));

// Back to tab one via Alt+K; TAB_ONE should reappear (per-session scrollback)
await page.keyboard.press('Alt+k');
await new Promise(r=>setTimeout(r,700));
console.log("Alt+K back to tab one shows TAB_ONE:", (await gridText()).includes('TAB_ONE'));

await browser.close();
process.exit(0);
