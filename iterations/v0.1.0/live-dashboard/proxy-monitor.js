"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const E = "TFvGJpSNFsa3xiz8mYPKNDpFvrU43UrKCX";
const H = "TWYKaMvx6MzwLt12MWXDvANeC5d9n3uQH2";
const I = "TYRq8Y4UHbXuEHBif7WvrPHynxp7B6NMJ7";
const J = "TXJgMdjVX5dKiQaUi9QobwNxtSQaFqccvd";
const U = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const DAY = 86400000;
function parseRange(params = {}, now = Date.now()) {
  const hasSince = params.since != null, hasUntil = params.until != null;
  const until = hasUntil ? Date.parse(params.until) : now;
  const since = hasSince ? Date.parse(params.since) : until - 7 * DAY;
  if (hasSince !== hasUntil || !Number.isFinite(since) || !Number.isFinite(until)
    || since >= until || until - since > 30 * DAY || until > now) {
    throw new RangeError("请选择有效的起止时间，结束时间不能晚于现在，范围最长 30 天");
  }
  return { since, until };
}
function weekStart(now) {
  const china = new Date(now + 8 * 3600000);
  return Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate())
    - ((china.getUTCDay() + 6) % 7) * DAY - 8 * 3600000;
}
function normalize(r) {
  if (r.confirmed === false || r.finalResult === "FAILED" || r.contractRet && r.contractRet !== "SUCCESS") return null;
  if (![U, J].includes(r.contract_address) || !/^[0-9a-f]{64}$/i.test(r.transaction_id || "")
    || !/^\d+$/.test(String(r.quant)) || BigInt(r.quant) === 0n || !(Number(r.block_ts) > 0)) return null;
  return { txid: r.transaction_id, blockTs: Number(r.block_ts), from: r.from_address,
    to: r.to_address, contract: r.contract_address, raw: String(r.quant) };
}
const key = r => [r.txid,r.from,r.to,r.contract,r.raw].join(":");
const sum = rows => rows.reduce((n,r) => n + BigInt(r.raw), 0n);
const usdt = n => Number(n) / 1e6;
function analyze(rows, since, until) {
  rows = [...new Map(rows.filter(r => r.blockTs >= since && r.blockTs <= until).map(r => [key(r),r])).values()];
  const rights = rows.filter(r => r.from === E && r.contract === J && r.to !== J);
  const receivers = new Set(rights.map(r => r.to));
  const deposits = [], reentries = [], unclassified = [];
  for (const r of rows.filter(r => [E,H].includes(r.from) && r.to === J && r.contract === U)) {
    const same = rows.filter(t => t.txid === r.txid);
    const funding = same.filter(t => t.to === r.from && t.contract === U && t.from !== J);
    const minted = same.filter(t => t.contract === J && t.from === J && t.to === r.from);
    const item = { ...r, amount: usdt(BigInt(r.raw)), funders: [...new Set(funding.map(t => t.from))], funding,
      mintedRaw: String(sum(minted)), evidenceComplete: sum(funding) === BigInt(r.raw) && minted.length > 0 };
    if (r.from === E) deposits.push(item);
    else if (item.evidenceComplete && funding.every(t => receivers.has(t.from)
      && rights.some(q => q.to === t.from && q.blockTs < r.blockTs))) reentries.push(item);
    else unclassified.push(item);
  }
  deposits.sort((a,b) => b.blockTs-a.blockTs);
  const days = new Map();
  for (const r of deposits) {
    const day = new Date(r.blockTs+8*3600000).toISOString().slice(0,10);
    if (!days.has(day)) days.set(day,{date:day,count:0,raw:0n,addresses:new Set()});
    const d=days.get(day); d.count++; d.raw+=BigInt(r.raw); r.funders.forEach(a=>d.addresses.add(a));
  }
  return { deposits, reentries, unclassified, rights,
    summary: { depositCount:deposits.length, funderCount:new Set(deposits.flatMap(r=>r.funders)).size,
      inflowRaw:String(sum(deposits)), inflowUsdt:usdt(sum(deposits)), reentryCount:reentries.length,
      reentryUsdt:usdt(sum(reentries)), unclassifiedHUsdt:usdt(sum(unclassified)), receiverCount:receivers.size,
      unresolvedDeposits:deposits.filter(r=>!r.evidenceComplete).length },
    days:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(d=>({date:d.date,count:d.count,
      funderCount:d.addresses.size,amount:usdt(d.raw)})) };
}
function decodePosition(result) {
  const raw = result.constant_result?.[0];
  if (result.result?.result === false || !/^[0-9a-f]+$/i.test(raw || "") || raw.length < 256 || raw.length % 64) throw new Error("持仓查询返回格式异常");
  const words = raw.match(/.{64}/g).map(x=>BigInt("0x"+x));
  if (words[0] !== 0n || words.slice(4).some(x=>x!==0n) || words[3] <= 0n) throw new Error("持仓查询失败或汇率异常");
  return { jTokenRaw:String(words[1]), borrowRaw:String(words[2]), exchangeRateRaw:String(words[3]),
    underlyingRaw:String(words[1]*words[3]/10n**18n), underlyingUsdt:Number(words[1]*words[3]/10n**18n)/1e6 };
}
function createProxyMonitor({root,fetchJson,readPosition,refreshMs=300000,maxPages=40,apiBase="https://api.trongrid.io"}) {
  const file=path.join(root,"data/xinbi-proxy-snapshot.json");
  let snapshot=null,running=null,timer=null,lastError=null,stage="pending";
  async function scanTronScan(address,since,until) {
    const found=new Map(); let offset=0;
    for(let page=0;page<maxPages;page++) {
      const url=new URL("https://apilist.tronscanapi.com/api/token_trc20/transfers");
      url.search=new URLSearchParams({limit:"50",start:String(offset),sort:"-timestamp",relatedAddress:address,end_timestamp:String(until)});
      const d=await fetchJson(url.toString());
      if(!Array.isArray(d.token_transfers)) throw new Error("TronScan 转账响应缺失");
      const rows=d.token_transfers;
      if(rows.some(r=>!Number.isFinite(Number(r.block_ts)) || Number(r.block_ts)<=0)) throw new Error("转账时间无效，无法确认分页完整性");
      for(const r of rows) {const n=normalize(r);if(n && n.blockTs>=since && n.blockTs<=until)found.set(key(n),n);}
      if(!rows.length || rows.some(r=>Number(r.block_ts)<since)) return {address,provider:"TronScan",complete:true,pages:page+1,rows:[...found.values()]};
      offset+=rows.length;
    }
    return {address,provider:"TronScan",complete:false,pages:maxPages,rows:[...found.values()]};
  }
  async function scanGrid(address,since,until) {
    const found=new Map(),seen=new Set();let cursor="";
    for(let page=0;page<maxPages;page++) {
      const url=new URL(`/v1/accounts/${address}/transactions/trc20`,apiBase);
      url.search=new URLSearchParams({only_confirmed:"true",limit:"200",order_by:"block_timestamp,desc",
        min_timestamp:String(since),max_timestamp:String(until)});
      if(cursor)url.searchParams.set("fingerprint",cursor);
      const d=await fetchJson(url.toString());
      if(d.success===false || !Array.isArray(d.data))throw new Error("TronGrid 转账响应缺失");
      for(const r of d.data) {
        if(r.type!=="Transfer")continue;
        if(!(Number(r.block_timestamp)>0))throw new Error("转账时间无效");
        const n=normalize({transaction_id:r.transaction_id,block_ts:r.block_timestamp,from_address:r.from,to_address:r.to,
          contract_address:r.token_info?.address,quant:r.value,confirmed:r.confirmed});
        if(n&&n.blockTs>=since&&n.blockTs<=until)found.set(key(n),n);
      }
      const next=d.meta?.fingerprint;
      if(!next)return {address,provider:"TronGrid",complete:true,pages:page+1,rows:[...found.values()]};
      if(seen.has(next)||!d.data.length)throw new Error("TronGrid 分页游标异常");
      seen.add(next);cursor=next;
    }
    return {address,provider:"TronGrid",complete:false,pages:maxPages,rows:[...found.values()]};
  }
  async function scan(address,since,until) {
    try{return await scanGrid(address,since,until);}
    catch(error){return {...await scanTronScan(address,since,until),primaryError:error.message};}
  }
  async function run() {
    const until=Date.now(),since=until-30*DAY;stage="transfers";
    const scans=[];
    for(const a of [E,H]) scans.push(await scan(a,since,until));
    const analysis=analyze(scans.flatMap(s=>s.rows),since,until);
    stage="positions";const positions=[];
    for(const address of [E,H,I]) {
      try {positions.push({address,...await readPosition(J,address),status:"ok",checkedAt:new Date().toISOString()});}
      catch(error){positions.push({address,status:"error",error:error.message,checkedAt:new Date().toISOString()});}
    }
    const previous=new Set((snapshot?.deposits || []).map(r=>r.txid));
    const newDeposits=analysis.deposits.filter(r=>!previous.has(r.txid));
    snapshot={version:2,rows:scans.flatMap(s=>s.rows),generatedAt:new Date().toISOString(),since:new Date(since).toISOString(),until:new Date(until).toISOString(),
      addresses:{E,H,I,J},...analysis,positions,
      coverage:{complete:scans.every(s=>s.complete) && !analysis.summary.unresolvedDeposits,
        scans:scans.map(({rows,...s})=>s),balanceErrors:positions.filter(p=>p.status!=="ok").length},
      alert:{active:analysis.deposits.length>0,level:analysis.deposits.length?"warning":"none",
        newDepositCount:newDeposits.length,latestInflowAt:analysis.deposits[0]?.blockTs || null,
        reason:"共用代理 E 入金活动提示；不自动认定为新币资金。首次赎回不代表整条资金链退出。"},
      note:"所选时段经 E 入金不叠加已识别接收地址经 H 的再存流水；未完成跨资产及全部历史资金去重。E/H/I 持仓含混同资金，非所选时段或新币专属余额。"};
    await fs.mkdir(path.dirname(file),{recursive:true});
    await fs.writeFile(file+".tmp",JSON.stringify(snapshot),{mode:0o600});await fs.rename(file+".tmp",file);stage="idle";
  }
  function refresh() {
    if(running)return running;
    running=run().then(()=>{lastError=null;}).catch(e=>{lastError=e.message;stage="error";})
      .finally(()=>{running=null;});return running;
  }
  return {refresh,getSnapshot(params = {}) {
    const {since,until}=parseRange(params);
    // Old snapshots lack raw transfer legs and cannot be safely re-aggregated.
    const available=snapshot?.version===2 && Array.isArray(snapshot.rows);
    const analysis=analyze(available?snapshot.rows:[],since,until);
    const windowCovered=!!available && since>=Date.parse(snapshot.since) && since<=Date.parse(snapshot.until);
    const dataThrough=available?Math.min(until,Date.parse(snapshot.until)):null;
    return {...(snapshot || {}), rows:undefined, ...analysis,
      addresses:{E,H,I,J},positions:snapshot?.positions || [],
      since:new Date(since).toISOString(),until:new Date(until).toISOString(),
      dataThrough:dataThrough?new Date(dataThrough).toISOString():null,
      coverage:{...snapshot?.coverage,windowCovered,
        complete:windowCovered && snapshot.coverage.scans.every(s=>s.complete) && !analysis.summary.unresolvedDeposits},
      runtime:{running:!!running,stage,lastError,
        stale:!snapshot || Date.now()-Date.parse(snapshot.generatedAt)>900000}};
    },
    async start(){try{snapshot=JSON.parse(await fs.readFile(file,"utf8"));}catch(e){if(e.code!=="ENOENT")lastError=e.message;}
      refresh();timer=setInterval(refresh,Math.max(60000,refreshMs));timer.unref();},stop(){clearInterval(timer);}};
}
module.exports={E,H,I,J,U,parseRange,weekStart,normalize,analyze,decodePosition,createProxyMonitor};
