"use strict";
const C=require("./mexc-core");

// At the second wallet, a third wallet cannot establish a two-wallet path.
// Contract relays require ordered logs from one complete receipt, retained in
// full below. Unindexed account rows alone cannot prove that same-tx relay.
function canDiscardFunding(row,state,seeds) {
  const account=state.accounts[row.to];
  return row.contract===C.USDT && row.eventIndex==null && !seeds.has(row.from)
    && account?.type==="wallet" && account.depth>=1 && !account.rights;
}
function compactState(state,{sources,market,since=0}) {
  const seeds=new Set(sources.addresses.filter(a=>a.status==="verified").map(a=>a.address));
  const before=state.transfers.length;
  state.transfers=state.transfers.filter(row=>{
    if(!canDiscardFunding(row,state,seeds))return true;
    state.accounts[row.to].fundingCompacted=true;
    return false;
  });
  for(const account of Object.values(state.accounts)) {
    for(const stream of [account.history,account.head,...(account.history?.segments||[])])if(stream?.done){delete stream.seen;stream.cursor="";}
    // Backfill may have ended days before the first continuous run. Start the
    // head at the last fixed boundary, never at wall-clock time minus a minute.
    if(!account.through&&account.history)account.through=account.history.until;
  }
  state.compaction={version:1,market:market.symbol,removedRows:(state.compaction?.removedRows||0)+before-state.transfers.length,
    scope:"two-wallet-unindexed-USDT-funding; complete receipts and all rights retained"};
  return state;
}
function promoteCompacted(account,depth,rights,{since,until,streamFields}) {
  if(!(account.fundingCompacted&&(depth<1||rights)||rights&&!account.rights||account.watchOnly&&depth<2))return false;
  account.history={since,until,cursor:"",done:false,...streamFields};
  account.head=null;account.fundingCompacted=false;account.lastSuccess=0;
  return true;
}
// A dictionary shares repeated address strings and omits repeated JSON keys.
// Token quantities remain decimal strings; no monetary value becomes Number.
function packState(state) {
  const strings=[],ids=new Map(),id=s=>{if(!ids.has(s)){ids.set(s,strings.length);strings.push(s);}return ids.get(s);};
  const rows=state.transfers.map(r=>[r.txid,id(r.from),id(r.to),id(r.contract),r.amountRaw,r.blockTs,r.eventIndex]);
  return {...state,transfers:undefined,transferTable:{version:1,strings,rows}};
}
function unpackState(state) {
  const table=state.transferTable;if(!table)return state;
  if(table.version!==1||!Array.isArray(table.strings)||!Array.isArray(table.rows))throw Error("Invalid MEXC transfer table");
  const dict=table.strings;
  if(dict.some(s=>typeof s!=="string"||!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s)))throw Error("Invalid MEXC address dictionary");
  state.transfers=table.rows;
  for(let i=0;i<state.transfers.length;i++){
    const r=state.transfers[i];
    if(!Array.isArray(r)||r.length!==7||!/^[a-f0-9]{64}$/i.test(r[0])||!r.slice(1,4).every(n=>Number.isInteger(n)&&dict[n])||!C.raw(r[4])||!Number.isSafeInteger(r[5])||r[6]!==null&&!Number.isInteger(r[6]))throw Error("Invalid MEXC packed transfer");
    state.transfers[i]={txid:r[0],from:dict[r[1]],to:dict[r[2]],contract:dict[r[3]],amountRaw:r[4],blockTs:r[5],eventIndex:r[6]};
  }
  delete state.transferTable;return state;
}
module.exports={canDiscardFunding,compactState,promoteCompacted,packState,unpackState};
