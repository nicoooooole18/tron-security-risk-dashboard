"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { validAddress, normalizeRow, transferKey, buildFindings, createXinbiMonitor } = require("./xinbi-monitor");
const full = require("./config.json");
const config = full.riskSources.xinbi;
const [S,A,B,C] = config.seeds.map(s => s.address);
const P = full.watchedAddresses.find(w => w.name === "jUSDT market").address;
const U = full.tokens.USDT.contract;
const now = Date.now();
const row = (from, to, time, id, extra = {}) => ({from,to,blockTs:now-100000+time,txid:id.repeat(64),contract:U,token:"USDT",amount:100,amountRaw:"100000000",...extra});
function findings(transfers,hubs=new Set()) {return buildFindings({transfers,seeds:[{address:S}],watched:[{address:P,name:"jUSDT",enabled:true}],hubs,config,now});}

test("all ten source addresses have valid Base58Check checksums", () => {
  assert.equal(config.seeds.length, 10);
  for (const s of config.seeds) assert.equal(validAddress(s.address), true, s.address);
  assert.equal(validAddress(`${S.slice(0,-1)}1`), false);
});
test("direct, one and two intermediary paths, but not three", () => {
  assert.equal(findings([row(S,P,1,"1")]).events[0].kind,"FLOW_0");
  assert.equal(findings([row(S,A,1,"1"),row(A,P,2,"2")]).events[0].kind,"FLOW_1");
  assert.equal(findings([row(S,A,1,"1"),row(A,B,2,"2"),row(B,P,3,"3")]).events[0].kind,"FLOW_2");
  assert.equal(findings([row(S,A,1,"1"),row(A,B,2,"2"),row(B,C,3,"3"),row(C,P,4,"4")]).events.length,0);
});
test("future or simultaneous seed transfers cannot establish an upstream path", () => {
  for (const t of [2,3]) assert.equal(findings([row(S,A,t,"1"),row(A,P,2,"2")]).events.length,0);
});
test("outgoing interaction and cross-asset association are P2, not provenance", () => {
  const a=findings([row(A,S,1,"1"),row(A,P,2,"2")]).events[0];
  assert.equal(a.kind,"INTERACTION"); assert.equal(a.level,"P2");
  assert.equal(findings([row(S,A,1,"1",{contract:"other"}),row(A,P,2,"2")]).events[0].kind,"INTERACTION");
});
test("public hub is a tracing boundary and dust is downgraded", () => {
  assert.equal(findings([row(S,A,1,"1"),row(A,B,2,"2"),row(B,P,3,"3")],new Set([A])).events.length,0);
  const e=findings([row(S,A,1,"1",{amount:0.1}),row(A,P,2,"2")]).events[0];
  assert.equal(e.level,"P2"); assert.equal(e.dust,true);
});
test("jToken transfer records risk rights without inventing an underlying inflow", () => {
  const f=findings([row(S,A,1,"1",{jToken:true,token:"jUSDT",contract:P})]);
  assert.equal(f.rights.length,1); assert.equal(f.events.length,0);
});
test("large, split cumulative and fast protocol return alerts", () => {
  const transfers=[row(S,A,0,"1")];
  for(let i=1;i<=5;i++)transfers.push(row(A,P,i,String(i+1),{amount:30000}));
  transfers.push(row(P,A,10,"7"));
  const f=findings(transfers);
  assert.ok(f.events.some(e=>e.anomalies.some(a=>a.includes("累计"))));
  assert.ok(f.events.some(e=>e.anomalies.some(a=>a.includes("1h"))));
});
test("strict Transfer filtering, trusted decimals and missing timestamps", () => {
  const tokens=new Map([[U,full.tokens.USDT]]);
  const raw={type:"Transfer",transaction_id:"1".repeat(64),from:S,to:A,token_info:{address:U,decimals:0,symbol:"FAKE"},value:"1000000",block_timestamp:now};
  assert.equal(normalizeRow(raw,tokens).amount,1);
  assert.equal(normalizeRow(raw,tokens).token,"USDT");
  assert.equal(normalizeRow({...raw,type:"Approval"},tokens),null);
  assert.equal(normalizeRow({...raw,confirmed:false},tokens),null);
  assert.equal(normalizeRow({...raw,block_timestamp:null},tokens),null);
  assert.equal(normalizeRow({...raw,token_info:{address:"unknown"}},tokens),null);
  assert.equal(transferKey(normalizeRow(raw,tokens)),transferKey(normalizeRow({...raw},tokens)));
});

