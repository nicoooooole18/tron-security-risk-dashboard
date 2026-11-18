"use strict";
const path=require("node:path"),C=require("./mexc-core"),F=require("./mexc-fund-flow"),{readJson,atomicJson}=require("./mexc-monitor"),D=require("./mexc-usdt-collect");
const [TKS,TM9,TMM,TD27,TN3,TXT,TWT]=D.CORE,TPM="TPmNgtjWzk3YMCL5F89jchtM8gefc1VWwF",TEA="TEAq2LxMXNTZ3ET7StNWMPf3PZxWqzq9qQ",POOL="TEr2uAVsgpCFCmon4xGaCMj9KeG8zm21z6",TD7="TD7fM22Lt7Ai6zDyUHGKoW24kvZUg37uxE",TJR="TJRoD5bgZKGYQjSCmA7ciZrMwc5nvDxL7D",TLY="TLYGQZhWki4XJXw4meEGUYrJW3d4BgNNDh";
const TX={redeem:"980b4e25dbcfabbc1f96825e4ac9fab1c54fcb9babc6d67dd2663c83b9546b06",toTpm:"01548d6a438f9eaf9c8749265dc81c1d024e2d51ee97e83cc50a8d39745513cc",sell:"bbacb3904cd56102986594881e3192ed3c27e3ffb9718dfc27c865e1922a6e60",buy1:"514f9455a040e69eba82c7548c57295f4e67cfcf2e7b8ca278be205d4790924f",buy2:"15b9fd5cfd6da4a5e2792d3d34fa18ef35451985a05b2848748aa00fa4115f92",mint1:"9ba4aadc3c374de4e9e2926eaaa1e36c474573ae5275867bfb067e7da0eda30b",mint2:"4515cbe45ef292ee66057ca2a283b0d989ff709d465eca23e0fe18c857631ce6",laterRedeem:"02556827ee776d7b9792e9eb56545b4c938c4a7e8c69bebb8311db95a4eecc3f",sun:"dba496b9a692965154289a7453383bada920e8acdfa8e0625174fe976b4bfaaf"};
const sum=(rs,f)=>String(rs.reduce((s,r)=>s+BigInt(f(r)),0n)),down=n=>String(BigInt(n)/F.SCALE),up=n=>String((BigInt(n)+F.SCALE-1n)/F.SCALE),ceil=(n,d)=>(n+d-1n)/d;
function mintEntry(r,receipts){
  const m=Object.values(C.MARKETS).find(m=>m.underlying===r.contract&&m.jToken===r.to),receipt=receipts[r.txid];
  const action=receipt?.actions.find(a=>a.contract===m?.jToken&&a.name==="Mint"&&C.address(a.result.minter)===r.from&&String(a.result.mintAmount)===r.amountRaw&&a.eventIndex>r.eventIndex);
  const shares=receipt?.transfers.find(t=>t.contract===m?.jToken&&t.from===m.jToken&&t.to===r.from&&t.amountRaw===String(action?.result.mintTokens)&&t.eventIndex>action.eventIndex);
  if(!m||!action||!shares)throw Error("缺少 Mint 回执: "+r.txid);
  return {...r,asset:m.symbol,operation:"Mint",mintTokens:shares.amountRaw,actionIndex:action.eventIndex};
}
function redeemEntry(r,receipts){
  const market=Object.values(C.MARKETS).find(m=>r.contract===m.underlying&&r.from===m.jToken),receipt=receipts[r.txid],j=receipt?.transfers.find(t=>t.contract===market?.jToken&&t.from===r.to&&t.to===market.jToken),action=receipt?.actions.find(a=>a.name==="Redeem"&&a.contract===market?.jToken&&C.address(a.result.redeemer)===r.to&&String(a.result.redeemAmount)===r.amountRaw&&String(a.result.redeemTokens)===j?.amountRaw);
  // JustLend pays underlying first, emits the jToken return, then Redeem.
  if(!market||!action||!j||!(r.eventIndex<j.eventIndex&&j.eventIndex<action.eventIndex))throw Error("Redeem 证据不闭合: "+r.txid);
  return {...r,redeemTokens:j.amountRaw,actionIndex:action.eventIndex};
}
function discoverReturns(probes,index,receipts){
  if(!probes.probedAt||Object.keys(probes.errors||{}).length||Object.values(probes.probes).some(p=>!p.done&&!p.boundary||p.limited))throw Error("回流探查未完成");
  if(index.markets.length!==2||index.markets.some(m=>!m.complete||m.until<probes.probeUntil))throw Error("市场回流索引覆盖不足");
  const terminals=index.markets.flatMap(m=>m.rows.map(C.normalizeTransfer).filter(Boolean)),routes=new Map();
  const canonical=r=>{const t=receipts[r.txid]?.transfers.find(t=>["from","to","contract","amountRaw","blockTs"].every(k=>t[k]===r[k]));if(!t)throw Error("回流路径缺少标准回执: "+r.txid);return t;};
  for(const probe of Object.values(probes.probes))for(const end of terminals.filter(t=>t.from===probe.address))for(const p of probe.parents.filter(p=>p.blockTs<end.blockTs)){
    const key=[p.from,probe.address,probe.address].join(":");if(!routes.has(key))routes.set(key,{origin:p.from,via:probe.address,destination:probe.address,parents:[],edges:[],terminals:[]});const route=routes.get(key);
    for(const [list,r]of [[route.parents,canonical(p)],[route.terminals,mintEntry(canonical(end),receipts)]])if(!list.some(x=>C.key(x)===C.key(r)))list.push(r);
  }
  for(const probe of Object.values(probes.probes))for(const raw of probe.rows||[]){const e=C.normalizeTransfer(raw);if(!e||![C.USDT,C.USDD].includes(e.contract))continue;
    const parents=probe.parents.filter(p=>p.blockTs<e.blockTs),ends=terminals.filter(t=>t.from===e.to&&t.blockTs>e.blockTs);if(!parents.length||!ends.length)continue;
    for(const p of parents)for(const end of ends){const key=[p.from,e.from,end.from].join(":");if(!routes.has(key))routes.set(key,{origin:p.from,via:e.from,destination:end.from,parents:[],edges:[],terminals:[]});
      const route=routes.get(key);for(const [list,r]of [[route.parents,canonical(p)],[route.edges,canonical(e)],[route.terminals,mintEntry(canonical(end),receipts)]])if(!list.some(x=>C.key(x)===C.key(r)))list.push(r);
    }
  }
  return [...routes.values()];
}
function buildUSDTDeepening({review,audit,extra,candidates,probes,index,book}){
  if([audit,extra,candidates].some(d=>!d?.collectedAt||d.since!==Date.parse(review.since)||d.entryUntil!==Date.parse(review.until)))throw Error("USDT 专项完整回执或固定窗口不一致");
  if(require("node:crypto").createHash("sha256").update(JSON.stringify(C.validateSources(book))).digest("hex").slice(0,16)!==review.sourceVersion)throw Error("MEXC 来源清单版本已变化");
  const result=structuredClone(review),wallets={...audit.wallets,...extra.wallets,...candidates.wallets},receipts={...audit.receipts,...extra.receipts,...candidates.receipts},proof={},focus=[];
  const pick=as=>Object.fromEntries(as.map(a=>{if(!wallets[a]?.complete)throw Error("不完整钱包: "+a);return [a,wallets[a]];}));
  const graphs={};
  for(const [a,upstream]of [[TKS,[]],[TM9,[TD27]],[TMM,[TN3,TXT,TWT]]]){
    const graph=F.buildFundGraph({wallets:pick([a,...upstream]),receipts,sources:book,since:audit.since,until:audit.entryUntil}),es=review.entries.filter(e=>e.asset==="USDT"&&e.from===a),ids=es.map(C.key),b=graph.bounds(ids),g=review.groups.find(g=>g.id===`USDT:${a}`);
    // A change requires the cross-asset joint principal review to run again.
    if(down(b.lowerRaw)!==g.lowerRaw||up(b.upperRaw)!==g.upperRaw)throw Error("来源区间已变化，需重算联合本金: "+a);
    graphs[a]=graph;proof[a]={lower:graph.witness(ids,"lower"),upper:graph.witness(ids,"upper"),openings:graph.openings};
    const funds=[a,...upstream].map(address=>{const rs=F.walletRows(address,wallets[address],receipts).filter(r=>r.contract===C.USDT&&r.blockTs<=audit.entryUntil),sources=graph.sources.filter(r=>r.to===address),sub=F.buildFundGraph({wallets:pick([a,...upstream]),receipts,sourceTransfers:sources,since:audit.since,until:audit.entryUntil}).bounds(ids);return {address,openingRaw:down(graph.openings[`${address}:${C.USDT}`]),incomingRaw:sum(rs.filter(r=>r.to===address),r=>r.amountRaw),outgoingRaw:sum(rs.filter(r=>r.from===address),r=>r.amountRaw),verifiedMexcRaw:sum(sources,r=>r.amountRaw),sourceContributionLowerRaw:down(sub.lowerRaw),sourceContributionUpperRaw:up(sub.upperRaw)};});
    focus.push({address:a,upstream,lowerRaw:g.lowerRaw,upperRaw:g.upperRaw,sourceCount:graph.sources.length,sourceRaw:down(graph.sourceTotal),funds,endpointProof:true,
      note:a===TKS?"直接收到 MEXC 来款，但存入前后与其他大量资金混同；不能把 MEXC 全部来款视作该笔存款。":a===TM9?"33,083 USDT 经 TD27 转入；TD27 有期初余额及其他来款，完整收支同时容许零归因和全额归因。":"本批来源上限来自 TN3 与 TWT 路径；TXt 来款对本批贡献上限为零。9 笔存款共享来源，不逐笔累加。"});
  }
  const jointGraph=F.buildFundGraph({wallets:pick(D.CORE),receipts,sources:book,since:audit.since,until:audit.entryUntil}),jointIds=review.entries.filter(e=>e.asset==="USDT"&&[TKS,TM9,TMM].includes(e.from)).map(C.key),joint=jointGraph.bounds(jointIds);
  if(down(joint.lowerRaw)!==sum(focus,g=>g.lowerRaw)||up(joint.upperRaw)!==sum(focus,g=>g.upperRaw))throw Error("三组联合来源上限发生重叠，需重算汇总");
  proof.jointFocus={lower:jointGraph.witness(jointIds,"lower"),upper:jointGraph.witness(jointIds,"upper")};
  // Refresh the original wallet cohorts without equating wallet closure with
  // closure of every redeemed-cash descendant.
  for(const a of [TKS,TM9,TMM,TLY]){const p=result.retention.find(p=>p.address===a&&p.asset==="USDT"),g=result.groups.find(g=>g.id===`USDT:${a}`),w=wallets[a];
    const es=result.entries.filter(e=>e.from===a&&e.asset==="USDT"&&e.operation==="Mint").map(e=>({...e,attribution:{lowerRaw:"0",upperRaw:String(BigInt(g.upperRaw)<BigInt(e.amountRaw)?BigInt(g.upperRaw):BigInt(e.amountRaw))}}));
    Object.assign(p,F.retainedShares({address:a,wallet:w,receipts,entries:es,principalUpperRaw:g.upperRaw,market:C.MARKETS.USDT}),{asOf:new Date(w.asOf.timestamp).toISOString(),checkedAt:w.checkedAt});
    if([TM9,TMM].includes(a)){p.status="wallet-closed";p.note="原钱包 jUSDT 余额为零；赎回资金存在后续回流路径，不能据此认定全协议留存为零。";}
  }
  const take=(id,filter)=>{const r=receipts[id]?.transfers.find(filter);if(!r)throw Error("专项证据缺失: "+id);return r;};
  const red=redeemEntry(take(TX.redeem,r=>r.contract===C.USDT&&r.to===TM9),receipts),mints=[TX.mint1,TX.mint2].map(id=>mintEntry(take(id,r=>r.contract===C.USDT&&r.to===C.JUSDT),receipts));
  if(!C.conversions(receipts).has(C.key(take(TX.sell,r=>r.contract===C.USDD))))throw Error("缺少 SellGem 证明");
  const reversals=C.reverseConversions(receipts);for(const id of [TX.buy1,TX.buy2])if(!reversals.has(C.key(take(id,r=>r.contract===C.USDT))))throw Error("缺少 BuyGem 证明");
  const cashGraph=F.buildFundGraph({wallets:pick([TM9,TPM,TEA]),receipts,since:audit.since,until:Math.min(...[TM9,TPM,TEA].map(a=>wallets[a].through)),sourceTransfers:[red],includeBuyGem:true});
  const cashBounds=cashGraph.bounds(mints.map(C.key));proof.tm9Cash={lower:cashGraph.witness(mints.map(C.key),"lower"),upper:cashGraph.witness(mints.map(C.key),"upper")};
  const poolTransfers=F.walletRows(TEA,wallets[TEA],receipts).filter(r=>r.contract===C.JUSDT&&r.from===TEA&&r.to===POOL&&r.blockTs>=mints[0].blockTs);
  if(!poolTransfers.length)throw Error("缺少跨交易合约边界证据");
  const routes=discoverReturns(probes,index,receipts),tmmEntries=review.entries.filter(e=>e.from===TMM&&e.operation==="Mint"),tmmRows=F.walletRows(TMM,wallets[TMM],receipts);
  const redemptions=tmmRows.filter(r=>r.contract===C.USDT&&r.from===C.JUSDT&&r.to===TMM&&r.blockTs>=Math.min(...tmmEntries.map(e=>e.blockTs))&&receipts[r.txid].actions.some(a=>a.name==="Redeem"&&a.contract===C.JUSDT)).map(r=>redeemEntry(r,receipts));
  const returnWallets=pick([TD7,TJR,TLY]),parentTransfers=routes.filter(r=>r.origin===TMM&&r.destination===TLY).flatMap(r=>r.parents);
  const parents=[...new Map(parentTransfers.map(r=>[C.key(r),r])).values()],seeds=new Set(book.addresses.filter(a=>a.status==="verified").map(a=>a.address));
  const knownSources=Object.entries(returnWallets).flatMap(([a,w])=>F.walletRows(a,w,receipts).filter(r=>r.contract===C.USDT&&seeds.has(r.from))),limits={};
  // Cap each possible returned-cash source by original principal that could
  // have entered before that payment, with a conservative accrued-interest
  // allowance from observed Mint / Redeem ratios. This is an upper envelope,
  // not proof of identity. Its mathematical lower bound must not be promoted.
  for(const p of parents){const earlier=tmmEntries.filter(e=>e.blockTs<p.blockTs),b=graphs[TMM].bounds(earlier.map(C.key));let shares=0n;
    for(const e of earlier){const n=ceil(BigInt(up(b.upperRaw))*BigInt(e.mintTokens),BigInt(e.amountRaw));if(n>shares)shares=n;}
    let cap=BigInt(up(b.upperRaw));for(const r of redemptions.filter(r=>r.blockTs<p.blockTs)){
      const value=ceil(shares*BigInt(r.amountRaw),BigInt(r.redeemTokens));if(value>cap)cap=value;
    }limits[C.key(p)]=String(cap*F.SCALE);
  }
  const familyCap=Object.values(limits).reduce((max,n)=>BigInt(n)>max?BigInt(n):max,0n)+BigInt(review.groups.find(g=>g.address===TLY&&g.asset==="USDT").upperRaw)*F.SCALE;
  const returnGraph=F.buildFundGraph({wallets:returnWallets,receipts,since:audit.since,until:Math.min(...Object.values(returnWallets).map(w=>w.through)),sourceTransfers:[...knownSources,...parents],sourceLimits:limits,sourceCapRaw:familyCap,includeBuyGem:true});
  const tlyMints=returnGraph.marketExits.filter(r=>r.from===TLY).map(r=>{const e=mintEntry(r,receipts),b=returnGraph.bounds([C.key(r)]);return {...e,attribution:{lowerRaw:"0",upperRaw:up(b.upperRaw)}};});
  const tlyBounds=returnGraph.bounds(tlyMints.map(C.key)),tlyRetention=F.retainedShares({address:TLY,wallet:wallets[TLY],receipts,entries:tlyMints,principalUpperRaw:up(tlyBounds.upperRaw),market:C.MARKETS.USDT});
  const originalTly=result.retention.find(p=>p.address===TLY&&p.asset==="USDT"),oldTlyUpper=originalTly.upperRaw;
  Object.assign(originalTly,tlyRetention,{status:"mixed",includesReturnFrom:TMM,originalCohortUpperRaw:oldTlyUpper,note:"含 TMM 赎回后经 TJRo / TD7 的可能回流；为保守留存上限，下限仍为零。TD7 的 10 USDT 与原路径在同一账本去重，不另加一次。"});
  proof.tlyReturn={upper:returnGraph.witness(tlyMints.map(C.key),"upper"),sourceLimits:limits,sharedCashCapRaw:String(familyCap),originalWalletUpperRaw:oldTlyUpper};
  const usdtSuspect=BigInt(result.totals.sameAssetUpperRaw)-BigInt(result.totals.sameAssetLowerRaw),focusTotal=BigInt(sum(focus,g=>BigInt(g.upperRaw)-BigInt(g.lowerRaw)));
  result.usdtDeepening={version:1,checkedAt:new Date().toISOString(),since:review.since,entryUntil:review.until,suspectedUpperRaw:String(usdtSuspect),focusUpperRaw:String(focusTotal),otherUpperRaw:String(usdtSuspect-focusTotal),principalReductionRaw:"0",newConfirmedRaw:"0",focus:focus.map(g=>({...g,retention:result.retention.find(p=>p.address===g.address&&p.asset==="USDT")})),
    tm9:{address:TM9,redeemedRaw:red.amountRaw,cashReturnLowerRaw:down(cashBounds.lowerRaw),cashReturnUpperRaw:up(cashBounds.upperRaw),mexcReturnLowerRaw:"0",mexcReturnUpperRaw:up(cashBounds.upperRaw),grossReentryRaw:sum(mints,r=>r.amountRaw),mints,swapProofs:[TX.sell,TX.buy1,TX.buy2],pool:POOL,poolTransfers,laterRedeem:take(TX.laterRedeem,r=>r.contract===C.USDT&&r.to===TEA),
      timeline:[{label:"TM9 赎回",...red},{label:"转给 TPm",...take(TX.toTpm,r=>r.contract===C.USDT)},{label:"USDT 经 PSM 换为 USDD",...take(TX.sell,r=>r.contract===C.USDT)},...F.walletRows(TPM,wallets[TPM],receipts).filter(r=>r.from===TPM&&r.to===TEA).map(r=>({label:"USDD 转入 TEAq",...r})),...mints.map(r=>({label:"换回 USDT 后再次存入",...r}))].sort((a,b)=>a.blockTs-b.blockTs),
      outOfScope:take(TX.sun,r=>r.contract===C.USDT),status:"reentered-contract-boundary",note:"31,383.1025 是已确认回流的赎回现金，含利息；其 MEXC 来源仍未确认。合约混同后无法逐币对应；TEAq 后续赎回不足以证明原批次权益全部退出。"},
    tmm:{address:TMM,redemptionCount:redemptions.length,routes:routes.filter(r=>r.origin===TMM),returnWallet:TLY,returnCashLowerRaw:"0",returnCashUpperRaw:up(tlyBounds.upperRaw),returnRetention:originalTly,returnEntries:tlyMints,sourceLimits:parents.map(r=>({...r,possibleCashUpperRaw:up(limits[C.key(r)])})),note:"回流金额使用按时序和历史份额限制的保守上限，不是假定所有赎回均来自 MEXC。所有路径共用原组来源本金，不增加历史本金；新留存上限不代表已确认留存。"},
    coverage:{wallets:Object.keys(wallets).length,receipts:Object.keys(receipts).length,firstRecipients:Object.keys(probes.probes).length,walletProbes:Object.values(probes.probes).filter(p=>p.done).length,contractBoundaries:Object.values(probes.probes).filter(p=>p.boundary).length,probeUntil:new Date(probes.probeUntil).toISOString(),marketUntil:new Date(Math.min(...index.markets.map(m=>m.until))).toISOString(),errors:0,limited:0,returnRouteCount:routes.length,terminalTxCount:new Set(routes.flatMap(r=>r.terminals.map(t=>t.txid))).size},
    limitations:["归因仅针对已核对 MEXC 地址子集及原固定 30 天首次入金；未知来源不能直接当作非 MEXC，也不扩张为 MEXC 标签。","来源上下界均通过完整收支和可行分配校验；不以等额、时间接近或先进先出强行缩小。","赎回后探查覆盖直接收款钱包及再经一个钱包进入 USDT / USDD 市场；公共合约、其他资产及更长路径未穷尽。","TM9 的 1,700 USDT 转入 SunSwap V4 合约，后续非本期资产路径未计入已核对钱包权益；不能据此视为已退出。","回流识别不证明地址属同一控制人，不将该路径直接定性为洗钱。"]};
  result.unresolved=result.unresolved.filter(p=>![TM9,TMM].includes(p.address));result.unresolved.push({address:TM9,sourcePrincipalUpperRaw:review.groups.find(g=>g.address===TM9&&g.asset==="USDT").upperRaw,reason:"原钱包已赎回，但已确认现金回流后 jUSDT 进入跨交易合约；另有 1,700 USDT 进入其他资产路径，全协议当前留存未闭合。"},{address:TMM,sourcePrincipalUpperRaw:review.groups.find(g=>g.address===TMM&&g.asset==="USDT").upperRaw,reason:"原钱包已清零，TLY 已核对的可能回流权益列入钱包上限；其余合约边界、更长路径仍未排除。此处本金上限不与 TLY 留存另行相加。"});
  for(const e of result.entries.filter(e=>[TM9,TMM].includes(e.from)&&e.asset==="USDT"))e.review.note=e.from===TMM?"9 笔存款共用 9,141.827663 USDT 来源本金上限，不逐笔累加。原钱包 jUSDT 为零，但存在赎回后回流线索，见专项复核。":"TD27 上游混同，来源本金仍为 0–33,083 USDT。原钱包已赎回，31,383.1025 USDT 赎回现金经换币再次存入；来源及后续合约权益仍有不确定性。";
  result.reviewedAt=result.usdtDeepening.checkedAt;result.positionsAsOf=new Date(Math.max(...result.retention.map(p=>Date.parse(p.asOf)))).toISOString();
  if(result.deepening)for(const g of result.deepening.breakdown){g.retention=result.retention.find(p=>p.address===g.address&&p.asset===g.asset)||null;if(focus.some(f=>f.address===g.address))g.status="11 月 18 日完整上游复算；本金区间未变，赎回后回流另列";}
  return {review:result,proof};
}
async function augmentFromFiles(review){
  const files=[D.FILE,D.EXTRA_FILE,"data/mexc-usdt-return-candidates-2026-11-18.json",D.PROBE_FILE,"data/mexc-return-market-index-2026-11-18.json"],ds=await Promise.all(files.map(f=>readJson(path.isAbsolute(f)?f:path.join(__dirname,f),null)));
  const built=buildUSDTDeepening({review,audit:ds[0],extra:ds[1],candidates:ds[2],probes:ds[3],index:ds[4],book:require("./mexc-sources.json")});
  await atomicJson(path.join(__dirname,"data/mexc-usdt-extremal-proof-2026-11-18.json"),built.proof);return require("./mexc-tm9-review").augmentTM9FromFiles(built.review);
}
async function main(){const r=await augmentFromFiles(await readJson(path.join(__dirname,"mexc-attribution-review.json"),null));require("./mexc-attribution").validateReview(r);await atomicJson(path.join(__dirname,"mexc-attribution-review.json"),r);console.log(JSON.stringify({totals:r.totals,coverage:r.usdtDeepening.coverage,tm9:r.usdtDeepening.tm9.cashReturnLowerRaw,tly:r.usdtDeepening.tmm.returnRetention}));}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={buildUSDTDeepening,augmentFromFiles,discoverReturns,mintEntry,redeemEntry,TKS,TM9,TMM,TPM,TEA,TLY,TJR,TD7,TX};
