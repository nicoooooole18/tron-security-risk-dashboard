"use strict";
const fs=require("node:fs/promises");
const path=require("node:path");
const crypto=require("node:crypto");
const C=require("./mexc-core");
const DEFAULTS={lookbackDays:30,refreshSeconds:300,accountsPerCycle:8,pagesPerAccount:2,receiptsPerCycle:20,
  positionsPerCycle:20,maxAccounts:2000,maxTransfers:100000,maxMembers:1000,maxReceipts:30000,maxArchive:5000};
async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,"utf8"));}catch(e){if(e.code==="ENOENT")return fallback;throw e;}}
async function atomicJson(file,data){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+".tmp",JSON.stringify(data),{mode:0o600});await fs.rename(file+".tmp",file);}
const version=book=>crypto.createHash("sha256").update(JSON.stringify(book)).digest("hex").slice(0,16);
async function pool(items,width,fn){let i=0;await Promise.all(Array.from({length:Math.min(width,items.length)},async()=>{while(i<items.length)await fn(items[i++]);}));}
function createMexcMonitor({root=__dirname,provider,readSources=()=>readJson(path.join(root,"mexc-sources.json"),null),
  getHubs=async()=>new Set(),options={},clock=Date.now}={}) {
  const config={...DEFAULTS,...options},market=config.market||C.MARKETS.USDT;
  const isUSDD=market.symbol==="USDD",jToken=market.jToken,underlying=market.underlying;
  const prefix=isUSDD?"mexc-usdd":"mexc",funding=c=>c===C.USDT||c===underlying;
  const streamFields=rights=>rights?{}:isUSDD?{incoming:true}:{asset:underlying,incoming:true};
  const stateFile=path.join(root,`data/${prefix}-state.json`),snapFile=path.join(root,`data/${prefix}-snapshot.json`);
  let state=null,running=null;
  async function run(){
    const backfill=Number.isFinite(config.backfillUntil),now=backfill?config.backfillUntil:clock(),since=now-config.lookbackDays*C.DAY,book=C.validateSources(await readSources());
    const sourceVersion=version(book),seeds=new Set(book.addresses.filter(a=>a.status==="verified").map(a=>a.address));
    state ||= await readJson(stateFile,{version:1,accounts:{},transfers:[],receipts:{},receiptAttempts:{},members:{},positions:{},archive:{},frozen:{},limits:{}});
    if(state.version!==1)throw new Error("MEXC 缓存版本不支持");
    if(state.sourceVersion && state.sourceVersion!==sourceVersion){state.members={};state.positions={};state.archive={};}
    state.sourceVersion=sourceVersion;const hubs=await getHubs();const types={};
    const hubVersion=version([...hubs].sort());
    if(state.hubVersion && state.hubVersion!==hubVersion){state.members={};state.positions={};state.archive={};}
    state.hubVersion=hubVersion;
    const add=(a,depth=0,rights=false)=>{
      if(!C.validAddress(a)||a===C.ZERO||seeds.has(a)&&!rights||hubs.has(a))return;
      if(!state.accounts[a]){
        if(Object.keys(state.accounts).length>=config.maxAccounts){state.limits.accounts=true;return;}
        state.accounts[a]={depth,rights,lastAttempt:0,active:true};
      }else {state.accounts[a].depth=Math.min(state.accounts[a].depth,depth);if(rights)state.accounts[a].rights=true;}
      state.accounts[a].active=true;return state.accounts[a];
    };
    // Rebuild reachability so a newly verified public hub also excludes candidates reachable only through that hub.
    for(const q of Object.values(state.accounts)){q.active=false;q.depth=3;}
    const reachable=[],incoming=new Map(),contractIncoming=new Map();
    for(const r of state.transfers)if(funding(r.contract)&&r.blockTs>=since&&r.blockTs<=now){if(!incoming.has(r.to))incoming.set(r.to,[]);incoming.get(r.to).push(r);}
    for(const receipt of Object.values(state.receipts))for(const r of receipt.transfers)if(funding(r.contract)&&r.blockTs>=since&&r.blockTs<=now){if(!contractIncoming.has(r.to))contractIncoming.set(r.to,[]);contractIncoming.get(r.to).push(r);}
    const enqueue=(a,depth,rights=false)=>{const previous=state.accounts[a];const change=!previous?.active||depth<previous.depth;const q=add(a,depth,rights);if(q&&change)reachable.push([a,q]);};
    enqueue(jToken,-1);for(const a of Object.keys(state.members))enqueue(a,2,true);
    for(let i=0;i<reachable.length;i++){
      const [a,q]=reachable[i];
      if((a===jToken||q.type==="wallet")&&q.depth<1)for(const r of incoming.get(a)||[])enqueue(r.from,q.depth+1);
      else if(q.type==="contract"&&a!==jToken)for(const r of contractIncoming.get(a)||[])enqueue(r.from,q.depth);
    }
    const transferMap=new Map(state.transfers.filter(r=>r.blockTs>=since || r.contract===jToken && (state.members[r.from]||state.members[r.to])).map(r=>[C.key(r),r]));
    const ingest=(r,rights=false)=>{
      if(!r || r.blockTs<since && !(rights && r.contract===jToken) || r.blockTs>now)return;
      if(transferMap.size>=config.maxTransfers && !transferMap.has(C.key(r))){state.limits.transfers=true;return false;}
      transferMap.set(C.key(r),r);return true;
    };
    // Second-wallet funding after its last relevant output cannot explain any market inflow.
    // Retain full market/first-wallet/rights windows; grow a bound again if a later connecting output is discovered.
    function resetHistoryBounds(){
      if(!backfill)return;
      const upstreamUntil=new Map(),consider=r=>{
        if(!funding(r.contract)||r.blockTs<since||r.blockTs>now)return;
        const from=state.accounts[r.from],to=state.accounts[r.to];
        if(from?.active&&from.depth===1&&!from.rights&&to?.active&&(to.depth<1||to.type==="contract"&&to.depth===1))
          upstreamUntil.set(r.from,Math.max(upstreamUntil.get(r.from)||since,r.blockTs));
      };
      for(const r of state.transfers)consider(r);
      for(const receipt of Object.values(state.receipts))for(const r of receipt.transfers)consider(r);
      for(const [a,q] of Object.entries(state.accounts))if(q.active){
        const until=upstreamUntil.get(a)||now,mode=q.rights?"rights":isUSDD?"conversion-in":"usdt-in",h=q.history;
        if(!h||h.since!==since||h.mode!==mode||h.until<until||h.until>until&&!h.done){
          q.history={since,until,cursor:"",done:false,mode,...streamFields(q.rights)};q.head=null;
        }
      }
    }
    resetHistoryBounds();
    const queue=Object.entries(state.accounts).filter(([,q])=>q.active&&(!backfill||!q.history?.done||q.error)).sort(([a,x],[b,y])=>(b===jToken?1:0)-(a===jToken?1:0)||x.lastAttempt-y.lastAttempt)
      .slice(0,config.accountsPerCycle);
    await pool(queue,config.concurrency||1,async([a,q])=>{
      q.lastAttempt=clock();
      try{
        q.type=a===jToken?"contract":["wallet","contract"].includes(q.type)?q.type:await provider.type(a);
        if(q.type==="unknown")throw new Error("地址类型待核验");
        q.history ||= {since,until:now,cursor:"",done:false,...streamFields(q.rights)};
        // Contract provenance is limited to full market-deposit receipts; unrelated historical funding is not traversed.
        if(backfill && q.type==="contract" && a!==jToken && !q.rights){q.history.done=true;q.history.evidenceScope="same-transaction-receipts";q.error=null;q.lastSuccess=now;return;}
        q.head ||= {since:Math.max(since,(q.through||now)-60000),until:now,cursor:"",...streamFields(q.rights)};
        const readPage=async(stream,history)=>{
          const d=await provider.page(a,stream);
          if(!Array.isArray(d.rows)||typeof d.next!=="string" || d.next && (!d.rows.length || d.next===stream.cursor || stream.seen?.includes(d.next)))throw new Error("转账分页游标异常");
          let overflow=false;
          for(const row of d.rows){const r=C.normalizeTransfer(row);if(!r)continue;
            if(ingest(r,q.rights)===false)overflow=true;
            if(funding(r.contract) && r.to===a && q.depth<1 && (q.type==="wallet" || a===jToken))add(r.from,q.depth+1);
          }
          if(overflow)throw new Error("转账存储上限已达，未推进游标");
          stream.seen ||= [];if(d.next)stream.seen.push(d.next);stream.cursor=d.next;
          if(!d.next){stream.done=true;if(!history){q.through=stream.until;q.head=null;}}
        };
        if(backfill&&config.historyShards>1&&q.depth===1&&q.type==="wallet"&&!q.rights&&!q.history.segments&&(q.history.seen?.length||0)>=64){
          const h=q.history,count=config.historyShards,span=h.until-h.since+1;
          // Disjoint inclusive ranges cover the entire required interval; replay safely deduplicates cached rows.
          h.segments=Array.from({length:count},(_,i)=>({since:h.since+Math.floor(span*i/count),until:h.since+Math.floor(span*(i+1)/count)-1,
            asset:h.asset,incoming:h.incoming,cursor:"",done:false}));h.cursor="";
        }
        if(backfill&&q.history.segments){
          const errors=[];
          await pool(q.history.segments.filter(s=>!s.done),config.concurrency||1,async stream=>{
            try{for(let p=0;p<config.pagesPerAccount&&!stream.done;p++)await readPage(stream,true);}
            catch(e){errors.push(e.message);}
          });
          q.history.done=q.history.segments.every(s=>s.done);
          if(errors.length)throw new Error(errors[0]);
        }else for(let p=0;p<config.pagesPerAccount;p++){
          const history=backfill || !q.lastSuccess || p%2===1,stream=history?q.history:q.head;
          if(!stream || stream.done){if(backfill)break;continue;}
          await readPage(stream,history);
        }
        q.error=null;q.lastSuccess=now;
      }catch(e){q.error=e.message;}
    });
    state.transfers=[...transferMap.values()];
    for(const [a,q] of Object.entries(state.accounts))types[a]=q.type;
    const preliminary=C.analyze({transfers:state.transfers,receipts:state.receipts,sources:book,accountTypes:types,hubs,since,until:now,maxVisits:config.maxGraphVisits||50000,market});
    const neededReceipts=analysis=>{
      const needed=new Map();
      // A wallet path is discoverable from confirmed inbound USDT pages. Fetch all its legs once matched.
      for(const e of analysis.events)for(const leg of e.evidence)needed.set(leg.txid,leg);
      // Every arbitrary market-deposit contract needs its full receipt to identify its actual same-tx funders.
      for(const r of state.transfers)if(funding(r.contract)&&r.to===jToken&&types[r.from]==="contract"&&!hubs.has(r.from)
        || r.contract===jToken&&state.members[r.from]
        || isUSDD&&r.contract===C.USDD&&state.accounts[r.to]?.active&&r.from!==jToken)needed.set(r.txid,r);
      return needed;
    };
    const receiptsNeeded=neededReceipts(preliminary);
    const pending=[...receiptsNeeded.values()].filter(r=>!state.receipts[r.txid]).sort((a,b)=>(state.receiptAttempts[a.txid]?.at||0)-(state.receiptAttempts[b.txid]?.at||0)||b.blockTs-a.blockTs);
    await pool(pending.slice(0,config.receiptsPerCycle),config.concurrency||1,async r=>{
      try{
        if(Object.keys(state.receipts).length>=config.maxReceipts){state.limits.receipts=true;return;}
        const receipt=await provider.receipt(r.txid);
        if(Object.keys(state.receipts).length>=config.maxReceipts){state.limits.receipts=true;return;}
        state.receipts[r.txid]=receipt;
        state.receiptAttempts[r.txid]={at:now,error:null};
      }catch(e){state.receiptAttempts[r.txid]={at:now,error:e.message};}
    });
    // Revisit cached receipts: a proxy's type may only be learned on a later cycle.
    for(const receipt of Object.values(state.receipts))for(const leg of receipt.transfers)if(funding(leg.contract) && leg.blockTs>=since){
      const target=state.accounts[leg.to];
      if(target?.active && target.type==="contract" && leg.to!==jToken)add(leg.from,target.depth);
    }
    for(const [a,q] of Object.entries(state.accounts))types[a]=q.type;
    const analysis=C.analyze({transfers:state.transfers,receipts:state.receipts,sources:book,accountTypes:types,hubs,since,until:now,maxVisits:config.maxGraphVisits||50000,market});
    // Canonical receipts can split a provisional account-index row into multiple log events.
    for(const [id,e] of Object.entries(state.archive))if(e.blockTs>=since)delete state.archive[id];
    for(const e of analysis.events){
      if(Object.keys(state.archive).length>=config.maxArchive&&!state.archive[e.id]){state.limits.archive=true;break;}
      state.archive[e.id]=e;
    }
    const tracked=C.trackRights({events:Object.values(state.archive),rows:analysis.rows,receipts:state.receipts,members:state.members,
      accountTypes:types,hubs,maxMembers:config.maxMembers,market});
    state.members=tracked.members;
    for(const [a,m] of Object.entries(state.members)){
      add(a,2,true);
      const q=state.accounts[a];if(q && m.edge.blockTs<q.history?.since){q.history={since:m.edge.blockTs,until:now,cursor:"",done:false};}
      if(backfill&&q&&q.history?.mode!=="rights")q.history={since,until:now,cursor:"",done:false,mode:"rights"};
    }
    // A new page or canonical receipt may reveal a later connection during this very cycle.
    resetHistoryBounds();
    const positions=Object.keys(state.members).filter(a=>types[a]==="wallet"&&!hubs.has(a))
      .sort((a,b)=>(state.positions[a]?.attemptedAt||0)-(state.positions[b]?.attemptedAt||0));
    for(const a of positions.slice(0,config.positionsPerCycle)){
      const previous=state.positions[a],checkedAt=clock();
      try{state.positions[a]={...await provider.position(a,market),status:"ok",checkedAt,attemptedAt:checkedAt};}
      catch(e){state.positions[a]={status:"error",error:e.message,attemptedAt:checkedAt,lastGood:previous?.status==="ok"?previous:previous?.lastGood};}
    }
    for(const a of [...seeds].slice(0,50))if(clock()-(state.frozen[a]?.checkedAt||0)>(state.frozen[a]?.status==="unknown"?60000:900000)){
      const checkedAt=clock();try{state.frozen[a]={status:await provider.frozen(a),checkedAt};}catch{state.frozen[a]={status:"unknown",checkedAt};}
    }
    const accounts=Object.values(state.accounts).filter(q=>q.active), events=Object.values(state.archive).filter(e=>e.blockTs>=since).sort((a,b)=>b.blockTs-a.blockTs);
    const currentPositions=positions.map(a=>({address:a,...state.positions[a],status:!state.positions[a]?"pending":state.positions[a].status==="ok"&&clock()-state.positions[a].checkedAt>900000?"stale":state.positions[a].status}));
    const historyPending=accounts.filter(a=>!a.history?.done).length,headPending=accounts.filter(a=>!a.through||now-a.through>900000).length;
    // New rights members may already have fully scanned accounts; include their newly required receipts before declaring completion.
    const stillNeeded=new Set([...neededReceipts(analysis).values()].filter(r=>!state.receipts[r.txid]).map(r=>r.txid));
    const receiptPending=stillNeeded.size;
    const errors=Object.entries(state.accounts).filter(([,a])=>a.active&&a.error).map(([address,a])=>({address,error:a.error}));
    const pendingMembers=Object.keys(state.members).filter(a=>!["wallet","contract"].includes(types[a])).length;
    const scanComplete=backfill && seeds.size>0 && historyPending===0 && receiptPending===0 && pendingMembers===0 && errors.length===0 && !analysis.graphLimited && !tracked.limited && !Object.values(state.limits).some(Boolean);
    const snapshot={version:1,scope:isUSDD?"MEXC-USDD-jUSDD":"MEXC-USDT-jUSDT",market:market.symbol,generatedAt:new Date(clock()).toISOString(),since:new Date(since).toISOString(),until:new Date(now).toISOString(),
      sourceVersion,sources:{...book,addresses:book.addresses.map(a=>({...a,frozen:state.frozen[a.address]||{status:"unknown"}}))},
      events:events.slice(0,500),rights:tracked.rights.slice(-500).reverse(),redemptions:tracked.redemptions.slice(-500).reverse(),ambiguous:tracked.ambiguous.slice(-100).reverse(),
      positions:currentPositions.map(p=>({...p,asset:market.symbol,decimals:market.decimals,jToken})),summary:{matchedCount:events.length,directRaw:C.sum(events.filter(e=>e.kind==="direct")),
        indirectRaw:C.sum(events.filter(e=>e.kind!=="direct")),attributedIndirectRaw:null,verifiedCount:events.filter(e=>e.verified).length},
      coverage:{status:!seeds.size?"sources-pending":scanComplete?"backfill-complete":"bounded",sourceComplete:false,scanComplete,backfill,totalAccounts:accounts.length,excludedAccounts:Object.keys(state.accounts).length-accounts.length,historyPending,headPending:backfill?null:headPending,receiptPending,
        errors,receiptErrors:Object.entries(state.receiptAttempts).filter(([,v])=>v.error).slice(0,20).map(([txid,v])=>({txid,error:v.error})),
        pendingMembers,stoppedAddresses:analysis.boundaries.length,
        contractMembers:Object.keys(state.members).filter(a=>types[a]==="contract").length,
        limits:{...state.limits,graph:analysis.graphLimited,rights:tracked.limited},
        displayTruncated:events.length>500||tracked.rights.length>500||tracked.redemptions.length>500||tracked.ambiguous.length>100,
        refreshSeconds:config.refreshSeconds},
      limitations:["地址库为已核对的 Arkham TRON 子集；未命中不代表没有 MEXC 资金。",
        "首次回查 30 天，最多 2 个钱包中转；合约只用同交易事件穿透。支持同笔已核验 PSM 的 USDT → USDD 换币；其他换币与跨链待核。",
        "间接路径金额为该资产的交易额，不自动计为来源本金；归因复核、权益和持仓各自独立。",
        "公共平台停止穿透；合约跨交易转出的等量 jUSDT 单列待核，不自动归属于原出资方。",
        "持仓为关联钱包该市场的全部份额，含混同资金；失败或过期不按零处理。"]};
    state.updatedAt=now;await atomicJson(stateFile,state);await atomicJson(snapFile,snapshot);return snapshot;
  }
  return {refresh(){if(!running)running=run().finally(()=>{running=null;});return running;}};
}
async function readMarketSnapshot(root,name) {
  const runtime=await readJson(path.join(root,"data",name),null);
  const snapshot=runtime||await readJson(path.join(root,"reviewed-snapshots",name),null);
  return snapshot?{...snapshot,runtime:{snapshotOrigin:runtime?"collector":"reviewed-publication"}}:null;
}
async function readBaseSnapshot(root=__dirname,now=Date.now()) {
  const sources=validateOrEmpty(await readJson(path.join(root,"mexc-sources.json"),null));
  const snapshot=await readMarketSnapshot(root,"mexc-snapshot.json");
  if(!snapshot)return {version:1,scope:"MEXC-USDT-jUSDT",generatedAt:null,sources,events:[],rights:[],redemptions:[],ambiguous:[],positions:[],
    summary:null,coverage:{status:sources.addresses.length?"pending":"sources-pending",sourceComplete:false},runtime:{stale:true},limitations:["首次扫描尚未完成，不能据此判断无流入。"]};
  if(snapshot.scope!=="MEXC-USDT-jUSDT" || snapshot.sourceVersion!==version(sources))return {version:1,scope:"MEXC-USDT-jUSDT",generatedAt:null,sources,
    events:[],rights:[],redemptions:[],ambiguous:[],positions:[],summary:null,coverage:{status:"sources-changed",sourceComplete:false},runtime:{stale:true},limitations:["地址清单已变更，等待重新核对历史路径。"]};
  return {...snapshot,runtime:{...snapshot.runtime,stale:!Number.isFinite(Date.parse(snapshot.generatedAt))||now-Date.parse(snapshot.generatedAt)>900000}};
}
async function readMexcSnapshot(root=__dirname,now=Date.now()) {
  const base=await readBaseSnapshot(root,now);
  const [usdd,review]=await Promise.all([readMarketSnapshot(root,"mexc-usdd-snapshot.json"),readJson(path.join(root,"mexc-attribution-review.json"),null)]);
  if(!usdd&&!review)return base;
  return require("./mexc-attribution").combineSnapshots(base,usdd,review,now);
}
function validateOrEmpty(book){return book?C.validateSources(book):{version:1,entity:"mexc",chain:"tron",addresses:[],coverage:"partial"};}
module.exports={createMexcMonitor,readMexcSnapshot,readJson,atomicJson,DEFAULTS};
