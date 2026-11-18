"use strict";
const path=require("node:path");
const fs=require("node:fs/promises");
const {createProvider,loadEnv}=require("./mexc-provider");
const {createMexcMonitor,readJson}=require("./mexc-monitor");
const {MARKETS}=require("./mexc-core");
loadEnv();
async function getHubs(){
  const config=await readJson(path.join(__dirname,"config.json"),{}),s=config.riskSources||{};
  const set=new Set(s.xinbi?.publicHubAddresses||[]);
  for(const a of [...(s.htxSeedAddresses||[]),...(s.intermediatePlatformAddresses||[])])set.add(typeof a==="string"?a:a.address);
  const boundaries=await readJson(path.join(__dirname,"mexc-boundaries.json"),{addresses:[]});
  for(const row of boundaries.addresses)if(row.status==="verified")set.add(row.address);
  // These are independent Arkham entity labels observed while checking MEXC counterparties.
  for(const a of ["TU4vEruvZwLLkSfV9bNw12EJTPvNr7Pvaa","TG2CMGxnTPgQ6V58kiKd7wbyN8ewtAmY76","TGnBDu95RaJEaw7dJpqzHt8Sy7faayBGvj",
    "TJ7hhYhVhaxNx6BPyq7yFpqZrQULL3JSdb","TB5hhNQtJ54e2bR8PXyVDbK3GiaZhQbuHt","TLiNefURVRNiCbdabwPNRWHVLdLNNNeG9n","TMQZ7piTMHEzg9hLdB5WEaxZh8stSDWps4","TSx55tDJR1WNf9WQYqTLoW2ZW2zkyRVSVH"])set.add(a);
  return set;
}
async function main(){
  const root=process.env.MEXC_DATA_ROOT?path.resolve(process.env.MEXC_DATA_ROOT):__dirname;
  await fs.mkdir(path.join(root,"data"),{recursive:true});
  // Exclusive worker lock avoids concurrent writers. A crash leaves a lock for explicit operator review.
  const lockPath=path.join(root,"data/mexc-worker.lock");const lock=await fs.open(lockPath,"wx",0o600);
  await lock.writeFile(String(process.pid));
  let stopped=false;process.on("SIGTERM",()=>{stopped=true;});process.on("SIGINT",()=>{stopped=true;});
  const monitor=createMexcMonitor({root,provider:createProvider(),getHubs,
    readSources:()=>readJson(path.join(__dirname,"mexc-sources.json"),null)});
  const usdd=createMexcMonitor({root,provider:createProvider(),getHubs,options:{market:MARKETS.USDD},
    readSources:()=>readJson(path.join(__dirname,"mexc-sources.json"),null)});
  try{
    do{
      try{for(const collector of [monitor,usdd]){const d=await collector.refresh();console.log(JSON.stringify({market:d.market,generatedAt:d.generatedAt,matched:d.summary.matchedCount,accounts:d.coverage.totalAccounts,pending:d.coverage.historyPending}));}}
      catch(e){console.error(`[mexc] ${e.message}`);if(process.argv.includes("--once")){process.exitCode=1;break;}}
      if(process.argv.includes("--once")||stopped)break;
      for(let s=0;s<300&&!stopped;s++)await new Promise(r=>setTimeout(r,1000));
    }while(!stopped);
  }finally{await lock.close();await fs.unlink(lockPath);}
}
if(require.main===module)main().catch(e=>{console.error(`[mexc] ${e.message}`);process.exitCode=1;});
module.exports={getHubs};
