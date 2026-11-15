// SPDX-License-Identifier: AGPL-3.0-only
// Physical Pad 7 acceptance: lamp-overlay motion, independent panels and borderless status.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const require=createRequire(new URL('../../app/package.json',import.meta.url));
const {WebSocket}=require('ws');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function device(code){return JSON.parse(execFileSync('python3',['-c',`import sys,json\nsys.path.insert(0,'/home/user/android-tablet')\nfrom androidctl import AndroidController\nc=AndroidController();c.connect()\n${code}`],{encoding:'utf8'}));}
class Page {
  static async open(port,suffix){let page;for(let i=0;i<40;i++){const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();page=list.find(p=>suffix==='home'?p.type==='page'&&!p.url.includes('.invalid'):p.url.endsWith(suffix));if(page)break;await delay(100);}assert(page,`Missing ${suffix}`);const client=new Page();client.ws=new WebSocket(page.webSocketDebuggerUrl);client.next=0;client.pending=new Map();client.ws.on('message',d=>{const m=JSON.parse(d);if(m.id)client.pending.get(m.id)?.(m);});await new Promise((r,j)=>{client.ws.once('open',r);client.ws.once('error',j);});return client;}
  call(method,params={}){return new Promise((resolve,reject)=>{const id=++this.next;const timeout=setTimeout(()=>reject(new Error(`CDP timeout: ${method}`)),10000);this.pending.set(id,m=>{clearTimeout(timeout);this.pending.delete(id);m.error?reject(new Error(m.error.message)):resolve(m.result);});this.ws.send(JSON.stringify({id,method,params}));});}
  async eval(expression){const value=await this.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!value.exceptionDetails,value.exceptionDetails?.text);return value.result.value;}
  async click(selector){const position=await this.eval(`(()=>{let b=document.querySelector(${JSON.stringify(selector)});if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);assert(position,`Missing ${selector}`);await this.call('Input.dispatchMouseEvent',{type:'mousePressed',...position,button:'left',clickCount:1});await this.call('Input.dispatchMouseEvent',{type:'mouseReleased',...position,button:'left',clickCount:1});}
  async until(expression){for(let i=0;i<60;i++){const result=await this.eval(expression);if(result)return result;await delay(100);}throw new Error(`UI did not reach expected state: ${expression}`);}
  close(){this.ws.close();}
}

const evidence={checks:[],screenshots:{}};
let home,shell;
const passed=name=>{evidence.checks.push(name);console.log('PASS '+name);};
const capture=name=>{evidence.screenshots[name]=device('print(json.dumps(c.screenshot(settle=.4)))').path;};
const sample=()=>shell.eval(`(()=>{window.motionFrames=[];let started;const tick=()=>{started??=performance.now();const node=document.querySelector('#panels>.panel')||document.querySelector('#panels'),style=getComputedStyle(node);const dock=getComputedStyle(document.querySelector('#dock'));motionFrames.push({at:performance.now()-started,phase:document.body.dataset.phase,panel:document.body.dataset.panel,opacity:Number(style.opacity),transform:style.transform,dockOpacity:Number(dock.opacity),dockTransform:dock.transform,visible:style.visibility,device:!!document.querySelector('#device')});if(performance.now()-started<650)requestAnimationFrame(tick);else window.motionFramesDone=true;};window.motionFramesDone=false;requestAnimationFrame(tick);})()`);
const settled=()=>shell.until('document.body.dataset.phase==="open"&&!document.getAnimations().some(a=>a.playState==="running")');
const homeVisible=()=>home.until('!document.documentElement.dataset.tabletPanel');
const onePanel=async name=>{
 await shell.until(`document.body.dataset.phase==='open'&&document.body.dataset.panel===${JSON.stringify(name)}`);
 assert.equal(await shell.eval('document.querySelectorAll("#panels>.panel").length'),1);
 assert.equal(await shell.eval('!!document.querySelector("#device")'),name==='device');
};
try {
 home=await Page.open(9487,'home');shell=await Page.open(9487,'/tablet.html');
 await shell.until('typeof window.closeTablet==="function"');await shell.eval('native("close")');await homeVisible();
 await home.click('[data-nav=home]');await home.until('!!document.querySelector("[data-tablet=apps]")');
 const expectedFrames=await home.eval(`Object.fromEntries([...document.styleSheets].flatMap(sheet=>[...sheet.cssRules]).filter(rule=>['modal-enter','modal-exit','overlay-scrim-in','overlay-scrim-out'].includes(rule.name)).map(rule=>[rule.name,[...rule.cssRules].map(frame=>({opacity:frame.style.opacity,...(frame.style.transform?{transform:frame.style.transform}:{})}))]))`);
 assert.deepEqual(await shell.eval('overlayFrames'),expectedFrames);evidence.reference=expectedFrames;
 const status=await home.eval(`(()=>{const s=getComputedStyle(document.querySelector('#hauser-tablet-status'));return {border:s.borderTopWidth,background:s.backgroundColor,shadow:s.boxShadow}})()`);
 assert.deepEqual(status,{border:'0px',background:'rgba(0, 0, 0, 0)',shadow:'none'});passed('the actual lamp-overlay keyframes are shared; Wi-Fi and battery have no pill');
 await home.eval(`window.preparingNavFrames=[];const sampleNav=()=>{if(document.documentElement.dataset.tabletPanel==='preparing')preparingNavFrames.push(getComputedStyle(document.querySelector('.tab-nav')).visibility);if(!document.documentElement.dataset.tabletPanel||document.documentElement.dataset.tabletPanel==='preparing')requestAnimationFrame(sampleNav);};requestAnimationFrame(sampleNav);`);
 await sample();await home.click('[data-tablet=apps]');await onePanel('apps');
 evidence.preparingNavFrames=await home.eval('preparingNavFrames');assert(evidence.preparingNavFrames.length>0);assert(evidence.preparingNavFrames.every(frame=>frame==='visible'),'navigation vanished during preparation');
 // A status update while entering must preserve the running visual transition.
 const stable=await shell.eval(`(()=>{const node=document.querySelector('#panels>.panel'),before=node.getAnimations()[0];window.render({...state,battery:(state.battery+1)%100});return !!before&&node.getAnimations()[0]===before;})()`);
 assert(stable,'status polling restarted or removed the entrance animation');
 const timing=await shell.eval(`(()=>{const a=document.querySelector('#panels>.panel').getAnimations()[0];return {timing:a.effect.getTiming(),target:a.effect.target.id}})()`);
 assert.equal(timing.timing.duration,300);assert.equal(timing.timing.easing,'cubic-bezier(0.34, 1.56, 0.64, 1)');assert.equal(timing.target,'content');evidence.panelTiming=timing;
 assert.equal(await shell.eval('document.querySelector("#panels").getAnimations().length'),0);
 assert.equal(await shell.eval('document.querySelector("#dock").getAnimations().length'),0);
 await shell.until('window.motionFramesDone');
 evidence.openFrames=await shell.eval('motionFrames');
 assert(evidence.openFrames.some(f=>f.phase==='open'&&f.visible==='visible'&&f.opacity>0&&f.opacity<1),'no visible entrance frames');
 assert(evidence.openFrames.filter(f=>f.phase==='open').every(f=>f.dockOpacity===1));
 assert(evidence.openFrames.some(f=>f.transform.startsWith('matrix(')&&Math.abs(Number(f.transform.split(',')[4]))<.001&&Math.abs(parseFloat(f.transform.split(',')[5]))<.001&&Number(f.transform.slice(7).split(',')[0])<1));
 await settled();capture('drawer-only');passed('direct Apps entry opens only the centered drawer and animates through status updates');
 await sample();await shell.click('#dock [data-action=store]');await onePanel('store');await shell.until('window.motionFramesDone');
 evidence.switchFrames=await shell.eval('motionFrames');assert(evidence.switchFrames.some(f=>f.panel==='apps'&&f.opacity<1));assert(evidence.switchFrames.some(f=>f.panel==='store'&&f.opacity<1));
 assert(evidence.switchFrames.every(f=>!f.device));await settled();capture('store-only');passed('drawer-to-store fades out and in without opening device controls');
 await sample();await shell.click('[data-action=contentClose]');await homeVisible();
 evidence.exitFrames=await shell.eval('motionFrames');assert(evidence.exitFrames.some(f=>f.phase==='open'&&f.opacity>0&&f.opacity<1),'the panel did not visibly animate out');
 await home.click('[data-tablet=store]');await onePanel('store');await settled();assert.equal(await shell.eval('!!document.querySelector("#device")'),false);
 await shell.click('[data-action=contentClose]');await homeVisible();await home.click('#hauser-tablet-status');await onePanel('device');await settled();capture('device-only');
 await shell.click('[data-action=settings]');await onePanel('settings');await settled();
 await shell.click('[data-action=timeoutMenu]');await shell.until('!!document.querySelector(".timeout-options")');
 assert((await shell.eval('document.querySelector(".dialog").getAnimations().length'))>0);
 device("c.shell(['input','keyevent','KEYCODE_BACK'])\nprint(json.dumps(True))");await shell.until('!document.querySelector(".dialog")');
 device("c.shell(['input','keyevent','KEYCODE_BACK'])\nprint(json.dumps(True))");await onePanel('device');await settled();
 await shell.click('#dock [data-action=apps]');await onePanel('apps');await settled();await shell.click('[data-action=settings]');await onePanel('settings');await settled();
 device("c.shell(['input','keyevent','KEYCODE_BACK'])\nprint(json.dumps(True))");await onePanel('apps');await settled();passed('close returns home; direct Store stays independent; Settings Back returns to its actual origin');
 await shell.click('#dock [data-action=store]');await shell.click('#dock [data-action=apps]');await onePanel('apps');await settled();assert.equal(await shell.eval('document.body.inert'),false);passed('rapid tab changes settle on the last requested surface');
 await shell.click('#dock [data-action=notifications]');await shell.until('document.querySelector(".htn-center").open');await settled();
 assert.equal(await shell.eval('document.querySelectorAll("#panels>.panel").length'),0);
 capture('notifications');await shell.click('.htn-center [data-command=close]');await homeVisible();
 await delay(2700);assert.equal(await shell.eval('document.querySelector(".htn-center").open'),false);passed('notifications enter and exit cleanly without reopening on native polling');
 await shell.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await home.click('[data-tablet=apps]');await onePanel('apps');
 assert.equal(await shell.eval('document.getAnimations().some(a=>a.playState==="running")'),false);
 await shell.click('#dock [data-action=store]');await onePanel('store');assert.equal(await shell.eval('document.getAnimations().some(a=>a.playState==="running")'),false);
 await shell.click('[data-action=contentClose]');await homeVisible();passed('reduced motion opens, switches and closes immediately');
 evidence.managed=await shell.eval('state.managed');assert.equal(evidence.managed,false);assert.equal(await shell.eval('state.nightMode'),true);assert.equal(await shell.eval('state.keyboard'),true);passed('Night Mode remains on and the Hauser keyboard stays selected');
 evidence.result='passed';
} catch(error){evidence.result='failed';evidence.error=error.stack;try{capture('failure');}catch{}process.exitCode=1;}
finally {
 try{await shell?.call('Emulation.setEmulatedMedia',{features:[]});await shell?.eval('native("close")');await homeVisible();}catch{}
 home?.close();shell?.close();
 writeFileSync(new URL('../build/tablet-prototype/lamp-overlay-motion-check.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({result:evidence.result,checks:evidence.checks,screenshots:evidence.screenshots,error:evidence.error}));
}
