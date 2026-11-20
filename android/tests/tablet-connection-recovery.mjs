// SPDX-License-Identifier: AGPL-3.0-only
// Physical tablet regression: fail only the server WebView's network, keep ADB online.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const require=createRequire(new URL('../../app/package.json',import.meta.url));
const {WebSocket}=require('ws');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evidence={checks:[],screenshots:{}};
function device(code){return JSON.parse(execFileSync('python3',['-c',`import sys,json\nsys.path.insert(0,'/home/user/android-tablet')\nfrom androidctl import AndroidController\nc=AndroidController();c.connect()\n${code}`],{encoding:'utf8'}));}
class Page {
  static async open(local){
    const pages=await(await fetch('http://127.0.0.1:9487/json/list')).json();
    const page=pages.find(p=>local?p.url.endsWith('/tablet.html'):!p.url.includes('.invalid'));
    assert(page,'Missing tablet WebView');const client=new Page();client.next=0;client.pending=new Map();
    client.ws=new WebSocket(page.webSocketDebuggerUrl);
    client.ws.on('message',data=>{const message=JSON.parse(data);if(message.id)client.pending.get(message.id)?.(message);});
    await new Promise((resolve,reject)=>{client.ws.once('open',resolve);client.ws.once('error',reject);});return client;
  }
  call(method,params={}){return new Promise((resolve,reject)=>{const id=++this.next,timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('CDP timeout: '+method));},10000);this.pending.set(id,m=>{clearTimeout(timer);this.pending.delete(id);m.error?reject(new Error(m.error.message)):resolve(m.result);});this.ws.send(JSON.stringify({id,method,params}));});}
  async eval(expression){const result=await this.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!result.exceptionDetails,result.exceptionDetails?.text);return result.result.value;}
  async until(expression){for(let i=0;i<200;i++){if(await this.eval(expression))return;await delay(100);}throw new Error('UI timeout: '+expression);}
  async click(selector){const bounds=await this.eval(`(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);assert(bounds,'Missing '+selector);await this.call('Input.dispatchMouseEvent',{type:'mousePressed',...bounds,button:'left',clickCount:1});await this.call('Input.dispatchMouseEvent',{type:'mouseReleased',...bounds,button:'left',clickCount:1});}
  network(offline){return this.call('Network.emulateNetworkConditions',{offline,latency:0,downloadThroughput:-1,uploadThroughput:-1});}
}
let home,shell;
const passed=name=>{evidence.checks.push(name);console.log('PASS '+name);};
const capture=name=>{evidence.screenshots[name]=device('print(json.dumps(c.screenshot(settle=.5)))').path;};
try{
  home=await Page.open(false);shell=await Page.open(true);
  await home.until('!!document.querySelector(".tab-nav")');
  await home.call('Network.enable');await home.network(true);await home.call('Page.reload');
  await shell.until('document.body.dataset.offline==="true"&&document.body.dataset.phase==="open"');
  const pages=await(await fetch('http://127.0.0.1:9487/json/list')).json();
  assert.equal(JSON.parse(pages.find(p=>p.url.endsWith('/tablet.html')).description).visible,true);
  assert.equal(await shell.eval('getComputedStyle(document.querySelector("#dock")).display'), 'flex');
  assert.equal(await shell.eval('document.querySelector("#dialog").textContent'),'');
  capture('offline-launcher');passed('Failed page is covered by the usable local launcher, without a blocking dialog');
  await shell.click('#dock [data-action=apps]');await shell.until('document.body.dataset.panel==="apps"');
  assert(await shell.eval('document.querySelectorAll(".app-tile").length>3'));
  capture('offline-apps');passed('Installed apps and device settings remain accessible without the server');
  await shell.eval('document.querySelector("#search").value="Chrome";document.querySelector("#search").dispatchEvent(new Event("input",{bubbles:true}))');
  await delay(11500);
  assert.equal(await shell.eval('document.body.dataset.panel'),'apps');
  assert.equal(await shell.eval('document.querySelector("#search").value'),'Chrome');
  passed('Automatic retry leaves the open launcher and app search intact while offline');
  await home.network(false);
  await home.until('!!document.querySelector(".tab-nav")&&typeof window.hauserTabletStandby==="function"');
  await shell.until('!document.body.dataset.offline');
  const restored=await(await fetch('http://127.0.0.1:9487/json/list')).json();
  assert.equal(JSON.parse(restored.find(p=>p.url.endsWith('/tablet.html')).description).visible,false);
  passed('Restored network reloads Hauser automatically and removes the local fallback');
  await home.click('[data-nav=apps]');await shell.until('document.body.dataset.panel==="apps"&&document.body.dataset.phase==="open"');
  device("c.shell(['input','keyevent','KEYCODE_BACK'])\nprint(json.dumps(True))");
  await shell.until('document.body.dataset.phase==="prepared"');capture('restored-hauser');
  assert.match(device("print(json.dumps(c.shell(['settings','get','secure','default_input_method'],readonly=True)))"),/de\.ralleur\.hauser\.tablet/);
  passed('Normal Apps entry and Back work after recovery; the Hauser keyboard stays selected');
  evidence.result='passed';
}catch(error){evidence.result='failed';evidence.error=error.stack;try{capture('failure');}catch{}process.exitCode=1;}
finally{
  if(home){try{await home.network(false);}catch{}home.ws.close();}shell?.ws.close();
  writeFileSync(new URL('../build/tablet-prototype/connection-recovery-check.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
}
