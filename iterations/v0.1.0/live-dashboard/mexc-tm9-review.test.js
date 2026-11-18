"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),C=require("./mexc-core"),F=require("./mexc-fund-flow"),{buildShareGraph}=require("./mexc-tm9-flow"),{POOL,TEA,SINCE}=require("./mexc-tm9-collect"),{ROUTER,buildTM9Followup}=require("./mexc-tm9-review");
test("jUSDT flow shares one cohort cap across two Mints and retains only reachable balances",()=>{
  const leaf="TTswa7EY4QpdfH5xU3LFjpx2bR8WKVGYoo",tr=(i,from,to,amountRaw)=>({txid:String(i).repeat(64),blockTs:i*1000,eventIndex:3,from,to,contract:C.JUSDT,amountRaw}),rs=[tr(1,C.JUSDT,TEA,"1000"),tr(2,TEA,POOL,"1000"),tr(3,POOL,leaf,"600"),tr(4,C.JUSDT,TEA,"1000"),tr(5,TEA,POOL,"1000"),tr(6,leaf,C.JUSDT,"600"),tr(7,POOL,C.JUSDT,"1390")];
  const receipts=Object.fromEntries(rs.map(r=>[r.txid,{txid:r.txid,transfers:[r]}])),wallets=Object.fromEntries([TEA,POOL,leaf].map(a=>[a,{complete:true,through:8000,rows:rs.filter(r=>r.from===a||r.to===a),balances:{[C.JUSDT]:a===POOL?"10":"0"}}])),mints=[rs[0],rs[3]].map(r=>({txid:r.txid,from:TEA,amountRaw:"100",mintTokens:"1000",actionIndex:2}));
  const g=buildShareGraph({wallets,receipts,mints,cashRaw:"50",since:0,router:ROUTER});assert.equal(g.sourceTotal,"500");assert.deepEqual(g.bounds([`end:${POOL}`]),{lowerRaw:"0",upperRaw:"10"});assert.equal(g.bounds(g.exits.map(e=>e.id)).upperRaw,"500");assert.ok(F.verifyWitness(g.witness([`end:${POOL}`],"upper")));
  const broken=structuredClone(wallets);broken[POOL].balances[C.JUSDT]="0";assert.throws(()=>buildShareGraph({wallets:broken,receipts,mints,cashRaw:"50",since:0,router:ROUTER}),/opening/);
});
test("real TM9 share exits, router, 23 Redeems and common cash convergence reconcile",()=>{
  const f=require("./test-fixtures/mexc-tm9-followup-2026-11-18.json"),{review,proof}=buildTM9Followup(f),r=review.usdtDeepening.tm9.followup;
  assert.equal(r.cohortCashRaw,"31383102500");assert.equal(r.originalShareRetention.upperSharesRaw,"120946437");assert.equal(r.originalShareRetention.upperRaw,"13183");assert.equal(r.redeemedOriginalPrincipalLowerRaw,"31383089329");assert.equal(r.coverage.redeemingWallets,23);assert.equal(r.poolRecipients.length,24);assert.equal(r.routerRoutes.length,1);
  assert.equal(r.confirmedMexcRaw,"0");assert.equal(r.protocolWideUpperRaw,null);assert.equal(r.unresolvedCashPrincipalUpperRaw,r.cohortCashRaw);
  assert.equal(r.cashConvergence.cashRaw,"2343946217772");assert.equal(r.teaCashReturn.cashRaw,"1044904297209");assert.equal(r.teaCashReturn.redeem.amountRaw,"2343970962037");assert.equal(r.teaCashReturn.tseCashRemainingRaw,"962037");
  for(const p of [proof.lower,proof.upper,proof.allRedemptionCash.lower,proof.allRedemptionCash.upper])assert.ok(F.verifyWitness(p));
});
test("missing branch, unequal router transfer or unverified Redeem never closes TM9",()=>{
  const f=require("./test-fixtures/mexc-tm9-followup-2026-11-18.json"),routerTx="8842cda46f8670271be75a9c17f863dd1c82418073d38f0eb55b7434dd8dab12";
  for(const change of [x=>delete x.audit.wallets["TTswa7EY4QpdfH5xU3LFjpx2bR8WKVGYoo"],x=>x.audit.receipts[routerTx].transfers.find(r=>r.from===ROUTER).amountRaw="1",x=>x.audit.receipts["02556827ee776d7b9792e9eb56545b4c938c4a7e8c69bebb8311db95a4eecc3f"].actions.find(a=>a.name==="Redeem").contract=C.USDT]){const bad=structuredClone(f);change(bad);assert.throws(()=>buildTM9Followup(bad));}
});
test("dashboard validation separates source, original shares and unknown protocol-wide retention",()=>{
  const {validateReview,combineSnapshots}=require("./mexc-attribution"),r=require("./mexc-attribution-review.json"),f=r.usdtDeepening.tm9.followup;validateReview(r);
  for(const change of [x=>x.confirmedMexcRaw=x.cohortCashRaw,x=>x.protocolWideUpperRaw=x.originalShareRetention.upperRaw,x=>x.originalShareRetention.upperRaw="0",x=>x.redeemedOriginalPrincipalLowerRaw=x.cohortCashRaw,x=>x.coverage.errors=1]){const bad=structuredClone(r);change(bad.usdtDeepening.tm9.followup);assert.throws(()=>validateReview(bad));}
  const base={scope:"MEXC-USDT-jUSDT",sourceVersion:r.sourceVersion,until:r.until,events:[],coverage:{},rights:[{from:POOL,to:TEA,blockTs:Date.parse(f.originalShareRetention.positions.find(p=>p.address===POOL).asOf)+1}]};assert.equal(combineSnapshots(base,null,r).review.usdtDeepening.tm9.followup.needsReview,true);
});
test("USDD follow-up shares the 0.062168 path cap and verifies redemption after jToken transfers",()=>{
  const f=require("./test-fixtures/mexc-tm9-followup-2026-11-18.json"),{buildUSDDReturn}=require("./mexc-tm9-usdd"),args={audit:f.audit,candidates:f.usddCandidates,redeemed:f.redeemed},built=buildUSDDReturn(args),u=built.result;
  assert.equal(u.entries.length,5);assert.equal(u.grossRaw,"396872000000000000000000");assert.equal(u.sourceUpperRaw,"62168000000000000");assert.equal(u.upstreamCashUpperRaw,"62168");assert.equal(u.bottleneck.balanceRaw,"62168");assert.equal(u.sourceScope,"observed-cash-path-excluding-external-reentry");assert.equal(u.upperRaw,"0");assert.equal(u.unresolvedSharesUpperRaw,"0");assert.equal(u.redemptions.length,5);assert.equal(u.watchpoints.length,10);
  for(const proof of Object.values(built.proof))assert.ok(F.verifyWitness(proof));
  const bad=structuredClone(args);bad.audit.receipts[u.redemptions[0].txid].actions.find(a=>a.name==="Redeem").contract=C.JUSDT;assert.throws(()=>buildUSDDReturn(bad),/Redeem 证据/);
});