test("monitor persists pagination, deduplicates shared transactions, and reports API failure", async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"xinbi-test-"));
  const calls=[];
  const makeRaw=(from,to,n,id)=>({type:"Transfer",from,to,block_timestamp:now-n,transaction_id:id.repeat(64),value:"100000000",token_info:{address:U}});
  let fail=false;
  const settings={...full,riskSources:{...full.riskSources,xinbi:{...config,seeds:[{address:S}],maxAddresses:10,pagesPerAddress:2,addressesPerCycle:10}}};
  const monitor=createXinbiMonitor({root,readConfig:async()=>settings,apiBase:"https://example.test",blacklist:async()=>({status:"blacklisted"}),readBalance:async()=>100n,getHubs:async()=>new Set(),hexToAddress:x=>x,
    fetchJson:async url=>{const u=new URL(url);calls.push(u);if(fail)throw new Error("429 rate limit");
      if(u.pathname.endsWith('/events'))return {data:[{event_name:"RepayBorrow",contract_address:P,result:{payer:A,borrower:B}}]};
      if(u.pathname.includes(A))return {data:[makeRaw(A,P,50,"3"),makeRaw(S,A,100,"1")]};
      if(u.searchParams.get("fingerprint")==="page2")return {data:[makeRaw(S,A,200,"2")]};
      return {data:[makeRaw(S,A,100,"1")],meta:{fingerprint:"page2"}};
    }});
  try {
    await monitor.refresh();
    assert.ok(calls.some(u=>u.searchParams.get("fingerprint")==="page2"));
    await monitor.refresh();
    let s=monitor.getSnapshot();
    assert.equal(s.summary.inflowCount,1);assert.equal(s.events[0].operation.actions[0].action,"RepayBorrowBehalf");
    assert.equal(s.coverage.storedTransfers,3);
    const state=JSON.parse(await fs.readFile(path.join(root,"data/xinbi-monitor-state.json"),"utf8"));
    assert.equal(state.accounts[S].backfillDone,true);
    fail=true;await monitor.refresh();s=monitor.getSnapshot();
    assert.ok(s.coverage.errors.length>0);assert.equal(s.summary.inflowCount,1);
    assert.equal(s.coverage.status,"bounded");
  }finally{monitor.stop();await fs.rm(root,{recursive:true,force:true});}
});

test("head refresh does not erase incomplete history and fingerprints keep fixed windows", async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"xinbi-cursor-test-"));
  const calls=[]; let cycle=0;
  const settings={...full,riskSources:{...full.riskSources,xinbi:{...config,seeds:[{address:S}],pagesPerAddress:2}}};
  const raw=n=>({type:"Transfer",from:S,to:A,block_timestamp:now-n,transaction_id:String(n).padStart(64,"0"),value:"1",token_info:{address:U}});
  const monitor=createXinbiMonitor({root,readConfig:async()=>settings,apiBase:"https://example.test",blacklist:async()=>({status:"clear"}),readBalance:async()=>0n,getHubs:async()=>new Set(),hexToAddress:x=>x,
    fetchJson:async url=>{const u=new URL(url);calls.push(u);
      if(u.pathname.includes(A))return {data:[]};
      const cursor=u.searchParams.get("fingerprint");
      if(cursor==='p2')return {data:[raw(200)],meta:{fingerprint:'p3'}};
      if(cursor==='p3')return {data:[raw(300)]};
      if(cycle===1)return {data:[]};
      return {data:[raw(100)],meta:{fingerprint:'p2'}};
    }});
  try{
    await monitor.refresh();cycle=1;
    assert.ok(monitor.getSnapshot().coverage.incompleteHistoryAccounts>0);
    await monitor.refresh();
    const historical=calls.filter(u=>['p2','p3'].includes(u.searchParams.get('fingerprint')));
    assert.equal(historical.length,2);
    assert.equal(historical[0].searchParams.get('min_timestamp'),historical[1].searchParams.get('min_timestamp'));
    assert.equal(historical[0].searchParams.get('max_timestamp'),historical[1].searchParams.get('max_timestamp'));
    assert.equal(monitor.getSnapshot().coverage.storedTransfers,3);
  }finally{monitor.stop();await fs.rm(root,{recursive:true,force:true});}
});

test("new public endpoint is read-only and runtime/config files cannot be fetched", async () => {
  const {server}=require('./server');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const response=await fetch(`${base}/api/xinbi`);const s=await response.json();
    assert.equal(response.status,200);assert.equal(s.runtime.running,false);assert.equal(s.coverage.status,'pending');
    for(const file of ['/.env','/config.json','/server.js','/xinbi-monitor.js','/data/xinbi-monitor-state.json','/data/xinbi-snapshot.json'])
      assert.equal((await fetch(base+file)).status,404,file);
    assert.equal((await fetch(`${base}/api/config`)).status,401);
    assert.equal((await fetch(`${base}/api/xinbi`,{method:'POST'})).status,404);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
