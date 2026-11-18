"use strict";
const path=require("node:path"),C=require("./mexc-core"),{readJson,atomicJson}=require("./mexc-monitor"),{createProvider,loadEnv}=require("./mexc-provider");
const FILE=path.join(__dirname,"data/mexc-usdt-deepening-2026-11-18.json");
const PROBE_FILE=path.join(__dirname,"data/mexc-usdt-reentry-probes-2026-11-18.json");
const EXTRA_FILE=path.join(__dirname,"data/mexc-usdt-return-evidence-2026-11-18.json");
const CORE=["TKsTkSS6WqnPbGfUGAwHFwbDozG7GxJwK7","TM9Y3bCBCKBVsZUy8QLBtCG7bBodyrijBN","TMMb3vKig35i1dnTGdraHfMQc5gRmJUdGY","TD27zqAbV5sJKzShJDEs2TK8iQeqtoAw8V","TN3K24QbSAZ3qPJxL3yS2WZ9EXGawgyVYC","TXt7g7NxhQnEBrsvKFnsWP6PKJ3odfFqJu","TWTsG83oBPSZpNA416VXW2zMyxjaDpLjYS"];
async function main(){
  loadEnv();const p=createProvider({delayMs:500}),prior=await readJson(path.join(__dirname,"data/mexc-usdd-audit-evidence-2026-11-17.json"),null),old=await readJson(path.join(__dirname,"data/mexc-attribution-evidence-2026-11-16.json"),null);
  const probing=process.argv.includes("--probes"),extra=process.argv.includes("--extras"),candidate=process.argv.includes("--candidates"),file=probing?PROBE_FILE:candidate?path.join(__dirname,"data/mexc-usdt-return-candidates-2026-11-18.json"):extra?EXTRA_FILE:FILE;
  const out=await readJson(file,probing?await readJson(FILE,null):{version:1,since:prior.since,entryUntil:prior.entryUntil,wallets:{},receipts:{...prior.receipts},probes:{},errors:{}});
  const write=()=>atomicJson(file,out);
  async function history(a,start,end){let rows=[],cursor="",pages=0;const seen=new Set();do{const d=await p.page(a,{since:start,until:end,cursor});rows.push(...d.rows);pages++;if(d.next&&(seen.has(d.next)||!d.rows.length))throw Error("历史游标异常");seen.add(d.next);cursor=d.next;if(pages>=200&&cursor)throw Error("历史超过保护上限");}while(cursor);return rows;}
  async function balance(a){const [u,d,ju,jd]=await Promise.all([p.balance(a,C.USDT),p.balance(a,C.USDD),p.position(a),p.position(a,C.MARKETS.USDD)]);return {balances:{[C.USDT]:u,[C.USDD]:d,[C.JUSDT]:ju.jTokenRaw,[C.JUSDD]:jd.jTokenRaw},positions:{USDT:ju,USDD:jd},checkedAt:Date.now()};}
  if(!process.argv.includes("--probes")){
    const targets=[...(extra||candidate?[]:CORE),...process.argv.filter(x=>/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(x))];
    for(const a of targets){if(!CORE.includes(a)&&await p.type(a)!=="wallet")throw Error("完整钱包审计拒绝公共合约: "+a);let w=out.wallets[a];if(w?.complete&&Date.now()-w.checkedAt<1800000)continue;
      if(!w){w=prior.wallets[a]?structuredClone(prior.wallets[a]):{rows:[],through:out.since-1};const h=old.ledgers[a];if(!w.rows.length&&h?.done&&h.since===out.since){w.rows=[...h.rows,...(h.tail?.rows||[])];w.through=h.tail?.done?h.tail.until:h.until;}out.wallets[a]=w;}
      w.complete=false;const anchor=await p.solidBlock();if(w.through<anchor.timestamp){w.rows.push(...await history(a,w.through+1,anchor.timestamp));w.through=anchor.timestamp;}
      for(let n=0;n<8;n++){const before=await balance(a),next=await p.solidBlock(),tail=next.timestamp>w.through?await history(a,w.through+1,next.timestamp):[];w.rows.push(...tail);w.through=next.timestamp;const after=await balance(a);if(JSON.stringify(before.balances)===JSON.stringify(after.balances)&&!tail.some(C.normalizeTransfer)){Object.assign(w,before,{asOf:next,complete:true});break;}}
      if(!w.complete)throw Error("无法获得一致余额: "+a);await write();console.log(JSON.stringify({wallet:a,rows:w.rows.length,complete:true}));
    }
    const states=await Promise.all(["data/mexc-state.json","data/mexc-usdd-state.json",FILE,EXTRA_FILE,"data/mexc-usdt-return-candidates-2026-11-18.json"].map(f=>readJson(path.isAbsolute(f)?f:path.join(__dirname,f),{})));const known=Object.assign({},...states.map(s=>s.receipts),out.receipts);
    for(const f of (await require("node:fs/promises").readdir(path.join(__dirname,"data"))).filter(f=>/^mexc-probe-tx-[a-f0-9]{64}\.json$/.test(f))){const r=await readJson(path.join(__dirname,"data",f),null);if(r?.txid)known[r.txid]=r;}
    const ids=[...new Set(Object.values(out.wallets).flatMap(w=>w.rows.filter(C.normalizeTransfer).map(r=>r.transaction_id||r.txid)))];
    for(let i=0;i<ids.length;i+=40){let j=0;const batch=ids.slice(i,i+40);await Promise.all(Array.from({length:4},async()=>{while(j<batch.length){const id=batch[j++],cached=known[id];out.receipts[id]=cached&&!cached.actions?.some(a=>!a.contract)?cached:await p.receipt(id);}}));await write();console.log(JSON.stringify({receipts:Math.min(i+40,ids.length),total:ids.length}));}
    out.collectedAt=new Date().toISOString();await write();
  }
  if(process.argv.includes("--probes")){
    const F=require("./mexc-fund-flow"),book=await readJson(path.join(__dirname,"mexc-sources.json"),null),hubs=await readJson(path.join(__dirname,"mexc-boundaries.json"),null),stops=new Set([...book.addresses,...hubs.addresses].filter(x=>x.status==="verified").map(x=>x.address));
    out.probeUntil ||= (await p.solidBlock()).timestamp;
    const queue=new Map();for(const a of CORE.slice(1,3)){const entries=require("./mexc-attribution-review.json").entries.filter(e=>e.from===a),first=Math.min(...entries.map(e=>e.blockTs));const rs=F.walletRows(a,out.wallets[a],out.receipts);const red=rs.filter(r=>r.contract===C.USDT&&r.from===C.JUSDT&&r.to===a&&r.blockTs>=first),start=Math.min(...red.map(r=>r.blockTs));
      for(const r of rs.filter(r=>r.contract===C.USDT&&r.from===a&&r.to!==C.JUSDT&&r.blockTs>=start)){let q=queue.get(r.to);if(!q){q={address:r.to,since:r.blockTs,parents:[]};queue.set(r.to,q);}q.since=Math.min(q.since,r.blockTs);q.parents.push(r);}}
    out.probeScope={maxWalletHopsAfterRedemption:1,targets:queue.size};await write();
    for(const [a,q]of queue){let probe=out.probes[a];if(probe?.done||probe?.boundary)continue;try{
      if(stops.has(a)){out.probes[a]={...q,boundary:"verified-public-platform"};await write();continue;}
      const type=await p.type(a);if(type!=="wallet"){out.probes[a]={...q,boundary:type};await write();continue;}
      probe ||= {...q,type,rows:[],cursor:"",pages:0};out.probes[a]=probe;
      do{const page=await p.page(a,{since:probe.since,until:out.probeUntil,cursor:probe.cursor,outgoing:true});probe.rows.push(...page.rows);probe.pages++;if(page.next&&(page.next===probe.cursor||!page.rows.length))throw Error("探查分页异常");probe.cursor=page.next;probe.done=!page.next;if(probe.pages>=20&&page.next){probe.limited=true;break;}}while(probe.cursor);
      delete out.errors[a];await write();console.log(JSON.stringify({probe:a,rows:probe.rows.length,done:probe.done,limited:!!probe.limited,market:probe.rows.filter(r=>[C.JUSDT,C.JUSDD].includes(r.to)&&C.normalizeTransfer(r)).length}));
    }catch(e){out.errors[a]=e.message;await write();console.log(JSON.stringify({probe:a,error:e.message}));}}
    out.probedAt=new Date().toISOString();await write();
  }
  console.log(JSON.stringify({done:true,wallets:Object.keys(out.wallets).length,receipts:Object.keys(out.receipts).length,probes:Object.keys(out.probes).length}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={FILE,PROBE_FILE,EXTRA_FILE,CORE,main};
