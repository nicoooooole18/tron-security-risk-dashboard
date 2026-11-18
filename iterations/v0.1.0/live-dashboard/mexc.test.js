"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path"),vm=require("node:vm");
const C=require("./mexc-core"),{createMexcMonitor,readMexcSnapshot}=require("./mexc-monitor"),{createProvider,addressHex}=require("./mexc-provider");
const book=require("./mexc-sources.json"),S=book.addresses[0].address;
const [A,B,D,E,F]=[1,2,3,4,5].map(n=>C.address(n.toString(16).padStart(40,"0")));
const now=Date.now(),J=C.JUSDT,U=C.USDT;
const hash=id=>id.toString(16).padStart(64,"0");
const row=(from,to,t=1,id=t,extra={})=>({from,to,blockTs:now-100000+t*1000,txid:hash(id),contract:U,amountRaw:"100000000",eventIndex:0,...extra});
const types={[A]:"wallet",[B]:"wallet",[D]:"wallet",[E]:"contract",[F]:"wallet",[S]:"wallet"};
const analyze=(transfers,extra={})=>C.analyze({transfers,sources:book,accountTypes:types,since:now-C.DAY,until:now,...extra});
function mintReceipt(from,t=2,id=t,extra=[]) {
  const deposit=row(from,J,t,id),mint=row(J,from,t,id,{contract:J,eventIndex:1,amountRaw:"4000000000"});
  return {txid:hash(id),blockTs:deposit.blockTs,transfers:[deposit,mint,...extra],actions:[{name:"Mint",eventIndex:2,result:{minter:from,mintAmount:deposit.amountRaw,mintTokens:mint.amountRaw}}]};
}
async function temp(t) {const root=await fs.mkdtemp(path.join(os.tmpdir(),"mexc-test-"));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,"mexc-sources.json"),JSON.stringify(book));return root;}
const provider=(overrides={})=>({page:async()=>({rows:[],next:""}),type:async a=>types[a]||"wallet",receipt:async()=>{throw new Error("not indexed");},position:async()=>({jTokenRaw:"1",underlyingRaw:"1",borrowRaw:"0"}),frozen:async()=>"clear",...overrides});

