"use strict";
const C=require("./mexc-core"),F=require("./mexc-fund-flow");
const min=(a,b)=>a<b?a:b,ceil=(n,d)=>(n+d-1n)/d;
// A conservative, integer jUSDT envelope. The two entry Mints share one
// cash-cohort cap; their independent maxima must never be summed. Different
// Mint rates widen this envelope very slightly. Cash after Redeem is an exit,
// not automatically reintroduced as a new source. All lower claims stay zero.
function buildShareGraph({wallets,receipts,mints,cashRaw,since,router,market=C.MARKETS.USDT,mintCaps={}}){
  const rows=new Map(),openings={},groups=new Map(),nodes=new Map(),edges=[],exits=[];
  let n=3;const S=0,T=1,supply=2;
  for(const [a,w]of Object.entries(wallets)){
    if(!w.complete||w.balances[market.jToken]===undefined)throw Error("Incomplete share ledger: "+a);
    const rs=F.walletRows(a,w,receipts).filter(r=>r.contract===market.jToken&&r.blockTs>=since);
    let b=BigInt(w.balances[market.jToken]);for(const r of rs)b+=(r.from===a?BigInt(r.amountRaw):0n)-(r.to===a?BigInt(r.amountRaw):0n);
    if(b<0n)throw Error("Invalid share opening: "+a);openings[a]=String(b);
    for(const r of rs){rows.set(C.key(r),r);if(!groups.has(a))groups.set(a,new Map());const g=groups.get(a);if(!g.has(r.blockTs))g.set(r.blockTs,[]);g.get(r.blockTs).push(r);}
  }
  for(const [a,g]of groups){let previous=null,b=BigInt(openings[a]);for(const[ts,rs]of [...g].sort((a,b)=>a[0]-b[0])){const id=n++;nodes.set(`${a}:${ts}`,id);if(previous!==null)edges.push({u:previous,v:id,cap:b,kind:"carry"});for(const r of rs)b+=(r.to===a?BigInt(r.amountRaw):0n)-(r.from===a?BigInt(r.amountRaw):0n);if(b<0n)throw Error("Negative share ledger: "+a);previous=id;}exits.push({u:previous,cap:b,id:`end:${a}`,address:a,kind:"holding"});}
  const at=(a,r)=>nodes.get(`${a}:${r.blockTs}`),sourceKeys=new Map();let sourceTotal=0n;
  for(const m of mints){const r=receipts[m.txid]?.transfers.find(r=>r.contract===market.jToken&&r.from===market.jToken&&r.to===m.from&&r.amountRaw===m.mintTokens&&r.eventIndex>m.actionIndex);if(!r||!rows.has(C.key(r)))throw Error("Missing source Mint shares");const jointCap=min(BigInt(r.amountRaw),ceil(BigInt(cashRaw)*BigInt(m.mintTokens),BigInt(m.amountRaw))),cap=min(jointCap,ceil(BigInt(mintCaps[m.txid]??cashRaw)*BigInt(m.mintTokens),BigInt(m.amountRaw)));sourceKeys.set(C.key(r),cap);if(jointCap>sourceTotal)sourceTotal=jointCap;}
  sourceTotal=min(sourceTotal,[...sourceKeys.values()].reduce((s,c)=>s+c,0n));
  edges.push({u:S,v:supply,cap:sourceTotal,kind:"joint-cohort-cap"});
  const routed=new Set(),routes=[];
  for(const r of rows.values())if(r.to===router&&at(r.from,r)!==undefined){const all=receipts[r.txid].transfers.filter(x=>x.contract===market.jToken),ins=all.filter(x=>x.to===router),outs=all.filter(x=>x.from===router);
    if(ins.length!==1||outs.length!==1||outs[0].amountRaw!==r.amountRaw||outs[0].eventIndex<=r.eventIndex||at(outs[0].to,outs[0])===undefined)throw Error("Router pass-through is not closed");
    edges.push({u:at(r.from,r),v:at(outs[0].to,outs[0]),cap:BigInt(r.amountRaw),kind:"same-transaction-router",transfer:r});routed.add(C.key(r));routed.add(C.key(outs[0]));routes.push({incoming:r,outgoing:outs[0]});
  }
  for(const [id,r]of rows){const u=at(r.from,r),v=at(r.to,r),cap=BigInt(r.amountRaw);if(sourceKeys.has(id))edges.push({u:supply,v,cap:sourceKeys.get(id),kind:"source",transfer:r});if(u===undefined||routed.has(id))continue;if(v!==undefined)edges.push({u,v,cap,kind:"transfer",transfer:r});else exits.push({u,cap,id,kind:r.to===market.jToken?"redemption":"unresolved-transfer",transfer:r});}
  function solve(ids,mode){const selected=new Set(ids),flow=new F.Flow(n),refs=[];for(const e of edges)refs.push({...e,ref:flow.add(e.u,e.v,e.cap)});const add=e=>refs.push({...e,v:T,selected:selected.has(e.id),ref:flow.add(e.u,T,e.cap)});
    exits.filter(e=>selected.has(e.id)===(mode==="upper")).forEach(add);const first=flow.run(S,T);exits.filter(e=>selected.has(e.id)!==(mode==="upper")).forEach(add);if(first+flow.run(S,T)!==sourceTotal)throw Error("Share envelope is infeasible");
    const proof={extremum:mode,sourceTotal:String(sourceTotal),nodes:n,edges:refs.map(({cap,ref,...e})=>({...e,capacityRaw:String(cap),flowRaw:String(cap-ref.cap)}))};proof.targetRaw=String(proof.edges.filter(e=>e.selected).reduce((s,e)=>s+BigInt(e.flowRaw),0n));F.verifyWitness(proof);return proof;
  }
  return {sourceTotal:String(sourceTotal),openings,routes,exits:exits.map(({cap,...e})=>({...e,capacityRaw:String(cap)})),witness:solve,bounds(ids){return {lowerRaw:solve(ids,"lower").targetRaw,upperRaw:solve(ids,"upper").targetRaw};}};
}
module.exports={buildShareGraph,ceil};
