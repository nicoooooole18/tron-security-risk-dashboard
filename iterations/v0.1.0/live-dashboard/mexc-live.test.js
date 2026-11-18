"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const C=require("./mexc-core"),{compactState,packState,unpackState}=require("./mexc-compact");
const {createMexcMonitor,readMexcSnapshot}=require("./mexc-monitor"),{createProvider}=require("./mexc-provider"),{combineSnapshots}=require("./mexc-attribution");
const {watchAccounts}=require("./mexc-live-cycle"),book=require("./mexc-sources.json"),review=require("./mexc-attribution-review.json");
const S=book.addresses[0].address,[A,B,X,H]=[1,2,3,4].map(i=>C.address(String(i).padStart(40,"0")));
const now=Date.now(),hash=i=>String(i).padStart(64,"0"),row=(i,from,to,ts,contract=C.USDT)=>({txid:hash(i),from,to,blockTs:ts,contract,amountRaw:"100000000",eventIndex:null});
const fresh=()=>({version:1,accounts:{},transfers:[],receipts:{},receiptAttempts:{},members:{},positions:{},archive:{},frozen:{},limits:{}});
async function temp(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),"mexc-live-test-"));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,"data"));await fs.writeFile(path.join(root,"mexc-sources.json"),JSON.stringify(book));return root;}
const provider=overrides=>({type:async()=>"wallet",page:async()=>({rows:[],next:""}),receipt:async()=>{throw Error("unavailable")},position:async()=>({jTokenRaw:"10",underlyingRaw:"2",borrowRaw:"0"}),frozen:async()=>"clear",...overrides});
const options={compact:true,accountsPerCycle:3,pagesPerAccount:2,receiptsPerCycle:0,positionsPerCycle:0,frozenPerCycle:0};

