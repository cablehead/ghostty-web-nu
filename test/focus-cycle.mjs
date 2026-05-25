import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const H="/root/http-nu-pty-projection/target/release/http-nu", S="/root/ghostty-web-nu-projection/serve-sessions.nu", C="/root/.cache/ms-playwright/chromium-1181/chrome-linux/chrome";
const P=5096,B=`http://127.0.0.1:${P}`,ST="/tmp/xs-foc"; rmSync(ST,{recursive:true,force:true});
const srv=spawn(H,["--datastar","--store",ST,`127.0.0.1:${P}`,S],{stdio:["ignore","pipe","pipe"]});
process.on("exit",()=>{try{srv.kill("SIGKILL")}catch{}});
for(let i=0;i<60;i++){try{if((await fetch(B)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
const br=await chromium.launch({executablePath:C,headless:true});
const pg=await(await br.newContext({viewport:{width:1100,height:800}})).newPage();
pg.on("pageerror",e=>console.log("[err]",e.message));
await pg.goto(B); await pg.waitForFunction(()=>document.querySelector('#doc .pane [data-cols]'),{timeout:8000});
await new Promise(r=>setTimeout(r,600));
const mode=()=>pg.evaluate(()=>document.getElementById('status-mode').textContent);
const activeClip=()=>pg.evaluate(()=>document.querySelector('#doc .pane.active')?.dataset.clip);

// Second terminal via the picker (Alt+T works from navigate).
await pg.keyboard.press('Alt+t');
await pg.waitForSelector('.modal-backdrop[data-show] .picker',{state:'visible',timeout:3000}).catch(()=>{});
await pg.click('.picker-row:has-text("Terminal")');
await pg.waitForFunction(()=>document.querySelectorAll('#doc .pane').length>=2,{timeout:5000});
await new Promise(r=>setTimeout(r,700));

// Focus the selected (2nd) terminal and type a marker into it.
await pg.keyboard.press('Enter');
await new Promise(r=>setTimeout(r,200));
const secondClip = await activeClip();
console.log("after Enter mode:", await mode(), "(want focus)");
await pg.keyboard.type('echo MARKB'); await pg.keyboard.press('Enter');
await new Promise(r=>setTimeout(r,500));

// Alt+K moves to the other terminal AND auto-focuses it (we stay in focus).
await pg.keyboard.press('Alt+k');
await new Promise(r=>setTimeout(r,700));
const firstClip = await activeClip();
console.log("after Alt+K mode:", await mode(), "(want focus) | moved:", firstClip!==secondClip, "(want true)");
await pg.keyboard.type('echo MARKA'); await pg.keyboard.press('Enter');
await new Promise(r=>setTimeout(r,600));

// Each marker should be confined to the terminal that was focused when typed.
const r = await pg.evaluate((s)=>{
  const second=document.querySelector('#pane-'+CSS.escape(s.second));
  const first=document.querySelector('#pane-'+CSS.escape(s.first));
  return {
    bInSecond: second.textContent.includes('MARKB'),
    bInFirst: first.textContent.includes('MARKB'),
    aInFirst: first.textContent.includes('MARKA'),
    aInSecond: second.textContent.includes('MARKA'),
  };
}, {second:secondClip, first:firstClip});
console.log("MARKB only in 2nd:", r.bInSecond && !r.bInFirst, "| MARKA only in 1st:", r.aInFirst && !r.aInSecond, JSON.stringify(r));
await br.close(); process.exit(0);
