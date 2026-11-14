// SPDX-License-Identifier: AGPL-3.0-only
// This fixture imports production pairing; it never contacts a real household.
import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createDeviceStore, authenticateRequest, remoteGateAllows, servePairing } from '../app/server/pairing.mjs';
const require=createRequire(new URL('../app/package.json',import.meta.url));
const {WebSocketServer}=require('ws');
const dir=fileURLToPath(new URL('./build/fixture/',import.meta.url));mkdirSync(dir,{recursive:true});
const store=createDeviceStore(null,{now:()=>1700000000000});const pair=store.startPairing();
writeFileSync(dir+'code.txt',pair.code);writeFileSync(dir+'pid.txt',String(process.pid));
const ws=new WebSocketServer({noServer:true});let state='off',commands=0,sockets=0;
const server=http.createServer((req,res)=>{
 authenticateRequest(req,store);
 const json=(status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
 if(req.url==='/api/health')return json(200,{ok:true});
 if(req.url==='/api/build-info')return json(200,{version:'android-fixture'});
 if(req.url==='/evidence')return json(200,{sockets,commands,state,devices:store.list().map(d=>({platform:d.platform,person:d.person}))});
 if(req.url==='/revoke'){for(const d of store.list())store.revoke(d.id);return json(200,{ok:true});}
 if(req.url.startsWith('/api/pairing/'))return servePairing(req,res,{store,allowedOrigins:new Set(['http://10.0.2.2:4187'])});
 if(!remoteGateAllows(req))return json(401,{code:'DEVICE_TOKEN_REQUIRED'});
 if(req.url==='/api/app/persons')return json(200,{persons:[{id:'fixture',entityId:'person.resident',name:'Test resident'}]});
 // Minimal protocol target checks a real WebView socket and an acknowledged command.
 // It does not claim to be the production UI or a real Home Assistant household.
 res.setHeader('content-type','text/html');res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><h1>Android connection fixture</h1><p id="state">Connecting</p><button id="light" disabled>Switch test light</button><script>const w=new WebSocket('ws://'+location.host+'/api/websocket');w.onmessage=e=>{const d=JSON.parse(e.data);document.getElementById('state').textContent='Socket authenticated · Light '+d.state;document.getElementById('light').disabled=false};document.getElementById('light').onclick=()=>w.send(JSON.stringify({command:'toggle'}));</script>`);
});
server.on('upgrade',(req,socket,head)=>{authenticateRequest(req,store);if(!req.hauserDevice||!remoteGateAllows(req)){socket.destroy();return;}ws.handleUpgrade(req,socket,head,client=>{sockets++;client.send(JSON.stringify({state}));client.on('message',data=>{if(JSON.parse(data).command==='toggle'){commands++;state=state==='off'?'on':'off';client.send(JSON.stringify({state}));}});});});
server.listen(4187,'127.0.0.1',()=>console.log('android_fixture_ready; test code stored locally'));
