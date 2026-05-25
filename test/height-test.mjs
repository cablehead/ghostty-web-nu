import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const H="/root/http-nu-pty-projection/target/release/http-nu", S="/root/ghostty-web-nu-projection/serve-sessions.nu", C="/root/.cache/ms-playwright/chromium-1181/chrome-linux/chrome";
const P=5083,B=`http://127.0.0.1:${P}`,ST="/tmp/xs-h"; rmSync(ST,{recursive:true,force:true});
const srv=spawn(H,["--datastar","--store",ST,`127.0.0.1:${P}`,S],{stdio:["ignore","pipe","pipe"]});
process.on("exit",()=>{try{srv.kill("SIGKILL")}catch{}});
for(let i=0;i<60;i++){try{if((await fetch(B)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
const br=await chromium.launch({executablePath:C,headless:true});
const pg=await(await br.newContext({viewport:{width:1100,height:700}})).newPage();
pg.on("pageerror",e=>console.log("[err]",e.message));
await pg.goto(B); await pg.waitForFunction(()=>document.querySelector('#doc .pane [data-cols]'),{timeout:8000});
await new Promise(r=>setTimeout(r,700));
// Alt+O cycles the active terminal pane's HEIGHT (rows), not width. The grid
// data-rows reflects the pty's row count; the .pane-screen height tracks it.
const snap = ()=>pg.evaluate(()=>{
  const p=document.querySelector('#doc .pane.active');
  const g=p.querySelector('[data-cols]');
  const sc=p.querySelector('.pane-screen');
  return { rows: g?.dataset.rows, cols: g?.dataset.cols,
           screenH: Math.round(sc.getBoundingClientRect().height) };
});
console.log("initial:", JSON.stringify(await snap()));
const seen=[];
for(let i=0;i<4;i++){
  await pg.keyboard.press('Alt+o');
  await new Promise(r=>setTimeout(r,700)); // reflow debounce + resize + re-render
  const s = await snap();
  seen.push(Number(s.rows));
  console.log("after Alt+O #"+(i+1)+":", JSON.stringify(s));
}
// Width (cols) stays constant; rows take at least two distinct values.
const cols0 = (await snap()).cols;
const distinctRows = new Set(seen).size;
console.log("distinct row counts:", distinctRows, "(want >=2) | width held:", cols0);
await br.close(); process.exit(0);
