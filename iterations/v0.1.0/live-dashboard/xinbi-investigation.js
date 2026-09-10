"use strict";

// Reviewed historical evidence, separate from the rolling discovery cache.
// These are transaction roles, not a claim that every participant has one owner.
const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const JUSDT = "TXJgMdjVX5dKiQaUi9QobwNxtSQaFqccvd";
const source = "https://www.coinlive.com/id/news/approximately-45-2-million-usdt-has-been-frozen-where-will-the";
const addresses = [
  ["A", "TMJfquPfp1BVUfSAsf95bLqGUkzdnbeiXu", "报道中的新币替代上押地址", 0],
  ["B", "TAnP1DxhEuCtbGqX66RV8TtWdDUJzhErzp", "180 万 USDT 中转地址", 1],
  ["C", "TVpLzSusAkcYSsN5bwRmYmyxajmVz11HQt", "80 万分支存款发起方", 2],
  ["D", "TU7nttHF5fcmEzFHZnNNjbzNHgZiXyL6RT", "100 万分支存款发起方", 2],
  ["E", "TFvGJpSNFsa3xiz8mYPKNDpFvrU43UrKCX", "外部存款代理合约", 3],
  ["F", "TFoULdc1mcwsiBKZ3Hr97KkrFXHyBEQCVo", "80 万分支权益接收及赎回方", 4],
  ["G", "TEm8BojfRPJND2SLpSp5fu2XxvsXpxw49k", "100 万分支权益接收及赎回方", 4]
].map(([id, address, role, depth]) => ({ id, address, role, depth, source,
  attribution: id === "A" ? "报道归属；链上行为已核验" : "资金路径关联；控制人及业务归属待核" }));
const byId = Object.fromEntries(addresses.map(a => [a.id, a.address]));
const leg = (from, to, amountRaw, contract = USDT) => ({ from: byId[from] || from, to: byId[to] || to,
  amountRaw, contract, token: contract === USDT ? "USDT" : "jUSDT", decimals: contract === USDT ? 6 : 8 });
const steps = [
  ["upstream-test", "上游转账", "0855ff096e5024d8c5dfd1f5353101b281955ef0a80aa9ef5805a69d4e22fc78", "2026-09-09T01:25:24+08:00", [leg("A", "B", "100000000")]],
  ["upstream", "上游转账", "2c141c48a1191f255c4eade555993cd8d31b7f713e8476b11136d8143de35719", "2026-09-09T01:29:21+08:00", [leg("A", "B", "1799900000000")]],
  ["branch80", "分支转账", "86bb02f58e05855ea3b87bbf8aba3ad41271ed2ffb7eaf8176bad4f5eb8bd863", "2026-09-09T01:33:12+08:00", [leg("B", "C", "800000000000")]],
  ["deposit80", "存款", "47dcff39ea90c9d3b58df9a6f2747b17dc7919f9987c3a2082806ca6d19617d3", "2026-09-09T01:36:54+08:00", [leg("C", "E", "800000000000"), leg("E", JUSDT, "800000000000"), leg(JUSDT, "E", "7368308182374064", JUSDT)], "Mint"],
  ["rights80", "权益转移", "3f7e9f72b86b01396f13c0a3f8cd49109f806f3af3f52e4111d662d034d08206", "2026-09-09T01:38:12+08:00", [leg("E", "F", "7368308182374064", JUSDT)]],
  ["redeem80", "赎回", "cdc718bca9305b35370b6e3ccfc12d3f8e20fc2947d4fea268d593431edb8053", "2026-09-09T01:39:15+08:00", [leg(JUSDT, "F", "800000084174"), leg("F", JUSDT, "7368308182374064", JUSDT)], "Redeem"],
  ["branch100", "分支转账", "2aaf101d32bcabc572b3acc2555c1682daa0021bca0c205548586d541c25539e", "2026-09-09T01:59:39+08:00", [leg("B", "D", "1000000000000")]],
  ["deposit100", "存款", "359f29d03f9bfca2ef9c9c72235923ed03944566b7ac5620eb8463fdf7824e82", "2026-09-09T02:05:15+08:00", [leg("D", "E", "1000000000000"), leg("E", JUSDT, "1000000000000"), leg(JUSDT, "E", "9210373526196923", JUSDT)], "Mint"],
  ["rights100", "权益转移", "cbec300907c10e9d19a24bf65945325156f4e36372bf54ab9cb796bc0b875478", "2026-09-09T02:06:42+08:00", [leg("E", "G", "9210373526196923", JUSDT)]],
  ["redeem100", "赎回", "2390fc4b03bde3c3277464f6625deb0dd75a8632b6689bf3ee057fa1e00de1df", "2026-09-09T02:07:57+08:00", [leg(JUSDT, "G", "1000000121000"), leg("G", JUSDT, "9210373526196923", JUSDT)], "Redeem"]
].map(([id, label, txid, time, transfers, action]) => ({ id, label, txid, blockTs: Date.parse(time), transfers, action }));

function verifyStep(step, events) {
  const actual = events.filter(e => e.event_name === "Transfer");
  const missing = step.transfers.filter(t => !actual.some(e => e.contract_address === t.contract
    && e.result?.from === t.from && e.result?.to === t.to && String(e.result?.value ?? e.result?.amount ?? e.result?.wad) === t.amountRaw));
  const action = !step.action || events.some(e => e.contract_address === JUSDT && e.event_name === step.action
    && (step.action === "Mint"
      ? e.result?.minter === byId.E && String(e.result?.mintTokens) === step.transfers[2].amountRaw && String(e.result?.mintAmount) === step.transfers[1].amountRaw
      : e.result?.redeemer === step.transfers[0].to && String(e.result?.redeemTokens) === step.transfers[1].amountRaw && String(e.result?.redeemAmount) === step.transfers[0].amountRaw));
  return { status: !missing.length && action ? "verified" : "mismatch", missingLegs: missing.length, actionMatched: action };
}

function investigationSnapshot(state = {}) {
  const verification = state.investigationVerification || {};
  return { id: "xinbi-2026-09-09-1800000", title: "新币关联 180 万 USDT 存赎事件",
    recordedAt: "2026-09-10", evidenceBasis: "人工核验新闻归属及 TronScan 交易；后台独立复核链上事件",
    source, market: JUSDT, addresses,
    historical: { depositUsdt: 1800000, redeemedUsdt: 1800000.205174, depositCount: 2, rightsCount: 2,
      redeemedCount: 2, status: "两批已登记存款凭证均已赎回", currentExposure: null },
    steps: steps.map(s => ({ ...s, verification: verification[s.txid] || { status: "pending" } })),
    balances: addresses.map(a => ({ address: a.address, ...(state.investigationBalances?.[a.address] || { status: "unknown", raw: null }) })),
    note: "历史存赎事实不等于当前敞口；当前余额覆盖以上 7 地址，未覆盖所有后续地址。路径关联不等于同一控制人或犯罪归属。" };
}

module.exports = { USDT, JUSDT, addresses, steps, verifyStep, investigationSnapshot };
