"use strict";
const path=require("node:path"),crypto=require("node:crypto"),C=require("./mexc-core"),F=require("./mexc-fund-flow"),{readJson,atomicJson}=require("./mexc-monitor");
const ROOT=__dirname,baseline=require("./test-fixtures/mexc-review-baseline-2026-11-16.json"),book=require("./mexc-sources.json");
const down=n=>String(BigInt(n)/F.SCALE),up=n=>String((BigInt(n)+F.SCALE-1n)/F.SCALE),sum=(xs,f)=>String(xs.reduce((s,x)=>s+BigInt(f(x)),0n));
async function calculate({draft=false}={}){
  const audit=await readJson(path.join(ROOT,"data/mexc-usdd-audit-evidence-2026-11-17.json"),null),snapshot=await readJson(path.join(ROOT,"data/mexc-usdd-snapshot.json"),null);
  const states=await Promise.all([readJson(path.join(ROOT,"data/mexc-usdd-state.json"),null),readJson(path.join(ROOT,"data/mexc-state.json"),null)]);
  const sourceVersion=crypto.createHash("sha256").update(JSON.stringify(C.validateSources(book))).digest("hex").slice(0,16);
  if([snapshot,baseline,...states].some(s=>s?.sourceVersion!==sourceVersion))throw Error("地址来源版本变化，必须重新回查和复核");
  if(Date.parse(snapshot.since)!==audit.since||Date.parse(snapshot.until)!==audit.entryUntil||snapshot.since!==baseline.since||snapshot.until!==baseline.until)throw Error("复核与回查时间范围不一致");
  if(!draft&&(!snapshot.coverage.scanComplete||!audit.collectedAt))throw Error("回查或完整审计回执尚未完成");
  const receipts={...states[1].receipts,...states[0].receipts,...audit.receipts},events=snapshot.events;
  const addresses=new Set(events.map(e=>e.from));for(const e of events)for(const r of e.evidence)if(states[0].accounts[r.from]?.type==="wallet")addresses.add(r.from);
  const wallets=Object.fromEntries([...addresses].map(a=>{if(!audit.wallets[a]?.complete)throw Error(`缺少完整审计: ${a}`);return [a,audit.wallets[a]];}));
  const graph=F.buildFundGraph({wallets,receipts,sources:book,since:audit.since,until:audit.entryUntil,required:!draft});
  const individual=new Map(events.map(e=>[e.id,graph.bounds([C.key(e)])])),groups=[];
  const bySender=new Map();for(const e of events){if(!bySender.has(e.from))bySender.set(e.from,[]);bySender.get(e.from).push(e);}
  for(const [a,es] of bySender){
    const b=graph.bounds(es.map(C.key)),component=new Set([a]);let changed=true;
    while(changed){changed=false;for(const [addr,w] of Object.entries(wallets))for(const r of F.walletRows(addr,w,receipts,{required:!draft}))if(wallets[r.from]&&wallets[r.to]&&(component.has(r.from)||component.has(r.to))){for(const p of [r.from,r.to])if(!component.has(p)){component.add(p);changed=true;}}}
    const sources=graph.sources.filter(r=>component.has(r.to));
    groups.push({id:`USDD:${a}`,address:a,asset:"USDD",decimals:18,principalAsset:"USDT",grossRaw:C.sum(es),lowerRaw:down(b.lowerRaw),upperRaw:up(b.upperRaw),exactBounds:{lowerRaw:b.lowerRaw,upperRaw:b.upperRaw},txids:es.map(e=>e.txid),sourceEvidence:sources,
      note:BigInt(b.lowerRaw)>0n?"先扣除可由其他来源解释的资金，再计算 MEXC 本金下限；上限保留混同不确定性。借款、赎回及再存入不重复计入本金。":"路径有关联，但完整收支未能确认新增 MEXC 本金；金额上限仅限该组已核对路径。"});
  }
  const swaps=C.conversions(receipts);
  const reviewed=events.map(e=>{const b=individual.get(e.id),lo=down(b.lowerRaw),hi=up(b.upperRaw),status=BigInt(hi)===0n?"diverted":BigInt(lo)>0n?(BigInt(hi)-BigInt(lo)<=1n?"confirmed":"mixed"):"weak";
    const swap=e.evidence.map(r=>swaps.get(C.key(r))).find(Boolean);
    return {...e,conversionTxid:swap?.txid,attribution:{lowerRaw:b.lowerRaw,upperRaw:b.upperRaw},review:{status,groupId:`USDD:${e.from}`,confirmedPrincipalRaw:lo,lowerPrincipalRaw:lo,upperPrincipalRaw:hi,
      note:status==="diverted"?"原有 MEXC 资金已用于更早存款或流向其他地址；本笔不增加首次进入 JustLend 的来源本金。":BigInt(lo)>0n?"该笔交易只有列出的本金下限可确认来自 MEXC；整笔交易额和钱包全额均不可直接归因。":"仅有可能关联上限，未确认新增来源本金；若是多笔共享来源，应以分组区间为准。"}};});
  const retention=[];
  for(const g of groups){const w=wallets[g.address],es=reviewed.filter(e=>e.from===g.address),r=F.retainedShares({address:g.address,wallet:w,receipts,entries:es,principalUpperRaw:g.exactBounds.upperRaw});
    retention.push({address:g.address,asset:"USDD",decimals:18,...r,status:BigInt(r.lowerRaw)>0n?"mixed":BigInt(r.wholeRaw)===0n?"closed":"mixed",asOf:new Date(w.asOf.timestamp).toISOString(),checkedAt:w.checkedAt,
      note:r.outflows.length?"已按后续赎回/转出扣减本批 jUSDD 权益；区间下限可确认、上限仍含混同不确定性。":"已核对期间没有 jUSDD 转出；来源本金对应的份额按当前兑换率折算，含利息。"});
  }
  for(const p of baseline.retention.filter(p=>p.asset==="USDT")){const w=audit.wallets[p.address],g=baseline.groups.find(g=>g.id===`USDT:${p.address}`);if(!w?.complete||!g)throw Error("USDT留存缺少完整快照");
    const es=baseline.entries.filter(e=>e.from===p.address&&e.operation==="Mint").map(e=>({...e,attribution:{lowerRaw:"0",upperRaw:String(BigInt(g.upperRaw)<BigInt(e.amountRaw)?BigInt(g.upperRaw):BigInt(e.amountRaw))}}));
    const r=F.retainedShares({address:p.address,wallet:w,receipts,entries:es,principalUpperRaw:g.upperRaw,market:C.MARKETS.USDT});
    // The SUN pool is a documented cross-transaction ownership boundary. Keep
    // the wallet-only bound separate, without claiming the pool cohort vanished.
    if(p.status==="boundary")r.upperRaw=String(BigInt(w.positions.USDT.underlyingRaw)<BigInt(g.upperRaw)?BigInt(w.positions.USDT.underlyingRaw):BigInt(g.upperRaw));
    retention.push({...p,...r,status:BigInt(r.wholeRaw)===0n?"closed":p.status,asOf:new Date(w.asOf.timestamp).toISOString(),checkedAt:w.checkedAt,
      note:p.status==="boundary"?"仅计钱包现持份额；SUN 公共池跨交易后的权益仍单列待核。":"按原 USDT 来源本金上限重算本批份额，已扣除随后赎回/转出；相关钱包全额另列。"});
  }
  const oldGroups=baseline.groups.filter(g=>g.asset==="USDT"),allGroups=[...oldGroups,...groups];
  const overlapOld=baseline.entries.filter(e=>e.asset==="USDT"&&addresses.has(e.from)),overlapGroups=oldGroups.filter(g=>overlapOld.some(e=>e.review.groupId===g.id));
  const joint=graph.bounds([...events,...overlapOld].map(C.key)),dd=graph.bounds(events.map(C.key));
  const independentUpper=BigInt(sum(allGroups,g=>g.upperRaw)),jointUpper=BigInt(baseline.totals.sameAssetUpperRaw)-BigInt(sum(overlapGroups,g=>g.upperRaw))+BigInt(up(joint.upperRaw));
  const lower=BigInt(sum(allGroups,g=>g.lowerRaw)),upper=jointUpper<independentUpper?jointUpper:independentUpper;
  if(lower>upper)throw Error("Combined lower exceeds upper");
  const oldDDIds=new Set(baseline.entries.filter(e=>e.asset==="USDD").map(e=>e.id)),added=events.filter(e=>!oldDDIds.has(e.id)),addedBounds=graph.bounds(added.map(C.key));
  const addedIds=new Set(added.map(e=>e.id)),addedRetention=groups.map(g=>{
    const es=reviewed.filter(e=>e.from===g.address&&addedIds.has(e.id)),b=graph.bounds(es.map(C.key));
    return {address:g.address,asset:"USDD",decimals:18,...F.retainedShares({address:g.address,wallet:wallets[g.address],receipts,entries:es,principalUpperRaw:b.upperRaw})};
  });
  let result={...baseline,version:2,id:"mexc-attribution-2026-11-17",reviewedAt:new Date().toISOString(),positionsAsOf:new Date(Math.max(...retention.map(r=>Date.parse(r.asOf)))).toISOString(),retention,
    entries:[...baseline.entries.filter(e=>e.asset==="USDT"),...reviewed].sort((a,b)=>b.blockTs-a.blockTs),groups:allGroups,
    confirmedSources:undefined,sourceEvidence:graph.sources,
    totals:{...baseline.totals,confirmedPrincipalRaw:String(lower),confirmedConversionPrincipalRaw:sum(groups,g=>g.lowerRaw),suspectedAdditionalUpperRaw:String(upper-lower),principalUpperRaw:String(upper),independentUpperRaw:String(independentUpper),overlapUpperAdjustmentRaw:String(independentUpper-upper),conversionUpperRaw:up(dd.upperRaw)},
    additionalUSDD:{reviewedCount:events.length,addedCount:added.length,grossRaw:C.sum(events),addedGrossRaw:C.sum(added),lowerRaw:down(dd.lowerRaw),upperRaw:up(dd.upperRaw),addedLowerRaw:down(addedBounds.lowerRaw),addedUpperRaw:up(addedBounds.upperRaw),zeroPrincipalCount:reviewed.filter(e=>e.review.upperPrincipalRaw==="0").length,
      retention:addedRetention,retainedLowerRaw:sum(addedRetention,p=>p.lowerRaw),retainedUpperRaw:sum(addedRetention,p=>p.upperRaw)},
    carriedUSDTReviewAt:baseline.reviewedAt,
    auditCoverage:{scanComplete:snapshot.coverage.scanComplete,historyPending:snapshot.coverage.historyPending,receiptPending:snapshot.coverage.receiptPending,wallets:Object.keys(wallets).length,receipts:Object.keys(audit.receipts).length,collectedAt:audit.collectedAt,sourceVersion:snapshot.sourceVersion},
    method:"来源本金按首次进入 JustLend 去重；使用完整收支、已核验 PSM 回执及时间有序资金守恒求上下界。同区块交易顺序保守放宽；金额下限向下取整、上限向上取整至 USDT 的 6 位精度。借款、赎回后再存不重复计入新本金；USDT/USDD共享来源联合去重。留存按本批jToken份额与后续转出计算，钱包全额不等于可归因余额。",
    provenance:{calculation:"mexc-audit-review.js / mexc-fund-flow.js",evidence:"data/mexc-usdd-audit-evidence-2026-11-17.json",baseline:"test-fixtures/mexc-review-baseline-2026-11-16.json",graph:{nodes:graph.nodes,edges:graph.edges,sourceTotal:graph.sourceTotal,openings:graph.openings},jointBounds:joint,conversionBounds:dd}};
  const deepEvidence=await readJson(path.join(ROOT,"data/mexc-deepening-2026-11-17.json"),null),deepBaseline=await readJson(path.join(ROOT,"data/mexc-deepening-baseline-2026-11-17.json"),null);
  if(deepEvidence&&deepBaseline){
    const {proof,summary}=require("./mexc-taja-review").buildDeepening({review:result,audit,evidence:deepEvidence,baseline:deepBaseline,book});
    result.deepening=summary;
    await atomicJson(path.join(ROOT,"data/mexc-taja-extremal-proof-2026-11-17.json"),proof);
  }
  if(!draft&&(await readJson(require("./mexc-usdt-collect").FILE,null))?.collectedAt)result=await require("./mexc-usdt-review").augmentFromFiles(result);
  await atomicJson(path.join(ROOT,"data/mexc-usdd-attribution-result-2026-11-17.json"),result);
  if(!draft){require("./mexc-attribution").validateReview(result);await atomicJson(path.join(ROOT,"mexc-attribution-review.json"),result);}
  console.log(JSON.stringify({draft,entries:result.entries.length,totals:result.totals,additional:result.additionalUSDD,groups:groups.map(g=>({address:g.address,n:g.txids.length,lower:g.lowerRaw,upper:g.upperRaw})),retention:retention.map(r=>({address:r.address,asset:r.asset,lower:r.lowerRaw,upper:r.upperRaw,whole:r.wholeRaw}))}));return result;
}
if(require.main===module)calculate({draft:process.argv.includes("--draft")}).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={calculate};
