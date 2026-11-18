"use strict";
// Read-only chain collection for a reproducible attribution review. No broadcasts.
const fs=require("node:fs/promises"),path=require("node:path"),C=require("./mexc-core");
const {createProvider,loadEnv}=require("./mexc-provider"),{readJson,atomicJson}=require("./mexc-monitor");
const FILE=path.join(__dirname,"data/mexc-usdd-audit-evidence-2026-11-17.json");
async function main(){
  loadEnv();const p=createProvider({delayMs:300}),window=await readJson(path.join(__dirname,"data/mexc-backfill-window.json"),null);
  const since=window.until-30*C.DAY,old=await readJson(path.join(__dirname,"data/mexc-attribution-evidence-2026-11-16.json"),{});
  const state=await readJson(path.join(__dirname,"data/mexc-usdd-state.json"),{}),review=await readJson(path.join(__dirname,"mexc-attribution-review.json"),{});
  const seeds=new Set((await readJson(path.join(__dirname,"mexc-sources.json"),{})).addresses.map(a=>a.address));
  const addresses=new Set(review.retention.map(r=>r.address));
  for(const e of Object.values(state.archive||{}))for(const r of e.evidence)for(const a of [r.from,r.to])if(state.accounts[a]?.type==="wallet"&&!seeds.has(a))addresses.add(a);
  const out=await readJson(FILE,{version:1,since,entryUntil:window.until,wallets:{},receipts:{}});
  async function history(a,start,end){
    let cursor="",rows=[],pages=0;const seen=new Set();
    do{const d=await p.page(a,{since:start,until:end,cursor});rows.push(...d.rows);pages++;if(d.next&&(seen.has(d.next)||!d.rows.length))throw Error("审计分页异常");seen.add(d.next);cursor=d.next;
      if(pages%50===0)console.log(JSON.stringify({history:a,pages,rows:rows.length}));if(pages>=2000&&cursor)throw Error("审计历史超过保护上限");
    }while(cursor);return {rows,done:true,pages,since:start,until:end};
  }
  async function balances(a){
    const values=await Promise.all([p.balance(a,C.USDT),p.balance(a,C.USDD),p.position(a,C.MARKETS.USDT),p.position(a,C.MARKETS.USDD)]);
    return {values:{[C.USDT]:values[0],[C.USDD]:values[1],[C.JUSDT]:values[2].jTokenRaw,[C.JUSDD]:values[3].jTokenRaw},positions:{USDT:values[2],USDD:values[3]},checkedAt:Date.now()};
  }
  for(const a of addresses){
    let w=out.wallets[a];if(w?.complete&&(process.argv.includes("--receipts-only")||Date.now()-w.asOf.timestamp<600000))continue;
    if(!w){const prior=old.ledgers?.[a];w={rows:[],through:since-1};if(prior?.done&&prior.since===since){w.rows=[...prior.rows];w.through=prior.until;if(prior.tail?.done){w.rows.push(...prior.tail.rows);w.through=prior.tail.until;}}out.wallets[a]=w;}
    w.complete=false;let anchor=await p.solidBlock();
    if(w.through<anchor.timestamp){const page=await history(a,w.through+1,anchor.timestamp);w.rows.push(...page.rows);w.through=anchor.timestamp;await atomicJson(FILE,out);}
    for(let attempt=0;attempt<8;attempt++){
      const before=await balances(a),next=await p.solidBlock();
      const tail=next.timestamp>w.through?await history(a,w.through+1,next.timestamp):{rows:[]};
      w.rows.push(...tail.rows);w.through=next.timestamp;
      const after=await balances(a);
      if(JSON.stringify(before.values)===JSON.stringify(after.values)&&!tail.rows.some(r=>C.normalizeTransfer(r))){w.complete=true;w.asOf=next;w.balances=before.values;w.positions=before.positions;w.checkedAt=before.checkedAt;break;}
      await atomicJson(FILE,out);
    }
    if(!w.complete)throw Error(`地址持续活动，暂未取得一致余额: ${a}`);
    console.log(JSON.stringify({wallet:a,rows:w.rows.length,complete:w.complete,asOf:w.asOf.timestamp}));await atomicJson(FILE,out);
  }
  // Reuse canonical, raw-log-verified receipts from the collectors. New relevant
  // transactions are fetched too, so equal events never collapse in ledger joins.
  const refreshed=await readJson(path.join(__dirname,"data/mexc-usdd-state.json"),state);
  const usdt=await readJson(path.join(__dirname,"data/mexc-state.json"),{}),known={...usdt.receipts,...refreshed.receipts,...out.receipts};
  const ids=[...new Set(Object.values(out.wallets).flatMap(w=>w.rows.filter(r=>C.normalizeTransfer(r)).map(r=>r.transaction_id||r.txid)))];
  for(let i=0;i<ids.length;i+=40){const batch=ids.slice(i,i+40);let index=0;
    await Promise.all(Array.from({length:4},async()=>{while(index<batch.length){const id=batch[index++];out.receipts[id]=known[id]||await p.receipt(id);}}));
    console.log(JSON.stringify({receipts:Math.min(i+40,ids.length),total:ids.length}));await atomicJson(FILE,out);
  }
  out.collectedAt=new Date().toISOString();await atomicJson(FILE,out);console.log(JSON.stringify({done:true,wallets:Object.keys(out.wallets).length,receipts:Object.keys(out.receipts).length,file:FILE}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main,FILE};
