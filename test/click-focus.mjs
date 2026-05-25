import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const H="/root/http-nu-pty-projection/target/release/http-nu", S="/root/ghostty-web-nu-projection/serve-sessions.nu", C="/root/.cache/ms-playwright/chromium-1181/chrome-linux/chrome";
const P=5091,B=`http://127.0.0.1:${P}`,ST="/tmp/xs-click"; rmSync(ST,{recursive:true,force:true});
const srv=spawn(H,["--datastar","--store",ST,`127.0.0.1:${P}`,S],{stdio:["ignore","pipe","pipe"]});
process.on("exit",()=>{try{srv.kill("SIGKILL")}catch{}});
for(let i=0;i<60;i++){try{if((await fetch(B)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
const br=await chromium.launch({executablePath:C,headless:true});
const pg=await(await br.newContext({viewport:{width:1100,height:800}})).newPage();
pg.on("pageerror",e=>console.log("[err]",e.message));
await pg.goto(B); await pg.waitForFunction(()=>document.querySelector('#doc .pane [data-cols]'),{timeout:8000});
await new Promise(r=>setTimeout(r,600));
// make a 2nd session
await pg.keyboard.press('Alt+t');
await pg.waitForFunction(()=>document.querySelectorAll('#doc .pane').length>=2,{timeout:5000});
await new Promise(r=>setTimeout(r,700));
// identify the two sids in DOM order
const sids = await pg.evaluate(()=>[...document.querySelectorAll('#doc .pane')].map(p=>p.dataset.sid));
console.log("panes:", sids.length, "mode:", await pg.evaluate(()=>document.getElementById('mode-badge').textContent));
// click the LAST pane (likely not active), then type
const lastSel = '#pane-' + sids[sids.length-1];
await pg.click(lastSel + ' .pane-screen');
await new Promise(r=>setTimeout(r,300));
const afterClick = await pg.evaluate((s)=>({
  mode: document.getElementById('mode-badge').textContent,
  active: document.querySelector('#doc .pane.active')?.dataset.sid,
  clicked: s,
}), sids[sids.length-1]);
console.log("after click last pane:", JSON.stringify(afterClick));
await pg.keyboard.type('echo CLICKMARK'); await pg.keyboard.press('Enter');
await new Promise(r=>setTimeout(r,600));
const landed = await pg.evaluate((s)=>{
  const pane=document.querySelector('#pane-'+CSS.escape(s));
  const others=[...document.querySelectorAll('#doc .pane')].filter(p=>p.dataset.sid!==s);
  return { inClicked: pane.textContent.includes('CLICKMARK'), inOthers: others.some(p=>p.textContent.includes('CLICKMARK')) };
}, sids[sids.length-1]);
console.log("CLICKMARK in clicked pane:", landed.inClicked, "| in others:", landed.inOthers, "(want true/false)");
await br.close(); process.exit(0);
