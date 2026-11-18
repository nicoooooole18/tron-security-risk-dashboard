"use strict";
// Read-only confirmed-chain collection. Writes only local evidence caches.
const fs=require("node:fs/promises"),path=require("node:path"),C=require("./mexc-core");
const {readJson,atomicJson}=require("./mexc-monitor"),{loadEnv,createProvider}=require("./mexc-provider");
const POOL="TEr2uAVsgpCFCmon4xGaCMj9KeG8zm21z6",TEA="TEAq2LxMXNTZ3ET7StNWMPf3PZxWqzq9qQ",TBF="TBFnjLEXpLCzYvomoYcQiYphetjnB46Ws5";
const FILE=path.join(__dirname,"data/mexc-tm9-followup-2026-11-18.json"),SINCE=1793208759000;
async function main(){
  loadEnv();const p=createProvider({delayMs:500}),out=await readJson(FILE,{version:1,since:SINCE,wallets:{},receipts:{},errors:{}}),known={};
  for(const f of ["mexc-usdt-deepening-2026-11-18.json","mexc-usdt-return-evidence-2026-11-18.json","mexc-usdt-return-candidates-2026-11-18.json"]){const d=await readJson(path.join(__dirname,"data",f),{});Object.assign(known,d.receipts);}
  for(const f of (await fs.readdir(path.join(__dirname,"data"))).filter(f=>/^mexc-probe-tx-[a-f0-9]{64}\.json$/.test(f))){const r=await readJson(path.join(__dirname,"data",f),null);if(r?.txid)known[r.txid]=r;}
  Object.assign(known,out.receipts);const save=()=>atomicJson(FILE,out);
  const probe=await readJson(path.join(__dirname,`data/mexc-probe-${POOL}.json`),null);
  const explicit=process.argv.slice(2).filter(C.validAddress),targets=explicit.length?explicit:[POOL,...new Set(probe.rows.map(C.normalizeTransfer).filter(r=>r?.contract===C.JUSDT).map(r=>r.to)),TBF,"TSEexpn2ukHwRF8i5EHFTpNepDnVnBBsqL"];
  delete out.collectedAt;out.collectionStatus="collecting";await save();
  async function history(a,start,end){let rows=[],cursor="";const seen=new Set();do{const d=await p.page(a,{since:start,until:end,cursor});rows.push(...d.rows);if(d.next&&(seen.has(d.next)||!d.rows.length))throw Error("Repeated cursor");seen.add(d.next);cursor=d.next;if(seen.size>=100&&cursor)throw Error("History exceeds 100-page boundary");}while(cursor);return rows;}
  async function balance(a){const [u,d,ju,jd]=await Promise.all([p.balance(a,C.USDT),p.balance(a,C.USDD),p.position(a),p.position(a,C.MARKETS.USDD)]);return {balances:{[C.USDT]:u,[C.USDD]:d,[C.JUSDT]:ju.jTokenRaw,[C.JUSDD]:jd.jTokenRaw},positions:{USDT:ju,USDD:jd},checkedAt:Date.now()};}
  for(const a of targets){try{let w=out.wallets[a];if(w?.complete&&!process.argv.includes("--refresh"))continue;const type=await p.type(a);if(type!=="wallet"&&a!==POOL&&!(type==="contract"&&explicit.includes(a)&&process.argv.includes("--contracts"))){out.errors[a]=`Boundary: ${type}`;await save();continue;}w ||= {rows:[],through:SINCE-1};out.wallets[a]=w;w.type=type;w.complete=false;const head=await p.solidBlock();if(w.through<head.timestamp){w.rows.push(...await history(a,w.through+1,head.timestamp));w.through=head.timestamp;}
    for(let attempt=0;attempt<8;attempt++){const before=await balance(a),head=await p.solidBlock(),tail=await history(a,w.through+1,head.timestamp);w.rows.push(...tail);w.through=head.timestamp;const after=await balance(a);if(JSON.stringify(before.balances)===JSON.stringify(after.balances)&&!tail.some(C.normalizeTransfer)){Object.assign(w,before,{asOf:head,complete:true});break;}}
    if(!w.complete)throw Error("No stable balance anchor");delete out.errors[a];await save();console.log(JSON.stringify({address:a,rows:w.rows.length,jUSDT:w.balances[C.JUSDT],USDT:w.balances[C.USDT],USDD:w.balances[C.USDD]}));
  }catch(e){out.errors[a]=e.message;await save();console.log(JSON.stringify({address:a,error:e.message}));}}
  const ids=[...new Set(Object.values(out.wallets).flatMap(w=>w.rows.filter(C.normalizeTransfer).map(r=>r.transaction_id||r.txid)))];
  for(let i=0;i<ids.length;i+=20){let j=0;const batch=ids.slice(i,i+20);await Promise.all(Array.from({length:4},async()=>{while(j<batch.length){const id=batch[j++],r=known[id];out.receipts[id]=r&&!r.actions?.some(a=>!a.contract)?r:await p.receipt(id);}}));await save();console.log(JSON.stringify({receipts:Math.min(i+20,ids.length),total:ids.length}));}
  out.collectedAt=new Date().toISOString();out.collectionStatus="complete";await save();console.log(JSON.stringify({done:true,wallets:Object.keys(out.wallets).length,receipts:ids.length,errors:out.errors}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={POOL,TEA,TBF,FILE,SINCE,main};
