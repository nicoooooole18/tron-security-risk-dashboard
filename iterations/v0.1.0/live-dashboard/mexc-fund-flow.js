"use strict";
const C=require("./mexc-core");
const SCALE=10n**12n,INF=10n**60n,min=(a,b)=>a<b?a:b;
class Flow {
  constructor(n){this.g=Array.from({length:n},()=>[]);}
  add(u,v,cap){if(cap<0n)throw Error("negative flow capacity");const a={to:v,cap,rev:this.g[v].length},b={to:u,cap:0n,rev:this.g[u].length};this.g[u].push(a);this.g[v].push(b);return a;}
  run(s,t){let total=0n;for(;;){const level=new Int32Array(this.g.length).fill(-1),queue=[s];level[s]=0;for(let i=0;i<queue.length;i++)for(const e of this.g[queue[i]])if(e.cap>0n&&level[e.to]<0){level[e.to]=level[queue[i]]+1;queue.push(e.to);}if(level[t]<0)return total;
      const next=new Int32Array(this.g.length);const dfs=(v,f)=>{if(v===t)return f;for(;next[v]<this.g[v].length;next[v]++){const e=this.g[v][next[v]];if(e.cap>0n&&level[e.to]===level[v]+1){const used=dfs(e.to,min(f,e.cap));if(used){e.cap-=used;this.g[e.to][e.rev].cap+=used;return used;}}}return 0n;};let sent;while((sent=dfs(s,INF))>0n)total+=sent;
    }}
}
function walletRows(address,wallet,receipts,{required=true}={}) {
  const txids=new Set(wallet.rows.map(r=>r.transaction_id||r.txid)),map=new Map();
  for(const id of txids){const receipt=receipts[id];if(!receipt){if(required&&wallet.rows.some(r=>(r.transaction_id||r.txid)===id&&C.normalizeTransfer(r)))throw Error(`Missing canonical receipt: ${id}`);for(const row of wallet.rows.filter(r=>(r.transaction_id||r.txid)===id)){const r=C.normalizeTransfer(row);if(r)map.set(C.key(r),r);}continue;}
    for(const r of receipt.transfers)if((r.from===address||r.to===address)&&r.blockTs<=wallet.through)map.set(C.key(r),r);
  }
  return [...map.values()].sort((a,b)=>a.blockTs-b.blockTs||a.txid.localeCompare(b.txid)||(a.eventIndex??0)-(b.eventIndex??0));
}
// Time-expanded conservation in 10^-18 token units. USDT-to-USDD bridges are
// allowed only for verified zero-fee, one-for-one PSM executions. All JustLend
// deposits are absorbing boundaries: redepositing redeemed or borrowed funds
// cannot count the original source principal for a second time.
function buildFundGraph({wallets,receipts,sources,since,until,required=true,sourceTransfers=null,sourceCapRaw=null,sourceLimits={},includeBuyGem=false}) {
  const seeds=new Set((sources?.addresses||[]).filter(a=>a.status==="verified").map(a=>a.address)),assets=[C.USDT,C.USDD],rows=new Map(),openings={},closing={};
  const sourceKeys=sourceTransfers?new Set(sourceTransfers.map(C.key)):null;
  const scale=r=>BigInt(r.amountRaw)*(r.contract===C.USDT?SCALE:1n);
  for(const [a,w] of Object.entries(wallets)){
    if(!w.complete)throw Error(`Incomplete ledger: ${a}`);const full=walletRows(a,w,receipts,{required}).filter(r=>r.blockTs>=since);
    for(const asset of assets){if(w.balances[asset]==null)continue;let balance=BigInt(w.balances[asset])*(asset===C.USDT?SCALE:1n);
      for(const r of full.filter(r=>r.contract===asset))balance+=r.from===a?scale(r):0n,balance-=r.to===a?scale(r):0n;
      if(balance<0n)throw Error(`Opening balance does not reconcile: ${a} ${asset} ${balance}`);openings[`${a}:${asset}`]=balance;
    }
    for(const r of full)if(assets.includes(r.contract)&&r.blockTs<=until)rows.set(C.key(r),r);
  }
  const groups=new Map(),nodes=new Map(),edges=[],exits=[],sourceEdges=[];let n=sourceCapRaw===null?2:3;const S=0,T=1,supply=sourceCapRaw===null?S:2;
  const tracked=(a,asset)=>openings[`${a}:${asset}`]!==undefined;
  for(const r of rows.values())for(const a of new Set([r.from,r.to]))if(tracked(a,r.contract)){
    const k=`${a}:${r.contract}`;if(!groups.has(k))groups.set(k,new Map());const byTime=groups.get(k);if(!byTime.has(r.blockTs))byTime.set(r.blockTs,[]);byTime.get(r.blockTs).push(r);
  }
  for(const [k,byTime] of groups){let previous=null,balance=openings[k];const a=k.split(":")[0];
    for(const [ts,rs] of [...byTime].sort((a,b)=>a[0]-b[0])){const id=n++;nodes.set(`${k}:${ts}`,id);if(previous!==null)edges.push([previous,id,balance]);
      // Same-block transaction order is deliberately relaxed, widening bounds.
      for(const r of rs)if(r.to===a)balance+=scale(r);
      for(const r of rs)if(r.from===a)balance-=scale(r);
      if(balance<0n)throw Error(`Ledger negative at ${k} ${ts}`);previous=id;
    }
    closing[k]=balance;if(previous!==null)exits.push({u:previous,cap:balance,id:`end:${k}`,market:false});
  }
  const at=(a,r)=>nodes.get(`${a}:${r.contract}:${r.blockTs}`);
  const bridges=new Map();
  const swaps=[...C.conversions(receipts).values(),...(includeBuyGem?C.reverseConversions(receipts).values():[])];
  for(const swap of swaps)if(tracked(swap.paid.from,swap.paid.contract)&&tracked(swap.received.to,swap.received.contract)&&rows.has(C.key(swap.paid))&&rows.has(C.key(swap.received))){
    const id=C.key(swap.paid);if(!bridges.has(id))bridges.set(id,swap);
  }
  for(const r of rows.values()){
    const id=C.key(r),u=at(r.from,r),v=at(r.to,r),cap=scale(r);
    if((sourceKeys?sourceKeys.has(id):seeds.has(r.from))&&v!==undefined){if(!sourceKeys&&r.contract!==C.USDT)throw Error("Direct MEXC USDD needs a separate principal unit");const limit=sourceLimits[id]===undefined?cap:min(cap,BigInt(sourceLimits[id]));if(limit<0n)throw Error("Negative source limit");sourceEdges.push({u:supply,v,cap:limit,transfer:r});edges.push([supply,v,limit,{kind:"source",transfer:r}]);}
    if(u===undefined)continue;
    if(bridges.has(id)){const b=bridges.get(id);edges.push([u,at(b.received.to,b.received),min(cap,scale(b.received)),{kind:"swap",transfer:r}]);continue;}
    if(v!==undefined)edges.push([u,v,cap,{kind:"transfer",transfer:r}]);
    else exits.push({u,cap,id,transfer:r,market:r.to===C.JUSDT||r.to===C.JUSDD});
  }
  const available=sourceEdges.reduce((s,e)=>s+e.cap,0n),sourceTotal=sourceCapRaw===null?available:min(BigInt(sourceCapRaw),available);
  if(sourceCapRaw!==null)edges.push([S,supply,sourceTotal,{kind:"shared-source-cap"}]);
  function solve(selected,mode="max"){
    const flow=new Flow(n);for(const [u,v,c] of edges)flow.add(u,v,c);
    const refs=[];for(const e of exits){const chosen=selected.has(e.id),enabled=mode==="all"||mode==="max"&&chosen||mode==="escape"&&!chosen;if(enabled)refs.push({e,ref:flow.add(e.u,T,e.cap)});}
    const value=flow.run(S,T);return {value,allocations:refs.filter(({e})=>selected.has(e.id)).map(({e,ref})=>({id:e.id,amount:(e.cap-ref.cap).toString()}))};
  }
  if(solve(new Set(),"all").value!==sourceTotal)throw Error("Source conservation infeasible");
  function bounds(ids){const set=new Set(ids),max=solve(set),escape=solve(set,"escape");return {lowerRaw:(sourceTotal-escape.value).toString(),upperRaw:max.value.toString(),allocation:max.allocations};}
  // Preserve an inspectable, fully feasible assignment for each extremum. First
  // saturate the preferred exits, then add the others and route every source.
  // These are alternative explanations, never a claim about actual coin identity.
  function witness(ids,extremum){
    if(!["lower","upper"].includes(extremum))throw Error("Invalid extremum");
    const selected=new Set(ids),flow=new Flow(n),refs=[];
    for(const [u,v,cap,meta] of edges)refs.push({u,v,cap,...meta,ref:flow.add(u,v,cap)});
    const addExit=e=>refs.push({u:e.u,v:T,cap:e.cap,kind:"exit",id:e.id,transfer:e.transfer,selected:selected.has(e.id),ref:flow.add(e.u,T,e.cap)});
    const preferred=e=>selected.has(e.id)===(extremum==="upper");
    exits.filter(preferred).forEach(addExit);const first=flow.run(S,T);
    exits.filter(e=>!preferred(e)).forEach(addExit);const total=first+flow.run(S,T);
    if(total!==sourceTotal)throw Error("Extremal assignment incomplete");
    const assignment=refs.map(({ref,cap,...e})=>({...e,capacityRaw:String(cap),flowRaw:String(cap-ref.cap)}));
    const target=assignment.filter(e=>e.selected).reduce((s,e)=>s+BigInt(e.flowRaw),0n);
    const result={extremum,sourceTotal:String(sourceTotal),targetRaw:String(target),nodes:n,edges:assignment};
    verifyWitness(result);const b=bounds(ids);if(result.targetRaw!==b[extremum+"Raw"])throw Error("Extremal assignment is not optimal");return result;
  }
  return {bounds,witness,openings:Object.fromEntries(Object.entries(openings).map(([k,v])=>[k,String(v)])),closing:Object.fromEntries(Object.entries(closing).map(([k,v])=>[k,String(v)])),sourceTotal:String(sourceTotal),sources:sourceEdges.map(e=>e.transfer),marketExits:exits.filter(e=>e.market).map(e=>e.transfer),nodes:n,edges:edges.length};
}
function verifyWitness(w){
  const net=Array(w.nodes).fill(0n);let target=0n;
  for(const e of w.edges){const flow=BigInt(e.flowRaw),cap=BigInt(e.capacityRaw);if(flow<0n||flow>cap)throw Error("Assignment exceeds edge capacity");net[e.u]-=flow;net[e.v]+=flow;if(e.selected)target+=flow;}
  if(net[0]!==-BigInt(w.sourceTotal)||net[1]!==BigInt(w.sourceTotal)||net.slice(2).some(v=>v!==0n)||target!==BigInt(w.targetRaw))throw Error("Assignment violates conservation");
  return true;
}
// Bounds of remaining shares under arbitrary mixing. Outflows can consume any
// shares; later unrelated mints do not restore previously lost cohort shares.
function retainedShares({address,wallet,receipts,entries,principalUpperRaw=null,market=C.MARKETS.USDD}) {
  const rows=walletRows(address,wallet,receipts).filter(r=>r.contract===market.jToken),now=BigInt(wallet.balances[market.jToken]);
  let opening=now;for(const r of rows){if(r.from===address)opening+=BigInt(r.amountRaw);if(r.to===address)opening-=BigInt(r.amountRaw);}if(opening<0n)throw Error("Share opening balance invalid");
  let balance=opening,lo=0n,hi=0n;const byTx=new Map(entries.filter(e=>e.mintTokens).map(e=>[e.txid,e])),outflows=[];
  const byTime=new Map();for(const r of rows){if(!byTime.has(r.blockTs))byTime.set(r.blockTs,[]);byTime.get(r.blockTs).push(r);}
  const batches=[...byTime.values()].sort((a,b)=>a[0].blockTs-b[0].blockTs);
  for(const batch of batches){for(const r of batch.filter(r=>r.to===address)){const amount=BigInt(r.amountRaw);balance+=amount;const e=byTx.get(r.txid);
      if(e&&r.from===market.jToken&&amount===BigInt(e.mintTokens)&&r.eventIndex>e.actionIndex){const minted=BigInt(e.amountRaw),lower=BigInt(e.attribution.lowerRaw),upper=BigInt(e.attribution.upperRaw);lo+=lower*amount/minted;hi+=min(amount,(upper*amount+minted-1n)/minted);}
    }
    for(const r of batch.filter(r=>r.from===address)){const amount=BigInt(r.amountRaw);outflows.push({txid:r.txid,to:r.to,amountRaw:r.amountRaw,blockTs:r.blockTs});balance-=amount;lo=lo>amount?lo-amount:0n;hi=min(hi,balance);}
    if(balance<0n)throw Error("Share balance becomes negative");
  }
  if(balance!==now)throw Error("Share balance does not reconcile");
  if(principalUpperRaw!==null){let cap=0n;for(const e of byTx.values()){const v=(BigInt(principalUpperRaw)*BigInt(e.mintTokens)+BigInt(e.amountRaw)-1n)/BigInt(e.amountRaw);if(v>cap)cap=v;}hi=min(hi,cap);}
  const rate=BigInt(wallet.positions[market.symbol].exchangeRateRaw);
  return {lowerSharesRaw:String(lo),upperSharesRaw:String(hi),wholeSharesRaw:String(now),lowerRaw:String(lo*rate/10n**18n),upperRaw:String(hi*rate/10n**18n),wholeRaw:String(now*rate/10n**18n),outflows};
}
module.exports={Flow,walletRows,buildFundGraph,retainedShares,verifyWitness,SCALE};
