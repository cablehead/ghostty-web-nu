import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const HTTP_NU = "/root/http-nu-pty-projection/target/release/http-nu";
const SERVE = "/root/ghostty-web-nu-projection/serve-sessions.nu";
const CHROMIUM = "/root/.cache/ms-playwright/chromium-1181/chrome-linux/chrome";
const PORT = 5094, BASE = `http://127.0.0.1:${PORT}`, STORE = "/tmp/xs-doc";
rmSync(STORE, { recursive: true, force: true });
const srv = spawn(HTTP_NU, ["--datastar","--store",STORE,`127.0.0.1:${PORT}`,SERVE], { stdio:["ignore","pipe","pipe"] });
const log=[]; srv.stdout.on("data",b=>log.push(b.toString())); srv.stderr.on("data",b=>log.push(b.toString()));
process.on("exit",()=>{try{srv.kill("SIGKILL")}catch{}});
for(let i=0;i<60;i++){try{if((await fetch(BASE)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
const page = await (await browser.newContext({viewport:{width:1200,height:800}})).newPage();
page.on("pageerror",e=>console.log("[err]",e.message));
await page.goto(BASE);
await page.waitForFunction(()=>document.querySelectorAll('#doc .pane').length>=1,{timeout:8000});
await new Promise(r=>setTimeout(r,800));
const panes = ()=>page.evaluate(()=>document.querySelectorAll('#doc .pane').length);
const liveGrids = ()=>page.evaluate(()=>[...document.querySelectorAll('#doc .pane')].filter(p=>p.textContent.includes('$')).length);
console.log("initial panes:", await panes(), "live(with prompt):", await liveGrids());

// Alt+T opens the type picker; choosing Terminal spawns a new terminal clip.
await page.keyboard.press('Alt+t');
await page.waitForSelector('.modal-backdrop[data-show] .picker', {state:'visible', timeout:3000}).catch(()=>{});
await page.click('.picker-row:has-text("Terminal")');
await page.waitForFunction(()=>document.querySelectorAll('#doc .pane').length>=2,{timeout:5000});
await new Promise(r=>setTimeout(r,900));
console.log("after Alt+T->Terminal panes:", await panes(), "live:", await liveGrids());

// Focus the selected pane, type -> should land in the active pane's pty
const activeSid = await page.evaluate(()=>document.querySelector('#doc .pane.active .pane-screen')?.dataset.sid);
console.log("active sid:", activeSid?.slice(0,8));
await page.keyboard.press('Enter'); // focus
await new Promise(r=>setTimeout(r,200));
console.log("mode after Enter:", await page.evaluate(()=>document.getElementById('status-mode').textContent));
await page.keyboard.type('echo DOCMARK');
await page.keyboard.press('Enter');
await new Promise(r=>setTimeout(r,600));
const markIn = await page.evaluate(()=>{
  const a = document.querySelector('#doc .pane.active');
  return a ? a.textContent.includes('DOCMARK') : false;
});
const markCount = await page.evaluate(()=>[...document.querySelectorAll('#doc .pane')].filter(p=>p.textContent.includes('DOCMARK')).length);
console.log("DOCMARK in active pane:", markIn, "| total panes with DOCMARK (want 1):", markCount);

await page.keyboard.press('Alt+Escape');
await new Promise(r=>setTimeout(r,200));
console.log("mode after Alt+Esc:", await page.evaluate(()=>document.getElementById('status-mode').textContent));

// Rename from navigate must not leak keys to any pane's pty.
await page.keyboard.press('Alt+r');
await new Promise(r=>setTimeout(r,400));
const beforeRen = await page.evaluate(()=>document.querySelector('#doc').textContent);
await page.keyboard.type('renamedoc');
await new Promise(r=>setTimeout(r,400));
const inputVal = await page.evaluate(()=>document.querySelector('.modal-input')?.value);
const leaked = (await page.evaluate(()=>document.querySelector('#doc').textContent)) !== beforeRen;
console.log("rename input:", JSON.stringify(inputVal), "| leaked to pty:", leaked, "(want false)");
await page.keyboard.press('Escape');

await new Promise(r=>setTimeout(r,200));
await page.screenshot({ path: '/tmp/doc-shot.png' });
console.log("[doc-warnings]", log.join("").split("\n").filter(l=>/NoTargetsFound|error/i.test(l)).slice(0,3).join(" | "));
await browser.close(); process.exit(0);
