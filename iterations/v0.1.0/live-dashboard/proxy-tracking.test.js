"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {updateTracking,trackingView,configuredMarkets}=require("./proxy-tracking");
const {E,H,I,J,U,createProxyMonitor}=require("./proxy-monitor");
const fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const A="TAnP1DxhEuCtbGqX66RV8TtWdDUJzhErzp",B="TVpLzSusAkcYSsN5bwRmYmyxajmVz11HQt",C="TU7nttHF5fcmEzFHZnNNjbzNHgZiXyL6RT";
const t=Date.now()-10000,blocked=new Set([E,H,I,J]),markets=[{contract:J,symbol:"USDT",decimals:6}];
const analysis={deposits:[{funders:[A],blockTs:t,txid:"a".repeat(64)}],rights:[{to:B,blockTs:t+1,txid:"b".repeat(64)}]};
const edge=(from,to,blockTs,contract=J)=>({from,to,blockTs,contract,raw:"100",txid:String(blockTs).padStart(64,"a")});
const position=n=>({underlyingRaw:String(n),borrowRaw:"0",jTokenRaw:"100",exchangeRateRaw:"100000000000000"});
const base={analysis,markets,blocked,until:Date.now(),scan:async()=>({rows:[],complete:true}),readPosition:async()=>position(0)};
test("new receivers and downstream transfers enter all-market queries; dedupe and cohort history",async()=>{
 const other={contract:U,symbol:"OTHER",decimals:18};
 const s=await updateTracking({...base,markets:[...markets,other],scan:async address=>({complete:true,rows:address===B?[edge(B,C,t+2),edge(B,H,t+3)]:[]}),
 readPosition:async(m,a)=>({...position(a===C?"2500000":"0"),borrowRaw:a===C?"500000":"0"})});
 assert.deepEqual(Object.keys(s.accounts).sort(),[A,B,C].sort());
 assert.equal(Object.keys(s.accounts[C].positions).length,2);
 const v=trackingView(s,analysis,{blocked});
 assert.equal(v.counts.addresses,3);assert.equal(v.totals[0].supplyRaw,"2500000");assert.equal(v.totals[0].netRaw,"2000000");
 assert.equal(v.totals[1].supplyRaw,"2500000");assert.equal(v.counts.transferPending,1);
 const empty=trackingView(s,{deposits:[],rights:[]},{blocked});assert.equal(empty.counts.addresses,0);
 const next=await updateTracking({...base,previous:JSON.parse(JSON.stringify(s)),analysis:{deposits:[],rights:[]}});
 assert.ok(next.accounts[C]);assert.equal(next.accounts[C].positions[J].underlyingRaw,"0");
 assert.equal(trackingView(next,analysis,{blocked}).counts.addresses,3);
});
test("97 receivers all queued; bounded queries rotate and failures never become zero",async()=>{
 const alphabet="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
 const addresses=Array.from({length:97},(_,i)=>"T"+"1".repeat(31)+alphabet[Math.floor(i/58)]+alphabet[i%58]);
 const cohort={deposits:[],rights:addresses.map((to,i)=>({to,blockTs:t,txid:String(i).padStart(64,"a")}))};
 let s=await updateTracking({...base,analysis:cohort,positionBudget:10,transferBudget:0});
 assert.equal(Object.keys(s.accounts).length,97);
 let v=trackingView(s,cohort,{blocked});assert.equal(v.counts.queried,10);assert.equal(v.counts.pending,87);assert.equal(v.complete,false);
 s=await updateTracking({...base,previous:s,analysis:cohort,positionBudget:10,transferBudget:0,until:base.until+1});
 assert.equal(trackingView(s,cohort,{blocked}).counts.queried,20);
 s=await updateTracking({...base,previous:s,analysis:cohort,positionBudget:100,transferBudget:0,until:base.until+2,readPosition:async()=>{throw new Error("429");}});
 v=trackingView(s,cohort,{blocked});assert.equal(v.counts.failed,97);assert.equal(v.totals[0].covered,0);
 assert.equal(v.rows[0].underlyingRaw,undefined);
});
test("old balances, transfer failures and hop/cap limits remain explicit",async()=>{
 let s=await updateTracking({...base,maxHops:0,maxAccounts:1,scan:async()=>({complete:false,rows:[edge(A,C,t+2)]})});
 let v=trackingView(s,analysis,{blocked,now:Date.now()+1000000});
 assert.equal(v.hopLimited,true);assert.equal(v.addressLimitReached,true);assert.equal(v.counts.stale,1);assert.equal(v.counts.pending,1);assert.equal(v.complete,false);
 s=await updateTracking({...base,previous:s,scan:async()=>{throw new Error("offline");}});
 v=trackingView(s,analysis,{blocked});assert.ok(v.counts.transferFailed>0);assert.equal(v.complete,false);
});
test("only time-ordered descendants belong to a selected cohort; shared hubs stop traversal",async()=>{
 const s=await updateTracking({...base,scan:async address=>({complete:true,rows:address===B?[edge(B,C,t-1),edge(B,H,t+2)]:[]})});
 const v=trackingView(s,analysis,{blocked});assert.equal(v.counts.addresses,2);assert.equal(v.stopped,1);
 assert.equal(s.accounts[C],undefined);assert.equal(s.accounts[H],undefined);
});
test("configured markets preserve per-asset decimals including native TRX",()=>{
 const config=require("./config.json"),ms=configuredMarkets(config);
 assert.ok(ms.length>10);assert.equal(ms.find(m=>m.contract===J).decimals,6);
 assert.equal(ms.find(m=>m.symbol==="TRX").decimals,6);
 assert.equal(ms.find(m=>m.symbol==="USDD").decimals,18);
 assert.equal(ms.find(m=>m.symbol==="USDCOLD").decimals,6);
 assert.ok(ms.every(m=>Number.isInteger(m.decimals)));
});
test("monitor persists queues on disk and serves selected cohort without network writes on GET",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"proxy-tracking-test-"));let requests=0;
 const raw=[edge(E,B,t+1)];
 const opts={root,readPosition:async()=>position(1000000),fetchJson:async url=>{
  requests++;const address=new URL(url).pathname.split("/")[3];
  return {data:raw.filter(r=>r.from===address||r.to===address).map(r=>({type:"Transfer",transaction_id:r.txid,block_timestamp:r.blockTs,from:r.from,to:r.to,value:r.raw,token_info:{address:r.contract}}))};}};
 const m=createProxyMonitor(opts);
 try {
  await m.refresh();assert.equal(m.getSnapshot().trackingView.counts.addresses,1);
  const before=requests;m.getSnapshot();assert.equal(requests,before);
  const saved=JSON.parse(await fs.readFile(path.join(root,"data/xinbi-proxy-snapshot.json"),"utf8"));assert.ok(saved.tracking.accounts[B]);
  const n=createProxyMonitor({...opts,fetchJson:async()=>{throw new Error("offline");}});
  await n.start();await n.refresh();n.stop();assert.equal(n.getSnapshot().trackingView.counts.addresses,1);assert.equal(n.getSnapshot().runtime.lastError,"offline");
 } finally {m.stop();await fs.rm(root,{recursive:true,force:true});}
});

