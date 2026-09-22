"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path"),vm=require("node:vm");
const {E,H,I,J,U,parseRange,weekStart,analyze,decodePosition,createProxyMonitor}=require("./proxy-monitor");
const fixture=require("./test-fixtures/proxy-e-week-2026-09-18.json");
test("rolling seven days and strict custom range validation",()=>{
 const now=Date.parse("2026-09-22T10:00:00Z"),day=86400000;
 assert.deepEqual(parseRange({},now),{since:now-7*day,until:now});
 assert.equal(parseRange({since:new Date(now-30*day).toISOString(),until:new Date(now).toISOString()},now).since,now-30*day);
 for(const [since,until] of [[now-31*day,now],[now,now],[now,now-day],[now-day,now+1]])
  assert.throws(()=>parseRange({since:new Date(since).toISOString(),until:new Date(until).toISOString()},now),RangeError);
 assert.throws(()=>parseRange({since:"invalid",until:"invalid"},now),RangeError);
 assert.throws(()=>parseRange({since:new Date(now-day).toISOString()},now),RangeError);
});
test("cached thirty-day transfers are reaggregated for the selected range",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"proxy-range-")),now=Date.now(),day=86400000;
 const rows=fixture.rows.map(r=>({...r,blockTs:r.blockTs+now-fixture.until-1000}));
 const m=createProxyMonitor({root,readPosition:async()=>({jTokenRaw:"123",underlyingUsdt:1}),fetchJson:async u=>{
  const q=new URL(u),address=q.pathname.includes(E)?E:H;
  assert.equal(Number(q.searchParams.get("max_timestamp"))-Number(q.searchParams.get("min_timestamp")),30*day);
  return {data:rows.filter(r=>r.from===address||r.to===address).map(r=>({type:"Transfer",transaction_id:r.txid,block_timestamp:r.blockTs,from:r.from,to:r.to,value:r.raw,token_info:{address:r.contract}}))};
 }});
 try{
  await m.refresh();
  const params={since:new Date(now-day).toISOString(),until:new Date(now).toISOString()};
  const result=m.getSnapshot(params),expected=analyze(rows,now-day,now);
  for(const key of ["summary","days","deposits","rights","reentries"])assert.deepEqual(result[key],expected[key]);
  assert.ok(result.summary.depositCount<m.getSnapshot().summary.depositCount);
  assert.equal(result.positions[0].jTokenRaw,"123");assert.equal(result.rows,undefined);
  assert.equal(result.coverage.complete,true);
  const missing=m.getSnapshot({since:new Date(now-40*day).toISOString(),until:new Date(now-35*day).toISOString()});
  assert.equal(missing.coverage.complete,false);assert.equal(missing.summary.depositCount,0);
 }finally{m.stop();await fs.rm(root,{recursive:true,force:true});}
});
test("observed week: 45 funders, 46 deposits, all five previously absent transactions included once",()=>{
 const a=analyze([...fixture.rows,...fixture.rows],fixture.since,fixture.until);
 assert.equal(a.summary.funderCount,45);assert.equal(a.summary.depositCount,46);assert.equal(a.summary.inflowRaw,"5144411700000");
 assert.equal(a.summary.receiverCount,52);assert.equal(a.rights.length,53);assert.equal(a.summary.unresolvedDeposits,0);
 assert.deepEqual(a.days.map(d=>d.amount),[550720,610440,300120,2683131.7,1000000]);
 for(const h of ["3eb177cb","0251f37e","376ed386","8ba17572","e7f90f7d"])assert.equal(a.deposits.filter(r=>r.txid.startsWith(h)).length,1);
});
test("H reentry stays separate; unknown H sources and incomplete E evidence are explicit",()=>{
 const receiver=fixture.rows.find(r=>r.from===E&&r.contract===J).to,t=fixture.until-1;
 const row=(from,to,contract,raw,txid="a".repeat(64))=>({from,to,contract,raw,txid,blockTs:t});
 const rows=[...fixture.rows,row(receiver,H,U,"1000000"),row(H,J,U,"1000000"),row(J,H,J,"9000000000"),
 row(I,H,U,"3000000","b".repeat(64)),row(H,J,U,"3000000","b".repeat(64)),row(J,H,J,"27000000000","b".repeat(64))];
 const a=analyze(rows,fixture.since,fixture.until);assert.equal(a.summary.inflowUsdt,5144411.7);assert.equal(a.summary.reentryUsdt,1);assert.equal(a.summary.unclassifiedHUsdt,3);
 const broken=analyze(fixture.rows.filter(r=>!(r.to===E&&r.contract===U)),fixture.since,fixture.until);
 assert.equal(broken.summary.unresolvedDeposits,46);assert.equal(broken.summary.funderCount,0);
});
test("Beijing Monday boundary and exact six-word proxy snapshot decode",()=>{
 assert.equal(weekStart(Date.parse("2026-09-13T16:00:00Z")),fixture.since);
 assert.equal(weekStart(Date.parse("2026-09-13T15:59:59Z")),fixture.since-7*86400000);
 const encode=w=>({constant_result:[w.map(x=>BigInt(x).toString(16).padStart(64,"0")).join("")]});
 const p=decodePosition(encode([0,2360290586278904n,0,108636650902381n,0,0]));assert.equal(p.jTokenRaw,"2360290586278904");assert.equal(p.underlyingUsdt,256414.064449);
 assert.throws(()=>decodePosition(encode([1,0,0,1])));assert.throws(()=>decodePosition(encode([0,0,0,1,1])));assert.throws(()=>decodePosition({}));
});
test("bounded pagination, balance failure, restart cache and retained snapshot on provider error",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"proxy-monitor-"));let fail=false,calls=0;
 const now=Date.now(),r={transaction_id:"a".repeat(64),block_ts:now-1000,from_address:E,to_address:J,contract_address:U,quant:"1000000"};
 const opts={root,maxPages:2,readPosition:async()=>{throw new Error("position unavailable");},fetchJson:async url=>{
   if(fail)throw new Error("429");const u=new URL(url);if(u.hostname!=="apilist.tronscanapi.com")throw new Error("primary unavailable");calls++;return {token_transfers:u.searchParams.get("start")==="0"?[r]:[]};}};
 const m=createProxyMonitor(opts);
 try{await m.refresh();const s=m.getSnapshot();assert.equal(calls,4);assert.equal(s.summary.depositCount,1);assert.equal(s.coverage.complete,false);assert.equal(s.positions[0].status,"error");assert.equal(s.positions[0].underlyingUsdt,undefined);
 fail=true;await m.refresh();assert.equal(m.getSnapshot().summary.depositCount,1);assert.equal(m.getSnapshot().runtime.lastError,"429");
 const n=createProxyMonitor(opts);await n.start();await n.refresh();assert.equal(n.getSnapshot().summary.depositCount,1);n.stop();
 }finally{m.stop();await fs.rm(root,{recursive:true,force:true});}
});
test("page cap cannot be presented as a complete scan",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"proxy-cap-"));const m=createProxyMonitor({root,maxPages:1,
 fetchJson:async()=>({token_transfers:[{transaction_id:"c".repeat(64),block_ts:Date.now()-1000,from_address:E,to_address:J,contract_address:U,quant:"1"}]}),readPosition:async()=>({jTokenRaw:"0",underlyingUsdt:0})});
 try{await m.refresh();assert.equal(m.getSnapshot().coverage.complete,false);assert.ok(m.getSnapshot().coverage.scans.every(s=>!s.complete));}finally{m.stop();await fs.rm(root,{recursive:true,force:true});}
});
test("TronGrid fixed-window pagination covers all observed deposits, not just its first 200 rows",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"proxy-grid-"));const calls=[];
 const source=fixture.rows.filter(r=>r.from===E||r.to===E).map(r=>({type:"Transfer",transaction_id:r.txid,block_timestamp:Date.now()-1000,from:r.from,to:r.to,value:r.raw,token_info:{address:r.contract}}));
 // Split arbitrarily, including across the legs of a single deposit.
 const m=createProxyMonitor({root,readPosition:async()=>({jTokenRaw:"0",underlyingUsdt:0}),fetchJson:async u=>{
  const q=new URL(u);calls.push(q);if(q.pathname.includes(H))return {data:[]};
  return q.searchParams.has("fingerprint")?{data:source.slice(100)}:{data:source.slice(0,100),meta:{fingerprint:"p2"}};
 }});
 try{await m.refresh();assert.equal(m.getSnapshot().summary.depositCount,46);assert.equal(m.getSnapshot().summary.inflowUsdt,5144411.7);assert.equal(m.getSnapshot().coverage.complete,true);
 const pages=calls.filter(u=>u.pathname.includes(E));assert.equal(pages.length,2);assert.equal(pages[0].searchParams.get("max_timestamp"),pages[1].searchParams.get("max_timestamp"));}
 finally{m.stop();await fs.rm(root,{recursive:true,force:true});}
});
test("proxy UI renders evidence and explicitly flags errors",async()=>{
 const nodes=new Map();const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,{textContent:"",innerHTML:"",addEventListener(){}});return nodes.get(id);}};
 let data={...analyze(fixture.rows,fixture.since,fixture.until),since:new Date(fixture.since).toISOString(),until:new Date(fixture.until).toISOString(),generatedAt:new Date().toISOString(),runtime:{currentWeek:true},coverage:{complete:true},positions:[],addresses:{E,H,I,J}};
 let poll;const script=await fs.readFile(path.join(__dirname,"proxy-ui.js"),"utf8");
 vm.runInNewContext(script,{document,fetch:async()=>({ok:true,json:async()=>data}),AbortSignal,setInterval:f=>{poll=f;},Date,BigInt});
 await new Promise(r=>setImmediate(r));assert.match(nodes.get("proxyDecision").textContent,/45 个/);assert.equal((nodes.get("proxyDeposits").innerHTML.match(/<tr>/g)||[]).length,46);assert.match(nodes.get("proxyDeposits").innerHTML,/3eb177cb654a/);
 data={...data,runtime:{currentWeek:false,lastError:"<unsafe>"}};await poll();assert.match(nodes.get("proxyDecision").textContent,/异常/);assert.equal(nodes.get("proxyDecision").className,"decision-banner warning");
});
test("UI applies Beijing ranges, keeps polling selection, rejects invalid input and ignores old responses",async()=>{
 const nodes=new Map(),requests=[];
 const document={getElementById:id=>{
  if(!nodes.has(id))nodes.set(id,{textContent:"",innerHTML:"",listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}});
  return nodes.get(id);
 }};
 let poll;
 const script=await fs.readFile(path.join(__dirname,"proxy-ui.js"),"utf8");
 vm.runInNewContext(script,{document,fetch:url=>new Promise(resolve=>requests.push({url,resolve})),AbortSignal,Date,BigInt,encodeURIComponent,setInterval:fn=>{poll=fn;}});
 assert.equal(requests[0].url,"api/xinbi-proxy");
 nodes.get("proxySince").value="2026-09-01T08:00";nodes.get("proxyUntil").value="2026-09-02T08:00";
 nodes.get("proxyRangeForm").listeners.submit({preventDefault(){}});
 const query=new URL(requests[1].url,"http://localhost");
 assert.equal(query.searchParams.get("since"),"2026-09-01T00:00:00.000Z");
 assert.equal(query.searchParams.get("until"),"2026-09-02T00:00:00.000Z");
 const response=n=>({ok:true,json:async()=>({generatedAt:new Date().toISOString(),summary:{funderCount:n},coverage:{complete:true},positions:[]})});
 requests[1].resolve(response(2));await new Promise(r=>setImmediate(r));
 requests[0].resolve(response(99));await new Promise(r=>setImmediate(r));
 assert.match(nodes.get("proxyDecision").textContent,/2 个/);
 assert.match(nodes.get("proxyDeposits").innerHTML,/暂无记录/);
 poll();assert.equal(requests[2].url,requests[1].url);
 nodes.get("proxySince").value="2026-07-01T08:00";
 nodes.get("proxyRangeForm").listeners.submit({preventDefault(){}});
 assert.equal(requests.length,3);assert.match(nodes.get("proxyRangeError").textContent,/最长 30 天/);
 nodes.get("proxyRecent").listeners.click();assert.equal(requests[3].url,"api/xinbi-proxy");
 requests[3].resolve({ok:false,status:500});await new Promise(r=>setImmediate(r));
 assert.match(nodes.get("proxyDecision").textContent,/读取失败/);assert.equal(nodes.get("proxyDeposits").innerHTML,"");
 requests[2].resolve(response(99));await new Promise(r=>setImmediate(r));
 assert.match(nodes.get("proxyDecision").textContent,/读取失败/);
});
