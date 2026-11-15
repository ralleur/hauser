// SPDX-License-Identifier: AGPL-3.0-only
// Focused physical-device measurements; forward the app's WebView socket to 9487.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const require=createRequire(new URL('../../app/package.json',import.meta.url));
const {WebSocket}=require('ws');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function device(code){return JSON.parse(execFileSync('python3',['-c',`import sys,json\nsys.path.insert(0,'/home/user/android-tablet')\nfrom androidctl import AndroidController\nc=AndroidController();c.connect()\n${code}`],{encoding:'utf8'}));}
export class Page {
  static async open(local){
    const pages=await(await fetch('http://127.0.0.1:9487/json/list')).json();
    const target=pages.find(p=>local?p.url.endsWith('/tablet.html'):p.url.startsWith('http:'));
    assert(target,'Missing app WebView');
    const page=new Page();page.next=0;page.pending=new Map();page.ws=new WebSocket(target.webSocketDebuggerUrl);
    page.ws.on('message',data=>{const m=JSON.parse(data);if(m.id)page.pending.get(m.id)?.(m);});
    await new Promise((resolve,reject)=>{page.ws.once('open',resolve);page.ws.once('error',reject);});
    await page.call('Performance.enable');return page;
  }
  call(method,params={}){return new Promise((resolve,reject)=>{
    const id=++this.next,timeout=setTimeout(()=>reject(new Error(`CDP timeout: ${method}`)),10000);
    this.pending.set(id,m=>{clearTimeout(timeout);this.pending.delete(id);m.error?reject(new Error(m.error.message)):resolve(m.result);});
    this.ws.send(JSON.stringify({id,method,params}));
  });}
  async eval(expression){const r=await this.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails,r.exceptionDetails?.exception?.description||r.exceptionDetails?.text);return r.result.value;}
  async click(selector){const box=await this.eval(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);assert(box,`Missing ${selector}`);await this.call('Input.dispatchMouseEvent',{type:'mousePressed',...box,button:'left',clickCount:1});await this.call('Input.dispatchMouseEvent',{type:'mouseReleased',...box,button:'left',clickCount:1});}
  async metrics(){return Object.fromEntries((await this.call('Performance.getMetrics')).metrics.filter(m=>['LayoutCount','RecalcStyleCount','LayoutDuration','RecalcStyleDuration','ScriptDuration','TaskDuration'].includes(m.name)).map(m=>[m.name,m.value]));}
  close(){this.ws.close();}
}
async function run(){
const home=await Page.open(false),shell=await Page.open(true),measurements=[];
try {
  await shell.eval('window.closeTablet()');await delay(500);
  await home.eval(`window.__perfObserver?.disconnect();window.__perfLong=[];window.__perfObserver=new PerformanceObserver(list=>__perfLong.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));__perfObserver.observe({type:'longtask'});`);
  for(let round=0;round<3;round++){
    for(const target of ['calendar','notes','library','ablage','energy','home','apps']){
      if(!await home.eval(`!!document.querySelector('[data-nav="${target}"],[data-tablet="${target}"]')`))continue;
      const before=await home.metrics();
      await home.eval(`(()=>{window.__perfFrames=[];window.__perfLong=[];window.__perfStart=performance.now();window.__perfDone=false;let last;function sample(now){if(last!==undefined)__perfFrames.push(now-last);last=now;if(now-__perfStart<800)requestAnimationFrame(sample);else __perfDone=true;}requestAnimationFrame(sample);})()`);
      await home.click(`[data-nav="${target}"],[data-tablet="${target}"]`);
      await delay(900);
      const after=await home.metrics();
      const frames=await home.eval(`({frames:__perfFrames,longTasks:__perfLong,selected:document.querySelector('.tab.is-active')?.dataset.nav||document.querySelector('.tab.is-active')?.dataset.tablet})`);
      assert.equal(frames.selected,target);
      const sorted=frames.frames.toSorted((a,b)=>a-b);
      measurements.push({round,target,maxFrameMs:Math.max(...sorted),p95FrameMs:sorted[Math.floor(sorted.length*.95)],frames:sorted.length,longTasks:frames.longTasks.map(t=>t.duration),metrics:Object.fromEntries(Object.keys(before).map(k=>[k,after[k]-before[k]]))});
      if(target==='apps'){
        assert(await shell.eval(`document.body.dataset.phase==='open'&&document.body.dataset.panel==='apps'`));
        const stable=await shell.eval(`(()=>{const original=state,node=document.querySelector('#panels>.panel');window.render({...state,battery:state.battery===99?98:99});const stable=node===document.querySelector('#panels>.panel');window.render(original);return stable})()`);assert(stable);
        await shell.eval('window.closeTablet()');await delay(400);
      }
    }
  }
  const result={measurements,device:device("print(json.dumps({'keyboard':c.shell(['settings','get','secure','default_input_method'],readonly=True).strip()}))")};
  const output=process.argv[2]||new URL('../build/tablet-prototype/performance-check.json',import.meta.url);
  writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(measurements.map(({round,target,maxFrameMs,p95FrameMs,longTasks,metrics})=>({round,target,maxFrameMs:+maxFrameMs.toFixed(1),p95FrameMs:+p95FrameMs.toFixed(1),longTasks,layouts:metrics.LayoutCount,layoutMs:+(metrics.LayoutDuration*1000).toFixed(2)}))));
} finally {try{await home.eval('window.__perfObserver?.disconnect()');await shell.eval('window.closeTablet()');}catch{}home.close();shell.close();}

}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
