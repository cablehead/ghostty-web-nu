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
const page = await (await browser.newContext({ viewport:{width:1100,height:600} })).newPage();
page.on("pageerror", e => console.log("[err]", e.message));
await page.goto(BASE);
await page.waitForFunction(() => document.getElementById('grid')?.dataset.cols, { timeout: 8000 });
await new Promise(r=>setTimeout(r,600));

const gridText = () => page.evaluate(() => document.getElementById('grid').textContent);
const modeOf = () => page.evaluate(() => ({ mode: document.getElementById('mode-badge').textContent,
  bodyClass: document.body.className, kbEnabled: document.querySelector('key-buffer').getAttribute('enabled') }));

console.log("initial:", JSON.stringify(await modeOf()));

// Navigate mode: typing should NOT reach the pty
let before = await gridText();
await page.keyboard.type('navmode_noecho');
await new Promise(r=>setTimeout(r,400));
console.log("navigate typing reached pty:", (await gridText()) !== before, "(want false)");

// Enter -> focus
await page.keyboard.press('Enter');
await new Promise(r=>setTimeout(r,200));
console.log("after Enter:", JSON.stringify(await modeOf()));

// Focus mode: typing should reach the pty
before = await gridText();
await page.keyboard.type('echo FOCUSED');
await new Promise(r=>setTimeout(r,500));
console.log("focus typing reached pty:", (await gridText()).includes('FOCUSED'), "(want true)");

// Alt+Esc -> navigate
await page.keyboard.press('Alt+Escape');
await new Promise(r=>setTimeout(r,200));
console.log("after Alt+Esc:", JSON.stringify(await modeOf()));

// Rename from navigate: open, type, ensure pty doesn't get it
await page.keyboard.press('Alt+r');
await new Promise(r=>setTimeout(r,400));
before = await gridText();
await page.keyboard.type('renamed_tab');
await new Promise(r=>setTimeout(r,400));
const inputVal = await page.evaluate(() => document.querySelector('.modal-input')?.value);
console.log("rename input value:", JSON.stringify(inputVal), "| pty got rename keys:", (await gridText()) !== before, "(want false)");
await page.keyboard.press('Escape');
await browser.close();
process.exit(0);
