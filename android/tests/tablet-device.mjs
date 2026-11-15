// SPDX-License-Identifier: AGPL-3.0-only
// Focused acceptance on the explicitly connected, local Xiaomi prototype.
// Main WebView debug socket must be forwarded to localhost:9487. No resets,
// installs, personal app data, account credentials or external services.
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
const evidence={checks:[],screenshots:{},managedDeviceLockdown:'not provisioned; no reset performed',permissions:'special Android permissions remain admin setup'};
let home,shell,keyboard,original,systemBefore;
function passed(name){evidence.checks.push(name);console.log('PASS '+name);}
function capture(name){evidence.screenshots[name]=device('print(json.dumps(c.screenshot(settle=1.2)))').path;}
try {
  systemBefore=device("print(json.dumps({key:c.shell(['settings','get','system',key],readonly=True) for key in ['screen_brightness','screen_brightness_mode','screen_off_timeout']}))");
  home=await Page.open(9487,'home');shell=await Page.open(9487,'/tablet.html');
  await home.until('document.querySelector("#hauser-tablet-status")!==null');await home.click('#hauser-tablet-status');
  await shell.until('state.apps?.length>0');original=await shell.eval('({volume:state.volume,brightness:state.brightness,auto:state.auto,rotationLocked:state.rotationLocked})');
  assert.equal(await home.eval('typeof Tablet'),'undefined');assert.equal(await home.eval('typeof Keyboard'),'undefined');passed('paired page has no privileged tablet or keyboard bridge');
  assert.equal(await shell.eval('state.home&&state.keyboard'),true);passed('Hauser is default home and selected system keyboard');
  await shell.eval('window.openPanel("device");native("brightness",{value:65});native("volume",{value:35})');
  await shell.until('state.brightness===65&&Math.abs(state.volume-35)<=3');
  await shell.eval('native("rotation")');await shell.until(`state.rotationLocked===${!original.rotationLocked}`);
  await shell.eval('native("rotation")');await shell.until(`state.rotationLocked===${original.rotationLocked}`);passed('real brightness, media volume and activity rotation controls');capture('device');
  if(await shell.eval('state.canWrite')){await shell.eval('native("timeout",{milliseconds:120000})');await shell.until('state.timeout===120000');assert.equal(device("print(json.dumps(c.shell(['settings','get','system','screen_off_timeout'],readonly=True)=='120000' and c.shell(['settings','get','system','screen_brightness'],readonly=True)=='166'))"),true);passed('system-wide brightness and screen timeout reach actual Android settings');}
  if(await shell.eval('state.quietAccess')){const wasQuiet=await shell.eval('state.quiet');await shell.eval('native("quiet")');await shell.until(`state.quiet===${!wasQuiet}`);await shell.eval('native("quiet")');await shell.until(`state.quiet===${wasQuiet}`);passed('quiet mode toggles through Android policy access and restores its previous state');}

  await shell.eval('window.openPanel("apps")');assert.equal(await shell.eval('document.querySelectorAll(".app-tile").length'),12);passed('app drawer uses installed apps and a compact quick-access grid');capture('apps');
  const calculator=await shell.eval('state.apps.find(a=>a.package==="com.miui.calculator")?.package');assert(calculator,'Expected installed calculator for safe launch acceptance');
  await shell.eval(`native('app',{package:${JSON.stringify(calculator)}})`);await delay(600);
  const launched=device(`text=c.shell(['dumpsys','activity','activities'],readonly=True)\nprint(json.dumps(any('topResumedActivity=' in line and '${calculator}/' in line for line in text.splitlines())))`);assert.equal(launched,true);device("c.shell(['input','keyevent','KEYCODE_HOME'])\nprint(json.dumps(True))");await delay(400);await home.click('#hauser-tablet-status');await delay(300);passed('app launches and Android Home returns to Hauser');
  await shell.eval('window.openPanel("store")');assert.equal(await shell.eval('catalog.filter(a=>installed(a.id)).every(a=>storeAction(a)==="Öffnen")'),true);assert.equal(await shell.eval('storeAction(catalog.find(a=>a.id==="org.jellyfin.mobile"))'),await shell.eval('installed("org.jellyfin.mobile")?"Öffnen":"Installieren"'));capture('store');passed('store actions reflect actual installation state');
  await shell.click('#search');await delay(1000);
  device("pid=c.shell(['pidof','de.ralleur.hauser.tablet:keyboard'],readonly=True).strip()\nassert pid\nc.command(['forward','tcp:9488','localabstract:webview_devtools_remote_'+pid])\nprint(json.dumps(True))");keyboard=await Page.open(9488,'/keyboard.html');
  await keyboard.until('document.querySelectorAll("#keys button").length>40');
  for(const key of ['h','a'])await keyboard.click(`[data-key="${key}"]`);
  await shell.until('document.querySelector("#search").value==="ha"');await keyboard.until('document.querySelector("[data-word=Hauser]")!==null');await keyboard.click('[data-word=Hauser]');await shell.until('document.querySelector("#search").value==="Hauser "');passed('QWERTZ keyboard commits through Android InputConnection and offers local suggestions');
  await shell.eval('document.querySelector("#search").select()');await keyboard.click('[data-key="ä"]');await shell.until('document.querySelector("#search").value==="ä"');await keyboard.click('[data-key=backspace]');await shell.until('document.querySelector("#search").value===""');
  for(const key of ['c','h','a','t'])await keyboard.click(`[data-key="${key}"]`);await shell.until('query==="chat"');assert.equal(await shell.eval('document.body.classList.contains("keyboard")'),true);capture('keyboard');passed('umlauts, selection replacement, delete and keyboard-aware tablet layout');
  await keyboard.click('[data-key=hide]');await shell.until('!document.body.classList.contains("keyboard")');
  await shell.eval('native("adminAction",{name:"android"})');await shell.until('document.querySelector("#pinForm")!==null');await delay(300);assert.equal(await shell.eval('state.admin'),false);passed('Android administration is gated by native PIN authorization');
  await shell.click('#pin');await delay(500);await keyboard.until('password===true');assert.equal(await keyboard.eval('document.querySelectorAll("#suggestions [data-word]").length'),0);passed('password input disables surrounding-text suggestions');
  await keyboard.click('[data-key=hide]');await shell.click('[data-action=cancelDialog]');
  await shell.eval(`native('volume',{value:${original.volume}});native('brightness',{value:${original.brightness}});${original.auto?'native("auto");':''}window.openPanel('store')`);await delay(400);
  evidence.result='passed';capture('final');
} catch(error) {evidence.result='failed';evidence.error=error.message;process.exitCode=1;}
finally {if(evidence.result==='failed'&&original&&shell){try{await shell.eval(`native('volume',{value:${original.volume}});native('brightness',{value:${original.brightness}});${original.auto?'native("auto");':''}`);device("c.shell(['input','keyevent','KEYCODE_HOME'])\nprint(json.dumps(True))");}catch{}}if(systemBefore){try{device(`values=${JSON.stringify(systemBefore)}\nfor key,value in values.items(): c.shell(['settings','put','system',key,value])\nassert all(c.shell(['settings','get','system',key],readonly=True)==value for key,value in values.items())\nprint(json.dumps(True))`);evidence.originalScreenSettingsRestored=true;}catch(error){evidence.result='failed';evidence.error='Could not restore display test values: '+error.message;process.exitCode=1;}}home?.close();shell?.close();keyboard?.close();writeFileSync(new URL('../build/tablet-prototype/device-check.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));}
