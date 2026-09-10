"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const vm = require("node:vm");
const evidence = require("./xinbi-investigation");
const { createXinbiMonitor, buildFindings, normalizeRow, precedes, validAddress } = require("./xinbi-monitor");
const full = require("./config.json");
const fixture = require("./test-fixtures/xinbi-2026-09-09-events.json");
const [A,B,C,D,E,F,G] = evidence.addresses.map(a => a.address);
const { USDT: U, JUSDT: P } = evidence;
const NOW = Date.parse("2026-09-10T12:00:00+08:00");
function toBase58(hex) {
  const bytes = Buffer.from("41" + hex, "hex");
  const checksum = crypto.createHash("sha256").update(crypto.createHash("sha256").update(bytes).digest()).digest().subarray(0,4);
  let n = BigInt("0x" + Buffer.concat([bytes,checksum]).toString("hex")), out = "";
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  while(n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
  return out;
}
function decoded(txid) {
  return structuredClone(fixture.transactions[txid].data).map(e => {
    for (const [key,value] of Object.entries(e.result)) if (/^0x[0-9a-f]{40}$/i.test(value)) e.result[key] = toBase58(value.slice(2));
    return e;
  });
}
const tokens = new Map([[U,{symbol:"USDT",decimals:6}],[P,{symbol:"jUSDT",decimals:8,jToken:true}]]);
function rows() {
  return evidence.steps.flatMap(s => decoded(s.txid).filter(e => e.event_name === "Transfer").map(e => normalizeRow({
    type:"Transfer", transaction_id:s.txid, from:e.result.from, to:e.result.to,
    value:e.result.value ?? e.result.amount, token_info:{address:e.contract_address},
    event_index:e.event_index, block_timestamp:e.block_timestamp
  },tokens)).filter(Boolean));
}
function find(transfers, investigationAccounts = evidence.addresses.map(a=>a.address)) {
  return buildFindings({transfers, seeds:[{address:A}], watched:full.watchedAddresses,
    hubs:new Set(), config:full.riskSources.xinbi, now:NOW, investigationAccounts});
}
test("official event fixtures match all ten transactions, seven addresses and exact large integer amounts", () => {
  assert.equal(evidence.steps.length,10);
  for(const a of evidence.addresses) assert.ok(validAddress(a.address));
  for(const s of evidence.steps) {
    assert.equal(evidence.verifyStep(s, decoded(s.txid)).status,"verified",s.id);
    assert.ok(decoded(s.txid).every(e => e.transaction_id === s.txid && e.block_timestamp === s.blockTs));
  }
  assert.equal(evidence.steps.filter(s=>s.action === "Mint").reduce((n,s)=>n+BigInt(s.transfers[1].amountRaw),0n),1800000000000n);
  assert.equal(evidence.steps.filter(s=>s.action === "Redeem").reduce((n,s)=>n+BigInt(s.transfers[0].amountRaw),0n),1800000205174n);
  assert.ok(BigInt(evidence.steps.find(s=>s.id==='rights100').transfers[0].amountRaw)>BigInt(Number.MAX_SAFE_INTEGER));
});
test("evidence validation rejects wrong asset, amount, actor and missing protocol action", () => {
  const s = evidence.steps.find(s=>s.id==='deposit100');
  for(const change of [events=>events.find(e=>e.event_name==='Transfer').contract_address=A,
    events=>events.find(e=>e.event_name==='Mint').result.mintTokens='1',
    events=>events.find(e=>e.event_name==='Mint').result.minter=A,
    events=>events.find(e=>e.event_name==='Mint').event_name='Approval']) {
    const events=decoded(s.txid); change(events);
    assert.equal(evidence.verifyStep(s,events).status,'mismatch');
  }
});
test("internal event order completes the proxy path without inferring unrelated three-hop paths", () => {
  const f=find(rows());
  assert.equal(f.events.length,2);
  assert.equal(f.summary.inflowUsdt,1800000);
  assert.ok(f.events.every(e=>e.kind==='FLOW_3' && e.evidence.length===4));
  assert.equal(f.rights.length,2);
  assert.equal(f.redemptionCandidates.length,2);
  assert.equal(find(rows(),[]).events.length,0);
  const firstDeposit=evidence.steps.find(s=>s.id==='deposit80');
  assert.equal(find(rows().filter(r=>r.blockTs<=firstDeposit.blockTs).map(r=>({...r,eventIndex:null}))).events.length,0);
  const legs=rows().filter(r=>r.txid===evidence.steps.find(s=>s.id==='deposit80').txid && r.contract===U).sort((a,b)=>a.eventIndex-b.eventIndex);
  assert.ok(precedes(legs[0],legs[1]));
  assert.equal(precedes(legs[1],legs[0]),false);
});

async function setup(t, options={}) {
  t.mock.method(Date,"now",()=>NOW);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'xinbi-case-'));
  const settings=structuredClone(full);
  Object.assign(settings.riskSources.xinbi,{seeds:[{address:A}],priorityAccounts:[],maxStoredTransfers:1,...options.config});
  const calls=[];
  const dependencies={root,readConfig:async()=>settings,apiBase:'https://example.test',hexToAddress:toBase58,
    blacklist:async()=>({status:'clear'}),readBalance:async(contract)=>{if(contract===P)throw new Error('malformed balanceOf');return 0n;},getHubs:async()=>new Set(),
    fetchJson:async url=>{
      const u=new URL(url); calls.push(u);
      if(options.fetch) {const result=await options.fetch(u);if(result)return result;}
      const txid=u.pathname.match(/transactions\/([0-9a-f]{64})\/events/)?.[1];
      if(txid) return structuredClone(fixture.transactions[txid] || {data:[]});
      return {data:[]};
    }};
  const monitor=createXinbiMonitor(dependencies);
  t.after(async()=>{monitor.stop();await fs.rm(root,{recursive:true,force:true});});
  return {root,monitor,settings,dependencies,calls};
}
test("full monitor confirms two deposits, rights transfers and redemptions beyond rolling storage capacity; restart and expiry preserve case",async t=>{
  const {monitor,root,settings,dependencies}=await setup(t);
  await monitor.refresh();
  const s=monitor.getSnapshot(), c=s.investigations[0];
  assert.equal(s.runtime.lastError,null);
  assert.equal(s.seedCount,1);
  assert.equal(s.summary.inflowUsdt,1800000);
  assert.equal(s.events.length,2);assert.equal(s.rights.length,2);
  assert.equal(s.redemptions.filter(e=>e.kind==='REDEEM').length,2);
  assert.equal(s.coverage.storedTransfers,0);
  assert.equal(c.steps.filter(s=>s.verification.status==='verified').length,10);
  assert.ok(c.balances.every(b=>b.raw===null && b.status==='error'));
  const state=JSON.parse(await fs.readFile(path.join(root,'data/xinbi-monitor-state.json'),'utf8'));
  assert.equal(Object.keys(state.investigationEvents).length,10);
  for(const address of [A,B,C,D,E,F,G]) assert.ok(state.accounts[address]);
  settings.riskSources.xinbi.lookbackDays=0;
  const restored=createXinbiMonitor(dependencies);
  try { await restored.start(); await restored.refresh();
    const old=restored.getSnapshot();
    assert.equal(old.events.length,0);
    assert.equal(old.investigations[0].steps.length,10);
    assert.equal(old.investigations[0].historical.depositUsdt,1800000);
  }finally {restored.stop();}
});
test("failed or incomplete event retrieval cannot verify evidence or manufacture a zero balance",async t=>{
  const first=evidence.steps[0].txid, second=evidence.steps[1].txid;
  const {monitor}=await setup(t,{fetch:async u=>{
    if(u.pathname.includes(first))throw new Error('429 rate limit');
    if(u.pathname.includes(second))return {...structuredClone(fixture.transactions[second]),meta:{fingerprint:String(Number(u.searchParams.get('fingerprint')||0)+1)}};
  }});
  await monitor.refresh();
  const c=monitor.getSnapshot().investigations[0];
  assert.equal(c.steps[0].verification.status,'error');
  assert.equal(c.steps[1].verification.status,'error');
  assert.match(c.steps[1].verification.error,/分页/);
  assert.equal(c.balances[0].raw,null);
});
test("rights receiver reserve works at candidate cap and follows the next receiver on a later cycle",async t=>{
  const extra=full.riskSources.xinbi.seeds.find(s=>![A,B,C,D,E,F,G].includes(s.address)).address;
  const transfer=(from,to,id)=>({type:'Transfer',from,to,transaction_id:id.repeat(64),block_timestamp:NOW-1000,value:'100000000',token_info:{address:P}});
  const {monitor,root}=await setup(t,{config:{investigationEnabled:false,maxAddresses:1,maxRightsAccounts:2},fetch:async u=>{
    if(u.pathname.includes(`/accounts/${A}/`))return {data:[transfer(A,F,'a')]};
    if(u.pathname.includes(`/accounts/${F}/`))return {data:[transfer(F,G,'b')]};
    if(u.pathname.includes(`/accounts/${G}/`))return {data:[transfer(G,extra,'c')]};
  }});
  for(let i=0;i<3;i++)await monitor.refresh();
  const state=JSON.parse(await fs.readFile(path.join(root,'data/xinbi-monitor-state.json'),'utf8'));
  assert.ok(state.accounts[F].rightsTracked);
  assert.ok(state.accounts[G].rightsTracked);
  assert.equal(state.accounts[extra],undefined);
  assert.equal(monitor.getSnapshot().coverage.rightsLimitReached,true);
  assert.deepEqual(monitor.getSnapshot().investigations,[]);
});
test("Transfer to market without a matching Redeem stays unconfirmed",async t=>{
  const {monitor}=await setup(t,{config:{investigationEnabled:false,maxStoredTransfers:10},fetch:async u=>{
    if(u.pathname.includes(`/accounts/${A}/`))return {data:[{type:'Transfer',from:A,to:P,transaction_id:'f'.repeat(64),block_timestamp:NOW-1000,value:'100000000',token_info:{address:P}}]};
    if(u.pathname.endsWith('/events'))return {data:[{event_name:'Redeem',contract_address:P,result:{redeemer:B,redeemTokens:'100000000',redeemAmount:'1'}}]};
  }});
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().redemptions[0].kind,'REDEEM_CANDIDATE');
  assert.equal(monitor.getSnapshot().redemptions[0].redeemedUnderlyingRaw,null);
});
test("UI shows exact evidence amounts, seven addresses, ten links, unknown balances and escaped failures; old snapshots still render",async()=>{
  const elements=new Map();
  const document={getElementById(id){if(!elements.has(id))elements.set(id,{value:'all',textContent:'',innerHTML:'',addEventListener(name,fn){this[name]=fn;}});return elements.get(id);}};
  const c=evidence.investigationSnapshot({investigationBalances:{[A]:{status:'error',raw:null,error:'<script>bad</script>'}}});
  let data={investigations:[c],runtime:{stale:true},redemptions:[{token:'jUSDT',kind:'REDEEM',from:F,to:P,blockTs:NOW,amountRaw:'7368308182374064',decimals:8,redeemedUnderlyingRaw:'800000084174'}]};
  let reload;
  vm.runInNewContext(await fs.readFile(path.join(__dirname,'xinbi-ui.js'),'utf8'),{document,fetch:async()=>({ok:true,json:async()=>data}),AbortSignal,setInterval(fn){reload=fn;}});
  await new Promise(resolve=>setImmediate(resolve));
  const html=elements.get('jusdtInvestigations').innerHTML;
  for(const a of evidence.addresses)assert.ok(html.includes(a.address));
  for(const s of evidence.steps)assert.ok(html.includes(s.txid));
  assert.ok(html.includes('92,103,735.26196923'));
  assert.ok(html.includes('未知'));
  assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert.match(elements.get('jusdtDecision').textContent,/当前快照待更新/);
  elements.get('jusdtFilter').value='redeem';elements.get('jusdtFilter').change();
  assert.match(elements.get('jusdtRows').innerHTML,/800,000.084174/);
  data={coverage:{status:'pending'}};await reload();
  assert.match(elements.get('jusdtInvestigations').innerHTML,/尚无事件台账/);
  assert.notEqual(elements.get('xinbiState').textContent,'数据读取失败');
});
