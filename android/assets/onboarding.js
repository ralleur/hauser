// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const de = navigator.language.startsWith('de');
const t = (a,b) => de?a:b;
document.documentElement.lang=de?'de':'en';
let pane='welcome',lit=false,busy=false,found=false,remote='',persons=[];
const fields={address:'',code:'',name:'Android',http:false};
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(id,text,kind='')=>`<button id="${id}" class="${kind}">${text}</button>`;
const back=()=>button('back',t('Zurück','Back'),'quiet');
const field=(id,label,placeholder='',extra='')=>`<label>${label}<input id="${id}" value="${esc(fields[id]||'')}" placeholder="${placeholder}" ${extra}></label>`;
const status=()=>'<p id="status" class="status" role="status" aria-live="polite"></p>';
const call=(name,...args)=>{if(window.HauserSetup)HauserSetup[name](...args);else window.dispatchEvent(new CustomEvent('native-call',{detail:{name,args}}));};
const click=(id,fn)=>{if($(id))$(id).onclick=fn;};
function show(next){pane=next;document.body.dataset.pane=pane;document.body.dataset.lit=lit;
 let html='';
 if(pane==='welcome')html=`<h1>${t('Schön, dass du da bist.','Good to have you here.')}</h1><p>${t('Hauser macht aus deinem Zuhause ein Bild, das mit dem Tag lebt — und das auf einen Tipp hört. Probier es gleich aus.','Hauser turns your home into a picture that lives with the day — and listens to a single tap. Try it right now.')}</p>${button('light',t('☼ Licht an','☼ Lights on'))}`;
 if(pane==='who')html=`<h2>${t('Wie hältst du es mit Smart Home?','How do you feel about smart home?')}</h2><p>${t('Danach richtet sich, wie Hauser zu dir kommt.','That decides how Hauser comes to you.')}</p><button id="ha" class="card"><strong>${t('Smart Home macht mir Spaß.','Smart home is fun for me.')}</strong><span>${t('Ich weiß schon viel und will vor allem mehr Komfort.','I already know a lot and mostly want more comfort.')}</span><em>${t('Weiter mit Home Assistant','Continue with Home Assistant')} →</em></button>${button('demo',t('Erst einmal nur umsehen','Just look around first'),'quiet')}`;
 if(pane==='ha')html=`<h2>${t('Schön — dann holen wir dein Home Assistant dazu.','Lovely — let us bring in your Home Assistant.')}</h2><p id="discovery" class="status">${found?t('Hauser läuft schon bei dir: ','Hauser is already running at your place: ')+esc(fields.address):t('Ich schaue, ob Hauser bei dir schon läuft …','Checking whether Hauser is already running at your place …')}</p><p>${t('Öffne in Hauser System → „Telefon koppeln“ und halte die Kamera auf den Code.','In Hauser, open System → “Pair a phone” and point the camera at the code.')}</p>${button('scan',t('QR-Code aufnehmen','Photograph QR code'))}${!found?button('setup',t('Hauser noch nicht eingerichtet?','Not set up Hauser yet?'),'card'):''}<details id="manual"><summary>${t('Oder von Hand eingeben','Or enter manually')}</summary>${field('address',t('Hauser-Adresse','Hauser address'),'http://homeassistant.local:4173','type="url" inputmode="url" autocomplete="url" autocapitalize="none" spellcheck="false"')}${field('code',t('Kopplungscode','Pairing code'),'ABCD2345','maxlength="8" autocapitalize="characters" spellcheck="false" autocomplete="off"')}${field('name',t('Gerätename','Device name'))}<label><input id="http" type="checkbox" ${fields.http?'checked':''}>${t('HTTP nur in meinem vertrauenswürdigen Heimnetz erlauben (unverschlüsselt).','Allow unencrypted HTTP only on my trusted home network.')}</label>${button('connect',t('Verbinden','Connect'))}</details>${status()}${back()}`;
 if(pane==='setup')html=`<h2>${t('Hauser einrichten','Set up Hauser')}</h2><p>${t('Das geht direkt in Home Assistant. Danach koppeln wir dein Gerät.','You can do this directly in Home Assistant. Then we pair your device.')}</p><section class="card"><strong>1 · ${t('Repository hinzufügen','Add the repository')}</strong><p>${t('Füge das Hauser-Repository zu Home Assistant hinzu.','Add the Hauser repository to Home Assistant.')}</p>${button('repo',t('In Home Assistant öffnen','Open in Home Assistant'))}<p class="small">https://github.com/ralleur/hauser</p></section><section class="card"><strong>2 · ${t('Hauser installieren und starten','Install and start Hauser')}</strong><p>${t('Installiere Hauser, starte es und öffne die Weboberfläche.','Install Hauser, start it and open the web interface.')}</p>${button('addon',t('Hauser öffnen','Open Hauser'))}</section><section class="card"><strong>3 · ${t('Hauser finden','Find Hauser')}</strong><p>${t('Sobald Hauser läuft, suchen wir es in deinem Heimnetz.','Once Hauser is running, we look for it on your network.')}</p>${field('address',t('Hauser-Adresse (falls bekannt)','Hauser address (if known)'),'http://homeassistant.local:4173','type="url" inputmode="url" autocapitalize="none"')}${button('find',t('Hauser suchen','Find Hauser'))}${status()}</section>${back()}`;
 if(pane==='person')html=`<h2>${t('Wer bist du?','Who are you?')}</h2><p>${t('Hauser kann dich mit deiner Person aus Home Assistant verbinden.','Hauser can connect you to your person from Home Assistant.')}</p>${persons.map((p,i)=>button('person-'+i,esc(p.name),'card')).join('')}${button('skipPerson',t('Überspringen','Skip'),'quiet')}${status()}`;
 $('pane').innerHTML=html;
 for(const id of ['address','code','name'])if($(id))$(id).oninput=()=>{fields[id]=$(id).value;if(id==='address')remote='';};
 if($('http'))$('http').onchange=()=>fields.http=$('http').checked;
 click('light',()=>{lit=true;document.body.dataset.lit=true;$('light').disabled=true;setTimeout(()=>show('who'),matchMedia('(prefers-reduced-motion:reduce)').matches?300:1100);});
 click('ha',()=>{show('ha');call('discover','');});click('demo',()=>call('demo'));click('scan',()=>call('scan'));click('setup',()=>show('setup'));
 click('connect',()=>{if(busy)return;busy=true;$('connect').disabled=true;$('status').textContent=t('Wird gekoppelt …','Pairing …');call('claim',fields.address,fields.code,fields.name,fields.http,remote);});
 click('repo',()=>call('external','https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fralleur%2Fhauser'));
 click('addon',()=>call('external','https://my.home-assistant.io/redirect/supervisor_addon/?addon=hauser&repository_url=https%3A%2F%2Fgithub.com%2Fralleur%2Fhauser'));
 click('find',()=>{if($('status'))$('status').textContent=t('Suche …','Searching …');call('discover',fields.address);});
 click('back',goBack);click('skipPerson',()=>call('person',''));persons.forEach((p,i)=>click('person-'+i,()=>call('person',p.entityId)));
 window.scrollTo(0,0);
}
window.nativeResult=r=>{
 busy=false;if($('connect'))$('connect').disabled=false;
 if(r.type==='found'){found=true;fields.address=r.address;if($('address'))$('address').value=r.address;if(pane==='setup')show('ha');if($('discovery'))$('discovery').textContent=t('Hauser läuft schon bei dir: ','Hauser is already running at your place: ')+r.address;}
 if(r.type==='missing'&&$('discovery'))$('discovery').textContent=r.message;
 if(r.type==='missing'&&pane==='setup'&&$('status'))$('status').textContent=r.message;
 if(r.type==='error'&&$('status')){$('status').textContent=r.message;$('status').classList.add('error');}
 if(r.type==='persons'){persons=r.persons;if(persons.length)show('person');else call('person','');}
 if(r.type==='link'){lit=true;fields.address=r.address;fields.code=r.code;remote=r.remote||'';show('ha');$('manual').open=true;$('status').textContent=t('Adresse und Code übernommen. Prüfe die Verbindung und tippe auf Verbinden.','Address and code filled in. Check the connection and tap Connect.');}
};
function goBack(){if(pane==='setup')show('ha');else if(pane==='ha')show('who');else if(pane==='who')show('welcome');else return false;return true;}
window.goBack=goBack;show('welcome');click('source',()=>call('external','https://github.com/ralleur/hauser'));