test("verified Arkham source subset validates; predicted and counterparty addresses do not become seeds",()=>{
  assert.ok(C.validateSources(book).addresses.length>=3);
  for(const s of book.addresses)assert.ok(C.validAddress(s.address));
  assert.throws(()=>C.validateSources({...book,addresses:[book.addresses[0],book.addresses[0]]}));
  assert.throws(()=>C.validateSources({...book,addresses:[{...book.addresses[0],source:"https://arkm.com.evil.test/"}]}));
  assert.equal(analyze([row(S,J)]).events.length,1);
  assert.equal(analyze([row(A,J)]).events.length,0);
  assert.equal(analyze([row(S,J)],{sources:{...book,addresses:book.addresses.map(s=>({...s,status:"predicted"}))}}).events.length,0);
});
test("direct / one / two intermediaries preserve integer amounts and never attribute mixed funds",()=>{
  const big="900719925474099312345678";
  const direct=analyze([row(S,J,1,1,{amountRaw:big})]).events[0];assert.equal(direct.attributedRaw,big);
  const one=analyze([row(S,A),row(A,J,2)]).events[0];assert.equal(one.kind,"wallet");assert.equal(one.attributedRaw,null);
  assert.equal(analyze([row(S,A),row(A,B,2),row(B,J,3)]).events[0].evidence.length,3);
  assert.equal(analyze([row(S,A),row(A,B,2),row(B,D,3),row(D,J,4)]).events.length,0);
  assert.equal(C.sum([direct,direct]),(BigInt(big)*2n).toString());
});
test("future, simultaneous unknown order, wrong asset, public hubs and unknown account types stop provenance",()=>{
  for(const t of [2,3])assert.equal(analyze([row(S,A,t,10),row(A,J,2)]).events.length,0);
  assert.equal(analyze([row(S,A,1,1,{contract:J}),row(A,J,2)]).events.length,0);
  assert.equal(analyze([row(S,A),row(A,J,2)],{hubs:new Set([A])}).events.length,0);
  assert.equal(analyze([row(S,A),row(A,J,2)],{accountTypes:{}}).events.length,0);
  assert.ok(analyze([row(S,A),row(A,J,2)],{maxVisits:1}).graphLimited);
  assert.ok(analyze([row(S,A,1,1,{amountRaw:"1"}),row(A,J,2)]).events[0].dust);
});
test("arbitrary contracts use ordered same-transaction funding; historical proxy funding never taints future deposits",()=>{
  assert.equal(analyze([row(S,E),row(E,J,2)]).events.length,0);
  const legs=[row(S,A),row(A,E,2,2,{eventIndex:0}),row(E,J,2,2,{eventIndex:1})];
  const e=analyze(legs).events[0];assert.equal(e.kind,"contract");assert.equal(e.evidence.length,3);
  assert.equal(analyze(legs.map(r=>({...r,eventIndex:null}))).events.length,0);
});
test("shared upstream searches reuse identical contexts without weakening chronology or hop limits",()=>{
  const rows=[...Array.from({length:100},(_,i)=>row(F,B,i+1,i+1)),...Array.from({length:100},(_,i)=>row(B,A,i+101,i+101)),...Array.from({length:100},(_,i)=>row(A,J,i+201,i+201))];
  const result=analyze(rows,{until:now+400000,maxVisits:20000});
  assert.equal(result.graphLimited,false);assert.equal(result.events.length,0);assert.ok(result.graphVisits<20000);
  const proven=analyze([row(S,B,50,500),...rows],{until:now+400000,maxVisits:20000});assert.equal(proven.events.length,100);
  assert.equal(analyze([...rows,row(S,B,400,501)],{until:now+400000,maxVisits:20000}).events.length,0);
});
test("canonical log identities replace index rows, distinguish repeated equal transfers, and require protocol actions",()=>{
  const r=mintReceipt(S),second={...r.transfers[0],eventIndex:3};r.transfers.push(second);
  const d=analyze([{...r.transfers[0],eventIndex:null}],{receipts:{[r.txid]:r}});
  assert.equal(d.events.length,2);assert.ok(d.events.every(e=>e.verified));
  assert.equal(d.events.filter(e=>e.operation==="Mint").length,1);
  const transfer=analyze([],{receipts:{[r.txid]:{...r,actions:[]}}}).events[0];assert.equal(transfer.operation,"Transfer");
  const repaid=analyze([],{receipts:{[r.txid]:{...r,actions:[{name:"RepayBorrow",eventIndex:2,result:{payer:S,repayAmount:"100000000"}}]}}}).events[0];
  assert.equal(repaid.operation,"RepayBorrow");
});
test("solid receipt cross-check rejects failures, missing and inconsistent logs, and normalizes hex addresses",()=>{
  const id=hash(1),blockTs=now-1000,topic="ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const info={id,blockTimeStamp:blockTs,receipt:{result:"SUCCESS"},log:[{address:addressHex(U).slice(2),topics:[topic,addressHex(S).slice(2).padStart(64,"0"),addressHex(J).slice(2).padStart(64,"0")],data:100n.toString(16).padStart(64,"0")}]};
  const e={transaction_id:id,block_timestamp:blockTs,event_index:0,contract_address:U,event_name:"Transfer",result:{from:addressHex(S).slice(2),to:addressHex(J).slice(2),value:"100"}};
  assert.equal(C.canonicalReceipt(id,[e],info).transfers[0].from,S);
  assert.throws(()=>C.canonicalReceipt(id,[],info));
  assert.throws(()=>C.canonicalReceipt(id,[{...e,result:{...e.result,value:"99"}}],info));
  assert.throws(()=>C.canonicalReceipt(id,[e],{...info,receipt:{result:"REVERT"}}));
  assert.throws(()=>C.canonicalReceipt(id,[{...e,event_index:null}],info));
  assert.equal(C.normalizeTransfer({...row(S,J),confirmed:false}),null);
  assert.equal(C.normalizeTransfer({...row(S,J),type:"Approval"}),null);
});
test("rights follow verified mint, stop pre-mint history and hubs, require Redeem action, and handle repeated proxy mints",()=>{
  const r=mintReceipt(E,2,2,[row(S,E,2,2,{eventIndex:-1})]),r2=mintReceipt(E,4,4,[row(S,E,4,4,{eventIndex:-1})]);
  const out=row(E,A,2,2,{eventIndex:3,contract:J,amountRaw:"4000000000"});
  const out2=row(E,B,4,4,{eventIndex:3,contract:J,amountRaw:"4000000000"});
  const onward=row(A,D,3,3,{contract:J}),redeem=row(D,J,5,5,{contract:J});
  const receipts={[r.txid]:r,[r2.txid]:r2,[redeem.txid]:{txid:redeem.txid,transfers:[redeem],actions:[{name:"Redeem",result:{redeemer:D,redeemTokens:redeem.amountRaw,redeemAmount:"2500000"}}]}};
  const events=analyze([],{receipts}).events;
  const rows=[...r.transfers,...r2.transfers,out,out2,onward,redeem,row(A,F,1,9,{contract:J}),row(E,F,6,6,{contract:J,amountRaw:"4000000000"})];
  const result=C.trackRights({events,rows,receipts,accountTypes:types});
  assert.ok(result.members[A]);assert.ok(result.members[B]);assert.ok(result.members[D]);assert.equal(result.members[F],undefined);
  assert.equal(result.redemptions[0].underlyingRaw,"2500000");assert.equal(result.ambiguous.length,1);
  const stopped=C.trackRights({events,rows,receipts,accountTypes:types,hubs:new Set([A])});assert.equal(stopped.members[A],undefined);assert.equal(stopped.members[D],undefined);
  const incomplete=C.trackRights({events,rows,receipts:{...receipts,[redeem.txid]:{actions:[]}},accountTypes:types});assert.equal(incomplete.redemptions[0].kind,"redeem-candidate");
});
test("paged scan resumes fixed windows after restart; head failures do not erase history or become complete",async t=>{
  const root=await temp(t),calls=[];let fail=false,clock=now;
  const p=provider({page:async(a,s)=>{calls.push({...s});if(fail)throw new Error("HTTP 429");return {rows:[row(S,J,1)],next:s.cursor?"":"next"};}});
  const make=()=>createMexcMonitor({root,provider:p,clock:()=>clock,options:{pagesPerAccount:1,receiptsPerCycle:0}});
  const monitor=make();assert.equal(monitor.refresh(),monitor.refresh());const first=await monitor.refresh();assert.equal(first.coverage.historyPending,1);
  clock+=60000;const restarted=make();await restarted.refresh(); // head
  // Two pages permits a history turn alongside head.
  await createMexcMonitor({root,provider:p,clock:()=>clock,options:{pagesPerAccount:2,receiptsPerCycle:0}}).refresh();
  const history=calls.find(c=>c.cursor==="next"&&c.since===calls[0].since);assert.ok(history);assert.equal(history.until,now);
  fail=true;const failed=await make().refresh();assert.ok(failed.coverage.errors.length);assert.equal(failed.summary.matchedCount,1);
  const bytes=await fs.readFile(path.join(root,"data/mexc-state.json"),"utf8");await readMexcSnapshot(root,clock);assert.equal(await fs.readFile(path.join(root,"data/mexc-state.json"),"utf8"),bytes);
});
test("rights traversal stops at the configured hop and member caps",()=>{
  const r=mintReceipt(S),receipts={[r.txid]:r},events=analyze([],{receipts}).events;
  const chain=[S,A,B,D,F,C.address("6".padStart(40,"0"))],rows=[...r.transfers,...chain.slice(1).map((a,i)=>row(chain[i],a,i+3,i+3,{contract:J}))];
  const result=C.trackRights({events,rows,receipts,accountTypes:types});assert.equal(result.rights.length,4);assert.equal(result.limited,true);assert.equal(result.members[chain[5]],undefined);
  const capped=C.trackRights({events,rows,receipts,accountTypes:types,maxMembers:1});assert.equal(Object.keys(capped.members).length,1);assert.equal(capped.limited,true);
});
test("real JustLend Mint-before-Transfer receipt creates the exact jUSDT cohort",()=>{
  const receipt=require("./test-fixtures/mexc-mint-2026-11-10.json"),receipts={[receipt.txid]:receipt};
  const deposit=receipt.transfers.find(r=>r.contract===U),mint=receipt.transfers.find(r=>r.contract===J);
  const sources={...book,addresses:[{...book.addresses[0],address:deposit.from}]};
  const events=analyze([],{sources,receipts,since:receipt.blockTs-1000,until:receipt.blockTs+1000}).events;
  const result=C.trackRights({events,rows:receipt.transfers,receipts,accountTypes:{[deposit.from]:"wallet"}});
  assert.equal(events[0].actionIndex,2);assert.equal(mint.eventIndex,3);
  assert.equal(result.members[deposit.from].edge.amountRaw,"2753339740844093");
});
test("fixed-window backfill drains queues and resumes without endlessly replaying completed accounts",async t=>{
  const root=await temp(t),r=mintReceipt(S),calls=[];
  const p=provider({page:async(a,s)=>{calls.push({a,s:{...s}});return {rows:a===J?[r.transfers[0]]:[],next:""};},receipt:async()=>r});
  const options={backfillUntil:now,concurrency:4,accountsPerCycle:4,pagesPerAccount:4};
  const m=createMexcMonitor({root,provider:p,clock:()=>now+60000,options});
  const first=await m.refresh();assert.equal(first.coverage.scanComplete,false);assert.equal(first.until,new Date(now).toISOString());
  const done=await m.refresh();assert.equal(done.coverage.scanComplete,true);assert.equal(done.coverage.sourceComplete,false);
  const count=calls.length;await createMexcMonitor({root,provider:p,clock:()=>now+120000,options}).refresh();assert.equal(calls.length,count);
  assert.ok(calls.every(c=>c.s.until===now&&c.s.since===now-30*C.DAY));
});
test("newly verified public hub removes old matches and candidates reachable only through that hub",async t=>{
  const root=await temp(t),r=mintReceipt(B,3,3),legs=[row(S,A),row(A,B,2)];let hubs=new Set();
  const p=provider({page:async a=>({rows:a===J?[r.transfers[0]]:a===B?[legs[1]]:a===A?[legs[0]]:[],next:""}),receipt:async id=>id===r.txid?r:{txid:id,transfers:legs.filter(x=>x.txid===id),actions:[]}});
  const m=createMexcMonitor({root,provider:p,getHubs:async()=>hubs,clock:()=>now,options:{backfillUntil:now}});
  await m.refresh();await m.refresh();await m.refresh();const before=await m.refresh();assert.equal(before.events.length,1);
  hubs=new Set([B]);const after=await m.refresh();assert.equal(after.events.length,0);assert.equal(after.positions.length,0);assert.equal(after.coverage.totalAccounts,1);assert.ok(after.coverage.excludedAccounts>=2);
});
test("second-wallet history ends at its last connecting output and grows when a later output is discovered",async t=>{
  const root=await temp(t),calls=[],legs=[row(S,A),row(A,B,2),row(B,J,3)],later=[row(S,A,4),row(A,B,5),row(B,J,6)];
  const p=provider({page:async(a,s)=>{calls.push({a,until:s.until});return {rows:[...legs,...later].filter(r=>r.to===a&&r.blockTs<=s.until&&legs.includes(r)),next:""};},receipt:async id=>({txid:id,transfers:[...legs,...later].filter(r=>r.txid===id),actions:[]})});
  const options={backfillUntil:now,pagesPerAccount:1};
  const m=createMexcMonitor({root,provider:p,clock:()=>now,options});
  let d;for(let i=0;i<4;i++)d=await m.refresh();
  assert.equal(d.coverage.scanComplete,true);assert.equal(calls.find(c=>c.a===A).until,legs[1].blockTs);
  assert.equal(calls.find(c=>c.a===J).until,now);assert.equal(calls.find(c=>c.a===B).until,now);
  const file=path.join(root,"data/mexc-state.json"),state=JSON.parse(await fs.readFile(file));state.transfers.push(...later.slice(1));await fs.writeFile(file,JSON.stringify(state));
  p.page=async(a,s)=>{calls.push({a,until:s.until});return {rows:[...legs,...later].filter(r=>r.to===a&&r.blockTs<=s.until),next:""};};
  const resumed=await createMexcMonitor({root,provider:p,clock:()=>now,options}).refresh();
  assert.equal(calls.filter(c=>c.a===A).at(-1).until,later[1].blockTs);assert.equal(resumed.events.length,2);assert.equal(resumed.coverage.scanComplete,true);
});
test("delayed contract discovery revisits cached receipt funders; mint descendants survive restart and position failure",async t=>{
  const root=await temp(t),r=mintReceipt(E,2,2,[row(A,E,2,2,{eventIndex:-1}),row(E,B,2,2,{contract:J,eventIndex:3,amountRaw:"4000000000"})]);
  let fail=false,cycle=0;
  const p=provider({page:async a=>({rows:a===J?[r.transfers[0]]:a===A?[row(S,A)]:[],next:""}),receipt:async id=>id===r.txid?r:{txid:id,blockTs:row(S,A).blockTs,transfers:[row(S,A)],actions:[]},
    position:async()=>{if(fail)throw new Error("timeout");return {jTokenRaw:"4000000000",underlyingRaw:"100000000",borrowRaw:"0"};}});
  const make=()=>createMexcMonitor({root,provider:p,clock:()=>now+(++cycle)*1000});
  await make().refresh();await make().refresh();await make().refresh();const snapshot=await make().refresh();
  assert.equal(snapshot.events.length,1);assert.equal(snapshot.events[0].kind,"contract");assert.ok(snapshot.positions.some(p=>p.address===B&&p.status==="ok"));
  fail=true;const failed=await make().refresh();const pos=failed.positions.find(p=>p.address===B);assert.equal(pos.status,"error");assert.equal(pos.underlyingRaw,undefined);assert.equal(pos.lastGood.underlyingRaw,"100000000");
});
test("large upstream histories use disjoint time segments and resume only a failed segment",async t=>{
  const root=await temp(t),legs=[row(S,A),row(A,B,2),row(B,J,3)],calls=[];
  const p=provider({page:async(a,s)=>({rows:legs.filter(r=>r.to===a&&r.blockTs>=s.since&&r.blockTs<=s.until),next:""}),receipt:async id=>({txid:id,transfers:legs.filter(r=>r.txid===id),actions:[]})});
  const options={backfillUntil:now,historyShards:12,concurrency:4,pagesPerAccount:1},m=createMexcMonitor({root,provider:p,clock:()=>now,options});
  for(let i=0;i<4;i++)await m.refresh();
  const file=path.join(root,"data/mexc-state.json"),state=JSON.parse(await fs.readFile(file));
  const h=state.accounts[A].history;h.done=false;h.cursor="legacy";h.seen=Array.from({length:64},(_,i)=>String(i));await fs.writeFile(file,JSON.stringify(state));
  let fail=true;p.page=async(a,s)=>{calls.push({a,since:s.since,until:s.until});if(fail&&a===A&&s.since===h.since)throw Error("temporary failure");return {rows:legs.filter(r=>r.to===a&&r.blockTs>=s.since&&r.blockTs<=s.until),next:""};};
  const failed=await createMexcMonitor({root,provider:p,clock:()=>now,options}).refresh();assert.equal(failed.coverage.scanComplete,false);assert.equal(failed.coverage.errors.length,1);
  const ranges=calls.filter(c=>c.a===A).sort((a,b)=>a.since-b.since);assert.equal(ranges.length,12);assert.equal(ranges[0].since,h.since);assert.equal(ranges.at(-1).until,h.until);for(let i=1;i<ranges.length;i++)assert.equal(ranges[i].since,ranges[i-1].until+1);
  fail=false;calls.length=0;const done=await createMexcMonitor({root,provider:p,clock:()=>now,options}).refresh();assert.equal(done.coverage.scanComplete,true);assert.equal(done.events.length,1);assert.equal(calls.filter(c=>c.a===A).length,1);
});
test("provisional log keys are replaced without double counting; source edits invalidate old findings",async t=>{
  const root=await temp(t),r=mintReceipt(S);let receiptReady=false;
  const p=provider({page:async()=>({rows:[{...r.transfers[0],eventIndex:null}],next:""}),receipt:async()=>{if(!receiptReady)throw new Error("pending");return r;}});
  const m=createMexcMonitor({root,provider:p,clock:()=>now});assert.equal((await m.refresh()).summary.matchedCount,1);
  receiptReady=true;assert.equal((await m.refresh()).summary.matchedCount,1);
  await fs.writeFile(path.join(root,"mexc-sources.json"),JSON.stringify({...book,addresses:[]}));
  const changed=await readMexcSnapshot(root,now);assert.equal(changed.coverage.status,"sources-changed");assert.equal(changed.summary,null);
  assert.equal((await m.refresh()).summary.matchedCount,0);
});
test("capacity and cursor errors remain explicit; an empty scan is never advertised as complete",async t=>{
  const root=await temp(t),p=provider({page:async()=>({rows:[row(A,J),row(B,J,2)],next:"same"})});
  const m=createMexcMonitor({root,provider:p,clock:()=>now,options:{maxTransfers:1,maxAccounts:1}});
  const d=await m.refresh();assert.ok(d.coverage.limits.transfers);assert.ok(d.coverage.limits.accounts);assert.ok(d.coverage.historyPending);assert.equal(d.coverage.sourceComplete,false);
  const fresh=await temp(t);const pending=await readMexcSnapshot(fresh);assert.equal(pending.summary,null);assert.equal(pending.coverage.status,"pending");
});
test("provider keeps fixed confirmed pages and treats bad account snapshots and freeze calls as errors",async()=>{
  const calls=[];let payload={data:[],meta:{}};
  const p=createProvider({delayMs:0,apiKey:"test-only",fetchImpl:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>payload};}});
  await p.page(A,{since:10,until:20,cursor:"opaque+cursor"});const u=new URL(calls[0].url);
  assert.equal(u.searchParams.get("only_confirmed"),"true");assert.equal(u.searchParams.get("max_timestamp"),"20");assert.equal(u.searchParams.get("fingerprint"),"opaque+cursor");
  assert.equal(calls[0].opts.redirect,"error");await assert.rejects(p.position(A));await assert.rejects(p.frozen(A));
  payload={result:{result:true},constant_result:[[0n,4000000000n,0n,25000000000000000n].map(n=>n.toString(16).padStart(64,"0")).join("")]};
  assert.equal((await p.position(A)).underlyingRaw,"100000000");
  payload.constant_result[0]+="0".repeat(128);assert.equal((await p.position(A)).underlyingRaw,"100000000");
  payload.constant_result[0]=payload.constant_result[0].slice(0,-1)+"1";await assert.rejects(p.position(A));
});
test("MEXC endpoint is read-only and private runtime files cannot be fetched",async()=>{
  const {server}=require("./server");await new Promise(r=>server.listen(0,"127.0.0.1",r));const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const r=await fetch(`${base}/api/mexc?refresh=1`);assert.equal(r.status,200);assert.equal((await r.json()).scope,"MEXC-USDT-jUSDT-USDD-jUSDD");
    assert.equal((await fetch(`${base}/api/mexc`,{method:"POST"})).status,405);
    for(const file of ["reviewed-snapshots/mexc-snapshot.json","reviewed-snapshots/mexc-usdd-snapshot.json"])assert.equal((await fetch(`${base}/${file}`)).status,404);
    for(const file of ["mexc-sources.json","mexc-worker.js","mexc-provider.js","mexc-attribution.js","mexc-attribution-review.json","data/mexc-state.json","data/mexc-snapshot.json","data/mexc-usdd-state.json","data/mexc-usdd-snapshot.json","data/mexc-attribution-evidence-2026-11-16.json","test-fixtures/mexc-conversions-2026-11-16.json",".env"])assert.equal((await fetch(`${base}/${file}`)).status,404);
    for(const file of ["mexc-ui.js","dashboard-tabs.js"])assert.equal((await fetch(`${base}/${file}`)).status,200);
  }finally{await new Promise(r=>server.close(r));}
});
test("UI lazy-loads only MEXC, preserves filters, escapes evidence and marks failed positions unknown",async()=>{
  const nodes=new Map(),listeners={},requests=[];let poll,fail=false;
  const document={hidden:false,getElementById:id=>{if(!nodes.has(id))nodes.set(id,{value:id==="mexcPeriod"?"30":"all",listeners:{},classList:{toggle(){},add(){}},addEventListener(n,f){this.listeners[n]=f;}});return nodes.get(id);},addEventListener:(n,f)=>{listeners[n]=f;}};
  const event=analyze([row(S,J)]).events[0];event.note="<img src=x onerror=alert(1)>";
  const data={scope:"MEXC-USDT-jUSDT",generatedAt:new Date(now).toISOString(),events:[event],sources:book,coverage:{},runtime:{stale:false},summary:{matchedCount:1,directRaw:"100000000",indirectRaw:"0"},positions:[{address:A,status:"ok",jTokenRaw:"4000000000",underlyingRaw:"100000000",borrowRaw:"0",checkedAt:now}]};
  vm.runInNewContext(await fs.readFile(path.join(__dirname,"mexc-ui.js"),"utf8"),{document,fetch:async url=>{requests.push(url);if(fail)throw new Error("offline");return {ok:true,json:async()=>data};},AbortSignal,Date,BigInt,setInterval:f=>{poll=f;}});
  assert.equal(requests.length,0);listeners["dashboard:tab"]({detail:"mexc"});await new Promise(r=>setImmediate(r));
  assert.match(nodes.get("mexcEvents").innerHTML,/&lt;img/);assert.doesNotMatch(nodes.get("mexcEvents").innerHTML,/<img/);assert.match(nodes.get("mexcPositions").innerHTML,/100/);
  nodes.get("mexcKind").value="wallet";nodes.get("mexcKind").listeners.change();assert.match(nodes.get("mexcEvents").innerHTML,/暂无记录/);
  fail=true;await nodes.get("mexcRefresh").listeners.click();assert.match(nodes.get("mexcNotice").textContent,/读取失败/);assert.match(nodes.get("mexcPositions").innerHTML,/待核/);
  assert.equal(nodes.get("mexcKind").value,"wallet");const count=requests.length;listeners["dashboard:tab"]({detail:"legacy"});poll();assert.equal(requests.length,count);
});
