"use strict";
const path=require("node:path"),fs=require("node:fs/promises");
const C=require("./mexc-core"),{createProvider,loadEnv}=require("./mexc-provider");
const {createMexcMonitor,readJson,atomicJson}=require("./mexc-monitor"),{getHubs}=require("./mexc-worker");
function watchAccounts(review,market) {
  const follow=review.usdtDeepening?.tm9?.followup,rows=review.retention.filter(p=>p.asset===market.symbol);
  const more=market.symbol==="USDT"?follow?.originalShareRetention.positions:follow?.usddReturn.watchpoints;
  const map=new Map();
  for(const p of [...rows,...(more||[])]){
    const since=Date.parse(p.asOf||review.positionsAsOf);
    if(!C.validAddress(p.address)||!Number.isFinite(since))throw Error("Invalid reviewed watchpoint");
    map.set(p.address,{address:p.address,since:Math.min(map.get(p.address)?.since||Infinity,since)});
  }
  return [...map.values()];
}
const OPTIONS={compact:true,concurrency:1,accountsPerCycle:24,pagesPerAccount:2,receiptsPerCycle:4,
  positionsPerCycle:24,maxAccounts:8000,maxTransfers:80000,maxReceipts:16000,maxArchive:5000,maxMembers:1000,maxGraphVisits:200000};
async function runCycle({root=__dirname,market,provider,clock=Date.now}) {
  const stateRoot=path.join(root,"data/mexc-live",market.symbol),prefix=market.symbol==="USDD"?"mexc-usdd":"mexc";
  const file=path.join(stateRoot,`data/${prefix}-state.json`),stat=await fs.stat(file);
  if(stat.size>36*1024*1024)throw Error("MEXC state exceeds bounded worker size; retain last snapshot and inspect capacity");
  const review=await readJson(path.join(root,"mexc-attribution-review.json")),started=clock();
  const monitor=createMexcMonitor({root:stateRoot,provider,getHubs,clock,readSources:()=>readJson(path.join(root,"mexc-sources.json")),
    options:{...OPTIONS,market,watchAccounts:watchAccounts(review,market),frozenPerCycle:market.symbol==="USDT"?13:0}});
  const snapshot=await monitor.refresh();
  snapshot.collection={mode:"bounded-continuous",startedAt:new Date(started).toISOString(),finishedAt:new Date(clock()).toISOString(),
    durationMs:clock()-started,maxRssKiB:process.resourceUsage().maxRSS,...provider.stats?.()};
  await atomicJson(path.join(root,`data/${prefix}-snapshot.json`),snapshot);
  return {market:market.symbol,...snapshot.collection,marketThrough:snapshot.coverage.marketThrough,historyPending:snapshot.coverage.historyPending,
    headPending:snapshot.coverage.headPending,receiptPending:snapshot.coverage.receiptPending,limits:snapshot.coverage.limits,
    errors:snapshot.coverage.errors.length,positions:snapshot.positions.length,stateBytes:(await fs.stat(file)).size};
}
if(require.main===module){
  loadEnv();const market=C.MARKETS[process.argv.find(x=>x.startsWith("--market="))?.slice(9)];
  if(!market)throw Error("Expected --market=USDT or --market=USDD");
  const provider=createProvider({delayMs:1500,maxRequests:96,maxDurationMs:150000,circuitBreakOnRateLimit:true});
  runCycle({market,provider}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(`[mexc-cycle] ${e.message}`);process.exitCode=1;});
}
module.exports={runCycle,watchAccounts,OPTIONS};