test("UI distinguishes pending/failed/stale from zero and clears stale amounts on request failure",async()=>{
 const vm=require("node:vm"),nodes=new Map();let poll;
 const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:"",textContent:"",addEventListener(){}});return nodes.get(id);}};
 const state=await updateTracking({...base,readPosition:async(contract,address)=>{if(address===A)throw new Error("<unsafe>");return position(0);}});
 let fail=false;
 const data={summary:{},positions:[],coverage:{complete:false},trackingView:trackingView(state,analysis,{blocked})};
 vm.runInNewContext(await fs.readFile(path.join(__dirname,"proxy-ui.js"),"utf8"),{document,fetch:async()=>{if(fail)throw new Error("offline");return {ok:true,json:async()=>data};},AbortSignal,Date,BigInt,setInterval:f=>{poll=f;}});
 await new Promise(r=>setImmediate(r));
 assert.match(nodes.get("proxyTrackingRows").innerHTML,/&lt;unsafe&gt;/);
 assert.match(nodes.get("proxyTrackingRows").innerHTML,/未知/);
 assert.match(nodes.get("proxyTrackingCoverage").textContent,/覆盖不完整/);
 assert.match(nodes.get("proxyTrackingTotals").innerHTML,/已读取部分/);
 fail=true;await poll();assert.equal(nodes.get("proxyTrackingRows").innerHTML,"");assert.equal(nodes.get("proxyTrackingTotals").innerHTML,"");
});
