"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const C=require("./mexc-core"),{createMexcMonitor,readMexcSnapshot}=require("./mexc-monitor");
const {validateReview,combineSnapshots}=require("./mexc-attribution");
const fixture=require("./test-fixtures/mexc-conversions-2026-11-16.json"),book=require("./mexc-sources.json"),review=require("./test-fixtures/mexc-review-baseline-2026-11-16.json");
const receipts={...fixture.sourceReceipts};
for(const [id,r] of Object.entries(fixture.proofReceipts))receipts[id]=C.canonicalReceipt(id,r.events,r.info);
const types=Object.fromEntries(Object.keys(fixture.wallets).map(a=>[a,"wallet"]));
const analyze=rs=>C.analyze({receipts:rs,sources:book,accountTypes:types,since:fixture.since,until:fixture.until,market:C.MARKETS.USDD});
test("published audit loads without private caches, preserves dates and yields to each market's collector",async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"mexc-publication-"));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,"reviewed-snapshots"));
  for(const name of ["mexc-sources.json","mexc-attribution-review.json","reviewed-snapshots/mexc-snapshot.json","reviewed-snapshots/mexc-usdd-snapshot.json"])await fs.copyFile(path.join(__dirname,name),path.join(root,name));
  const published=JSON.parse(await fs.readFile(path.join(root,"reviewed-snapshots/mexc-snapshot.json"),"utf8"));
  const asOf=Date.parse(published.generatedAt)+86400000,first=await readMexcSnapshot(root,asOf);
  assert.equal(first.review.entries.length,61);assert.equal(first.review.totals.confirmedPrincipalRaw,"138838196314");assert.equal(first.reviewError,null);
  assert.equal(first.runtime.snapshotOrigin,"reviewed-publication");assert.equal(first.runtime.usddSnapshotOrigin,"reviewed-publication");
  assert.equal(first.generatedAt,published.generatedAt);assert.equal(first.runtime.stale,true);
  await assert.rejects(fs.stat(path.join(root,"data")),{code:"ENOENT"});
  await fs.mkdir(path.join(root,"data"));
  await fs.writeFile(path.join(root,"data/mexc-snapshot.json"),JSON.stringify({...published,generatedAt:new Date(asOf).toISOString()}));
  const next=await readMexcSnapshot(root,asOf);
  assert.equal(next.runtime.snapshotOrigin,"collector");assert.equal(next.runtime.usddSnapshotOrigin,"reviewed-publication");assert.equal(next.runtime.stale,false);
  assert.equal(next.review.reviewedAt,first.review.reviewedAt);assert.deepEqual(next.review.totals,first.review.totals);
  await fs.writeFile(path.join(root,"mexc-sources.json"),JSON.stringify({...book,addresses:[]}));
  const changed=await readMexcSnapshot(root,asOf);assert.equal(changed.coverage.status,"sources-changed");assert.equal(changed.review,null);
});
test("real direct PSM and routed PSM conversions connect USDT to USDD Mint with exact decimal units",()=>{
  const result=analyze(receipts);assert.equal(result.events.length,2);
  for(const e of result.events){assert.equal(e.kind,"conversion");assert.equal(e.asset,"USDD");assert.equal(e.decimals,18);assert.equal(e.operation,"Mint");assert.equal(e.attributedRaw,null);assert.equal(e.evidence.length,4);}
  const tracked=C.trackRights({events:result.events,rows:result.rows,receipts,accountTypes:types,market:C.MARKETS.USDD});
  assert.equal(Object.keys(tracked.members).length,2);
  assert.equal(tracked.members[Object.keys(types).find(a=>a.startsWith("TYYC"))].edge.amountRaw,"131747184986357");
  assert.equal(C.analyze({receipts,sources:book,accountTypes:types,since:fixture.since,until:fixture.until}).events.some(e=>e.asset==="USDD"),false);
});
test("unverified swap, wrong amount, wrong PSM, wrong recipient and different transaction never prove conversion",()=>{
  const id="599113a4992dc6c53579988f21584109d42a6415b2aa1da28f172f79985eaa96",r=receipts[id];
  for(const mutate of [
    x=>x.actions=[],
    x=>x.actions[0].contract=C.USDT,
    x=>x.actions[0].result.value="1",
    x=>x.transfers.find(t=>t.contract===C.USDD).amountRaw="13191448500",
    x=>x.transfers.find(t=>t.contract===C.USDD).to=C.address("1".padStart(40,"0")),
    x=>x.transfers.find(t=>t.contract===C.USDD).eventIndex=0
  ]){const changed=structuredClone(r);mutate(changed);assert.equal(C.conversions({[id]:changed}).size,0);}
  assert.equal(C.conversions({a:{transfers:r.transfers.filter(t=>t.contract===C.USDT),actions:r.actions},b:{transfers:r.transfers.filter(t=>t.contract===C.USDD),actions:[]}}).size,0);
});
test("USDD collector discovers both real conversion wallets, resumes independently and reads the USDD market",async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"mexc-usdd-"));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,"mexc-sources.json"),JSON.stringify(book));
  const transfers=Object.values(receipts).flatMap(r=>r.transfers),calls=[];
  const provider={type:async a=>types[a]||"contract",page:async(a,s)=>{calls.push({a,s:{...s}});return {rows:transfers.filter(r=>(s.incoming?r.to===a:r.to===a||r.from===a)&&(!s.asset||s.asset===r.contract)&&r.blockTs>=s.since&&r.blockTs<=s.until),next:""};},
    receipt:async id=>{if(!receipts[id])throw Error("missing receipt");return receipts[id];},position:async(a,m)=>{assert.equal(m.jToken,C.JUSDD);return {jTokenRaw:"1",borrowRaw:"0",exchangeRateRaw:"100000000000000000000000000",underlyingRaw:"100000000"};},frozen:async()=>"clear"};
  const options={market:C.MARKETS.USDD,backfillUntil:fixture.until,pagesPerAccount:5,accountsPerCycle:30,receiptsPerCycle:50};
  let snapshot;const monitor=createMexcMonitor({root,provider,options,clock:()=>fixture.until});
  for(let i=0;i<8;i++){snapshot=await monitor.refresh();if(snapshot.coverage.scanComplete)break;}
  assert.equal(snapshot.coverage.scanComplete,true);assert.equal(snapshot.events.length,2);assert.equal(snapshot.positions.length,2);
  assert.ok(snapshot.positions.every(p=>p.asset==="USDD"&&p.decimals===18));
  assert.equal(snapshot.scope,"MEXC-USDD-jUSDD");assert.equal(calls.some(c=>c.s.incoming&&c.s.asset===C.USDT),false);
  await assert.rejects(fs.stat(path.join(root,"data/mexc-state.json")),{code:"ENOENT"});
  const count=calls.length;await createMexcMonitor({root,provider,options,clock:()=>fixture.until}).refresh();assert.equal(calls.length,count);
});
test("review reconciles 23 USDT transactions plus two USDD conversions without duplicate principal",()=>{
  validateReview(review);assert.equal(review.entries.length,25);assert.equal(review.entries.filter(e=>e.review.status==="confirmed").length,3);
  assert.equal(review.totals.confirmedPrincipalRaw,"15202390217");assert.equal(review.totals.suspectedAdditionalUpperRaw,"83844713421");
  const duplicate=structuredClone(review);duplicate.confirmedSources.push(duplicate.confirmedSources[0]);assert.throws(()=>validateReview(duplicate));
  const wrong=structuredClone(review);wrong.totals.suspectedAdditionalUpperRaw=wrong.totals.sameAssetUpperRaw;assert.throws(()=>validateReview(wrong));
  const exceed=structuredClone(review);exceed.retention[0].upperRaw=(BigInt(exceed.retention[0].wholeRaw)+1n).toString();assert.throws(()=>validateReview(exceed));
});
test("new candidates never inflate reviewed totals; source changes invalidate review; later outflow flags retention",()=>{
  const base={sourceVersion:review.sourceVersion,scope:"MEXC-USDT-jUSDT",events:[],positions:[],coverage:{},until:review.until};
  const e={...review.entries[0],id:"new",txid:"f".repeat(64)},usdd={...base,scope:"MEXC-USDD-jUSDD",events:[e],rights:[{from:review.retention.at(-1).address,blockTs:Date.parse(review.positionsAsOf)+1000}]};
  const s=combineSnapshots(base,usdd,review);assert.equal(s.events.length,26);assert.equal(s.review.newPendingCount,1);assert.equal(s.review.totals.confirmedPrincipalRaw,review.totals.confirmedPrincipalRaw);
  assert.ok(s.review.retention.at(-1).needsReview);assert.equal(s.review.historical,true);
  assert.equal(combineSnapshots({...base,sourceVersion:"changed"},usdd,review).review,null);
  assert.equal(combineSnapshots(base,null,null).marketCoverage.USDD.scanComplete,false);
  assert.equal(combineSnapshots(base,{...usdd,generatedAt:"invalid"},review).runtime.usddStale,true);
  assert.equal(combineSnapshots({...base,limitations:["跨链、换币不在本期范围。"]},usdd,review).limitations.some(x=>x.includes("换币不在本期")),false);
});
test("review UI keeps fixed audit totals across asset/strength filters and clears invalidated retention",async()=>{
  const vm=require("node:vm"),nodes=new Map(),listeners={};
  const document={hidden:false,getElementById:id=>{if(!nodes.has(id))nodes.set(id,{value:id==="mexcPeriod"?"30":"all",innerHTML:"",listeners:{},classList:{toggle(){},add(){}},addEventListener(n,f){this.listeners[n]=f;}});return nodes.get(id);},addEventListener:(n,f)=>{listeners[n]=f;}};
  const base={sourceVersion:review.sourceVersion,scope:"MEXC-USDT-jUSDT",events:[],positions:[],sources:book,coverage:{},until:review.until};
  let data=combineSnapshots(base,null,review);
  vm.runInNewContext(await fs.readFile(path.join(__dirname,"mexc-ui.js"),"utf8"),{document,fetch:async()=>({ok:true,json:async()=>data}),AbortSignal,Date,BigInt,setInterval(){}});
  listeners["dashboard:tab"]({detail:"mexc"});await new Promise(r=>setImmediate(r));
  const card=nodes.get("mexcMetrics").innerHTML;assert.match(card,/15,202.39/);assert.match(card,/83,844.71/);assert.match(card,/13,191.45/);
  const filter=(id,v)=>{nodes.get(id).value=v;nodes.get(id).listeners.change();};
  filter("mexcAsset","USDD");filter("mexcStrength","confirmed");assert.match(nodes.get("mexcCount").textContent,/2 条展示/);assert.match(nodes.get("mexcEvents").innerHTML,/13,191.4485/);assert.match(nodes.get("mexcEvents").innerHTML,/PSM换币证据/);
  filter("mexcStrength","weak");assert.match(nodes.get("mexcEvents").innerHTML,/当前筛选下暂无记录/);assert.equal(nodes.get("mexcMetrics").innerHTML,card);
  filter("mexcAsset","all");filter("mexcStrength","all");assert.match(nodes.get("mexcCount").textContent,/25 条展示/);
  data.marketCoverage.USDD={status:"bounded",limits:{accounts:true},errors:[{address:Object.keys(types)[0],error:"TronGrid HTTP 429"}]};await nodes.get("mexcRefresh").listeners.click();
  assert.match(nodes.get("mexcMarketCoverage").innerHTML,/已触及上限，结果不完整/);assert.match(nodes.get("mexcErrors").innerHTML,/USDD.*TronGrid HTTP 429/);
  data=combineSnapshots({...base,sourceVersion:"changed"},null,review);await nodes.get("mexcRefresh").listeners.click();
  assert.equal(nodes.get("mexcRetentionSummary").innerHTML,"");assert.equal(nodes.get("mexcUnresolved").innerHTML,"");assert.match(nodes.get("mexcMetrics").innerHTML,/待复核/);
});
test("completed USDD audit reconciles joint source bounds, new leads and refreshed retention",()=>{
  const r=structuredClone(require("./mexc-attribution-review.json"));validateReview(r);
  assert.equal(r.version,2);assert.equal(r.entries.length,61);assert.equal(r.additionalUSDD.reviewedCount,38);assert.equal(r.additionalUSDD.addedCount,36);
  assert.equal(r.totals.confirmedPrincipalRaw,"138838196314");assert.equal(r.additionalUSDD.addedLowerRaw,"123635806098");
  assert.equal(r.additionalUSDD.zeroPrincipalCount,24);assert.equal(r.totals.overlapUpperAdjustmentRaw,"38");
  assert.equal(r.retention.find(p=>p.address.startsWith("TYYC")&&p.asset==="USDD").lowerRaw,"0");
  assert.ok(BigInt(r.retention.find(p=>p.address.startsWith("TAja")).lowerRaw)>113295n*10n**18n);
  for(const mutate of [
    x=>x.totals.principalUpperRaw=x.totals.independentUpperRaw,
    x=>x.auditCoverage.receiptPending=1,
    x=>x.additionalUSDD.retainedUpperRaw="0",
    x=>x.groups.find(g=>g.asset==="USDD").sourceEvidence[0].amountRaw="1",
    x=>{const gs=x.groups.filter(g=>g.asset==="USDD");gs[1].sourceEvidence.push(gs[0].sourceEvidence[0]);}
  ]){const changed=structuredClone(r);mutate(changed);assert.throws(()=>validateReview(changed));}
  const early=r.retention.find(p=>p.asset==="USDD"),stamp=Date.parse(early.asOf)+1;
  const base={sourceVersion:r.sourceVersion,scope:"MEXC-USDT-jUSDT",events:[],coverage:{},until:r.until};
  const dd={...base,scope:"MEXC-USDD-jUSDD",rights:[{from:early.address,blockTs:stamp}]};
  assert.ok(combineSnapshots(base,dd,r).review.retention.find(p=>p.address===early.address).needsReview);
});
test("completed audit UI shows confirmed mixed-fund lower bounds and new USDD retention separately",async()=>{
  const r=require("./mexc-attribution-review.json"),vm=require("node:vm"),nodes=new Map(),listeners={};
  const document={hidden:false,getElementById:id=>{if(!nodes.has(id))nodes.set(id,{value:id==="mexcPeriod"?"30":"all",innerHTML:"",listeners:{},classList:{toggle(){},add(){}},addEventListener(n,f){this.listeners[n]=f;}});return nodes.get(id);},addEventListener:(n,f)=>{listeners[n]=f;}};
  const base={sourceVersion:r.sourceVersion,scope:"MEXC-USDT-jUSDT",events:[],positions:[],sources:book,coverage:{},until:r.until};
  const data=combineSnapshots(base,null,r);
  data.runtime.snapshotOrigin="reviewed-publication";data.runtime.usddSnapshotOrigin="reviewed-publication";
  vm.runInNewContext(await fs.readFile(path.join(__dirname,"mexc-ui.js"),"utf8"),{document,fetch:async()=>({ok:true,json:async()=>data}),AbortSignal,Date,BigInt,setInterval(){}});
  listeners["dashboard:tab"]({detail:"mexc"});await new Promise(resolve=>setImmediate(resolve));
  assert.match(nodes.get("mexcNotice").textContent,/USDT \/ USDD 显示已发布的复核快照，持续采集未启用/);
  assert.doesNotMatch(nodes.get("mexcLimitations").innerHTML,/独立采集器配置周期/);
  const cards=nodes.get("mexcMetrics").innerHTML;assert.match(cards,/138,838.19/);assert.match(cards,/173,548.83/);assert.match(cards,/123,626.42/);
  assert.match(nodes.get("mexcReviewNote").innerHTML,/38 笔已复核/);assert.match(nodes.get("mexcReviewNote").innerHTML,/36 笔为本次新增/);assert.match(nodes.get("mexcReviewNote").innerHTML,/123,635.80/);
  assert.match(nodes.get("mexcReviewNote").innerHTML,/对应 jUSDD 留存折合/);assert.match(nodes.get("mexcRetention").innerHTML,/下限可确认/);
  assert.equal(nodes.get("mexcDeepening").hidden,false);assert.match(nodes.get("mexcDeepening").innerHTML,/SunX/);assert.match(nodes.get("mexcDeepening").innerHTML,/尚未取得能可靠缩小/);assert.match(nodes.get("mexcDeepening").innerHTML,/不是实际资金归属的判定/);
  assert.match(nodes.get("mexcDeepening").innerHTML,/113,295.89/);assert.match(nodes.get("mexcDeepening").innerHTML,/203,000.00/);
  nodes.get("mexcAsset").value="USDD";nodes.get("mexcAsset").listeners.change();assert.match(nodes.get("mexcCount").textContent,/38 条展示/);
  assert.match(nodes.get("mexcEvents").innerHTML,/本组 MEXC 来源出款证据/);assert.match(nodes.get("mexcEvents").innerHTML,/各笔|逐笔上限可能共享来源/);
  nodes.get("mexcStrength").value="diverted";nodes.get("mexcStrength").listeners.change();assert.match(nodes.get("mexcCount").textContent,/24 条展示/);assert.equal(nodes.get("mexcMetrics").innerHTML,cards);
});
test("deepening breakdown reconciles uncertainty and stale review invalidates the focused balance",()=>{
  const r=structuredClone(require("./mexc-attribution-review.json"));validateReview(r);assert.equal(r.deepening.reductionRaw,"0");
  assert.equal(r.deepening.focus.uncertainRaw,"89704109838");assert.equal(r.deepening.focus.downstream.directReturnCount,0);
  for(const mutate of [x=>x.deepening.breakdown[0].uncertainRaw="0",x=>x.deepening.focus.lowerRaw="0",x=>x.deepening.focus.cases[0].principalRaw="0"]){const bad=structuredClone(r);mutate(bad);assert.throws(()=>validateReview(bad));}
  const base={sourceVersion:r.sourceVersion,scope:"MEXC-USDT-jUSDT",events:[],coverage:{},until:r.until};
  const usdd={...base,scope:"MEXC-USDD-jUSDD",rights:[{from:r.deepening.focus.address,blockTs:Date.parse(r.deepening.focus.retention.asOf)+1}]};
  assert.ok(combineSnapshots(base,usdd,r).review.deepening.focus.retention.needsReview);
});
