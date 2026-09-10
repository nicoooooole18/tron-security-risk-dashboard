/* Independent cache endpoint: polling never triggers a chain scan. */
(() => {
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? "—").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const time = value => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
  const amount = value => value === null || value === undefined ? "未知" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
  const rawAmount = (raw, decimals = 8) => {
    if (!/^\d+$/.test(String(raw ?? ""))) return "未知";
    const digits = String(raw).padStart(decimals + 1, "0");
    return `${BigInt(digits.slice(0, -decimals)).toLocaleString("zh-CN")}.${digits.slice(-decimals)}`;
  };
  const addr = value => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value || "") ? `<a class="xinbi-address" href="https://tronscan.org/#/address/${encodeURIComponent(value)}" target="_blank" rel="noopener noreferrer">${esc(value)}</a>` : esc(value);
  const tx = value => /^[0-9a-f]{64}$/i.test(value || "") ? `<a href="https://tronscan.org/#/transaction/${value}" target="_blank" rel="noopener noreferrer">${value.slice(0, 10)}…</a>` : "证据缺失";
  const kinds = { FLOW_0: "直接流入", FLOW_1: "1 个中转地址", FLOW_2: "2 个中转地址", FLOW_3: "登记代理路径", INTERACTION: "仅交互关联", JTOKEN_RIGHTS: "jToken 权益转移" };
  const actions = { Mint: "存款", RepayBorrow: "还款", RepayBorrowBehalf: "代还款", LiquidateBorrow: "清算", Borrow: "借款", Redeem: "赎回" };
  let current = null;
  function operationText(event) {
    const operation = event.operation;
    return operation?.actions?.length ? operation.actions.map(a => actions[a.action] || a.action).join(" / ")
      : event.kind === "JTOKEN_RIGHTS" ? "TRC20 Transfer"
      : operation?.error ? "操作读取失败"
      : operation?.pending ? "操作待解析"
      : "转账（未识别借贷操作）";
  }
  function renderEvents() {
    if (!current) return;
    const filter = byId("xinbiFilter").value;
    const all = [...(current.events || []), ...(current.rights || [])];
    const rows = all.filter(e => filter === "all" || filter === "flow" && e.kind.startsWith("FLOW_")
      || filter === "interaction" && e.kind === "INTERACTION" || filter === "anomaly" && e.anomalies?.length
      || filter === "rights" && e.kind === "JTOKEN_RIGHTS").sort((a,b) => b.blockTs-a.blockTs);
    byId("xinbiEventCount").textContent = `当前筛选：${amount(rows.length)} 条命中明细`;
    byId("xinbiEvents").innerHTML = rows.length ? rows.map(e => {
      const label = operationText(e);
      const priority = e.level === "P1" ? "重点线索" : "一般线索";
      return `<tr><td>${esc(time(e.blockTs))}<br><span class="pill ${e.level === "P1" ? "red" : "amber"}">${esc(e.level)} ${priority}</span></td>
        <td>${esc(kinds[e.kind] || e.kind)}<br>${esc(label)}</td><td>${amount(e.amount)} ${esc(e.token)}<br>${esc(e.market || "存款权益")}</td>
        <td>${(e.evidence || []).map(r => `<div class="xinbi-leg">${addr(r.from)} → ${addr(r.to)}<br>${amount(r.amount)} ${esc(r.token)} · ${esc(time(r.blockTs))} · ${tx(r.txid)}</div>`).join("")}</td>
        <td>${esc(e.reason)}${e.dust ? "<br>含 ≤1 USDT 小额线索，注意被动收款污染" : ""}${e.publicHub ? "<br>涉及公共平台，归属待核" : ""}${(e.anomalies || []).map(a => `<br><span class="pill amber">${esc(a)}</span>`).join("")}</td></tr>`;
    }).join("") : '<tr><td colspan="5">当前筛选下未发现命中线索。地址初扫和历史补扫进度见上方；未命中不代表无风险。</td></tr>';
  }
  function renderJusdt() {
    if (!current) return;
    const c = current.coverage || {};
    const filter = byId("jusdtFilter").value;
    const deposits = (current.events || []).filter(e => /(^|\b)jUSDT\b/i.test(e.market || ""));
    const rights = (current.rights || []).filter(e => e.token === "jUSDT");
    const redemptions = (current.redemptions || []).filter(e => e.token === "jUSDT");
    const all = [
      ...deposits.map(e => ({ ...e, jusdtType: "deposit" })),
      ...rights.map(e => ({ ...e, jusdtType: "rights" })),
      ...redemptions.map(e => ({ ...e, jusdtType: "redeem" }))
    ].sort((a, b) => b.blockTs - a.blockTs);
    const rows = all.filter(e => filter === "all" || e.jusdtType === filter);
    const related = new Set();
    for (const e of deposits) related.add(e.from);
    for (const e of rights) { related.add(e.from); related.add(e.to); }
    const latest = all[0]?.blockTs;
    const depositUsdt = deposits.filter(e => e.token === "USDT").reduce((sum, e) => sum + e.amount, 0);
    const rightsAmount = rights.reduce((sum, e) => sum + e.amount, 0);
    byId("jusdtSummary").innerHTML = [
      ["关联入金", deposits.length],
      ["关联入金交易额", `${amount(depositUsdt)} USDT`],
      ["jUSDT 权益转移", `${rights.length} 笔 / ${amount(rightsAmount)} jUSDT`],
      ["关联账户赎回", `${redemptions.filter(e => e.kind === "REDEEM").length} 笔已核 / ${redemptions.filter(e => e.kind !== "REDEEM").length} 笔待核`],
      ["相关账户", related.size]
    ].map(([k, v]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("");
    const coverageLimited = Number(c.pendingAccounts || 0) > 0 || Number(c.incompleteHistoryAccounts || 0) > 0
      || c.addressLimitReached || c.storageTruncated || c.graphTruncated || c.displayTruncated || c.rightsLimitReached || c.errors?.length || c.operationsPending;
    const decision = byId("jusdtDecision");
    if (deposits.length) {
      decision.textContent = `发现 ${deposits.length} 条风险关联资金进入 jUSDT 市场${rights.length ? `，并发现 ${rights.length} 笔后续 jUSDT 权益转移` : ""}。请从交易证据核对具体路径。${coverageLimited ? " 当前扫描仍不完整或存在截断。" : ""}`;
      decision.className = "decision-banner danger";
    } else if (rights.length) {
      decision.textContent = `暂未发现关联资金存入 jUSDT 市场；发现 ${rights.length} 笔 jUSDT 权益转移线索。${coverageLimited ? " 当前扫描仍不完整或存在截断。" : ""}`;
      decision.className = "decision-banner warning";
    } else {
      decision.textContent = `已扫描范围内暂未发现风险关联的 jUSDT 入金或权益转移。${coverageLimited ? " 扫描仍不完整或存在截断，不能据此认定无风险。" : ""}`;
      decision.className = coverageLimited ? "decision-banner warning" : "decision-banner clear";
    }
    if (current.investigations?.length) {
      decision.textContent = `已登记新币关联 180 万 USDT 历史存赎事件：两批凭证均已赎回，不能作为当前未赎回敞口。链上复核和七地址余额见下方；滚动扫描${coverageLimited ? "仍有覆盖缺口" : "仅代表已扫描范围"}。`;
      decision.className = "decision-banner warning";
    }
    if (current.runtime?.lastError || current.runtime?.stale) {
      decision.textContent += ` 当前快照${current.runtime.lastError ? "扫描失败" : "待更新"}，请检查扫描状态。`;
      decision.className = "decision-banner warning";
    }
    renderInvestigations();
    byId("jusdtCount").textContent = `当前筛选：${amount(rows.length)} 条`;
    byId("jusdtRows").innerHTML = rows.length ? rows.map(e => {
      const isDeposit = e.jusdtType === "deposit";
      const evidence = isDeposit ? (e.evidence || []) : [e];
      return `<tr><td>${esc(time(e.blockTs))}<br><span class="pill ${e.level === "P1" ? "red" : "amber"}">${esc(e.level)} ${e.level === "P1" ? "重点线索" : "一般线索"}</span></td>
        <td>${isDeposit ? "关联资金进入 jUSDT" : e.jusdtType === "redeem" ? (e.kind === "REDEEM" ? "已核对赎回" : "待核赎回") : "jUSDT 权益转移"}<br>${esc(operationText(e))}</td>
        <td>${rawAmount(e.amountRaw, e.decimals ?? 8)} ${esc(e.token)}${e.redeemedUnderlyingRaw != null ? `<br>赎回 ${rawAmount(e.redeemedUnderlyingRaw, 6)} USDT` : ""}</td>
        <td>${isDeposit ? addr(e.from) : `${addr(e.from)} → ${addr(e.to)}`}</td>
        <td>${evidence.map(r => `<div class="xinbi-leg">${addr(r.from)} → ${addr(r.to)}<br>${amount(r.amount)} ${esc(r.token)} · ${tx(r.txid)}</div>`).join("")}</td>
        <td>${esc(e.reason)}</td></tr>`;
    }).join("") : '<tr><td colspan="6">当前筛选下没有 jUSDT 相关线索。</td></tr>';
    byId("jusdtCoverage").textContent = `下表为滚动扫描结果，与上方固定事件证据不相加。最近识别活动：${time(latest)}。候选初扫 ${c.scannedAccounts ?? 0}/${c.totalAccounts ?? 0}，历史待补 ${c.incompleteHistoryAccounts ?? 0}。权益接收方最多继续跟踪 ${c.rightsMaxHops ?? 4} 跳，当前 ${c.rightsTrackedAccounts ?? 0} 个；${c.rightsLimitReached ? "权益候选达到上限；" : ""}${c.displayTruncated ? "明细展示已截断；" : ""}不代表全量持仓、完整同源证明或全部后续赎回。`;
  }
  function renderInvestigations() {
    const panel = byId("jusdtInvestigations");
    if (!panel) return;
    const labels = { verified: "后台已复核", pending: "等待后台复核", error: "复核失败", mismatch: "证据不一致" };
    panel.innerHTML = (current.investigations || []).map(c => {
      const verified = c.steps.filter(s => s.verification.status === "verified").length;
      const problems = c.steps.filter(s => ["error", "mismatch"].includes(s.verification.status)).length;
      return `<details open class="investigation"><summary>${esc(c.title)}</summary>
        <p>登记历史：${amount(c.historical.depositUsdt)} USDT 存入，${amount(c.historical.redeemedUsdt)} USDT 赎回（含利息）。<strong>${esc(c.historical.status)}</strong>。</p>
        <p class="notice">${esc(c.evidenceBasis)}。后台复核 ${verified}/${c.steps.length} 笔${problems ? `，${problems} 笔失败或不一致，请复查登记结论` : ""}。${esc(c.note)}</p>
        <details><summary>七个调查地址与当前 jUSDT 余额</summary>
        <div class="table-wrap"><table><thead><tr><th>地址</th><th>交易角色 / 归属</th><th>当前 jUSDT 余额</th><th>读取时间 / 状态</th></tr></thead><tbody>
        ${c.addresses.map(a => { const b = c.balances.find(b => b.address === a.address) || {}; return `<tr><td>${esc(a.id)} · ${addr(a.address)}</td><td>${esc(a.role)}<br>${esc(a.attribution)}</td><td>${b.status === "ok" ? rawAmount(b.raw) : "未知"}</td><td>${esc(time(b.checkedAt))}<br>${esc(b.error || (b.status === "ok" ? "已读取；余额不自动视为涉案金额" : "待读取"))}</td></tr>`; }).join("")}
        </tbody></table></div></details>
        <details><summary>两组存款 → 权益转移 → 赎回及上游证据（${c.steps.length} 笔交易）</summary>
        <div class="table-wrap"><table><thead><tr><th>时间 / 动作</th><th>交易</th><th>资产流转</th><th>后台复核</th></tr></thead><tbody>
        ${c.steps.map(s => `<tr><td>${esc(time(s.blockTs))}<br>${esc(s.label)}</td><td>${tx(s.txid)}</td><td>${s.transfers.map(t => `${addr(t.from)} → ${addr(t.to)}<br>${rawAmount(t.amountRaw, t.decimals)} ${esc(t.token)}`).join("<br>")}</td><td>${esc(labels[s.verification.status] || "未知")}<br>${esc(time(s.verification.checkedAt))}${s.verification.error ? `<br>${esc(s.verification.error)}` : ""}</td></tr>`).join("")}
        </tbody></table></div></details></details>`;
    }).join("") || '<p class="notice">此快照尚无事件台账；等待监控版本更新。</p>';
  }
  function render(data) {
    current = data;
    const s = data.summary || {}, c = data.coverage || {}, runtime = data.runtime || {};
    const decision = byId("xinbiDecision");
    if (decision) {
      const strong = Number(s.strongPathCount || 0);
      const weak = Number(s.interactionCount || 0) + Number(s.rightsCount || 0);
      const coverageLimited = Number(c.pendingAccounts || 0) > 0 || Number(c.incompleteHistoryAccounts || 0) > 0
        || c.addressLimitReached || c.storageTruncated || c.graphTruncated;
      if (runtime.lastError) {
        decision.textContent = `专项扫描异常：${runtime.lastError}。当前结果可能过期，请先查看扫描覆盖。`;
        decision.className = "decision-banner danger";
      } else if (data.investigations?.length) {
        decision.textContent = "已登记新币关联 180 万 USDT 历史存赎事件，两批凭证均已赎回。请在 jUSDT 监测中查看七地址、交易证据及后台复核状态；滚动扫描未命中不撤销历史证据。";
        decision.className = "decision-banner warning";
      } else if (strong > 0) {
        decision.textContent = `发现 ${strong} 条新币来源资金进入 JustLend 的直接或中转路径，请优先查看交易证据。${coverageLimited ? " 当前仍存在未完成或受限扫描，命中数量可能继续变化。" : ""}`;
        decision.className = "decision-banner danger";
      } else if (weak > 0) {
        decision.textContent = `暂未发现直接或中转路径；发现 ${weak} 条交互或权益关联线索，可按需查看证据。${coverageLimited ? " 当前仍存在未完成或受限扫描。" : ""}`;
        decision.className = "decision-banner warning";
      } else {
        decision.textContent = `已扫描范围内暂未发现新币相关资金进入 JustLend。${coverageLimited ? " 扫描仍未完整或存在容量截断，不能据此认定无风险。" : ""}`;
        decision.className = coverageLimited ? "decision-banner warning" : "decision-banner clear";
      }
    }
    const related = byId("xinbiRelatedAccounts");
    if (related) related.innerHTML = (data.priorityAccounts || []).map(a => `优先跟踪：${addr(a.address)} · ${esc(a.label)}<br>上游：${addr(a.origin)} · 交易证据：${(a.evidenceTxids || []).map(tx).join(" / ")}。按 1 跳候选跟踪，不计入来源地址数量。`).join("<br>");
    const progress = byId("xinbiScanProgress");
    if (progress) progress.innerHTML = c.totalAccounts > 0
      ? `已初扫 <strong>${amount(c.scannedAccounts)} / ${amount(c.totalAccounts)}</strong> 个候选地址 · 当前保留 <strong>${amount(c.storedTransfers)}</strong> 条有效转账记录 · 历史待补齐 <strong>${amount(c.incompleteHistoryAccounts)}</strong> 个地址。<br>初扫表示至少成功读取过一次，不代表该地址的 30 天历史已全部补齐。${c.addressLimitReached ? "已达候选地址上限。" : ""}${c.storageTruncated ? "转账保留已达容量上限，部分历史记录已截断。" : ""}`
      : "等待扫描结果：地址初扫、转账记录和历史补扫进度将在这里显示。";
    byId("xinbiState").textContent = runtime.lastError ? "扫描失败" : runtime.running ? `扫描中 ${runtime.processed}/${runtime.total}` : runtime.stale ? "数据待更新" : "已启用 · 有限覆盖";
    byId("xinbiState").className = `pill ${runtime.lastError ? "red" : "amber"}`;
    byId("xinbiSummary").innerHTML = [
      ["来源地址", `${data.seedCount ?? "—"} / ${data.reportedSeedCount ?? "—"}`],
      ["当前冻结", (data.addresses || []).filter(a => a.status === "blacklisted").length],
      ["JustLend 路径入金", s.strongPathCount ?? "—"], ["仅交互线索", s.interactionCount ?? "—"],
      ["命中入金 USDT", amount(s.inflowUsdt)], ["全部 jToken 转移", s.rightsCount ?? "—"]
    ].map(([k,v]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("");
    byId("xinbiCoverage").textContent = `最近完成：${time(data.generatedAt)}。回溯：${time(c.since)} 至 ${time(c.until)}。已扫描 ${c.scannedAccounts ?? 0}/${c.totalAccounts ?? 0} 个候选账户；历史待补齐 ${c.incompleteHistoryAccounts ?? 0}；接口失败 ${c.errors?.length ?? 0}；操作解析待补 ${c.operationsPending ?? 0}。${c.addressLimitReached ? "已达地址上限。" : ""}${c.storageTruncated || c.graphTruncated ? "存在数据/计算截断。" : ""}${runtime.lastError ? `上次失败：${runtime.lastError}。` : ""}命中入金总额不等于涉案金额；扫描未命中不代表无风险。`;
    byId("xinbiAddresses").innerHTML = (data.addresses || []).map(a => `<tr><td>${addr(a.address)}<br>${esc(a.business || a.label)} · ${esc(a.attribution)}${/^https:\/\/x\.com\//.test(a.source || "") ? `<br><a href="${esc(a.source)}" target="_blank" rel="noopener noreferrer">地址来源</a>` : ""}</td><td><span class="pill ${a.status === "blacklisted" ? "red" : "amber"}">${esc({ blacklisted: "已冻结", clear: "未冻结", unknown: "未知 / 重试" }[a.status] || "待查")}</span></td><td>${amount(a.balance)}</td><td>${esc(time(a.checkedAt))}</td></tr>`).join("");
    byId("xinbiTransfers").innerHTML = (data.seedTransfers || []).map(r => `<tr><td>${esc(time(r.blockTs))}</td><td>${amount(r.amount)} ${esc(r.token)}</td><td>${addr(r.from)} → ${addr(r.to)}</td><td>${tx(r.txid)}</td></tr>`).join("") || '<tr><td colspan="4">尚无已扫描记录。</td></tr>';
    byId("xinbiChanges").innerHTML = (data.changes || []).map(c => `<p>${esc(time(c.observedAt))} ${addr(c.address)}：${esc(c.from)} → ${esc(c.to)}（观测时间）</p>`).join("") || "尚未观测到冻结状态变化；首次读取作为基线。";
    byId("xinbiLimitations").innerHTML = [...(c.limitations || []), `扫描资产：${(c.assets || []).join("、")}`, `公共平台停止穿透：${c.stoppedHubs || 0} 个`].map(t => `<li>${esc(t)}</li>`).join("");
    renderEvents();
    renderJusdt();
  }
  async function load() {
    try {
      const response = await fetch("api/xinbi", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      render(await response.json());
    } catch (error) { byId("xinbiState").textContent = "数据读取失败"; byId("xinbiCoverage").textContent = `新币监控接口不可用：${error.message}。已有显示可能过期，不能据此判断无风险。`; }
  }
  byId("xinbiFilter").addEventListener("change", renderEvents);
  byId("jusdtFilter").addEventListener("change", renderJusdt);
  load(); setInterval(load, 60000);
})();
