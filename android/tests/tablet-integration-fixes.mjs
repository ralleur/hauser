// SPDX-License-Identifier: AGPL-3.0-only
// Acceptance for the concrete integration findings, on the connected Pad 7.
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
let home,shell,keyboard,originalHome,originalHomeRead,originalLocalRead,fixtureId;
const passed=name=>{evidence.checks.push(name);console.log('PASS '+name);};
const capture=name=>{evidence.screenshots[name]=device('print(json.dumps(c.screenshot(settle=.4)))').path;};
const center='document.querySelector("#hauser-notification-center")';
try {
 home=await Page.open(9487,'home');shell=await Page.open(9487,'/tablet.html');
 await shell.until('typeof native==="function"');await shell.eval('native("close")');
 originalHome=await home.eval('localStorage.getItem("hmi:notifications:v2")');
 originalHomeRead=await home.eval('localStorage.getItem("hauser:tablet-notifications:read:v1")');
 originalLocalRead=await shell.eval('localStorage.getItem("hauser:tablet-notifications:read:v1")');
 await home.until('!!document.querySelector("[data-nav=home]")');await home.click('[data-nav=home]');await home.until('!!document.querySelector("#hauser-tablet-status")');await home.click('#hauser-tablet-status');await shell.until('state.keyboard!==undefined');
 assert.equal(await shell.eval('state.nightMode'),true);assert.equal(await shell.eval('state.keyboard'),true);assert.equal(await shell.eval('state.notificationAccess'),true);
 const homeIcons=await home.eval('[...document.querySelectorAll(".tab-nav [data-nav]")].map(b=>({id:b.dataset.nav,icon:(getComputedStyle(b.querySelector(".icon")).getPropertyValue("--icon-url").match(/([a-z0-9-]+)\.svg/)||[])[1]}))');
 const nativeIcons=await shell.eval('state.navigation.map(({id,icon})=>({id,icon}))');assert.deepEqual(nativeIcons,homeIcons);
 const dock=await shell.eval('document.querySelector("#dock").getBoundingClientRect().toJSON()');assert(dock.x>=0&&dock.right<=1164);
 capture('device-night-mode');passed('Night Mode defaults on; Hauser keyboard selected; identical navigation pictograms');
 await shell.click('[data-action=settings]');await shell.click('[data-action=timeoutMenu]');
 assert.equal(await shell.eval('document.querySelector("select")===null'),true);assert.equal(await shell.eval('document.querySelectorAll(".timeout-options [role=radio]").length'),6);capture('hauser-timeout-picker');
 await shell.click('[data-action=cancelDialog]');await shell.click('[data-action=nightMode]');await shell.until('state.nightMode===false');await shell.click('[data-action=nightMode]');await shell.until('state.nightMode===true');
 device("c.shell(['input','keyevent','KEYCODE_BACK'])\nprint(json.dumps(True))");await shell.until('panel==="device"');passed('screen timeout uses a Hauser dialog; Night Mode toggles; Back returns to device controls');
 await shell.click('[data-action=apps]');await shell.eval(`document.querySelector('#search').value='zzznichtvorhanden';document.querySelector('#search').dispatchEvent(new Event('input',{bubbles:true}))`);
 assert.equal(await shell.eval('document.querySelectorAll("#results .app-tile").length'),0);assert((await shell.eval('document.querySelector("#results").innerText')).includes('Keine passende App'));
 await shell.click('[data-action=store]');await shell.eval(`document.querySelector('#search').value='zzznichtvorhanden';document.querySelector('#search').dispatchEvent(new Event('input',{bubbles:true}))`);
 assert((await shell.eval('document.querySelector("#results").innerText')).includes('Keine passende App'));assert.equal(await shell.eval('getComputedStyle(document.querySelector("#store-featured")).display==="none"'),true);passed('drawer and store show accurate empty results and hide unrelated recommendations');
 await shell.eval(`document.querySelector('#search').value='';document.querySelector('#search').dispatchEvent(new Event('input',{bubbles:true}))`);await shell.click('#search');await delay(500);
 device("pid=c.shell(['pidof','de.ralleur.hauser.tablet:keyboard'],readonly=True).strip()\nc.command(['forward','tcp:9488','localabstract:webview_devtools_remote_'+pid])\nprint(json.dumps(True))");keyboard=await Page.open(9488,'/keyboard.html');await keyboard.until('!!document.querySelector("[data-key=ä]")');
 await keyboard.click('[data-key=ä]');await shell.until('document.querySelector("#search").value==="ä"');capture('hauser-keyboard');await keyboard.click('[data-key=hide]');passed('the actual Hauser QWERTZ keyboard enters an umlaut into the app search');
 await shell.eval('native("close")');
 const stamp=Date.now();const fixtures=[
 {id:'fix-test:critical',source:'test:home',title:'Prüfmeldung · Wichtiger Hinweis',message:'Ein lokaler Oberflächentest, kein echter Alarm.',type:'critical',icon:'i-shield-home',priority:90,createdAt:stamp},
 {id:'fix-test:normal',source:'test:home',title:'Prüfmeldung · Waschmaschine',message:'Diese vollständige Nachricht muss im Ungelesen-Filter lesbar bleiben.',type:'info',icon:'i-washing-machine',priority:50,createdAt:stamp+1},
 ].map(item=>({...item,dedupeKey:item.id}));
 const addFixtures=async values=>home.eval(`(()=>{const data=JSON.parse(localStorage.getItem('hmi:notifications:v2')||'null')||{active:[],dismissed:[]};data.active=data.active.filter(n=>!n.id.startsWith('fix-test:')).concat(${JSON.stringify(values)});localStorage.setItem('hmi:notifications:v2',JSON.stringify(data));location.reload()})()`);
 await addFixtures([fixtures[0]]);await home.until('document.querySelector(".htn-toast:not([hidden])")?.innerText.includes("Wichtiger Hinweis")');
 // A later normal feed update must not replace the critical banner.
 await home.eval(`window.dispatchEvent(new CustomEvent('hauser:notification-state',{detail:${JSON.stringify(fixtures.map(item=>({...item,group:'home'})))}}))`);
 assert((await home.eval('document.querySelector(".htn-toast").innerText')).includes('Wichtiger Hinweis'));passed('a normal incoming notification cannot replace a critical banner');
 await addFixtures(fixtures);await home.until('!!document.querySelector("[data-tablet=notifications]")');await home.click('[data-tablet=notifications]');await shell.until(`${center}.open&&document.querySelector('[data-id="fix-test:normal"]')!==null`);
 await shell.click('[data-group=home]');await shell.click('[data-command=unread]');await shell.click('[data-id="fix-test:normal"]');
 assert.equal(await shell.eval('document.querySelectorAll(".htn-details").length'),1);assert((await shell.eval('document.querySelector(".htn-details").innerText')).includes('vollständige Nachricht'));
 const idBefore=await shell.eval('document.activeElement.dataset.id');
 await shell.eval(`window.dispatchEvent(new CustomEvent('hauser:notification-state',{detail:${JSON.stringify(fixtures.map(item=>({...item,group:'home'})))}}))`);
 // The real 30-second refresh retains the focused row; same-feed update is its direct render path.
 assert.equal(await shell.eval('document.activeElement.dataset.id'),idBefore);passed('reading in the unread filter keeps details open and preserves row focus');
 await shell.click('[data-command=read-all]');await shell.click('[data-command=unread]');
 assert.equal(await shell.eval(`(()=>{const row=document.querySelector('[data-id="fix-test:critical"]').closest('article');return getComputedStyle(row).borderTopColor===getComputedStyle(row.querySelector('.htn-critical-label')).color})()`),true);
 assert((await shell.eval(`document.querySelector('[data-id="fix-test:critical"]').innerText`)).includes('Wichtiger Hinweis'));capture('notifications-critical');passed('read critical notifications retain a visible warning until acknowledged');
 await shell.click('[data-command=close]');
 device("c.shell(['cmd','notification','post','-t','Hauser Prüfmeldung','hauser-integration-fixture','Nur ein lokaler App-Mitteilungstest.'])\nprint(json.dumps(True))");
 await home.click('[data-tablet=notifications]');await shell.until(`${center}.open`);await shell.click('[data-group=apps]');
 fixtureId=await shell.until(`([...document.querySelectorAll('.htn-summary')].find(b=>b.innerText.includes('Hauser Prüfmeldung')))?.dataset.id`);
 assert.equal(await home.eval('document.body.innerText.includes("Hauser Prüfmeldung")'),false);assert.equal(await home.eval('typeof Tablet'),'undefined');
 await shell.click(`[data-id=${JSON.stringify(fixtureId)}]`);await shell.click(`[data-command=dismiss][data-id=${JSON.stringify(fixtureId)}]`);await shell.until(`!document.querySelector('[data-id='+${JSON.stringify(JSON.stringify(fixtureId))}+']')`);
 fixtureId=null;passed('real Android app notification reaches only the offline UI and can be individually dismissed');
 evidence.result='passed';
} catch(error){evidence.result='failed';evidence.error=error.stack;try{evidence.failureState={local:await shell.eval('({panel,open:document.querySelector(".htn-center").open,feed:document.documentElement.dataset.tabletNotificationFeed,fixtures:[...document.querySelectorAll(".htn-summary[data-id]")].filter(b=>b.dataset.id.startsWith("fix-test:")).map(b=>b.dataset.id)})'),home:await home.eval('({panel:document.documentElement.dataset.tabletPanel,fixtureStore:JSON.parse(localStorage.getItem("hmi:notifications:v2")||"{}").active?.filter(i=>i.id.startsWith("fix-test:")).map(i=>i.id)})')};capture('failure');}catch{}process.exitCode=1;}
finally {
 try{
  if(fixtureId&&shell)await shell.eval(`native('notificationAction',{action:'dismiss',id:${JSON.stringify(fixtureId)}})`);
  if(home&&originalHome!==undefined)await home.eval(`localStorage.${originalHome===null?'removeItem("hmi:notifications:v2")':`setItem('hmi:notifications:v2',${JSON.stringify(originalHome)})`};localStorage.${originalHomeRead===null?'removeItem("hauser:tablet-notifications:read:v1")':`setItem('hauser:tablet-notifications:read:v1',${JSON.stringify(originalHomeRead)})`};location.reload()`);
  if(shell&&originalLocalRead!==undefined)await shell.eval(`localStorage.${originalLocalRead===null?'removeItem("hauser:tablet-notifications:read:v1")':`setItem('hauser:tablet-notifications:read:v1',${JSON.stringify(originalLocalRead)})`};native('close')`);
  evidence.originalNotificationStoresRestored=true;
 }catch(error){evidence.cleanupError=error.message;process.exitCode=1;}
 home?.close();shell?.close();keyboard?.close();
 writeFileSync(new URL('../build/tablet-prototype/integration-fixes-check.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}
