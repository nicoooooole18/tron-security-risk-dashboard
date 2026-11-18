"use strict";
// Offline export only. Originals remain available for complete cash attribution.
const fs=require("node:fs/promises"),path=require("node:path"),C=require("./mexc-core");
const {compactState,packState}=require("./mexc-compact"),{readJson,atomicJson}=require("./mexc-monitor");
async function exportMarket({root=__dirname,out,market,verify=true}) {
  const prefix=market.symbol==="USDD"?"mexc-usdd":"mexc";
  const sourceFile=path.join(root,`data/${prefix}-state.json`),book=await readJson(path.join(root,"mexc-sources.json"));
  const state=await readJson(sourceFile),snapshot=await readJson(path.join(root,`data/${prefix}-snapshot.json`));
  const {getHubs}=require("./mexc-worker"),hubs=await getHubs();
  const types=Object.fromEntries(Object.entries(state.accounts).map(([a,q])=>[a,q.type]));
  const analyze=s=>C.analyze({transfers:s.transfers,receipts:s.receipts,sources:book,accountTypes:types,hubs,
    since:Date.parse(snapshot.since),until:Date.parse(snapshot.until),market,maxVisits:2000000});
  const before=verify?analyze(state):null;
  const priorRows=state.transfers.length;compactState(state,{sources:book,market});
  const after=verify?analyze(state):null;
  if(verify){
    if(before.graphLimited||after.graphLimited||JSON.stringify(before.events)!==JSON.stringify(after.events))throw Error("Compaction changed evidence or hit graph limit");
    const rights=a=>C.trackRights({events:Object.values(state.archive),rows:a.rows,receipts:state.receipts,members:state.members,accountTypes:types,hubs,market,maxMembers:10000});
    if(JSON.stringify(rights(before))!==JSON.stringify(rights(after)))throw Error("Compaction changed rights evidence");
  }
  const target=path.join(out,market.symbol,"data",`${prefix}-state.json`);
  await atomicJson(target,packState(state));
  return {market:market.symbol,priorRows,rows:state.transfers.length,sourceBytes:(await fs.stat(sourceFile)).size,bytes:(await fs.stat(target)).size,
    verified:verify,events:after?.events.length,sourceVersion:state.sourceVersion,target};
}
if(require.main===module){
  const market=C.MARKETS[process.argv.find(a=>a.startsWith("--market="))?.split("=")[1]||"USDT"];
  const out=process.argv.find(a=>a.startsWith("--out="))?.slice(6);
  if(!market||!out)throw Error("Use --market=USDT|USDD --out=/absolute/path");
  exportMarket({market,out:path.resolve(out)}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={exportMarket};
