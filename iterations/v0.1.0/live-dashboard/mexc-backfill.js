"use strict";
const fs=require("node:fs/promises"),path=require("node:path");
const {createProvider,loadEnv}=require("./mexc-provider");
const {createMexcMonitor,readJson,atomicJson}=require("./mexc-monitor");
const {getHubs}=require("./mexc-worker");
const {MARKETS}=require("./mexc-core");
async function main(){
  loadEnv();const root=__dirname,dir=path.join(root,"data");await fs.mkdir(dir,{recursive:true});
  const lockPath=path.join(dir,"mexc-worker.lock"),lock=await fs.open(lockPath,"wx",0o600);await lock.writeFile(String(process.pid));
  let stopped=false;process.on("SIGTERM",()=>{stopped=true;});process.on("SIGINT",()=>{stopped=true;});
  try{
    let window=await readJson(path.join(dir,"mexc-backfill-window.json"),null);
    if(!window){window={until:Date.now()-120000,lookbackDays:30};await atomicJson(path.join(dir,"mexc-backfill-window.json"),window);}
    const market=process.argv.includes("--market=USDD")?MARKETS.USDD:MARKETS.USDT;
    const monitor=createMexcMonitor({root,provider:createProvider({delayMs:200}),getHubs,
      options:{market,backfillUntil:window.until,lookbackDays:window.lookbackDays,concurrency:4,historyShards:12,accountsPerCycle:24,pagesPerAccount:64,
        receiptsPerCycle:120,positionsPerCycle:100,maxAccounts:50000,maxTransfers:1000000,maxReceipts:100000,maxArchive:20000,maxMembers:10000,maxGraphVisits:2000000}});
    console.log(JSON.stringify({event:"start",since:new Date(window.until-30*86400000).toISOString(),until:new Date(window.until).toISOString()}));
    let previous="",stalls=0;
    for(let cycle=1;!stopped;cycle++){
      const s=await monitor.refresh(),c=s.coverage;
      const progress={cycle,generatedAt:s.generatedAt,accounts:c.totalAccounts,historyPending:c.historyPending,receiptPending:c.receiptPending,
        matches:s.summary.matchedCount,verified:s.summary.verifiedCount,errors:c.errors.length,receiptErrors:c.receiptErrors.length,limits:c.limits,complete:c.scanComplete};
      console.log(JSON.stringify({...progress,market:market.symbol}));await atomicJson(path.join(dir,market.symbol==="USDD"?"mexc-usdd-backfill-progress.json":"mexc-backfill-progress.json"),progress);
      if(c.scanComplete)break;
      const state=await readJson(path.join(dir,market.symbol==="USDD"?"mexc-usdd-state.json":"mexc-state.json"),{});
      const mark=JSON.stringify([c.totalAccounts,c.historyPending,c.receiptPending,state.transfers?.length,Object.keys(state.receipts||{}).length,Object.values(state.accounts||{}).map(a=>a.history?.segments?.map(s=>[s.cursor,s.done])||a.history?.cursor)]);
      stalls=mark===previous?stalls+1:0;previous=mark;
      if(stalls>=3 || Object.values(c.limits).some(Boolean))throw new Error("回查未完成：进度停滞或触及上限，需处理后续跑");
      if(c.errors.some(e=>/HTTP (403|429)/.test(e.error))||c.receiptErrors.some(e=>/HTTP (403|429)/.test(e.error)))throw new Error("回查受 API 限流影响，保留游标，待恢复后续跑");
    }
  }finally{await lock.close();await fs.unlink(lockPath);}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};
