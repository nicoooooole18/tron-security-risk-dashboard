"use strict";
const C=require("./mexc-core");
const bigint=v=>{if(!C.raw(v))throw new Error("归因金额格式错误");return BigInt(v);};
function validateReview(r) {
  if(![1,2].includes(r?.version)||!Number.isFinite(Date.parse(r.reviewedAt))||!Number.isFinite(Date.parse(r.positionsAsOf)))throw new Error("归因复核版本或时间无效");
  const ids=new Set(),groups=new Map(r.groups.map(g=>[g.id,g]));
  if(groups.size!==r.groups.length)throw new Error("归因分组重复");
  for(const e of r.entries) {
    if(ids.has(e.txid)||!groups.has(e.review?.groupId)||!C.MARKETS[e.asset]||!C.normalizeTransfer(e))throw new Error("归因明细重复或市场不匹配");
    if(C.MARKETS[e.asset].underlying!==e.contract||C.MARKETS[e.asset].jToken!==e.to)throw new Error("归因资产不匹配");
    ids.add(e.txid);
  }
  if(r.version===2)validateConservationReview(r);
  else {
  const sourceIds=new Set(),entryIds=new Set();let confirmed=0n;
  for(const s of r.confirmedSources) {
    const e=r.entries.find(e=>e.txid===s.entryTxid);
    if(sourceIds.has(s.txid)||entryIds.has(s.entryTxid)||e?.review.status!=="confirmed"||e.review.confirmedPrincipalRaw!==s.principalRaw
      ||!e.evidence.some(t=>t.txid===s.txid&&t.contract===C.USDT&&bigint(t.amountRaw)>=bigint(s.principalRaw)))throw new Error("来源本金重复或证据不闭合");
    sourceIds.add(s.txid);entryIds.add(s.entryTxid);confirmed+=bigint(s.principalRaw);
  }
  if(r.entries.filter(e=>e.review.status==="confirmed").length!==entryIds.size)throw new Error("已确认记录缺少来源本金");
  if(confirmed!==bigint(r.totals.confirmedPrincipalRaw)
    ||confirmed!==bigint(r.totals.confirmedRepaymentRaw)+bigint(r.totals.confirmedConversionPrincipalRaw))throw new Error("已确认本金不一致");
  const usdt=r.groups.filter(g=>g.asset==="USDT");
  for(const field of ["grossRaw","lowerRaw","upperRaw"]){
    const expected={grossRaw:"originalGrossRaw",lowerRaw:"sameAssetLowerRaw",upperRaw:"sameAssetUpperRaw"}[field];
    if(usdt.reduce((s,g)=>s+bigint(g[field]),0n)!==bigint(r.totals[expected]))throw new Error("去重归因区间不一致");
  }
  if(bigint(r.totals.sameAssetUpperRaw)-bigint(r.totals.confirmedRepaymentRaw)!==bigint(r.totals.suspectedAdditionalUpperRaw))throw new Error("疑似上限重复包含确认金额");
  }
  for(const g of r.groups) {
    if(bigint(g.lowerRaw)>bigint(g.upperRaw)||g.txids.some(id=>!ids.has(id)))throw new Error("归因分组无效");
    if(r.entries.filter(e=>e.review.groupId===g.id).length!==g.txids.length)throw new Error("归因分组漏项");
    const actual=r.entries.filter(e=>e.review.groupId===g.id);
    if(new Set(g.txids).size!==g.txids.length||actual.some(e=>!g.txids.includes(e.txid)||e.asset!==g.asset)||actual.reduce((s,e)=>s+bigint(e.amountRaw),0n)!==bigint(g.grossRaw))throw new Error("归因分组流水不一致");
  }
  for(const p of r.retention)if(!C.MARKETS[p.asset]||bigint(p.lowerRaw)>bigint(p.upperRaw)||bigint(p.upperRaw)>bigint(p.wholeRaw))throw new Error("归因留存超过钱包持仓");
  if(r.usdtDeepening){
    const d=r.usdtDeepening,t=d.tm9,m=d.tmm,c=d.coverage;
    if(d.version!==1||!Number.isFinite(Date.parse(d.checkedAt))||d.since!==r.since||d.entryUntil!==r.until||d.newConfirmedRaw!=="0"||d.principalReductionRaw!=="0")throw Error("USDT 专项口径无效");
    if(bigint(d.suspectedUpperRaw)!==bigint(r.totals.sameAssetUpperRaw)-bigint(r.totals.sameAssetLowerRaw)||bigint(d.focusUpperRaw)+bigint(d.otherUpperRaw)!==bigint(d.suspectedUpperRaw))throw Error("USDT 专项本金重复");
    if(d.focus.length!==3||new Set(d.focus.map(f=>f.address)).size!==3||d.focus.reduce((s,f)=>s+bigint(f.upperRaw)-bigint(f.lowerRaw),0n)!==bigint(d.focusUpperRaw))throw Error("USDT 专项分组无效");
    for(const f of d.focus){const g=groups.get(`USDT:${f.address}`),p=r.retention.find(p=>p.address===f.address&&p.asset==="USDT");if(!g||!p||f.lowerRaw!==g.lowerRaw||f.upperRaw!==g.upperRaw||!f.endpointProof||f.retention.upperRaw!==p.upperRaw||f.retention.asOf!==p.asOf)throw Error("USDT 专项分组或留存不一致");}
    if(bigint(t.cashReturnLowerRaw)>bigint(t.cashReturnUpperRaw)||bigint(t.cashReturnUpperRaw)>bigint(t.redeemedRaw)||t.mexcReturnLowerRaw!=="0"||bigint(t.mexcReturnUpperRaw)>bigint(t.cashReturnUpperRaw)||t.mints.reduce((s,e)=>s+bigint(e.amountRaw),0n)!==bigint(t.grossReentryRaw)||!t.poolTransfers.length)throw Error("TM9 回流现金与来源归因混淆");
    if(t.followup){const f=t.followup,p=f.originalShareRetention;
      if(f.version!==1||f.cohortCashRaw!==t.cashReturnUpperRaw||f.confirmedMexcRaw!=="0"||f.sourceAttributionUnchanged!==true||f.protocolWideUpperRaw!==null||f.unresolvedCashPrincipalUpperRaw!==f.cohortCashRaw||!Number.isFinite(Date.parse(f.checkedAt)))throw Error("TM9 原批权益不能当作全协议或已确认来源");
      const sumPositions=p.positions.reduce((s,p)=>s+bigint(p.upperRaw),0n),maxRate=p.positions.reduce((m,p)=>bigint(p.exchangeRateRaw)>m?bigint(p.exchangeRateRaw):m,0n),jointValue=(bigint(p.upperSharesRaw)*maxRate+10n**18n-1n)/10n**18n;
      if(p.lowerRaw!=="0"||p.lowerSharesRaw!=="0"||bigint(p.upperSharesRaw)>bigint(p.jointShareCapRaw)||bigint(p.upperRaw)!==(sumPositions<jointValue?sumPositions:jointValue)||p.positions.some(p=>bigint(p.upperRaw)>bigint(p.wholeRaw)||bigint(p.upperSharesRaw)>bigint(p.wholeSharesRaw)||!Number.isFinite(Date.parse(p.asOf))))throw Error("TM9 留存未受实际持仓约束");
      if(bigint(f.redeemedOriginalPrincipalLowerRaw)+bigint(p.principalRemainingUpperRaw)!==bigint(f.cohortCashRaw)||f.redeemedOriginalPrincipalUpperRaw!==f.cohortCashRaw||bigint(f.redeemedOriginalPrincipalLowerRaw)>bigint(f.redeemedOriginalPrincipalUpperRaw))throw Error("TM9 原始本金守恒错误");
      if(f.coverage.errors!==0||f.coverage.truncatedShareLedgers!==0||f.coverage.redeemingWallets!==new Set(f.redemptions.map(r=>r.to)).size||f.routerRoutes.length!==f.coverage.routerPassThroughs||f.poolRecipients.length!==new Set(f.poolOutgoing.map(r=>r.to)).size)throw Error("TM9 权益穿透覆盖不完整");
      if(f.cashProbe&&(f.cashProbe.errors!==0||f.cashProbe.targets!==f.cashProbe.complete+f.cashProbe.limited+f.cashProbe.contracts||f.cashProbe.candidateCount!==f.cashProbe.candidates.length))throw Error("TM9 现金探查覆盖不一致");
      const c=f.teaCashReturn;if(c.tbfSharesRaw!=="0"||c.tseSharesRaw!=="0"||c.split.reduce((s,r)=>s+bigint(r.amountRaw),0n)+bigint(c.tseCashRemainingRaw)!==bigint(c.toTse.amountRaw))throw Error("TM9 再赎回现金分拆不一致");
      if(f.cashConvergence){const g=f.cashConvergence;if(g.cashRaw!==c.mint.amountRaw||g.lowerRaw!==g.cashRaw||g.upperRaw!==g.cashRaw||g.sourceRedemptions!==f.redemptions.length||f.redemptions.reduce((s,r)=>s+bigint(r.amountRaw),0n)!==bigint(g.cashRaw))throw Error("TM9 全部分流现金未共同守恒");}
      if(f.usddReturn){const u=f.usddReturn;if(u.asset!=="USDD"||u.decimals!==18||u.sourceScope!=="observed-cash-path-excluding-external-reentry"||u.sourceLowerRaw!=="0"||u.lowerRaw!=="0"||bigint(u.sourceUpperRaw)>bigint(u.upstreamCashUpperRaw)*10n**12n||u.entries.reduce((s,e)=>s+bigint(e.amountRaw),0n)!==bigint(u.grossRaw)||new Set(u.entries.map(C.key)).size!==u.entries.length||bigint(u.upperSharesRaw)>bigint(u.jointShareCapRaw)||bigint(u.upperRaw)>(bigint(u.upperSharesRaw)*bigint(u.maxExchangeRateRaw)+10n**18n-1n)/10n**18n||!u.swapProofs.length||u.watchpoints.some(w=>!Number.isFinite(Date.parse(w.asOf))))throw Error("TM9 后续 USDD 来源或留存重复计算");}
    }
    const p=r.retention.find(p=>p.address===m.returnWallet&&p.asset==="USDT");if(!p||m.returnCashLowerRaw!=="0"||m.returnRetention.lowerRaw!=="0"||m.returnRetention.upperRaw!==p.upperRaw||m.returnRetention.asOf!==p.asOf)throw Error("TMM 回流留存未同步");
    if(c.errors!==0||c.limited!==0||c.walletProbes+c.contractBoundaries!==c.firstRecipients||Date.parse(c.marketUntil)<Date.parse(c.probeUntil)||!Number.isFinite(Date.parse(c.probeUntil)))throw Error("USDT 回流覆盖不完整");
  }
  if(r.deepening){
    const d=r.deepening,f=d.focus,g=groups.get(`USDD:${f.address}`),p=r.retention.find(p=>p.address===f.address&&p.asset==="USDD");
    if(!g||!p||f.lowerRaw!==g.lowerRaw||f.upperRaw!==g.upperRaw||f.retention.lowerRaw!==p.lowerRaw||f.retention.upperRaw!==p.upperRaw||d.suspectedUpperRaw!==r.totals.suspectedAdditionalUpperRaw)throw Error("专项复核与归因汇总不一致");
    if(d.breakdown.reduce((s,g)=>s+bigint(g.uncertainRaw),0n)-bigint(d.overlapAdjustmentRaw)!==bigint(d.suspectedUpperRaw))throw Error("疑似金额拆解不一致");
    const keys=new Set();for(const b of d.breakdown){const g=groups.get(b.groupId);if(keys.has(b.groupId)||!g||bigint(b.uncertainRaw)!==bigint(g.upperRaw)-bigint(g.lowerRaw))throw Error("疑似拆解分组无效");keys.add(b.groupId);}
    if(f.cases.length!==2||f.cases[0].principalRaw!==g.lowerRaw||f.cases[1].principalRaw!==g.upperRaw)throw Error("专项区间端点证明不一致");
    if(!f.sourceLabel.url.startsWith("https://sunx.gitbook.io/"))throw Error("专项来源链接无效");
  }
  return r;
}
function validateConservationReview(r){
  const sum=(rows,field)=>rows.reduce((s,g)=>s+bigint(g[field]),0n),dd=r.groups.filter(g=>g.asset==="USDD"),usdt=r.groups.filter(g=>g.asset==="USDT"),t=r.totals;
  if(sum(r.groups,"lowerRaw")!==bigint(t.confirmedPrincipalRaw)||sum(dd,"lowerRaw")!==bigint(t.confirmedConversionPrincipalRaw)||sum(usdt,"lowerRaw")!==bigint(t.confirmedRepaymentRaw))throw Error("已确认下限未按分组去重");
  if(sum(r.groups,"upperRaw")!==bigint(t.independentUpperRaw)||bigint(t.independentUpperRaw)-bigint(t.overlapUpperAdjustmentRaw)!==bigint(t.principalUpperRaw)||bigint(t.principalUpperRaw)-bigint(t.confirmedPrincipalRaw)!==bigint(t.suspectedAdditionalUpperRaw))throw Error("联合本金上限重复或不一致");
  if(sum(usdt,"grossRaw")!==bigint(t.originalGrossRaw)||sum(usdt,"lowerRaw")!==bigint(t.sameAssetLowerRaw)||sum(usdt,"upperRaw")!==bigint(t.sameAssetUpperRaw))throw Error("USDT基线不一致");
  const sources=new Map();for(const e of r.sourceEvidence){if(!C.normalizeTransfer(e)||e.contract!==C.USDT||sources.has(C.key(e)))throw Error("来源证据无效或重复");sources.set(C.key(e),e);}
  const assignedSources=new Set();for(const g of dd){let amount=0n;for(const e of g.sourceEvidence){const source=sources.get(C.key(e));if(!source||assignedSources.has(C.key(e))||["from","to","contract","amountRaw","blockTs"].some(k=>source[k]!==e[k]))throw Error("不同归因组重复分配来源证据或证据内容不一致");assignedSources.add(C.key(e));amount+=bigint(e.amountRaw);}if(amount<bigint(g.upperRaw))throw Error("分组上限超过来源证据");}
  for(const e of r.entries.filter(e=>e.asset==="USDD")){const lo=bigint(e.review.lowerPrincipalRaw),hi=bigint(e.review.upperPrincipalRaw),cap=(bigint(e.amountRaw)+10n**12n-1n)/10n**12n;if(lo>hi||hi>cap||e.review.confirmedPrincipalRaw!==e.review.lowerPrincipalRaw)throw Error("逐笔归因区间无效");}
  const c=r.auditCoverage;if(!c?.scanComplete||c.historyPending!==0||c.receiptPending!==0||!c.collectedAt)throw Error("USDD回查证据不完整");
  const a=r.additionalUSDD,ddEntries=r.entries.filter(e=>e.asset==="USDD");
  if(a.reviewedCount!==ddEntries.length||bigint(a.grossRaw)!==sum(ddEntries,"amountRaw")||a.zeroPrincipalCount!==ddEntries.filter(e=>e.review.upperPrincipalRaw==="0").length)throw Error("USDD复核笔数或流水不一致");
  if(bigint(a.lowerRaw)>bigint(a.upperRaw)||bigint(a.addedLowerRaw)>bigint(a.addedUpperRaw)||bigint(a.addedUpperRaw)>bigint(a.upperRaw))throw Error("新增USDD来源区间无效");
  if(sum(a.retention,"lowerRaw")!==bigint(a.retainedLowerRaw)||sum(a.retention,"upperRaw")!==bigint(a.retainedUpperRaw))throw Error("新增线索留存汇总不一致");
  for(const p of a.retention){const full=r.retention.find(f=>f.address===p.address&&f.asset==="USDD");if(!full||bigint(p.lowerRaw)>bigint(p.upperRaw)||bigint(p.upperRaw)>bigint(full.upperRaw))throw Error("新增线索留存区间无效");}
}
function combineSnapshots(base,usdd,review,now=Date.now()) {
  const validUSDD=usdd?.scope==="MEXC-USDD-jUSDD"&&usdd.sourceVersion===base.sourceVersion;
  const extra=validUSDD?usdd:null,live=[...(base.events||[]),...(extra?.events||[])];
  let audit=null,auditError=null;
  if(review&&base.sourceVersion===review.sourceVersion){try{audit=validateReview(review);}catch(e){auditError=e.message;}}
  else if(review)auditError="来源地址版本已变更，历史归因待复核";
  const eventMap=new Map(live.map(e=>[e.id,{...e,asset:e.asset||"USDT",decimals:e.decimals??6,review:{status:"pending",note:"采集器识别到关联路径，来源本金尚未完成复核。"}}]));
  if(audit)for(const e of audit.entries)eventMap.set(e.id,e);
  const events=[...eventMap.values()].sort((a,b)=>b.blockTs-a.blockTs);
  const stamp=rows=>rows.map(r=>({...r,asset:r.asset||"USDT",decimals:r.decimals??6}));
  const ddStamp=rows=>rows.map(r=>({...r,asset:"USDD",decimals:18}));
  const retention=audit?.retention.map(p=>{
    const snap=p.asset==="USDD"?extra:base;
    const asOf=p.asOf||audit.positionsAsOf;
    const changed=[...(snap?.rights||[]),...(snap?.redemptions||[])].some(t=>t.from===p.address&&t.blockTs>Date.parse(asOf));
    return {...p,asOf,needsReview:changed};
  })||[];
  let tm9=audit?.usdtDeepening?.tm9;
  if(tm9?.followup){const f=tm9.followup,watch=new Map(f.originalShareRetention.positions.map(p=>[p.address,Date.parse(p.asOf)]));
    for(const a of [f.teaCashReturn.mint.from,f.teaCashReturn.toTse.to])watch.set(a,Date.parse(f.teaCashReturn.asOf));
    for(const p of f.cashProbe?.rows||[])watch.set(p.address,Date.parse(f.cashProbe.asOf));
    for(const p of f.usddReturn?.watchpoints||[])watch.set(p.address,Date.parse(p.asOf));
    const newer=[...live,...(base.rights||[]),...(base.redemptions||[]),...(extra?.rights||[]),...(extra?.redemptions||[])].some(e=>[e.from,e.to].some(a=>watch.has(a)&&e.blockTs>watch.get(a)));
    tm9={...tm9,followup:{...f,needsReview:newer}};
  }
  return {...base,scope:"MEXC-USDT-jUSDT-USDD-jUSDD",events,
    until:new Date(Math.max(Date.parse(base.until)||0,Date.parse(extra?.until)||0,Date.parse(audit?.until)||0)).toISOString(),
    positions:[...stamp(base.positions||[]),...ddStamp(extra?.positions||[])],
    rights:[...stamp(base.rights||[]),...ddStamp(extra?.rights||[])],
    redemptions:[...stamp(base.redemptions||[]),...ddStamp(extra?.redemptions||[])],
    ambiguous:[...stamp(base.ambiguous||[]),...ddStamp(extra?.ambiguous||[])],
    review:audit?{...audit,retention,usdtDeepening:audit.usdtDeepening?{...audit.usdtDeepening,tm9,focus:audit.usdtDeepening.focus.map(f=>({...f,retention:retention.find(p=>p.address===f.address&&p.asset==="USDT")})),tmm:{...audit.usdtDeepening.tmm,returnRetention:retention.find(p=>p.address===audit.usdtDeepening.tmm.returnWallet&&p.asset==="USDT")}}:undefined,deepening:audit.deepening?{...audit.deepening,focus:{...audit.deepening.focus,retention:retention.find(p=>p.address===audit.deepening.focus.address&&p.asset==="USDD")},breakdown:audit.deepening.breakdown.map(g=>({...g,retention:retention.find(p=>p.address===g.address&&p.asset===g.asset)||null}))}:undefined,historical:true,newPendingCount:events.filter(e=>e.review.status==="pending").length}:null,reviewError:auditError,
    marketCoverage:{USDT:{...base.coverage,generatedAt:base.generatedAt},USDD:extra?{...extra.coverage,generatedAt:extra.generatedAt}:{status:"pending",scanComplete:false,historyPending:null,receiptPending:null}},
    limitations:["地址库为已核对的 Arkham TRON 子集；未命中不代表没有 MEXC 资金。",
      "首次回查 30 天，最多 2 个钱包中转；合约只用同交易事件穿透。支持同笔已核验 PSM 的 USDT → USDD 换币；其他换币与跨链待核。",
      "间接路径金额为该资产的交易额，不自动计为来源本金；归因复核、权益和持仓各自独立。",
      "公共平台停止穿透；合约跨交易转出的等量 jToken 单列待核，不自动归属于原出资方。",
      "持仓为关联钱包该市场的全部份额，含混同资金；失败或过期不按零处理。",
      "USDD市场单独采集、独立标记覆盖进度。仅同笔已验证PSM换币自动串联，其他兑换为待核线索。",
      "归因卡片为注明时点的复核结果；新增线索不自动累加确认金额。后续权益转出会提示重新复核留存。"],
    runtime:{...base.runtime,usddSnapshotOrigin:extra?.runtime?.snapshotOrigin,usddStale:!extra||!Number.isFinite(Date.parse(extra.generatedAt))||now-Date.parse(extra.generatedAt)>900000}};
}
module.exports={validateReview,combineSnapshots};
