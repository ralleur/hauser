// SPDX-License-Identifier: AGPL-3.0-only
// Physical Pad 7: power/wake, including another app and open tablet/weather panels.
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
function policy(){return device("print(json.dumps(c.shell(['dumpsys','window','policy'],readonly=True)))");}
async function powerCycle(){
 device("c.shell(['input','keyevent','KEYCODE_POWER'])\nprint(json.dumps(True))");
 await delay(1000);
 const power=device("print(json.dumps(c.shell(['dumpsys','power'],readonly=True)))");
 assert.match(power,/mWakefulness=Asleep/,'power must leave display asleep');
 device("c.shell(['input','keyevent','KEYCODE_POWER'])\nprint(json.dumps(True))");
 await home.until('document.querySelector(".ambient.is-on")!==null');
 await delay(700);
 assert.match(policy(),/mKeyguardOccluded=true|showing=false/,'Android swipe lock must not cover Hauser');
 const activity=device("print(json.dumps(c.shell(['dumpsys','activity','activities'],readonly=True)))");
 assert.match(activity,/(?:mResumedActivity|topResumedActivity).*de\.ralleur\.hauser\.tablet/);
 assert.equal(await home.eval('!!document.documentElement.dataset.tabletPanel'),false);
}
async function unlock(){
 const pos=await home.eval('({x:innerWidth/2,y:innerHeight/2})');
 await home.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[pos]});
 await home.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await home.until('!document.querySelector(".ambient.is-on")');await delay(1000);
}
try{
 home=await Page.open(9487,'home');shell=await Page.open(9487,'/tablet.html');
 await home.until('typeof window.hauserTabletStandby==="function"');
 assert.match(policy(),/secure=false/,'this suite never bypasses a secure keyguard');
 await home.call('Page.reload',{ignoreCache:true});
 await home.until('typeof window.hauserTabletStandby==="function"&&!!document.querySelector(".ambient")');
 await home.click('[data-nav=home]');
 await powerCycle();capture('power-wake');passed('Power sleeps the display; Power wakes directly into the settled Hauser lockscreen');
 await unlock();passed('touch leaves standby and returns to normal Hauser controls');
 await home.click('[data-nav=apps]');await shell.until('document.body.dataset.panel==="apps"&&document.body.dataset.phase==="open"');
 await powerCycle();await shell.until('document.body.dataset.phase==="prepared"');passed('power closes the native app drawer and wakes into Hauser standby');
 await unlock();
 device("c.start('com.android.settings')\nprint(json.dumps(True))");await delay(600);
 await powerCycle();capture('other-app-wake');passed('Power from Android Settings returns directly to the Hauser lockscreen');
 await home.click('.ambient-weather-access');await home.until('!!document.querySelector(".weather-view")');
 await powerCycle();await home.until('!document.querySelector(".weather-view")');passed('power closes weather and preserves the Hauser standby background');
 await unlock();
 await powerCycle();await powerCycle();capture('final-standby');passed('repeated sleep/wake stays in standby and keeps the display off between presses');
 assert.match(device("print(json.dumps(c.shell(['settings','get','secure','default_input_method'],readonly=True)))"),/de\.ralleur\.hauser\.tablet/);
 evidence.result='passed';
}catch(error){evidence.result='failed';evidence.error=error.stack;try{capture('failure');}catch{}process.exitCode=1;}
finally{home?.close();shell?.close();writeFileSync(new URL('../build/tablet-prototype/lockscreen-check.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));}
