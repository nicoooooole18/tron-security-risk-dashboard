"use strict";
const crypto = require("node:crypto");
const { validAddress, precedes } = require("./xinbi-monitor");
const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const JUSDT = "TXJgMdjVX5dKiQaUi9QobwNxtSQaFqccvd";
const USDD = "TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz";
const JUSDD = "TKFRELGGoRgiayhwJTNNLqCNjFoLBh3Mnf";
const PSM = "TBXW4hS5KYjjbJXDpnrPf4zhkLwrpUjbyz";
const PSM_JOIN = "TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ";
const MARKETS = {USDT:{symbol:"USDT",underlying:USDT,jToken:JUSDT,decimals:6},USDD:{symbol:"USDD",underlying:USDD,jToken:JUSDD,decimals:18}};
const TOKENS = [USDT,JUSDT,USDD,JUSDD];
const ZERO = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
const DAY = 86400000;
const raw = x => /^\d+$/.test(String(x ?? ""));
const key = r => `${r.txid}:${r.contract}:${r.eventIndex ?? `${r.from}:${r.to}:${r.amountRaw}`}`;
const sum = rows => rows.reduce((n, r) => n + BigInt(r.amountRaw), 0n).toString();
function address(value) {
  if (validAddress(value)) return value;
  const hex = String(value || "").replace(/^0x/, "");
  if (!/^(41)?[a-fA-F0-9]{40}$/.test(hex)) return null;
  const body = Buffer.from(hex.length === 40 ? `41${hex}` : hex, "hex");
  const hash = crypto.createHash("sha256").update(crypto.createHash("sha256").update(body).digest()).digest();
  let n = BigInt(`0x${Buffer.concat([body, hash.subarray(0, 4)]).toString("hex")}`), out = "";
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  while (n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
  return out;
}
function validateSources(book) {
  if (book?.entity !== "mexc" || book.chain !== "tron" || !Array.isArray(book.addresses)) throw new Error("MEXC 地址清单格式无效");
  const seen = new Set();
  for (const row of book.addresses) {
    if (!validAddress(row.address) || row.address === ZERO || TOKENS.includes(row.address)
      || seen.has(row.address) || !["verified","predicted","removed"].includes(row.status)
      || !/^https:\/\/(intel\.)?arkm\.com\//.test(row.source || "") || !Number.isFinite(Date.parse(row.checkedAt))) {
      throw new Error("MEXC 地址或核验来源无效 / 重复");
    }
    seen.add(row.address);
  }
  return book;
}
function normalizeTransfer(r) {
  const contract = address(r.contract || r.token_info?.address);
  const from = address(r.from), to = address(r.to), amountRaw = String(r.amountRaw ?? r.value ?? "");
  const txid = r.txid || r.transaction_id, blockTs = Number(r.blockTs ?? r.block_timestamp);
  if (!TOKENS.includes(contract) || !from || !to || !raw(amountRaw) || BigInt(amountRaw) <= 0n
    || !/^[a-f0-9]{64}$/i.test(txid || "") || !Number.isFinite(blockTs) || blockTs <= 0
    || r.confirmed === false || (r.type && r.type !== "Transfer")) return null;
  const index = r.eventIndex ?? r.event_index;
  return { txid, from, to, contract, amountRaw, blockTs,
    eventIndex: index != null && /^\d+$/.test(String(index)) ? Number(index) : null };
}
function canonicalReceipt(txid, events, info) {
  if (info?.id !== txid || info.receipt?.result !== "SUCCESS" || !Number.isFinite(Number(info.blockTimeStamp))) {
    throw new Error("交易未在已确认链上成功执行");
  }
  const transfers = [], actions = [];
  for (const e of events) {
    if (e.transaction_id !== txid || e.confirmed === false || !Number.isInteger(e.event_index)
      || Number(e.block_timestamp) !== Number(info.blockTimeStamp)) throw new Error("交易事件标识 / 时间不一致");
    const contract = address(e.contract_address), r = e.result || {};
    if (e.event_name === "Transfer" && TOKENS.includes(contract)) {
      if(String(r.value ?? r.amount ?? r.wad)==="0")continue;
      const t = normalizeTransfer({txid,contract,from:r.from ?? r.src,to:r.to ?? r.dst,
        amountRaw:r.value ?? r.amount ?? r.wad,blockTs:info.blockTimeStamp,eventIndex:e.event_index});
      if (!t) throw new Error("Transfer 事件字段无效");
      transfers.push(t);
    } else if ([JUSDT,JUSDD].includes(contract) && ["Mint","Redeem","Borrow","RepayBorrow","LiquidateBorrow"].includes(e.event_name)
      || contract===PSM && ["SellGem","BuyGem"].includes(e.event_name)) {
      const result = {...r};
      for (const field of ["minter","redeemer","payer","borrower","liquidator"]) if (result[field]) result[field] = address(result[field]);
      actions.push({name:e.event_name,contract,result,eventIndex:e.event_index});
    }
  }
  // An event-index response can be empty or lag the solid receipt. Never cache that as complete.
  if(!Array.isArray(info.log))throw new Error("交易原始日志缺失");
  const transferTopic="ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  for(const [eventIndex,log] of info.log.entries()) {
    const contract=address(log.address);
    if(!TOKENS.includes(contract)||log.topics?.[0]?.toLowerCase()!==transferTopic)continue;
    if(!/^[0-9a-f]{64}$/i.test(log.data||""))throw new Error("原始 Transfer 金额格式错误");
    const amountRaw=BigInt(`0x${log.data}`).toString();if(amountRaw==="0")continue;
    const row=transfers.find(r=>r.eventIndex===eventIndex && r.contract===contract);
    if(!row || row.from!==address(log.topics[1]?.slice(-40)) || row.to!==address(log.topics[2]?.slice(-40)) || row.amountRaw!==amountRaw)throw new Error("交易事件索引尚未与原始日志一致");
  }
  return {txid,blockTs:Number(info.blockTimeStamp),transfers:[...new Map(transfers.map(r=>[key(r),r])).values()],actions};
}
// Recognise only verified PSM SellGem executions. A same-transaction receipt must
// connect the payer's USDT to the PSM and the minted USDD back to that payer.
// An arbitrary AMM payment or a cross-transaction equal amount is not a conversion proof.
function conversions(receipts) {
  const out=new Map();
  for(const r of Object.values(receipts)) {
    const legs=r.transfers||[];
    for(const action of r.actions||[]) {
      if(action.contract!==PSM||action.name!=="SellGem"||!raw(action.result.value)||String(action.result.fee)!=="0")continue;
      const value=String(action.result.value),owner=address(action.result.owner);
      const joined=legs.find(t=>t.contract===USDT&&t.from===owner&&t.to===PSM_JOIN&&t.amountRaw===value);
      const minted=legs.find(t=>t.contract===USDD&&t.from===ZERO&&t.to===owner&&BigInt(t.amountRaw)===BigInt(value)*10n**12n);
      if(!joined||!minted||joined.eventIndex>=minted.eventIndex)continue;
      function connected(token,from,to,start,end,visited=new Set()) {
        if(from===to)return true;
        if(visited.has(from)||visited.size>=8)return false;
        for(const t of legs)if(t.contract===token&&t.from===from&&t.eventIndex>=start&&t.eventIndex<=end
          &&BigInt(t.amountRaw)>=(token===USDT?BigInt(value):BigInt(minted.amountRaw))
          &&connected(token,t.to,to,t.eventIndex+1,end,new Set([...visited,from])))return true;
        return false;
      }
      for(const received of legs.filter(t=>t.contract===USDD&&t.eventIndex>=minted.eventIndex&&BigInt(t.amountRaw)>=BigInt(minted.amountRaw))) {
        const paid=legs.find(t=>t.contract===USDT&&t.from===received.to&&t.amountRaw===value&&t.eventIndex<joined.eventIndex+1);
        if(paid&&(paid===joined||connected(USDT,paid.to,owner,paid.eventIndex+1,joined.eventIndex))
          &&(received===minted||connected(USDD,owner,received.from,minted.eventIndex+1,received.eventIndex))) {
          out.set(key(received),{paid,received,psm:PSM,principalRaw:value,txid:r.txid});
        }
      }
    }
  }
  return out;
}
function reverseConversions(receipts) {
  const out=new Map();
  for(const r of Object.values(receipts))for(const a of r.actions||[]){
    if(a.contract!==PSM||a.name!=="BuyGem"||!raw(a.result.value)||String(a.result.fee)!=="0")continue;
    const owner=address(a.result.owner),value=String(a.result.value),dd=String(BigInt(value)*10n**12n),legs=r.transfers||[];
    const paid=legs.find(t=>t.contract===USDD&&t.from===owner&&t.to===PSM&&t.amountRaw===dd);
    const burn=legs.find(t=>t.contract===USDD&&t.from===PSM&&t.to===ZERO&&t.amountRaw===dd);
    const received=legs.find(t=>t.contract===USDT&&t.from===PSM_JOIN&&t.to===owner&&t.amountRaw===value);
    if(!paid||!burn||!received||!(paid.eventIndex<burn.eventIndex&&burn.eventIndex<received.eventIndex&&received.eventIndex<a.eventIndex))continue;
    out.set(key(received),{paid,received,psm:PSM,principalRaw:value,txid:r.txid,direction:"USDD-USDT"});
  }
  return out;
}
function analyze({transfers=[], receipts={}, sources, accountTypes={}, hubs=new Set(), since=0, until=Date.now(), maxVisits=50000,market=MARKETS.USDT}) {
  const underlying=market.underlying,jToken=market.jToken;
  validateSources(sources);
  const seeds = new Set(sources.addresses.filter(s=>s.status==="verified").map(s=>s.address));
  // A complete receipt replaces account-index rows, preserving identical transfers at different log indices.
  const map = new Map();
  for (const r of transfers) if (!receipts[r.txid]) map.set(key(r),r);
  for (const receipt of Object.values(receipts)) for (const r of receipt.transfers) map.set(key(r),r);
  const rows=[...map.values()].filter(r=>r.blockTs<=until), incoming=new Map();
  for(const r of rows) if([USDT,underlying].includes(r.contract)){if(!incoming.has(r.to))incoming.set(r.to,[]);incoming.get(r.to).push(r);}
  const swaps=underlying===USDD?conversions(receipts):new Map();
  for(const list of incoming.values())list.sort((a,b)=>b.blockTs-a.blockTs || (b.eventIndex??0)-(a.eventIndex??0));
  let visits=0, graphLimited=false;
  // The same upstream transfer is revisited by many later deposits. Cache only
  // an identical search context: the transfer, hop budget and visited addresses.
  // This preserves chronology/cycle checks and never caches a truncated result.
  const traceCache=new Map();
  const boundaries=new Set();
  function trace(last, wallets=0, seen=new Set(), depth=0) {
    const cacheKey=`${key(last)}:${wallets}:${depth}:${[...seen].sort().join(",")}`;
    if(traceCache.has(cacheKey))return traceCache.get(cacheKey);
    if(graphLimited)return null;
    const result=traceUncached(last,wallets,seen,depth);
    if(!graphLimited&&traceCache.size<100000)traceCache.set(cacheKey,result);
    return result;
  }
  function traceUncached(last, wallets, seen, depth) {
    if(++visits>maxVisits){graphLimited=true;return null;}
    if(seeds.has(last.from))return [last];
    if(depth>=8 || seen.has(last.from) || [JUSDT,JUSDD,ZERO].includes(last.from))return null;
    if(hubs.has(last.from)){boundaries.add(last.from);return null;}
    const kind=accountTypes[last.from];
    if(!["wallet","contract"].includes(kind)){boundaries.add(last.from);return null;}
    if(kind==="wallet" && wallets>=2)return null;
    const visited=new Set([...seen,last.from]);
    for(const prior of incoming.get(last.from)||[]) {
      if(prior.contract!==last.contract||prior.blockTs<since || !precedes(prior,last))continue;
      const swap=swaps.get(key(prior));
      if(swap && kind==="wallet") {
        // The payer and recipient are the same wallet: do not count it twice.
        const path=trace(swap.paid,wallets,seen,depth+1);
        if(path)return [...path,prior,last];
        if(graphLimited)return null;
      }
      // Arbitrary contracts may relay only evidence from this same execution.
      if(kind==="contract" && prior.txid!==last.txid)continue;
      const path=trace(prior,wallets+(kind==="wallet"?1:0),visited,depth+1);
      if(path)return [...path,last];
      if(graphLimited)return null;
    }
    return null;
  }
  const events=[];
  for(const r of rows.filter(r=>r.contract===underlying && r.to===jToken && r.from!==jToken && r.blockTs>=since)) {
    const evidence=trace(r);if(!evidence)continue;
    const receipt=receipts[r.txid];
    // Pair an action to its nearest matching preceding transfer, not every equal amount in the transaction.
    const matchesAction=(a,name,actor,amount)=>a.name===name && (a.contract||JUSDT)===jToken && a.result[actor]===r.from && String(a.result[amount])===r.amountRaw
      && Number.isInteger(r.eventIndex) && a.eventIndex>r.eventIndex
      && !receipt.transfers.some(t=>t.contract===underlying && t.to===jToken && t.from===r.from && t.amountRaw===r.amountRaw && t.eventIndex>r.eventIndex && t.eventIndex<a.eventIndex);
    const mint=receipt?.actions.find(a=>matchesAction(a,"Mint","minter","mintAmount"));
    const repaid=receipt?.actions.find(a=>matchesAction(a,"RepayBorrow","payer","repayAmount"));
    const kind=evidence.some(e=>swaps.has(key(e)))?"conversion":evidence.length===1?"direct":evidence.some(e=>accountTypes[e.from]==="contract")?"contract":"wallet";
    const dust=evidence.some(e=>BigInt(e.amountRaw)<=(e.contract===USDD?10n**18n:1000000n));
    events.push({...r,id:key(r),kind,evidence,source:evidence[0].from,dust,asset:market.symbol,decimals:market.decimals,jToken,
      operation:mint?"Mint":repaid?"RepayBorrow":receipt?"Transfer":"pending",
      verified:Boolean(receipt),attributedRaw:kind==="direct"?r.amountRaw:null,
      actionIndex:mint?.eventIndex??repaid?.eventIndex??null,
      mintTokens:mint && raw(mint.result.mintTokens)?String(mint.result.mintTokens):null,
      note:kind==="direct"?"已知 MEXC 标签地址直接转入；不代表资金违法。":kind==="conversion"?"已核验同笔 PSM 换币及后续存入路径；混同资金的来源本金仍需复核。":"时间有序的同资产关联路径；混同资金的可归因金额未知。"});
  }
  events.sort((a,b)=>b.blockTs-a.blockTs);
  return {events,rows,boundaries:[...boundaries],graphLimited,graphVisits:visits};
}
function trackRights({events,rows,receipts,members={},accountTypes={},hubs=new Set(),maxMembers=1000,maxHops=4,market=MARKETS.USDT}) {
  const underlying=market.underlying,jToken=market.jToken;
  members=structuredClone(members);const rights=[],redemptions=[],ambiguous=[],anchors=new Map();let limited=false,memberCount=Object.keys(members).length;
  const add=(a,edge,depth,origin)=>{
    if(a===ZERO || a===jToken || hubs.has(a))return;
    if(!members[a] && memberCount>=maxMembers){limited=true;return;}
    const k=`${a}:${edge.txid}`,anchor=anchors.get(k);
    if(!anchor || precedes(edge,anchor.edge))anchors.set(k,{address:a,edge,depth,origin});
    if(!members[a])memberCount++;
    if(!members[a] || precedes(edge,members[a].edge))members[a]={address:a,edge,depth,origin};
  };
  for(const e of events.filter(e=>e.operation==="Mint" && e.mintTokens)) {
    const transfers=receipts[e.txid]?.transfers||[];
    const nextDeposit=Math.min(Infinity,...transfers.filter(r=>r.contract===underlying&&r.from===e.from&&r.to===jToken&&r.eventIndex>e.eventIndex).map(r=>r.eventIndex));
    // JustLend emits Mint before its jUSDT Transfer. Pair within this deposit's segment, supporting either event order.
    const mint=transfers.filter(r=>r.contract===jToken && r.to===e.from
      && [jToken,ZERO].includes(r.from) && r.amountRaw===e.mintTokens && r.eventIndex>e.eventIndex && r.eventIndex<nextDeposit)
      .sort((a,b)=>Math.abs(a.eventIndex-e.actionIndex)-Math.abs(b.eventIndex-e.actionIndex))[0];
    if(mint)add(e.from,mint,0,e.id);
  }
  const ordered=rows.filter(r=>r.contract===jToken).sort((a,b)=>a.blockTs-b.blockTs || (a.eventIndex??0)-(b.eventIndex??0));
  for(const r of ordered) {
    let m=members[r.from];if(!m || !precedes(m.edge,r) || hubs.has(r.from))continue;
    if(accountTypes[r.from]!=="wallet") {
      const sameTx=anchors.get(`${r.from}:${r.txid}`);
      if(sameTx && precedes(sameTx.edge,r))m=sameTx;
      else {
      if(r.amountRaw===m.edge.amountRaw)ambiguous.push({...r,kind:"contract-review",origin:m.origin});
      continue;
      }
    }
    if(r.to===jToken || r.to===ZERO) {
      const action=receipts[r.txid]?.actions.find(a=>a.name==="Redeem" && (a.contract||JUSDT)===jToken && a.result.redeemer===r.from
        && String(a.result.redeemTokens)===r.amountRaw && raw(a.result.redeemAmount));
      redemptions.push({...r,kind:action?"redeem":"redeem-candidate",underlyingRaw:action?String(action.result.redeemAmount):null,origin:m.origin});
      continue;
    }
    if(m.depth>=maxHops){limited=true;continue;}
    rights.push({...r,kind:"rights",origin:m.origin});
    add(r.to,r,m.depth+1,m.origin);
  }
  return {members,rights,redemptions,ambiguous,limited};
}
module.exports={USDT,JUSDT,USDD,JUSDD,PSM,PSM_JOIN,MARKETS,TOKENS,ZERO,DAY,key,sum,raw,address,validAddress,precedes,validateSources,normalizeTransfer,canonicalReceipt,conversions,reverseConversions,analyze,trackRights};
