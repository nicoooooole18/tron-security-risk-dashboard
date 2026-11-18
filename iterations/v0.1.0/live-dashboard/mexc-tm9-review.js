"use strict";
const path=require("node:path"),C=require("./mexc-core"),F=require("./mexc-fund-flow"),D=require("./mexc-tm9-collect"),{buildShareGraph,ceil}=require("./mexc-tm9-flow"),{readJson,atomicJson}=require("./mexc-monitor");
const ROUTER="TQqgNg13s2DjvXhW1ky4v6TsR8wZGvb7Y4",TSE="TSEexpn2ukHwRF8i5EHFTpNepDnVnBBsqL";
const sum=(rs,k)=>String(rs.reduce((s,r)=>s+BigInt(r[k]),0n));
function buildTM9Followup({review,audit,probes}){
  const {mintEntry,redeemEntry}=require("./mexc-usdt-review"),t=review.usdtDeepening?.tm9;
  if(!t||!audit?.collectedAt||audit.since!==D.SINCE||Object.entries(audit.errors).some(([a,e])=>a!==ROUTER||e!=="Boundary: contract"))throw Error("TM9 follow-up collection is incomplete");
  const {wallets,receipts}=audit,rows=a=>F.walletRows(a,wallets[a],receipts).filter(r=>r.blockTs>=audit.since),poolRows=rows(D.POOL),out=poolRows.filter(r=>r.contract===C.JUSDT&&r.from===D.POOL);
  const recipients=[...new Set(out.map(r=>r.to))],leafs=recipients.filter(a=>a!==ROUTER);
  for(const a of [...leafs,D.POOL,D.TBF,TSE])if(!wallets[a]?.complete)throw Error("Missing downstream ledger: "+a);
  const mints=t.mints.map(m=>mintEntry(receipts[m.txid].transfers.find(r=>r.contract===C.USDT&&r.to===C.JUSDT),receipts));
  const directWallets=Object.fromEntries([D.POOL,...leafs].map(a=>[a,wallets[a]]));
  const graph=buildShareGraph({wallets:directWallets,receipts,mints,cashRaw:t.cashReturnUpperRaw,since:audit.since,router:ROUTER});
  if(graph.exits.some(e=>e.kind==="unresolved-transfer"))throw Error("Unclosed outgoing jUSDT route");
  const holdings=graph.exits.filter(e=>e.kind==="holding"),ids=holdings.map(e=>e.id),bounds=graph.bounds(ids),proof={lower:graph.witness(ids,"lower"),upper:graph.witness(ids,"upper")};
  const positions=holdings.map(e=>{const w=wallets[e.address],p=w.positions.USDT,b=graph.bounds([e.id]);return {address:e.address,lowerSharesRaw:"0",upperSharesRaw:b.upperRaw,wholeSharesRaw:p.jTokenRaw,exchangeRateRaw:p.exchangeRateRaw,lowerRaw:"0",upperRaw:String(ceil(BigInt(b.upperRaw)*BigInt(p.exchangeRateRaw),10n**18n)),wholeRaw:String(ceil(BigInt(p.jTokenRaw)*BigInt(p.exchangeRateRaw),10n**18n)),asOf:new Date(w.asOf.timestamp).toISOString()};});
  // Avoid summing competing independent account maxima if a future snapshot
  // contains more than one surviving holder.
  const maxRate=positions.reduce((m,p)=>BigInt(p.exchangeRateRaw)>m?BigInt(p.exchangeRateRaw):m,0n),jointValue=ceil(BigInt(bounds.upperRaw)*maxRate,10n**18n),sumValues=BigInt(sum(positions,"upperRaw")),retentionUpper=jointValue<sumValues?jointValue:sumValues;
  const redemptions=[];for(const exit of graph.exits.filter(e=>e.kind==="redemption")){const r=receipts[exit.transfer.txid],cash=r.transfers.find(r=>r.contract===C.USDT&&r.from===C.JUSDT&&r.to===exit.transfer.from);if(!cash)throw Error("Shares returned without matching redemption cash");const red=redeemEntry(cash,receipts),b=graph.bounds([exit.id]);redemptions.push({...red,cohortSharesUpperRaw:b.upperRaw,cohortCashUpperRaw:String(ceil(BigInt(b.upperRaw)*BigInt(red.amountRaw),BigInt(red.redeemTokens))),outgoing:rows(red.to).filter(r=>r.contract===C.USDT&&r.from===red.to&&r.blockTs>red.blockTs)});}
  // All initially minted shares can now only be in these positions or verified
  // Redeems. Value residual shares at the larger ORIGINAL Mint cash/share rate.
  // Ceil outward; the lower amount is original cash principal, excluding yield.
  let residualPrincipal=0n;for(const m of mints){const v=ceil(BigInt(bounds.upperRaw)*BigInt(m.amountRaw),BigInt(m.mintTokens));if(v>residualPrincipal)residualPrincipal=v;}
  const cash=BigInt(t.cashReturnUpperRaw);if(residualPrincipal>cash)residualPrincipal=cash;
  const teaRed=redemptions.find(r=>r.to===D.TEA);if(!teaRed)throw Error("Missing TEA redemption");
  const tbfMint=mintEntry(rows(D.TBF).find(r=>r.contract===C.USDT&&r.to===C.JUSDT),receipts),tbfRed=redeemEntry(rows(D.TBF).find(r=>r.contract===C.USDT&&r.from===C.JUSDT),receipts);
  const returnWallets=Object.fromEntries([D.TEA,D.TBF,TSE].map(a=>[a,wallets[a]])),returnGraph=F.buildFundGraph({wallets:returnWallets,receipts,since:audit.since,until:Math.min(...Object.values(returnWallets).map(w=>w.through)),sourceTransfers:[teaRed]});
  const rb=returnGraph.bounds([C.key(tbfMint)]);if(rb.lowerRaw!==String(BigInt(teaRed.amountRaw)*F.SCALE)||rb.upperRaw!==rb.lowerRaw)throw Error("TEA cash did not fully reenter through TBF");
  proof.teaCashReturn={lower:returnGraph.witness([C.key(tbfMint)],"lower"),upper:returnGraph.witness([C.key(tbfMint)],"upper")};
  if(wallets[D.TBF].balances[C.JUSDT]!=="0"||wallets[TSE].balances[C.JUSDT]!=="0")throw Error("TBF or TSE position changed; retention needs extension");
  const toTse=rows(D.TBF).find(r=>r.contract===C.USDT&&r.to===TSE),split=rows(TSE).filter(r=>r.contract===C.USDT&&r.from===TSE&&r.blockTs>=toTse.blockTs);
  if(toTse.amountRaw!==tbfRed.amountRaw||BigInt(sum(split,"amountRaw"))+BigInt(wallets[TSE].balances[C.USDT])!==BigInt(toTse.amountRaw))throw Error("TSE cash split does not reconcile");
  let cashConvergence=null;const hubs=["TS7oQ4MGiE7zbWEftvwcrLLNwrhV6KqAnR","TUAPDHnvikYpzhZb82CWx9j2422qwcd3Zy"];
  if(hubs.every(a=>wallets[a]?.complete)){
    const g=F.buildFundGraph({wallets,receipts,since:audit.since,until:Math.min(...Object.values(wallets).map(w=>w.through)),sourceTransfers:redemptions}),b=g.bounds([C.key(tbfMint)]),allCash=sum(redemptions,"amountRaw");
    if(b.lowerRaw!==String(BigInt(allCash)*F.SCALE)||b.upperRaw!==b.lowerRaw||allCash!==tbfMint.amountRaw)throw Error("Full redemption-cash convergence is not closed");
    cashConvergence={cashRaw:allCash,sourceRedemptions:redemptions.length,hubTransfers:hubs.flatMap(a=>rows(a).filter(r=>r.contract===C.USDT&&r.to===D.TBF)),lowerRaw:allCash,upperRaw:allCash};
    proof.allRedemptionCash={lower:g.witness([C.key(tbfMint)],"lower"),upper:g.witness([C.key(tbfMint)],"upper")};
  }
  let cashProbe=null;if(probes){if(!probes.checkedAt||Object.keys(probes.errors).length||probes.marketIndex?.length!==2||probes.marketIndex.some(m=>!m.complete||m.until!==probes.until))throw Error("Incomplete cash probe evidence");
    const ends=probes.marketIndex.flatMap(m=>m.rows),candidates=new Map();
    for(const p of Object.values(probes.probes)){
      for(const e of ends.filter(e=>e.from===p.address&&e.blockTs>=p.since))candidates.set([p.address,e.txid,"direct"].join(":"),{parent:p.address,via:p.address,entry:e,kind:"direct-cash-recipient"});
      for(const r of (p.rows||[]).map(C.normalizeTransfer).filter(r=>r&&[C.USDT,C.USDD].includes(r.contract)))for(const e of ends.filter(e=>e.from===r.to&&e.blockTs>r.blockTs))candidates.set([p.address,e.txid,r.to].join(":"),{parent:p.address,via:r.to,edge:r,entry:e,kind:"one-more-wallet"});
    }
    cashProbe={asOf:new Date(probes.until).toISOString(),targets:Object.keys(probes.probes).length,complete:Object.values(probes.probes).filter(p=>p.done).length,limited:Object.values(probes.probes).filter(p=>p.limited).length,contracts:Object.values(probes.probes).filter(p=>p.boundary).length,errors:0,
      candidates:[...candidates.values()],candidateCount:candidates.size,rows:Object.values(probes.probes).map(p=>({address:p.address,since:new Date(p.since).toISOString(),rows:p.rows?.length||0,status:p.done?"complete":p.limited?"limited":"contract-boundary",directEntries:ends.filter(e=>e.from===p.address&&e.blockTs>=p.since).length}))};
  }
  let usddReturn=null;if(cashProbe?.candidates.length&&cashProbe.candidates.every(c=>wallets[c.via]?.complete&&wallets[c.parent]?.complete)){const u=require("./mexc-tm9-usdd").buildUSDDReturn({audit,candidates:cashProbe.candidates,redeemed:tbfRed});usddReturn=u.result;proof.usddReturn=u.proof;}
  const result=structuredClone(review),followup={version:1,checkedAt:audit.collectedAt,cohortCashRaw:t.cashReturnUpperRaw,confirmedMexcRaw:"0",sourceAttributionUnchanged:true,
    originalShareRetention:{lowerRaw:"0",upperRaw:String(retentionUpper),lowerSharesRaw:"0",upperSharesRaw:bounds.upperRaw,jointShareCapRaw:graph.sourceTotal,positions,scope:"original-two-mints-and-jUSDT-descendants-before-redemption",principalRemainingUpperRaw:String(residualPrincipal)},
    redeemedOriginalPrincipalLowerRaw:String(cash-residualPrincipal),redeemedOriginalPrincipalUpperRaw:String(cash),protocolWideUpperRaw:null,unresolvedCashPrincipalUpperRaw:String(cash),
    pool:D.POOL,poolOutgoing:out,poolRecipients:recipients,routerRoutes:graph.routes,redemptions,
    teaCashReturn:{cashRaw:teaRed.amountRaw,mint:tbfMint,redeem:tbfRed,toTse,split,tseCashRemainingRaw:wallets[TSE].balances[C.USDT],tbfSharesRaw:wallets[D.TBF].balances[C.JUSDT],tseSharesRaw:wallets[TSE].balances[C.JUSDT],asOf:new Date(Math.min(wallets[D.TBF].asOf.timestamp,wallets[TSE].asOf.timestamp)).toISOString()},
    cashProbe,cashConvergence,usddReturn,coverage:{ledgers:Object.keys(wallets).length,receipts:Object.keys(receipts).length,redeemingWallets:new Set(redemptions.map(r=>r.to)).size,routerPassThroughs:graph.routes.length,errors:0,truncatedShareLedgers:0},
    limitations:["31,383.1025 USDT 是已确认的 TM9 赎回现金回流，MEXC 来源仍为疑似；本次不增加已确认本金。","原批 jUSDT 留存是合约及已核对分流钱包在各自快照时点的上限，包含利息；不是全协议留存上限。","两笔初始 Mint 共享同一来源上限，公共合约混同不采用 FIFO 或固定比例；各条路径的独立上限不能相加。","首次赎回后 USDT 可能经更多钱包、公共服务或其他资产再存；未闭合部分仍可包含整个原批本金，不能据此宣布全部退出。","TBF 的大额再存和赎回含其他资金；本次只证明路径与现金守恒，不把总操作额列为 MEXC 金额。"]};
  result.usdtDeepening.tm9.followup=followup;result.usdtDeepening.tm9.status="shares-traced-cash-boundaries";result.usdtDeepening.tm9.note="原批 jUSDT 已追踪至 23 个赎回钱包及 TEr2 的微量剩余权益；TEAq 赎回款经 TBF 再存再赎回。赎回现金更远路径仍未闭合。";
  const unresolved=result.unresolved.find(u=>u.address===t.address);if(unresolved)unresolved.reason="31,383.1025 USDT 回流所对应的原批 jUSDT 已追踪至少量合约残余；TEAq→TBF 再存再赎回已核验。现金后续边界及另有 1,700 USDT 其他资产路径未闭合，不能把原批 jUSDT 上限当作全协议留存。";
  result.reviewedAt=followup.checkedAt;return {review:result,proof};
}
async function augmentTM9FromFiles(review){const audit=await readJson(D.FILE,null);if(!audit)return review;if(!audit.collectedAt)throw Error("TM9 补证尚未完成，保留原复核快照");const probes=await readJson(require("./mexc-tm9-cash-probe").FILE,null);const built=buildTM9Followup({review,audit,probes});await atomicJson(path.join(__dirname,"data/mexc-tm9-share-proof-2026-11-18.json"),built.proof);return built.review;}
async function main(){const r=await augmentTM9FromFiles(await readJson(path.join(__dirname,"mexc-attribution-review.json"),null));require("./mexc-attribution").validateReview(r);await atomicJson(path.join(__dirname,"mexc-attribution-review.json"),r);const f=r.usdtDeepening.tm9.followup;console.log(JSON.stringify({retainedUpperRaw:f.originalShareRetention.upperRaw,redeemedPrincipalLowerRaw:f.redeemedOriginalPrincipalLowerRaw,coverage:f.coverage,cashProbe:f.cashProbe?{...f.cashProbe,candidates:f.cashProbe.candidates.length,rows:undefined}:null}));}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={buildTM9Followup,augmentTM9FromFiles,ROUTER,TSE};
