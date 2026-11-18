"use strict";
const C=require("./mexc-core"),F=require("./mexc-fund-flow");
const TAJA="TAja3r47XUuXH6DwsZoYBviVE28B6kvXm7",TTB="TTbNpK1L7yEPwB6dymNMycxQnaUZuy6wr2",SUNX="TEubMt2TNag5NN1JXVaeysUk8GNTTYmtVX",OUT="TWu6sFHc67NRmHq8yVyucK6zDQAANbVdW4",LOOKALIKE="TTbNp8QnJJryoZbyyywd6iowgUqKuy6wr2";
const SUNX_DOC="https://sunx.gitbook.io/sunx-cn/ru-men/chong-zhi-yu-ti-xian";
const TX={sunx:"135c1934e70d7c755af46130415c3b94a45a6520bec7608897cbe594bd73cd4a",returned:"b18fd97a8ee9a6ff0bc2ef0ee6916263b0c69268f17ed516b0ec3bfa756c6836",out:"0bf893ea28e87a09abb08cafcd30f61ca85340e3839649a9d07267ea3f95a96c",first:"383318a8f00a7c8590b9744542ab25bbc022b3428a59ff9b30421c4c807192bc",second:"2433571f8e8d43c8aebb71f1882305f6c022e1b1d1471a6ec5259c58068164c5",lookalike:"8a6b4eb1d0c3287f0a872f339578e8a15f11ace38547c63ee6eca4b210f10e04",swap:"8baf1b79735525add0511b74d9bc651133b4bd11790ea03b480286c3df2da9c3",mint:"89ff2d7eaa7eb5fa66c40e82264e9793fc5db4986838b996b135d63cb1e36c67"};
function buildDeepening({review,audit,evidence,baseline,book}){
  const wallets=Object.fromEntries([TAJA,TTB].map(a=>[a,audit.wallets[a]]));
  const graph=F.buildFundGraph({wallets,receipts:audit.receipts,sources:book,since:audit.since,until:audit.entryUntil});
  const entries=review.entries.filter(e=>e.from===TAJA&&e.asset==="USDD"),ids=entries.map(C.key);
  const group=review.groups.find(g=>g.id===`USDD:${TAJA}`),b=graph.bounds(ids);
  if(BigInt(b.lowerRaw)/F.SCALE!==BigInt(group.lowerRaw)||(BigInt(b.upperRaw)+F.SCALE-1n)/F.SCALE!==BigInt(group.upperRaw))throw Error("TAja 专项结果与汇总不一致");
  const proof={lower:graph.witness(ids,"lower"),upper:graph.witness(ids,"upper"),openings:graph.openings,closing:graph.closing};
  const tks=Object.keys(audit.wallets).find(a=>a.startsWith("TKsTk")),tksGroup=review.groups.find(g=>g.id===`USDT:${tks}`);
  const tksGraph=F.buildFundGraph({wallets:{[tks]:audit.wallets[tks]},receipts:audit.receipts,sources:book,since:audit.since,until:audit.entryUntil});
  proof.otherCheck=tksGraph.bounds(review.entries.filter(e=>e.from===tks&&e.asset==="USDT").map(C.key));
  if(BigInt(proof.otherCheck.lowerRaw)/F.SCALE!==BigInt(tksGroup.lowerRaw)||BigInt(proof.otherCheck.upperRaw)/F.SCALE!==BigInt(tksGroup.upperRaw))throw Error("TKs 专项复算已变化，需同步更新归因组");
  const take=(id,from,to,amount,contract=C.USDT)=>{
    const row=audit.receipts[id]?.transfers.find(r=>r.from===from&&r.to===to&&r.contract===contract&&r.amountRaw===amount);
    if(!row)throw Error(`TAja 关键证据缺失: ${id}`);return row;
  };
  const timeline=[
    {label:"TTb 第一次转给 TAja",...take(TX.first,TTB,TAJA,"89573700000")},
    {label:"SunX 金库出款",...take(TX.sunx,SUNX,TAJA,"220000000000")},
    {label:"TAja 转给 TTb，混同发生在此处",...take(TX.returned,TAJA,TTB,"220000000000")},
    {label:"TTb 转出到 TWu",...take(TX.out,TTB,OUT,"220000000000")},
    {label:"另一个相似地址转入 1 USDT",...take(TX.lookalike,LOOKALIKE,TAJA,"1000000")},
    {label:"TTb 第二次转给 TAja",...take(TX.second,TTB,TAJA,"114237000000")},
    {label:"PSM 换入 203,000 USDD",...take(TX.swap,TAJA,C.PSM_JOIN,"203000000000")},
    {label:"混合其他 USDD 后存入 JustLend",...take(TX.mint,TAJA,C.JUSDD,"204781464484068407552487",C.USDD)}
  ];
  if(evidence.checks[SUNX]?.type!=="contract"||evidence.checks[OUT]?.type!=="wallet")throw Error("TAja 外围地址类型尚未核对");
  const downstream=evidence.checks[OUT].fullHistory;
  if(!downstream?.complete||downstream.since>audit.since||downstream.until<audit.entryUntil)throw Error("TWu 下游核对时间范围不完整");
  const directReturns=downstream.rows.map(C.normalizeTransfer).filter(r=>r?.from===OUT&&[TAJA,TTB].includes(r.to));
  const cases=["lower","upper"].map(mode=>({mode,principalRaw:String(BigInt(proof[mode].targetRaw)/F.SCALE),
    assignments:[TX.first,TX.returned,TX.out,TX.second,TX.swap].map(txid=>{const e=proof[mode].edges.find(e=>e.transfer?.txid===txid&&e.kind!=="source");if(!e||BigInt(e.flowRaw)%F.SCALE)throw Error("分配示例精度异常");return {txid,from:e.transfer.from,to:e.transfer.to,totalRaw:e.transfer.amountRaw,mexcRaw:String(BigInt(e.flowRaw)/F.SCALE)};})}));
  const breakdown=review.groups.map(g=>({address:g.address,asset:g.asset,groupId:g.id,lowerRaw:g.lowerRaw,upperRaw:g.upperRaw,uncertainRaw:String(BigInt(g.upperRaw)-BigInt(g.lowerRaw)),
    status:g.address===TAJA?"本次完整收支及上下界分配验证":g.address.startsWith("TKsT")?"本次独立复算，区间未变":"沿用前次逐组复核",
    retention:review.retention.find(p=>p.address===g.address&&p.asset===g.asset)||null,note:g.note})).filter(g=>BigInt(g.uncertainRaw)>0n).sort((a,b)=>BigInt(a.uncertainRaw)>BigInt(b.uncertainRaw)?-1:1);
  const suspect=BigInt(review.totals.suspectedAdditionalUpperRaw),old=BigInt(baseline.totals.suspectedAdditionalUpperRaw);
  const focusRetention=review.retention.find(p=>p.address===TAJA&&p.asset==="USDD");
  return {proof,summary:{version:1,checkedAt:new Date().toISOString(),baselineReviewedAt:baseline.reviewedAt,previousSuspectedUpperRaw:String(old),suspectedUpperRaw:String(suspect),reductionRaw:String(old>suspect?old-suspect:0n),
    overlapAdjustmentRaw:review.totals.overlapUpperAdjustmentRaw,breakdown,
    focus:{address:TAJA,upstream:TTB,lowerRaw:group.lowerRaw,upperRaw:group.upperRaw,uncertainRaw:String(BigInt(group.upperRaw)-BigInt(group.lowerRaw)),retention:focusRetention,
      conclusion:"已查明 22 万 USDT 的直接出款方为 SunX 金库；但它进入 TAja 后与旧有 MEXC 来款混同。上下界都能满足完整收支和余额约束，暂不能据链上信息进一步缩窄。",
      sourceLabel:{address:SUNX,label:"SunX 金库合约",url:SUNX_DOC},timeline,cases,
      downstream:{address:OUT,since:new Date(downstream.since).toISOString(),until:new Date(downstream.until).toISOString(),rows:downstream.rows.length,directReturnCount:directReturns.length},
      limitations:["SunX 为共享金库；合约出款身份不等于该笔资金最终来源，不能直接断言全为非 MEXC 资金。",
        "22 万等额进出和相近时间不能证明逐笔对应；未采用先进先出、后进先出或按比例分摊强行确认。",
        "相似地址 TTbNp8…与 TTbNpK…为两个完整地址；1 USDT 小额入账未作为 MEXC 来源。",
        "下游核对仅证明 TWu 在给定窗口未直接返还 TAja / TTb；不据此排除更长路径或平台内部资金流。",
        "下方两种分配只是可行性证明，不代表实际发生的资金归属；缩小区间需要能排除其中一种分配的额外证据。"]}}};
}
module.exports={buildDeepening,TAJA,TTB,TX};