test("packed storage preserves integer quantities, addresses and event identity and rejects corrupt dictionaries",()=>{
 const s=fresh();s.transfers=[{...row(1,S,A,now),amountRaw:"123456789012345678901234567890"},row(2,A,B,now,C.JUSDT)];
 const packed=JSON.parse(JSON.stringify(packState(s)));assert.equal(packed.transfers,undefined);
 assert.deepEqual(unpackState(structuredClone(packed)),s);
 const bad=structuredClone(packed);bad.transferTable.rows[0][1]=999;assert.throws(()=>unpackState(bad));
 assert.equal(typeof unpackState(packed).transfers[0].amountRaw,"string");
});
test("compaction retains canonical contract relays, source rows and all jToken evidence",()=>{
 const s=fresh();s.accounts[A]={depth:1,type:"wallet",rights:false};
 s.transfers=[row(1,X,A,now),row(2,S,A,now),row(3,A,B,now,C.JUSDT),{...row(4,H,A,now),eventIndex:2}];
 s.receipts[hash(1)]={transfers:[{...row(1,S,H,now),eventIndex:0},{...row(1,H,A,now),eventIndex:1}],actions:[]};
 const receipt=structuredClone(s.receipts);compactState(s,{sources:book,market:C.MARKETS.USDT});
 assert.deepEqual(s.transfers.map(r=>r.txid),[hash(2),hash(3),hash(4)]);assert.deepEqual(s.receipts,receipt);
 assert.equal(s.accounts[A].fundingCompacted,true);
});
test("a compacted second wallet promoted by a new market deposit replays history and discovers the previously omitted path",async t=>{
 const root=await temp(t),s=fresh(),past=now-C.DAY;
 const account=depth=>({depth,type:"wallet",rights:false,active:true,lastAttempt:0,lastSuccess:past,through:past,history:{since:now-30*C.DAY,until:past,done:true,cursor:""}});
 s.accounts[A]=account(0);s.accounts[B]={...account(1),fundingCompacted:true};s.accounts[C.JUSDT]={...account(-1),type:"contract"};
 s.transfers=[row(1,B,A,now-1.5*C.DAY),row(2,A,C.JUSDT,now-1.25*C.DAY)];
 await fs.writeFile(path.join(root,"data/mexc-state.json"),JSON.stringify(packState(s)));
 const deposit=row(3,B,C.JUSDT,now-3600000),funding=row(4,X,B,now-2*C.DAY),source=row(5,S,X,now-3*C.DAY),calls=[];
 const p=provider({page:async(a,q)=>{calls.push({a,q:{...q}});const rows=a===C.JUSDT?[deposit]:a===B?[funding]:a===X?[source]:[];return {rows:rows.filter(r=>r.blockTs>=q.since&&r.blockTs<=q.until),next:""};}});
 let snap;for(let i=0;i<5;i++)snap=await createMexcMonitor({root,provider:p,options,clock:()=>now+i*1000}).refresh();
 assert.ok(calls.some(c=>c.a===B&&c.q.since<=funding.blockTs));
 const event=snap.events.find(e=>e.txid===deposit.txid);assert.ok(event);assert.equal(event.evidence[0].from,S);assert.equal(event.evidence.length,3);
});
test("continuous market head resumes from the prior backfill boundary without skipping a multi-day deployment gap",async t=>{
 const root=await temp(t),s=fresh(),boundary=now-2*C.DAY;
 s.accounts[C.JUSDT]={depth:-1,type:"contract",rights:false,lastSuccess:boundary,lastAttempt:0,history:{since:now-32*C.DAY,until:boundary,done:true,cursor:""}};
 await fs.writeFile(path.join(root,"data/mexc-state.json"),JSON.stringify(packState(s)));
 const calls=[];await createMexcMonitor({root,provider:provider({page:async(a,q)=>{calls.push({a,q});return {rows:[],next:""};}}),options,clock:()=>now}).refresh();
 assert.ok(calls.some(c=>c.a===C.JUSDT&&c.q.since===boundary-60000&&c.q.until===now));
});
test("a review-only jToken watcher promoted to a depositor replays USDT funding and verifies its actual account type",async t=>{
 const root=await temp(t),s=fresh(),past=now-C.DAY,deposit=row(6,B,C.JUSDT,now-3600000),source=row(7,S,B,now-2*C.DAY);
 s.accounts[B]={depth:2,type:"watch",rights:true,watchOnly:true,lastSuccess:past,lastAttempt:0,through:past,history:{since:past-1000,until:past,done:true,cursor:"",asset:C.JUSDT}};
 s.accounts[C.JUSDT]={depth:-1,type:"contract",rights:false,lastSuccess:past,lastAttempt:0,through:past,history:{since:now-30*C.DAY,until:past,done:true,cursor:""}};
 s.transfers=[deposit];await fs.writeFile(path.join(root,"data/mexc-state.json"),JSON.stringify(packState(s)));
 const types=[];const snap=await createMexcMonitor({root,clock:()=>now,options:{...options,watchAccounts:[{address:B,since:past}]},
  provider:provider({type:async a=>{types.push(a);return "wallet";},page:async(a,q)=>({rows:a===B&&source.blockTs>=q.since&&(!q.asset||q.asset===C.USDT)?[source]:[],next:""})})}).refresh();
 assert.ok(types.includes(B));assert.equal(snap.events.find(e=>e.txid===deposit.txid).evidence[0].from,S);
});
test("expired pagination cursors restart the same bounded interval without advancing past missing records",async t=>{
 const root=await temp(t),s=fresh(),since=now-2*C.DAY,until=now-3600000,calls=[];
 s.accounts[C.JUSDT]={depth:-1,type:"contract",lastSuccess:since,lastAttempt:0,through:since,history:{since:now-30*C.DAY,until:since,done:true,cursor:""},head:{since,until,cursor:"expired",seen:["expired"],asset:C.USDT,incoming:true}};
 await fs.writeFile(path.join(root,"data/mexc-state.json"),JSON.stringify(packState(s)));
 const p=provider({page:async(a,q)=>{calls.push({...q});if(q.cursor)throw Error("TronGrid HTTP 400");return {rows:[],next:""};}});
 const monitor=createMexcMonitor({root,provider:p,options,clock:()=>now});await monitor.refresh();await monitor.refresh();
 assert.equal(calls[0].cursor,"expired");assert.equal(calls[1].cursor,"");assert.equal(calls[1].since,since);assert.equal(calls[1].until,until);
});
test("review watchpoints including public pools report positions and observed jToken changes without becoming source provenance",async t=>{
 const root=await temp(t),transfer=row(9,A,B,now-1000,C.JUSDT);
 const snap=await createMexcMonitor({root,getHubs:async()=>new Set([A]),clock:()=>now,
   options:{...options,positionsPerCycle:2,watchAccounts:[{address:A,since:now-10000}]},
   provider:provider({page:async(a,q)=>({rows:a===A?[transfer]:[],next:""})})}).refresh();
 assert.equal(snap.events.length,0);assert.equal(snap.observedRights.length,1);assert.equal(snap.rights.length,0);
 assert.equal(snap.positions[0].address,A);assert.equal(snap.positions[0].reviewWatch,true);assert.equal(snap.positions[0].status,"ok");
 assert.equal(snap.sources.addresses.some(a=>a.address===A),false);
 const p=review.retention[0],base={sourceVersion:review.sourceVersion,scope:"MEXC-USDT-jUSDT",events:[],positions:[],coverage:{},until:review.until};
 const dd={...base,scope:"MEXC-USDD-jUSDD",observedRights:[{from:p.address,to:B,blockTs:Date.parse(p.asOf)+1}]};
 const merged=combineSnapshots(base,dd,review);assert.equal(merged.review.retention.find(r=>r.address===p.address).needsReview,true);
 assert.deepEqual(merged.review.totals,review.totals);
 const evicted={...dd,observedRights:[],watchActivity:{[p.address]:{lastOutgoingAt:Date.parse(p.asOf)+1,txid:hash(9)}}};
 assert.equal(combineSnapshots(base,evicted,review).review.retention.find(r=>r.address===p.address).needsReview,true);
 assert.equal(watchAccounts(review,C.MARKETS.USDT).length,31);assert.equal(watchAccounts(review,C.MARKETS.USDD).length,16);
});
test("request budget bounds actual HTTP calls and 429 opens a per-cycle circuit without retry bursts",async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return {ok:true,status:200,json:async()=>({data:[],meta:{}})};};
 const p=createProvider({fetchImpl,delayMs:0,maxRequests:2});
 await p.page(A,{since:1,until:2});await p.page(A,{since:1,until:2});await assert.rejects(p.page(A,{since:1,until:2}),/预算/);assert.equal(calls,2);
 const limited=createProvider({delayMs:0,circuitBreakOnRateLimit:true,fetchImpl:async()=>{calls++;return {ok:false,status:429};}});
 await assert.rejects(limited.page(A,{since:1,until:2}),/429/);await assert.rejects(limited.page(A,{since:1,until:2}),/429/);
 assert.equal(calls,3);assert.equal(limited.stats().rateLimited,true);
 const expired=createProvider({fetchImpl,delayMs:0,maxDurationMs:0});await assert.rejects(expired.page(A,{since:1,until:2}),/时间预算/);
 assert.equal(calls,3);assert.equal(expired.stats().timeBudgetExhausted,true);
});
test("exhausting the graph budget stops further uncached traversal and explicitly reports incomplete coverage",()=>{
 const transfers=[...Array.from({length:500},(_,i)=>row(i+10,X,A,now-10000+i)),...Array.from({length:500},(_,i)=>row(i+1000,A,C.JUSDT,now-1000+i))];
 const result=C.analyze({transfers,sources:book,accountTypes:{[A]:"wallet",[X]:"wallet"},since:now-C.DAY,until:now,maxVisits:10});
 assert.equal(result.graphLimited,true);assert.ok(result.graphVisits<=11);assert.equal(result.events.length,0);
});
test("collector heartbeat cannot make old snapshots or historical attribution look fresh",async t=>{
 const root=await temp(t);await fs.mkdir(path.join(root,"reviewed-snapshots"));
 for(const file of ["mexc-attribution-review.json","reviewed-snapshots/mexc-snapshot.json","reviewed-snapshots/mexc-usdd-snapshot.json"])await fs.copyFile(path.join(__dirname,file),path.join(root,file));
 await fs.writeFile(path.join(root,"data/mexc-live-status.json"),JSON.stringify({enabled:true,phase:"paused",heartbeatAt:new Date(now-180000).toISOString()}));
 const snap=await readMexcSnapshot(root,now);assert.equal(snap.runtime.collector.heartbeatStale,true);assert.equal(snap.review.historical,true);
 assert.equal(snap.review.reviewedAt,review.reviewedAt);assert.equal(snap.runtime.snapshotOrigin,"reviewed-publication");
});
test("UI exposes pressure pauses and stale heartbeat while retaining clearly dated review snapshots",async()=>{
 const vm=require("node:vm"),nodes=new Map(),listeners={};
 const document={hidden:false,getElementById:id=>{if(!nodes.has(id))nodes.set(id,{value:id==="mexcPeriod"?"30":"all",innerHTML:"",listeners:{},classList:{toggle(){},add(){}},addEventListener(n,f){this.listeners[n]=f;}});return nodes.get(id);},addEventListener:(n,f)=>{listeners[n]=f;}};
 const base={sourceVersion:review.sourceVersion,scope:"MEXC-USDT-jUSDT",events:[],positions:[],sources:book,coverage:{},until:review.until,
  runtime:{snapshotOrigin:"reviewed-publication",collector:{enabled:true,phase:"paused",pauseReason:"主机可用内存不足",heartbeatAt:new Date(now).toISOString()}}};
 const data=combineSnapshots(base,null,review);
 vm.runInNewContext(await fs.readFile(path.join(__dirname,"mexc-ui.js"),"utf8"),{document,fetch:async()=>({ok:true,json:async()=>data}),AbortSignal,Date,BigInt,setInterval(){}});
 listeners["dashboard:tab"]({detail:"mexc"});await new Promise(r=>setImmediate(r));
 assert.match(nodes.get("mexcCollectorStatus").textContent,/已暂停.*主机可用内存不足/);
 assert.doesNotMatch(nodes.get("mexcNotice").textContent,/持续采集未启用/);assert.match(nodes.get("mexcNotice").textContent,/等待该市场首轮更新/);
 data.runtime.collector.heartbeatStale=true;await nodes.get("mexcRefresh").listeners.click();
 assert.match(nodes.get("mexcCollectorStatus").textContent,/进程心跳过期/);assert.equal(data.review.reviewedAt,review.reviewedAt);
});
