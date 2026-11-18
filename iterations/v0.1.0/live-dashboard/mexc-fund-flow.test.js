"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),C=require("./mexc-core"),{buildFundGraph,retainedShares,SCALE}=require("./mexc-fund-flow");
const book=require("./mexc-sources.json"),S=book.addresses[0].address,A=C.address("1".padStart(40,"0")),B=C.address("2".padStart(40,"0")),X=C.address("3".padStart(40,"0"));
const row=(i,from,to,amount,contract=C.USDT)=>({txid:i.toString(16).padStart(64,"0"),blockTs:i*1000,from,to,contract,amountRaw:String(amount),eventIndex:0});
function graph(rs,balances){const receipts=Object.fromEntries(rs.map(r=>[r.txid,{txid:r.txid,transfers:[r],actions:[]}])),wallets=Object.fromEntries(Object.entries(balances).map(([a,v])=>[a,{complete:true,through:1e6,rows:rs.filter(r=>r.from===a||r.to===a),balances:{[C.USDT]:String(v)}}]));return buildFundGraph({wallets,receipts,sources:book,since:0,until:1e6});}
test("flow bounds respect wallet mixtures, source conservation, chronology and first entry",()=>{
  const rs=[row(1,S,A,100),row(2,X,A,100),row(3,A,X,120),row(4,A,C.JUSDT,80),row(5,C.JUSDT,A,80),row(6,A,C.JUSDT,80)];
  const g=graph(rs,{[A]:0});assert.deepEqual([g.bounds([C.key(rs[3])]).lowerRaw,g.bounds([C.key(rs[3])]).upperRaw],["0",String(80n*SCALE)]);
  assert.equal(g.bounds([C.key(rs[5])]).upperRaw,"0");assert.equal(g.bounds([C.key(rs[3]),C.key(rs[5])]).upperRaw,String(80n*SCALE));
  const future=[row(1,X,A,80),row(2,A,C.JUSDT,80),row(3,S,A,100)];assert.equal(graph(future,{[A]:100}).bounds([C.key(future[1])]).upperRaw,"0");
  const forced=[row(1,S,A,100),row(2,X,A,20),row(3,A,C.JUSDT,110)];const f=graph(forced,{[A]:10}).bounds([C.key(forced[2])]);assert.equal(f.lowerRaw,String(90n*SCALE));assert.equal(f.upperRaw,String(100n*SCALE));
});
test("joint bounds do not add competing per-transaction maxima and balances must reconcile",()=>{
  const rs=[row(1,S,A,100),row(2,X,A,100),row(3,A,B,200),row(4,B,C.JUSDT,100),row(5,B,C.JUSDT,100)];const g=graph(rs,{[A]:0,[B]:0});
  assert.equal(g.bounds([C.key(rs[3])]).upperRaw,String(100n*SCALE));assert.equal(g.bounds([C.key(rs[4])]).upperRaw,String(100n*SCALE));
  const both=g.bounds([C.key(rs[3]),C.key(rs[4])]);assert.equal(both.lowerRaw,String(100n*SCALE));assert.equal(both.upperRaw,String(100n*SCALE));
  assert.throws(()=>graph([row(1,S,A,100)],{[A]:0}),/Opening balance/);
});
test("verified PSM carries mixed USDT principal into USDD with exact units; missing proof never does",()=>{
  const paid={...row(3,A,C.PSM_JOIN,150),eventIndex:0},received={...row(3,C.ZERO,A,150n*SCALE,C.USDD),eventIndex:1};
  const rs=[row(1,S,A,100),row(2,X,A,50),paid,received,row(4,A,C.JUSDD,120n*SCALE,C.USDD)];
  const receipts={};for(const r of rs){receipts[r.txid]||={txid:r.txid,transfers:[],actions:[]};receipts[r.txid].transfers.push(r);}
  receipts[paid.txid].actions=[{contract:C.PSM,name:"SellGem",result:{owner:A,value:"150",fee:"0"},eventIndex:2}];
  const wallets={[A]:{complete:true,through:1e6,rows:rs,balances:{[C.USDT]:"0",[C.USDD]:String(30n*SCALE)}}};
  const calc=()=>buildFundGraph({wallets,receipts,sources:book,since:0,until:1e6}).bounds([C.key(rs.at(-1))]);
  assert.deepEqual([calc().lowerRaw,calc().upperRaw],[String(70n*SCALE),String(100n*SCALE)]);
  receipts[paid.txid].actions=[];assert.equal(calc().upperRaw,"0");
  delete receipts[paid.txid];assert.throws(calc,/Missing canonical receipt/);
});
test("later redemption reduces confirmed shares and unrelated new mints cannot restore them",()=>{
  const shares=[{...row(1,C.JUSDD,A,100,C.JUSDD),eventIndex:3},row(2,A,C.JUSDD,90,C.JUSDD),row(3,C.JUSDD,A,100,C.JUSDD)];
  const receipts=Object.fromEntries(shares.map(r=>[r.txid,{transfers:[r]}]));const wallet={rows:shares,through:1e6,balances:{[C.JUSDD]:"110"},positions:{USDD:{exchangeRateRaw:String(10n**18n)}}};
  const entries=[{txid:shares[0].txid,amountRaw:"1000",mintTokens:"100",actionIndex:2,attribution:{lowerRaw:"600",upperRaw:"800"}}];
  const r=retainedShares({address:A,wallet,receipts,entries});assert.equal(r.lowerRaw,"0");assert.equal(r.upperRaw,"10");assert.equal(r.wholeRaw,"110");
});
test("TAja real ledgers admit both attribution endpoints; equal SunX in/out does not fix ownership",()=>{
  const fixture=require("./test-fixtures/mexc-taja-mixing-2026-11-17.json"),{verifyWitness}=require("./mexc-fund-flow");
  const g=buildFundGraph({...fixture,sources:book}),ids=fixture.entries.map(C.key),b=g.bounds(ids);
  assert.equal(b.lowerRaw,"113295890162000000000000");assert.equal(b.upperRaw,"203000000000000000000000");
  const lower=g.witness(ids,"lower"),upper=g.witness(ids,"upper");assert.ok(verifyWitness(lower));assert.ok(verifyWitness(upper));
  const returnAmount=w=>w.edges.find(e=>e.transfer?.txid.startsWith("b18fd97a")).flowRaw;
  assert.notEqual(returnAmount(lower),returnAmount(upper));
  for(const w of [lower,upper])assert.ok(w.edges.filter(e=>e.kind==="source").every(e=>e.flowRaw===e.capacityRaw));
  const corrupt=structuredClone(lower);corrupt.edges.find(e=>e.kind==="source").flowRaw="0";assert.throws(()=>verifyWitness(corrupt),/conservation/);
  assert.throws(()=>g.witness(ids,"fifo"),/Invalid extremum/);
});
