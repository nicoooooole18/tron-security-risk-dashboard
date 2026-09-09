/* Independent cache endpoint: polling never triggers a chain scan. */
(() => {
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? "—").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const time = value => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
  const amount = value => value === null || value === undefined ? "未知" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
  const addr = value => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value || "") ? `<a class="xinbi-address" href="https://tronscan.org/#/address/${encodeURIComponent(value)}" target="_blank" rel="noopener noreferrer">${esc(value)}</a>` : esc(value);
  const tx = value => /^[0-9a-f]{64}$/i.test(value || "") ? `<a href="https://tronscan.org/#/transaction/${value}" target="_blank" rel="noopener noreferrer">${value.slice(0, 10)}…</a>` : "证据缺失";
  const kinds = { FLOW_0: "直接流入", FLOW_1: "1 个中转地址", FLOW_2: "2 个中转地址", INTERACTION: "仅交互关联", JTOKEN_RIGHTS: "jToken 权益转移" };
  const actions = { Mint: "存款", RepayBorrow: "还款", RepayBorrowBehalf: "代还款", LiquidateBorrow: "清算", Borrow: "借款", Redeem: "赎回" };
  let current = null;
  function renderEvents() {
    if (!current) return;
    const filter = byId("xinbiFilter").value;
    const all = [...(current.events || []), ...(current.rights || [])];
    const rows = all.filter(e => filter === "all" || filter === "flow" && e.kind.startsWith("FLOW_")
      || filter === "interaction" && e.kind === "INTERACTION" || filter === "anomaly" && e.anomalies?.length
      || filter === "rights" && e.kind === "JTOKEN_RIGHTS").sort((a,b) => b.blockTs-a.blockTs);
    byId("xinbiEventCount").textContent = `展示 ${rows.length} 条 · 入金明细最多 500 条`;
    byId("xinbiEvents").innerHTML = rows.length ? rows.map(e => {
      const operation = e.operation;
      const label = operation?.actions?.length ? operation.actions.map(a => actions[a.action] || a.action).join(" / ")
        : e.kind === "JTOKEN_RIGHTS" ? "TRC20 Transfer" : operation?.error ? "操作读取失败" : operation?.pending ? "操作待解析" : "转账（未识别借贷操作）";
      return `<tr><td>${esc(time(e.blockTs))}<br><span class="pill ${e.level === "P1" ? "red" : "amber"}">${esc(e.level)} 待核查</span></td>
        <td>${esc(kinds[e.kind] || e.kind)}<br>${esc(label)}</td><td>${amount(e.amount)} ${esc(e.token)}<br>${esc(e.market || "存款权益")}</td>
        <td>${(e.evidence || []).map(r => `<div class="xinbi-leg">${addr(r.from)} → ${addr(r.to)}<br>${amount(r.amount)} ${esc(r.token)} · ${esc(time(r.blockTs))} · ${tx(r.txid)}</div>`).join("")}</td>
        <td>${esc(e.reason)}${e.dust ? "<br>含 ≤1 USDT 小额线索，注意被动收款污染" : ""}${e.publicHub ? "<br>涉及公共平台，归属待核" : ""}${(e.anomalies || []).map(a => `<br><span class="pill amber">${esc(a)}</span>`).join("")}</td></tr>`;
    }).join("") : '<tr><td colspan="5">当前已扫描范围内没有符合筛选的线索；请结合覆盖状态判断。</td></tr>';
  }
  function render(data) {
    current = data;
    const s = data.summary || {}, c = data.coverage || {}, runtime = data.runtime || {};
    byId("xinbiState").textContent = runtime.lastError ? "扫描失败" : runtime.running ? `扫描中 ${runtime.processed}/${runtime.total}` : runtime.stale ? "数据待更新" : "已启用 · 有限覆盖";
    byId("xinbiState").className = `pill ${runtime.lastError ? "red" : "amber"}`;
    byId("xinbiSummary").innerHTML = [
      ["来源地址", `${data.seedCount ?? "—"} / ${data.reportedSeedCount ?? 10}`],
      ["当前冻结", (data.addresses || []).filter(a => a.status === "blacklisted").length],
      ["JustLend 路径入金", s.strongPathCount ?? "—"], ["仅交互线索", s.interactionCount ?? "—"],
      ["命中入金 USDT", amount(s.inflowUsdt)], ["jToken 转移", s.rightsCount ?? "—"]
    ].map(([k,v]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("");
    byId("xinbiCoverage").textContent = `最近完成：${time(data.generatedAt)}。回溯：${time(c.since)} 至 ${time(c.until)}。已扫描 ${c.scannedAccounts ?? 0}/${c.totalAccounts ?? 0} 个候选账户；历史待补齐 ${c.incompleteHistoryAccounts ?? 0}；接口失败 ${c.errors?.length ?? 0}；操作待核 ${c.operationsPending ?? 0}。${c.addressLimitReached ? "已达地址上限。" : ""}${c.storageTruncated || c.graphTruncated ? "存在数据/计算截断。" : ""}${runtime.lastError ? `上次失败：${runtime.lastError}。` : ""}命中入金总额不等于涉案金额；扫描未命中不代表无风险。`;
    byId("xinbiAddresses").innerHTML = (data.addresses || []).map(a => `<tr><td>${addr(a.address)}<br>${esc(a.attribution)}</td><td><span class="pill ${a.status === "blacklisted" ? "red" : "amber"}">${esc({ blacklisted: "已冻结", clear: "未冻结", unknown: "未知 / 重试" }[a.status] || "待查")}</span></td><td>${amount(a.balance)}</td><td>${esc(time(a.checkedAt))}</td></tr>`).join("");
    byId("xinbiTransfers").innerHTML = (data.seedTransfers || []).map(r => `<tr><td>${esc(time(r.blockTs))}</td><td>${amount(r.amount)} ${esc(r.token)}</td><td>${addr(r.from)} → ${addr(r.to)}</td><td>${tx(r.txid)}</td></tr>`).join("") || '<tr><td colspan="4">尚无已扫描记录。</td></tr>';
    byId("xinbiChanges").innerHTML = (data.changes || []).map(c => `<p>${esc(time(c.observedAt))} ${addr(c.address)}：${esc(c.from)} → ${esc(c.to)}（观测时间）</p>`).join("") || "尚未观测到冻结状态变化；首次读取作为基线。";
    byId("xinbiLimitations").innerHTML = [...(c.limitations || []), `扫描资产：${(c.assets || []).join("、")}`, `公共平台停止穿透：${c.stoppedHubs || 0} 个`].map(t => `<li>${esc(t)}</li>`).join("");
    renderEvents();
  }
  async function load() {
    try {
      const response = await fetch("api/xinbi", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      render(await response.json());
    } catch (error) { byId("xinbiState").textContent = "数据读取失败"; byId("xinbiCoverage").textContent = `新币监控接口不可用：${error.message}。已有显示可能过期，不能据此判断无风险。`; }
  }
  byId("xinbiFilter").addEventListener("change", renderEvents);
  load(); setInterval(load, 60000);
})();
