"use strict";
// Persistent association tracking. Association is not proof of ownership or provenance.
const ZERO = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
const valid = a => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a || "") && a !== ZERO;
const edgeKey = r => [r.txid,r.contract,r.from,r.to,r.raw].join(":");
const JUSDT = "TXJgMdjVX5dKiQaUi9QobwNxtSQaFqccvd";
const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const inScope = e => e.contract === USDT || e.contract === JUSDT;
function configuredMarkets(config) {
  return (config.watchedAddresses || []).some(m => m.enabled !== false && m.address === JUSDT && m.asset === "USDT")
    ? [{contract:JUSDT,symbol:"USDT",decimals:6,underlying:USDT,jDecimals:8}] : [];
}
function rootsFrom(analysis) {
  return [...analysis.deposits.flatMap(d => d.funders.map(address => ({address,blockTs:d.blockTs,txid:d.txid,role:"出资方"}))),
    ...analysis.rights.map(r => ({address:r.to,blockTs:r.blockTs,txid:r.txid,role:"权益接收方"}))].filter(r => valid(r.address));
}
function discover(state, roots, {blocked,maxAccounts=5000,maxHops=4}) {
  const accounts=state.accounts;
  let limited=false;
  const add=(address,since,depth) => {
    if (!valid(address) || blocked.has(address)) return;
    if (!accounts[address]) {
      if(Object.keys(accounts).length>=maxAccounts){limited=true;return;}
      accounts[address]={address,since,depth,positions:{}};
    } else {
      // An earlier path requires a history backfill, even for previously scanned addresses.
      if(since<accounts[address].since) accounts[address].scanUntil=null;
      accounts[address].since=Math.min(accounts[address].since,since);
      accounts[address].depth=Math.min(accounts[address].depth,depth);
    }
  };
  roots.forEach(r=>add(r.address,r.blockTs,0));
  for(let hop=0;hop<maxHops;hop++) for(const e of state.edges) {
    const parent=accounts[e.from];
    if(parent && e.blockTs>=parent.since && parent.depth<maxHops) add(e.to,e.blockTs,parent.depth+1);
  }
  state.addressLimitReached=limited;
}
async function updateTracking({previous,analysis,markets,scan,readPosition,blocked,until,
  transferBudget=40,positionBudget=300,maxAccounts=5000,maxHops=4,maxEdges=100000}) {
  markets=markets.filter(m=>m.contract===JUSDT).map(m=>({...m,symbol:"USDT",decimals:6,underlying:USDT,jDecimals:8}));
  if(!markets.length)throw new Error("USDT 市场未启用");
  const state=previous ? structuredClone(previous) : {accounts:{},edges:[],roots:[]};
  // Rebuild membership once when migrating the previously broader asset scope.
  const legacyAccounts=state.scope!=="USDT-jUSDT" ? state.accounts : null;
  state.edges=state.edges.filter(inScope);
  if(legacyAccounts)state.accounts={};
  state.roots=[...new Map([...state.roots,...rootsFrom(analysis)].map(r=>[[r.address,r.txid,r.role].join(":"),r])).values()];
  const options={blocked,maxAccounts,maxHops};
  discover(state,state.roots,options);
  if(legacyAccounts)for(const [address,a] of Object.entries(state.accounts)) {
    const old=legacyAccounts[address];
    if(old)state.accounts[address]={...old,...a,positions:old.positions?.[JUSDT]?{[JUSDT]:old.positions[JUSDT]}:{},
      scanUntil:null,scanComplete:false};
  }
  state.scope="USDT-jUSDT";
  const edges=new Map(state.edges.map(e=>[edgeKey(e),e]));
  const queue=Object.values(state.accounts).sort((a,b)=>(a.scanAttempt||0)-(b.scanAttempt||0)).slice(0,transferBudget);
  for(const account of queue) {
    account.scanAttempt=until;
    try {
      const result=await scan(account.address,account.scanUntil ? Math.max(account.since,account.scanUntil-60000) : account.since,until);
      account.scanComplete=result.complete; account.scanError=null;
      for(const e of result.rows) if(inScope(e) && e.from===account.address && valid(e.to)) {
        if(edges.size<maxEdges || edges.has(edgeKey(e))) edges.set(edgeKey(e),e);
        else state.edgeLimitReached=true;
      }
      if(result.complete) account.scanUntil=until;
    } catch(error) {account.scanComplete=false;account.scanError=error.message;}
  }
  state.edges=[...edges.values()].sort((a,b)=>a.blockTs-b.blockTs);
  discover(state,state.roots,options);
  const jobs=Object.values(state.accounts).flatMap(a=>markets.map(m=>({a,m,p:a.positions[m.contract]})))
    .sort((a,b)=>(a.p?.attemptedAt||0)-(b.p?.attemptedAt||0)).slice(0,positionBudget);
  for(const {a,m,p} of jobs) {
    try {
      if(!Number.isInteger(m.decimals)) throw new Error("市场资产精度未配置");
      const value=await readPosition(m.contract,a.address);
      if(!/^\d+$/.test(value.underlyingRaw || "") || !/^\d+$/.test(value.borrowRaw || "")) throw new Error("持仓原始金额缺失");
      a.positions[m.contract]={jTokenRaw:value.jTokenRaw,borrowRaw:value.borrowRaw,
        exchangeRateRaw:value.exchangeRateRaw,underlyingRaw:value.underlyingRaw,
        status:"ok",checkedAt:new Date().toISOString(),attemptedAt:until};
    } catch(error) {
      a.positions[m.contract]={status:"error",error:error.message,attemptedAt:until,
        lastGood:p?.status==="ok"?p:p?.lastGood};
    }
  }
  state.markets=markets; state.maxHops=maxHops;
  state.updatedAt=new Date().toISOString();
  return state;
}
function trackingView(state, analysis, {blocked,now=Date.now(),staleMs=900000}={}) {
  blocked=blocked || new Set();
  if(!state) return {ready:false,complete:false,rows:[],totals:[],note:"地址持仓队列尚未初始化，不能判断资金退出"};
  const scopedEdges=state.edges.filter(inScope);
  const members=new Map();
  for(const r of rootsFrom(analysis)) if(!blocked.has(r.address)) {
    const old=members.get(r.address);
    if(!old || r.blockTs<old.since) members.set(r.address,{since:r.blockTs,depth:0,role:r.role,txid:r.txid});
  }
  let hopLimited=false,stopped=0;
  for(let hop=0;hop<=state.maxHops;hop++) for(const e of scopedEdges) {
    const parent=members.get(e.from);
    if(!parent || e.blockTs<parent.since) continue;
    if(blocked.has(e.to)){continue;}
    if(parent.depth>=state.maxHops){if(!members.has(e.to))hopLimited=true;continue;}
    const old=members.get(e.to);
    if(!old || e.blockTs<old.since || parent.depth+1<old.depth)
      members.set(e.to,{since:Math.min(old?.since ?? Infinity,e.blockTs),depth:Math.min(old?.depth ?? Infinity,parent.depth+1),
        role:old?.role || "后续流向",upstream:e.from,txid:e.txid});
  }
  stopped=scopedEdges.filter(e=>members.has(e.from)&&e.blockTs>=members.get(e.from).since&&blocked.has(e.to)).length;
  const counts={addresses:members.size,queried:0,pending:0,failed:0,stale:0,transferPending:0,transferFailed:0};
  const totals=new Map(),rows=[];
  for(const [address,origin] of members) {
    const a=state.accounts[address];
    if(!a?.scanUntil || !a.scanComplete || now-a.scanUntil>staleMs) counts.transferPending++;
    if(a?.scanError)counts.transferFailed++;
    for(const m of state.markets.filter(m=>m.contract===JUSDT)) {
      const p=a?.positions[m.contract];
      const status=!p?"pending":p.status!=="ok"?"error":now-Date.parse(p.checkedAt)>staleMs?"stale":"ok";
      counts[{pending:"pending",error:"failed",stale:"stale",ok:"queried"}[status]]++;
      rows.push({address,...origin,market:m.contract,symbol:m.symbol,decimals:m.decimals,...p,status});
      if(!totals.has(m.contract))totals.set(m.contract,{market:m.contract,symbol:m.symbol,decimals:m.decimals,supply:0n,borrow:0n,covered:0});
      if(status==="ok") {const t=totals.get(m.contract);t.supply+=BigInt(p.underlyingRaw);t.borrow+=BigInt(p.borrowRaw);t.covered++;}
    }
  }
  return {ready:true,counts,rows,totals:[...totals.values()].map(t=>({market:t.market,symbol:t.symbol,decimals:t.decimals,
    supplyRaw:String(t.supply),borrowRaw:String(t.borrow),netRaw:String(t.supply-t.borrow),covered:t.covered,expected:members.size})),
    complete:!counts.pending&&!counts.failed&&!counts.stale&&!counts.transferPending&&!hopLimited&&!state.addressLimitReached&&!state.edgeLimitReached,
    hopLimited,addressLimitReached:state.addressLimitReached,edgeLimitReached:!!state.edgeLimitReached,stopped,
    attributedAmount:null,note:"按地址去重的 jUSDT 折算 USDT 存款余额，含历史及混同资金；本批资金可归因金额待核。公共平台及共用代理停止穿透，TRX 原生转账、换币和跨链后的同源追踪未覆盖。"};
}
module.exports={configuredMarkets,rootsFrom,updateTracking,trackingView};
