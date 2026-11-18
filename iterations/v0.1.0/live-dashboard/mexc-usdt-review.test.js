"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),C=require("./mexc-core"),F=require("./mexc-fund-flow"),{createProvider}=require("./mexc-provider"),{TX,TEA}=require("./mexc-usdt-review");
const fixture=require("./test-fixtures/mexc-psm-buygem-2026-11-18.json");
test("real PSM BuyGem requires matching burn, payout, owner, amount, zero fee and ordered events",()=>{
  assert.equal(C.reverseConversions(fixture).size,2);assert.equal(C.conversions(fixture).size,1);
  for(const change of [r=>r.actions[0].result.fee="1",r=>r.transfers.find(t=>t.to===C.ZERO).amountRaw="1",r=>r.transfers.find(t=>t.contract===C.USDT).to=C.ZERO,r=>r.transfers.find(t=>t.contract===C.USDT).eventIndex=0,r=>r.actions[0].contract=C.USDT]){
    const changed=structuredClone(fixture[TX.buy1]);change(changed);assert.equal(C.reverseConversions({[TX.buy1]:changed}).size,0);
  }
});
test("BuyGem graph connects only verified conversion, and explicit source caps limit repeated redeemed cash",()=>{
  const receipt=fixture[TX.buy1],ts=receipt.blockTs,deposit={txid:"1".repeat(64),blockTs:ts+1000,from:TEA,to:C.JUSDT,contract:C.USDT,amountRaw:"500000000000",eventIndex:0};
  const source={txid:"2".repeat(64),blockTs:ts-1000,from:C.JUSDD,to:TEA,contract:C.USDD,amountRaw:String(500000n*10n**18n),eventIndex:0};
  const receipts={...fixture,[source.txid]:{transfers:[source]},[deposit.txid]:{transfers:[deposit]}},wallets={[TEA]:{complete:true,through:ts+2000,rows:[source,...receipt.transfers,deposit],balances:{[C.USDT]:"0",[C.USDD]:"0"}}};
  const params={wallets,receipts,since:ts-2000,until:ts+2000,sourceTransfers:[source]},id=C.key(deposit);
  assert.equal(F.buildFundGraph(params).bounds([id]).upperRaw,"0");
  const graph=F.buildFundGraph({...params,includeBuyGem:true,sourceCapRaw:300n*10n**18n});assert.equal(graph.bounds([id]).upperRaw,String(300n*10n**18n));assert.ok(F.verifyWitness(graph.witness([id],"upper")));
  const limited=F.buildFundGraph({...params,includeBuyGem:true,sourceLimits:{[C.key(source)]:50n*10n**18n}});assert.equal(limited.bounds([id]).upperRaw,String(50n*10n**18n));
});
test("multiple redeemed transfers share one cap instead of multiplying the original principal",()=>{
  const A=TEA,rows=[1,2].map(i=>({txid:String(i).repeat(64),blockTs:i*1000,from:C.JUSDT,to:A,contract:C.USDT,amountRaw:"100",eventIndex:0}));
  const deposit={txid:"3".repeat(64),blockTs:3000,from:A,to:C.JUSDT,contract:C.USDT,amountRaw:"200",eventIndex:0};
  const rs=[...rows,deposit],wallets={[A]:{complete:true,through:4000,rows:rs,balances:{[C.USDT]:"0"}}},receipts=Object.fromEntries(rs.map(r=>[r.txid,{transfers:[r]}]));
  const g=F.buildFundGraph({wallets,receipts,since:0,until:4000,sourceTransfers:rows,sourceCapRaw:100n*F.SCALE});assert.equal(g.bounds([C.key(deposit)]).upperRaw,String(100n*F.SCALE));
});
test("recipient probe uses only_from while preserving the fixed window and cursor",async()=>{
  let url;const p=createProvider({delayMs:0,fetchImpl:async u=>(url=new URL(u),{ok:true,status:200,json:async()=>({data:[],meta:{}})})});
  await p.page(TEA,{since:10,until:20,cursor:"cursor",outgoing:true});assert.equal(url.searchParams.get("only_from"),"true");assert.equal(url.searchParams.has("only_to"),false);assert.equal(url.searchParams.get("min_timestamp"),"10");assert.equal(url.searchParams.get("max_timestamp"),"20");assert.equal(url.searchParams.get("fingerprint"),"cursor");
});
test("TM9 real cash returns through two PSM directions; the 1.03m gross deposit is not MEXC principal",()=>{
  const f=require("./test-fixtures/mexc-tm9-return-2026-11-18.json"),{TM9}=require("./mexc-usdt-review");
  const source=f.receipts[TX.redeem].transfers.find(t=>t.contract===C.USDT&&t.to===TM9),ends=[TX.mint1,TX.mint2].map(id=>f.receipts[id].transfers.find(t=>t.contract===C.USDT&&t.to===C.JUSDT));
  const g=F.buildFundGraph({...f,sourceTransfers:[source],includeBuyGem:true}),b=g.bounds(ends.map(C.key));assert.equal(b.lowerRaw,"31383102500000000000000");assert.equal(b.upperRaw,b.lowerRaw);
  assert.ok(F.verifyWitness(g.witness(ends.map(C.key),"lower")));assert.ok(F.verifyWitness(g.witness(ends.map(C.key),"upper")));
  assert.equal(ends.reduce((s,e)=>s+BigInt(e.amountRaw),0n),1031383802400n);
  assert.equal(F.buildFundGraph({...f,sourceTransfers:[source]}).bounds(ends.map(C.key)).upperRaw,"0");
  assert.equal(f.wallets[TEA].balances[C.JUSDT],"0");assert.ok(F.walletRows(TEA,f.wallets[TEA],f.receipts).some(t=>t.contract===C.JUSDT&&t.to==="TEr2uAVsgpCFCmon4xGaCMj9KeG8zm21z6"));
});
test("return Mint proof rejects legacy actions without contract, wrong contract and reversed payment order",()=>{
  const {mintEntry}=require("./mexc-usdt-review"),f=require("./test-fixtures/mexc-tm9-return-2026-11-18.json"),r=f.receipts[TX.mint1],paid=r.transfers.find(t=>t.contract===C.USDT&&t.to===C.JUSDT);
  assert.equal(mintEntry(paid,{[r.txid]:r}).operation,"Mint");
  for(const change of [x=>delete x.actions[0].contract,x=>x.actions[0].contract=C.USDT,x=>x.actions[0].eventIndex=0]){const bad=structuredClone(r);change(bad);assert.throws(()=>mintEntry(paid,{[r.txid]:bad}),/Mint 回执/);}
});
test("real JustLend Redeem pays USDT before jUSDT return and cannot be replaced by a Borrow event",()=>{
  const {redeemEntry}=require("./mexc-usdt-review"),f=require("./test-fixtures/mexc-tm9-return-2026-11-18.json"),r=f.receipts[TX.redeem],cash=r.transfers.find(t=>t.contract===C.USDT);
  assert.ok(BigInt(redeemEntry(cash,{[r.txid]:r}).redeemTokens)>0n);
  for(const change of [x=>x.actions[0].name="Borrow",x=>x.actions[0].contract=C.USDT,x=>x.transfers.find(t=>t.contract===C.JUSDT).eventIndex=0]){const bad=structuredClone(r);change(bad);assert.throws(()=>redeemEntry(cash,{[r.txid]:bad}),/Redeem 证据/);}
});
test("USDT completed review separates historical principal, redeemed cash and inclusive wallet retention",()=>{
  const {validateReview,combineSnapshots}=require("./mexc-attribution"),r=structuredClone(require("./mexc-attribution-review.json")),d=r.usdtDeepening;
  validateReview(r);assert.equal(d.suspectedUpperRaw,"83844713421");assert.equal(d.focusUpperRaw,"83216937663");assert.equal(d.otherUpperRaw,"627775758");
  assert.equal(d.newConfirmedRaw,"0");assert.equal(d.tm9.cashReturnLowerRaw,"31383102500");assert.equal(d.tm9.cashReturnUpperRaw,"31383102500");assert.equal(d.tm9.mexcReturnLowerRaw,"0");
  assert.equal(d.coverage.firstRecipients,109);assert.equal(d.coverage.walletProbes,101);assert.equal(d.coverage.contractBoundaries,8);
  const tmm=d.focus.find(f=>f.address.startsWith("TMM"));assert.equal(tmm.funds.find(w=>w.address.startsWith("TXt")).sourceContributionUpperRaw,"0");assert.equal(tmm.funds.find(w=>w.address.startsWith("TWT")).sourceContributionUpperRaw,"151577663");
  assert.equal(tmm.retention.status,"wallet-closed");assert.equal(tmm.retention.upperRaw,"0");assert.equal(d.tmm.returnRetention.lowerRaw,"0");assert.ok(BigInt(d.tmm.returnRetention.upperRaw)>8990n*10n**6n);assert.ok(BigInt(d.tmm.returnRetention.upperRaw)<9100n*10n**6n);
  assert.equal(r.retention.filter(p=>p.address===d.tmm.returnWallet&&p.asset==="USDT").length,1);assert.equal(r.entries.length,61);assert.equal(r.totals.suspectedAdditionalUpperRaw,"173548823271");
  for(const mutation of [x=>x.usdtDeepening.tm9.mexcReturnLowerRaw=x.usdtDeepening.tm9.cashReturnLowerRaw,x=>x.usdtDeepening.coverage.errors=1,x=>x.usdtDeepening.tmm.returnRetention.upperRaw="0",x=>x.usdtDeepening.focus[0].upperRaw="1"]){const bad=structuredClone(r);mutation(bad);assert.throws(()=>validateReview(bad));}
  const base={sourceVersion:r.sourceVersion,scope:"MEXC-USDT-jUSDT",events:[],coverage:{},until:r.until,rights:[{from:d.tmm.returnWallet,blockTs:Date.parse(d.tmm.returnRetention.asOf)+1}]};
  assert.ok(combineSnapshots(base,null,r).review.usdtDeepening.tmm.returnRetention.needsReview);assert.equal(combineSnapshots({...base,sourceVersion:"changed"},null,r).review,null);
});
test("USDT UI keeps cash-return proof distinct from unconfirmed MEXC attribution and clears invalid results",async()=>{
  const fs=require("node:fs/promises"),vm=require("node:vm"),path=require("node:path"),{combineSnapshots}=require("./mexc-attribution"),r=require("./mexc-attribution-review.json"),nodes=new Map(),listeners={};
  const document={hidden:false,getElementById:id=>{if(!nodes.has(id))nodes.set(id,{value:id==="mexcPeriod"?"30":"all",innerHTML:"",listeners:{},classList:{toggle(){},add(){}},addEventListener(n,f){this.listeners[n]=f;}});return nodes.get(id);},addEventListener:(n,f)=>{listeners[n]=f;}};
  const base={sourceVersion:r.sourceVersion,scope:"MEXC-USDT-jUSDT",events:[],positions:[],sources:require("./mexc-sources.json"),coverage:{},until:r.until};let data=combineSnapshots(base,null,r),fail=false;
  vm.runInNewContext(await fs.readFile(path.join(__dirname,"mexc-ui.js"),"utf8"),{document,fetch:async()=>{if(fail)throw Error("offline");return {ok:true,json:async()=>data};},AbortSignal,Date,BigInt,setInterval(){}});
  listeners["dashboard:tab"]({detail:"mexc"});await new Promise(resolve=>setImmediate(resolve));
  const box=nodes.get("mexcUSDTDeepening");assert.equal(box.hidden,false);assert.match(box.innerHTML,/31,383.1025 USDT/);assert.match(box.innerHTML,/尚未确认来源/);assert.match(box.innerHTML,/本次新增确认金额为 0/);assert.match(box.innerHTML,/不是|不能归为 MEXC 新本金/);assert.match(box.innerHTML,/保守上限/);
  assert.match(box.innerHTML,/0.013183 USDT/);assert.match(box.innerHTML,/全协议当前留存：尚未闭合/);assert.match(box.innerHTML,/0.062168 USDT/);assert.match(box.innerHTML,/外部绕行返回未排除/);assert.match(box.innerHTML,/>0 USDD<\/strong>/);
  const before=nodes.get("mexcMetrics").innerHTML;nodes.get("mexcAsset").value="USDD";nodes.get("mexcAsset").listeners.change();assert.equal(nodes.get("mexcMetrics").innerHTML,before);assert.equal(box.hidden,false);
  fail=true;await nodes.get("mexcRefresh").listeners.click();assert.match(box.innerHTML,/读取失败，保留快照/);
  fail=false;data=combineSnapshots({...base,sourceVersion:"changed"},null,r);await nodes.get("mexcRefresh").listeners.click();assert.equal(box.hidden,true);assert.equal(box.innerHTML,"");
});
