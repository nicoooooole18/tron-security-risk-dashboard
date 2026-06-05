const pageMeta = {
  overview: {
    title: "总览",
    subtitle: "所选周期资金变化、主要异常信号和大户未回流摘要。"
  },
  market: {
    title: "竞品对比",
    subtitle: "JustLend vs Aave / Morpho / Spark / Compound / Venus 的所选周期 TVL Change 中位数。"
  },
  borrow: {
    title: "借贷需求分析",
    subtitle: "按资产同时查看 borrow_usd、borrow_amount、Supply、Utilization 和 APY，识别资产级信号。"
  },
  outflow: {
    title: "大户资金流出",
    subtitle: "Top20 Current、Top20 Lost、Round Trip、1 跳强归因和 2 跳弱归因。"
  },
  settings: {
    title: "数据与口径配置",
    subtitle: "阈值、内部地址、资产范围、数据源和归因规则配置。"
  }
};

const els = {
  pageTitle: document.getElementById("pageTitle"),
  pageSubtitle: document.getElementById("pageSubtitle"),
  periodSelect: document.getElementById("periodSelect"),
  csvExportBtn: document.getElementById("csvExportBtn"),
  dataThrough: document.getElementById("dataThrough"),
  snapshotBuilt: document.getElementById("snapshotBuilt"),
  sidebarPeriod: document.getElementById("sidebarPeriod"),
  headline: document.getElementById("headline"),
  overviewKicker: document.getElementById("overviewKicker"),
  windowText: document.getElementById("windowText"),
  dataMode: document.getElementById("dataMode"),
  overviewKpis: document.getElementById("overviewKpis"),
  signalCount: document.getElementById("signalCount"),
  signalsList: document.getElementById("signalsList"),
  roundTripSummary: document.getElementById("roundTripSummary"),
  dataQuality: document.getElementById("dataQuality"),
  marketSummary: document.getElementById("marketSummary"),
  trendChart: document.getElementById("trendChart"),
  competitorChangeHead: document.getElementById("competitorChangeHead"),
  competitorRows: document.getElementById("competitorRows"),
  borrowRows: document.getElementById("borrowRows"),
  outflowSummary: document.getElementById("outflowSummary"),
  outflowTitle: document.getElementById("outflowTitle"),
  outflowCopy: document.getElementById("outflowCopy"),
  outflowHead: document.getElementById("outflowHead"),
  outflowRows: document.getElementById("outflowRows"),
  thresholdRows: document.getElementById("thresholdRows"),
  thresholdChangeLogRows: document.getElementById("thresholdChangeLogRows"),
  dataSourceRows: document.getElementById("dataSourceRows"),
  assetScopeRows: document.getElementById("assetScopeRows"),
  attributionRulesRows: document.getElementById("attributionRulesRows"),
  internalAddressRows: document.getElementById("internalAddressRows"),
  internalAddressLogRows: document.getElementById("internalAddressLogRows"),
  internalAddressForm: document.getElementById("internalAddressForm"),
  internalAddressInput: document.getElementById("internalAddressInput"),
  internalLabelInput: document.getElementById("internalLabelInput"),
  internalReasonInput: document.getElementById("internalReasonInput"),
  internalExcludeInput: document.getElementById("internalExcludeInput"),
  internalImportForm: document.getElementById("internalImportForm"),
  internalImportText: document.getElementById("internalImportText"),
  internalImportReason: document.getElementById("internalImportReason"),
  roleBadge: document.getElementById("roleBadge"),
  thresholdRolePill: document.getElementById("thresholdRolePill"),
  permissionNote: document.getElementById("permissionNote"),
  authModal: document.getElementById("authModal"),
  authForm: document.getElementById("authForm"),
  authUsername: document.getElementById("authUsername"),
  authPassword: document.getElementById("authPassword"),
  authCancelBtn: document.getElementById("authCancelBtn"),
  authError: document.getElementById("authError"),
  toast: document.getElementById("toast")
};

let snapshot = null;
let thresholds = {};
let activeOutflowTab = "current";
let activeSettingsTab = "thresholds";
let useServerSignals = true;
const HIGH_UTILIZATION_THRESHOLD = 60;
let activePeriod = "90d";
let settingsLoaded = false;
let pendingSettingsOpen = false;
let authState = {
  authenticated: false,
  username: null
};

function isAdmin() {
  return authState.authenticated;
}

function updateAuthChrome() {
  els.roleBadge.textContent = isAdmin() ? "Admin" : "Public";
  els.roleBadge.classList.toggle("admin", isAdmin());
  els.roleBadge.classList.toggle("readonly", !isAdmin());
}

function formatUsd(value, compact = true) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 2 : 0
  }).format(number);
}

function formatSignedUsd(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "TODO";
  const number = Number(value || 0);
  const formatted = formatUsd(Math.abs(number));
  const className = number < 0 ? "negative" : number > 0 ? "positive" : "";
  const sign = number > 0 ? "+" : number < 0 ? "-" : "";
  return `<span class="${className}">${sign}${formatted}</span>`;
}

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "TODO";
  return Number(value).toLocaleString("en-US", {
    maximumFractionDigits: digits
  });
}

function formatPct(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "TODO";
  const number = Number(value);
  const className = number < 0 ? "negative" : number > 0 ? "positive" : "";
  return `<span class="${className}">${number > 0 ? "+" : ""}${number.toFixed(digits)}%</span>`;
}

function periodChangeUsd(currentValue, changePct) {
  const current = Number(currentValue);
  const pct = Number(changePct);
  if (!Number.isFinite(current) || !Number.isFinite(pct) || pct <= -100) return null;
  const start = current / (1 + pct / 100);
  return current - start;
}

function highUtilAssetCountForPeriod(assets) {
  return assets.filter((item) => {
    const current = Number(item.utilization);
    const change = Number(item.utilizationChangePct);
    if (!Number.isFinite(current)) return false;
    const periodStart = Number.isFinite(change) ? current - change : current;
    return current > HIGH_UTILIZATION_THRESHOLD || periodStart > HIGH_UTILIZATION_THRESHOLD;
  }).length;
}

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toISOString().replace(".000Z", "Z");
}

function shortAddress(address) {
  if (!address) return "--";
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function infoTooltip(text) {
  return `<span class="info-tip" aria-label="${escapeHtml(text)}" data-tip="${escapeHtml(text)}">?</span>`;
}

function pill(text, type = "muted") {
  return `<span class="pill ${type}">${escapeHtml(text)}</span>`;
}

function isTronAddress(value) {
  return /^T[1-9A-HJ-NP-Za-km-z]{25,40}$/.test(String(value || ""));
}

function tooltipText(html, title) {
  return `<span title="${escapeHtml(title)}">${html}</span>`;
}

function stripHtml(value) {
  const template = document.createElement("template");
  template.innerHTML = String(value ?? "");
  return template.content.textContent.trim();
}

function tableCell(cell) {
  const html = String(cell ?? "");
  const title = stripHtml(html).replace(/\s+/g, " ");
  return `<td title="${escapeHtml(title)}"><div class="cell-ellipsis">${html}</div></td>`;
}

function hydrateTableCellTitles() {
  document.querySelectorAll("td").forEach((cell) => {
    if (cell.hasAttribute("title")) return;
    const title = cell.textContent.trim().replace(/\s+/g, " ");
    if (title) cell.setAttribute("title", title);
  });
}

function destinationDisplay(destination, category, attribution, meta = {}) {
  const value = String(destination || "").trim();
  if (!value || value === "Pending chain lookup" || value === "待链上归因") {
    return pill("待链上归因", "amber");
  }
  if (value === "已回流") {
    return pill("已回流", "green");
  }
  if (value === "无流出") {
    return pill("无流出", "muted");
  }
  if (value === "No matching chain path" || value === "未匹配到去向") {
    return pill("未匹配到去向", "muted");
  }
  if (value === "Unknown") {
    return pill("Unknown（无标签）", "muted");
  }
  if (attribution === "system_sink" || category === "Blackhole / Burn") {
    return tooltipText(
      `${pill("黑洞/销毁地址", "muted")} <span class="muted-text">${escapeHtml(shortAddress(meta.destinationAddress || value))}</span>`,
      "黑洞/销毁地址只表示资金进入不可花费或系统接收地址，不等同于外部目的地流失，也不进入强归因统计。"
    );
  }
  if (attribution === "unlabeled_hop" || category === "Unlabeled Hop" || isTronAddress(value)) {
    const address = meta.destinationAddress || value;
    return tooltipText(
      `${pill("一跳地址未识别", "muted")} <span class="muted-text">${escapeHtml(shortAddress(address))}</span>`,
      `仅确认一跳接收地址，未确认实体归属；可能是同一用户钱包、中转地址或外部平台地址。${address}`
    );
  }
  if (category === "User Wallet") {
    const profile = meta.destinationProfileLabel || meta.profileLabel || "";
    return tooltipText(
      `${pill("疑似用户钱包", "muted")}${profile ? ` <span class="muted-text">${escapeHtml(profile)}</span>` : ""}`,
      `地址库画像标签，不代表外部资金目的地；可能是同一用户钱包或仅曾参与 JustLend。${meta.destinationAddress || ""}`
    );
  }
  if (attribution === "profile") {
    return tooltipText(
      `${pill("非目的地标签", "muted")} <span class="muted-text">${escapeHtml(value)}</span>`,
      "该标签只用于辅助识别地址类型，不足以作为外部资金目的地结论，也不进入强归因统计。"
    );
  }
  if (attribution === "weak") {
    return `${escapeHtml(value)} ${pill("弱归因", "amber")}`;
  }
  if (attribution === "strong") {
    return `${escapeHtml(value)} ${pill("强归因", "green")}`;
  }
  if (category && category !== "Unknown") {
    return `${escapeHtml(value)} <span class="muted-text">${escapeHtml(category)}</span>`;
  }
  return escapeHtml(value);
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  setTimeout(() => els.toast.classList.remove("show"), 1600);
}

function threshold(key) {
  return thresholds[key]?.value;
}

function isThresholdEnabled(key) {
  return Boolean(thresholds[key]?.enabled);
}

function normalizeThresholds(configThresholds = []) {
  thresholds = {};
  for (const item of configThresholds) {
    thresholds[item.key] = { ...item };
  }
}

function buildSignals(data) {
  const signals = [];
  const periodLabel = (data.period || activePeriod).toUpperCase();
  const market = data.marketComparison;
  const borrowAssets = data.borrowDemand.assets;
  const outflow = data.capitalOutflow.summary;
  const destinations = data.capitalOutflow.destinations;

  const underperformance = market.relative.tvlUnderperformancePctPoint;
  if (isThresholdEnabled("competitor_underperformance_pct") && underperformance > threshold("competitor_underperformance_pct")) {
    signals.push({
      severity: "high",
      title: "JustLend 跑输竞品中位数",
      phenomenon: `JustLend ${periodLabel} TVL ${market.justlend.tvlChangePct.toFixed(1)}%，竞品中位数 ${market.competitorMedian.tvlChangePct.toFixed(1)}%。`,
      impact: "JustLend 表现弱于同类借贷协议。",
      evidence: `相对差值 ${underperformance.toFixed(1)} pct，超过 ${threshold("competitor_underperformance_pct")} pct 阈值。`,
      confidence: "高",
      entry: "Market Comparison"
    });
  }

  for (const asset of borrowAssets) {
    const signal = classifyBorrowSignal(asset);
    if (signal.type === "demand_weakening") {
      signals.push({
        severity: "medium",
        title: `${asset.asset} 需求减弱信号`,
        phenomenon: `${asset.asset} borrow_usd ${asset.borrowUsdChangePct.toFixed(1)}%，borrow_amount ${asset.borrowAmountChangePct.toFixed(1)}%。`,
        impact: "资产级借款规模和利用率同步走弱，且暂未被供给收缩或利率上升解释。",
        evidence: signal.evidence,
        confidence: "中",
        entry: "Borrow Demand"
      });
    } else if (signal.type === "price_impact") {
      signals.push({
        severity: "info",
        title: `${asset.asset} Borrow USD 下降主要受价格影响`,
        phenomenon: `${asset.asset} borrow_usd ${asset.borrowUsdChangePct.toFixed(1)}%，但 borrow_amount ${asset.borrowAmountChangePct.toFixed(1)}%。`,
        impact: "USD 本位下降不能直接解释为资产借款需求走弱。",
        evidence: signal.evidence,
        confidence: "中",
        entry: "Borrow Demand"
      });
    }
  }

  if (isThresholdEnabled("top20_unreturned_ratio_pct") && outflow.unreturnedOutflowRatioPct > threshold("top20_unreturned_ratio_pct")) {
    signals.push({
      severity: "high",
      title: "Top20 未回流资金流出",
      phenomenon: `Top20 ${periodLabel} 未回流资金 ${formatUsd(outflow.unreturnedOutflowUsd)}。`,
      impact: "该部分资金尚未回到 JustLend，更接近真实大户流失。",
      evidence: `未回流率 ${outflow.unreturnedOutflowRatioPct.toFixed(2)}%，超过 ${threshold("top20_unreturned_ratio_pct")}% 阈值。`,
      confidence: "高",
      entry: "Capital Outflow"
    });
  }

  const whaleThreshold = threshold("single_whale_unreturned_usd");
  const whale = data.capitalOutflow.top20Lost.find((item) => item.unreturnedOutflowUsd > whaleThreshold);
  if (isThresholdEnabled("single_whale_unreturned_usd") && whale) {
    signals.push({
      severity: "medium",
      title: "单个大户未回流流出超阈值",
      phenomenon: `${shortAddress(whale.address)} 未回流 ${formatUsd(whale.unreturnedOutflowUsd)}。`,
      impact: "重点用户可能正在撤资，需要结合目的地和回流路径核查。",
      evidence: `阈值 ${formatUsd(whaleThreshold)}，Top destination: ${whale.topDestination}。`,
      confidence: "中",
      entry: "Capital Outflow"
    });
  }

  const concentrated = destinations.find((item) => item.attribution === "strong" && item.sharePct > threshold("destination_concentration_pct"));
  if (isThresholdEnabled("destination_concentration_pct") && concentrated) {
    signals.push({
      severity: "medium",
      title: "1 跳强归因目的地集中",
      phenomenon: `${concentrated.destination} 承接 Top20 流出 ${concentrated.sharePct.toFixed(1)}%。`,
      impact: "大户资金集中流向同一类目的地。",
      evidence: `超过 ${threshold("destination_concentration_pct")}% 阈值；Overview 只使用 Hop 1 强归因。`,
      confidence: "中",
      entry: "Capital Outflow"
    });
  }

  return signals;
}

function hasNumber(value) {
  return Number.isFinite(Number(value));
}

function classifyBorrowSignal(asset) {
  const declineThreshold = threshold("borrow_demand_decline_pct");
  const required = [
    asset.borrowUsdChangePct,
    asset.borrowAmountChangePct,
    asset.supplyChangePct,
    asset.utilizationChangePct,
    asset.borrowApyChangePct,
    asset.assetPriceChangePct
  ];
  if (!isThresholdEnabled("borrow_demand_decline_pct") || !hasNumber(declineThreshold) || !required.every(hasNumber)) {
    return { type: "insufficient", label: "数据不足", tone: "gray", evidence: "关键变化率字段缺失或阈值未启用。" };
  }

  const usdDecline = asset.borrowUsdChangePct < declineThreshold;
  const amountDecline = asset.borrowAmountChangePct < 0;
  const supplyContraction = asset.supplyChangePct < declineThreshold;
  const utilizationWeakening = asset.utilizationChangePct < 0;
  const rateCostUp = asset.borrowApyChangePct > 0;
  const evidence = `阈值 ${declineThreshold}%，Supply ${formatPct(asset.supplyChangePct)}，Utilization ${formatPct(asset.utilizationChangePct)}，Borrow APY ${formatPct(asset.borrowApyChangePct)}。`;

  if (usdDecline && !amountDecline) {
    return { type: "price_impact", label: "价格影响", tone: "amber", evidence: `asset_price_change ${formatPct(asset.assetPriceChangePct)}，borrow_amount 未下降。` };
  }
  if (usdDecline && amountDecline && rateCostUp) {
    return { type: "rate_cost", label: "利率成本影响", tone: "amber", evidence };
  }
  if (usdDecline && amountDecline && (supplyContraction || !utilizationWeakening)) {
    return { type: "supply_contraction", label: "供给收缩影响", tone: "amber", evidence };
  }
  if (usdDecline && amountDecline && utilizationWeakening) {
    return { type: "demand_weakening", label: "需求减弱信号", tone: "red", evidence };
  }
  return { type: "normal", label: "正常观察", tone: "green", evidence };
}

function renderOverview(data) {
  const kpis = data.overview.kpis;
  const borrowAssets = data.borrowDemand?.assets || [];
  const periodLabel = (data.period || activePeriod).toUpperCase();
  const highUtilAssetCount = highUtilAssetCountForPeriod(borrowAssets);
  els.overviewKicker.textContent = `${periodLabel} 核心结论`;
  els.headline.textContent = data.overview.headline;
  els.windowText.textContent = `${data.periodStart.slice(0, 10)} → ${data.periodEnd.slice(0, 10)}`;
  els.dataMode.textContent = data.status.mode;
  els.overviewKpis.innerHTML = [
    ["TVL Change", formatSignedUsd(periodChangeUsd(kpis.tvlUsd, kpis.tvlChangePct)), `${periodLabel} period`],
    ["Supply Change", formatSignedUsd(periodChangeUsd(kpis.supplyUsd, kpis.supplyChangePct)), `${periodLabel} period`],
    ["Borrow Change", formatSignedUsd(periodChangeUsd(kpis.borrowUsd, kpis.borrowChangePct)), `${periodLabel} period`],
    ["High Util Assets", `${highUtilAssetCount} / ${borrowAssets.length}`, `>${HIGH_UTILIZATION_THRESHOLD}% in ${periodLabel}`],
    ["Net Flow", formatSignedUsd(kpis.netFlowUsd), `${periodLabel} aggregate`]
  ].map(([label, value, sub]) => `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${sub}</small>
    </article>
  `).join("");

  const signals = useServerSignals && Array.isArray(data.serverOverview?.anomalySignals)
    ? data.serverOverview.anomalySignals
    : buildSignals(data);
  els.signalCount.textContent = `${signals.length} 条`;
  els.signalsList.innerHTML = signals.map((signal) => `
    <article class="signal-card ${signal.severity}">
      <h3>${escapeHtml(signal.title)}</h3>
      <dl>
        <dt>现象</dt><dd>${escapeHtml(signal.phenomenon)}</dd>
        <dt>影响</dt><dd>${escapeHtml(signal.impact)}</dd>
        <dt>证据</dt><dd>${escapeHtml(signal.evidence)}</dd>
        <dt>置信度</dt><dd>${escapeHtml(signal.confidence)}</dd>
        <dt>入口</dt><dd>${escapeHtml(signal.entry)}</dd>
      </dl>
    </article>
  `).join("");

  const outflow = data.capitalOutflow.summary;
  els.roundTripSummary.innerHTML = [
    ["主动提出", formatUsd(outflow.grossWithdrawUsd), "gross_withdraw_usd"],
    ["已回流", formatUsd(outflow.returnedOutflowUsd), `${outflow.returnRatePct.toFixed(1)}% return rate`],
    ["未回流", formatUsd(outflow.unreturnedOutflowUsd), `${outflow.unreturnedOutflowRatioPct.toFixed(2)}% of beginning supply`],
    ["平均离开时长", `${outflow.avgTimeAwayDays.toFixed(1)} 天`, "avg_time_away"],
    ["Unknown 强归因占比", `${outflow.unknownStrongAttributionPct.toFixed(1)}%`, "Unknown preserved"]
  ].map(([label, value, sub]) => `
    <div class="summary-item">
      <span>${label}</span>
      <strong>${value}</strong>
      <p>${sub}</p>
    </div>
  `).join("");

  els.dataQuality.innerHTML = data.dataQuality.map((item) => `
    <div class="quality-card">
      <strong>${escapeHtml(item.source)}</strong>
      ${pill(item.status, item.status === "todo" ? "amber" : item.status === "mock" ? "blue" : "muted")}
      <p>${escapeHtml(item.message)}</p>
    </div>
  `).join("");
}

function renderMarket(data) {
  const market = data.marketComparison;
  const periodLabel = (data.period || activePeriod).toUpperCase();
  els.competitorChangeHead.textContent = `${periodLabel} TVL Change`;
  els.marketSummary.innerHTML = [
    [
      `JustLend TVL Change`,
      formatSignedUsd(periodChangeUsd(market.justlend.tvlUsd, market.justlend.tvlChangePct)),
      `${periodLabel} · ${market.justlend.tvlChangePct.toFixed(1)}%`,
      `JustLend 在所选 ${periodLabel} 窗口内的 TVL 变化金额和变化率。TVL 口径来自生产快照和 DeFiLlama 校验口径。`
    ],
    [
      "竞品 TVL 中位数",
      `${market.competitorMedian.tvlChangePct.toFixed(1)}%`,
      "Aave / Morpho / Spark / Compound / Venus",
      `Aave、Morpho、Spark、Compound、Venus 在所选 ${periodLabel} 窗口内 TVL change 的中位数，不是平均值，也不是全市场份额。`
    ],
    [
      "相对差值",
      `${market.relative.tvlUnderperformancePctPoint.toFixed(1)} pct`,
      "Market Share 一期不做",
      "相对差值 = 竞品 TVL 中位数变化率 - JustLend TVL 变化率。正数表示 JustLend 跑输竞品中位数，负数表示跑赢。"
    ]
  ].map(([label, value, sub, help]) => `
    <div class="comparison-item">
      <span class="label-with-tip">${escapeHtml(label)}${infoTooltip(help)}</span>
      <strong>${value}</strong>
      <p>${sub}</p>
    </div>
  `).join("");

  const justlendValues = market.trend.map((item) => item.justlendTvl);
  const min = Math.min(...justlendValues);
  const max = Math.max(...justlendValues);
  const trendBars = market.trend.map((item) => {
    const justlendHeight = 36 + ((item.justlendTvl - min) / (max - min || 1)) * 124;
    const medianHeight = 36 + ((item.competitorMedianTvl - 100) / 4) * 124;
    return `
      <div class="trend-bar">
        <div class="bar-pair">
          <div class="bar justlend" title="JustLend ${formatUsd(item.justlendTvl)}" style="height:${Math.max(8, justlendHeight)}px"></div>
          <div class="bar median" title="Competitor median index ${item.competitorMedianTvl}" style="height:${Math.max(8, medianHeight)}px"></div>
        </div>
        <div class="trend-label">${item.date.slice(5)}</div>
      </div>
    `;
  }).join("");
  els.trendChart.innerHTML = `
    <div class="chart-legend" aria-label="TVL 趋势图图例">
      <span><i class="legend-dot justlend"></i>JustLend TVL</span>
      <span><i class="legend-dot median"></i>Competitor Median TVL</span>
    </div>
    <div class="trend-bars">${trendBars}</div>
  `;

  els.competitorRows.innerHTML = market.competitors.map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${formatSignedUsd(periodChangeUsd(item.tvlUsd, item.tvlChangePct))}</td>
      <td>${formatPct(item.tvlChangePct)}</td>
      <td>${item.borrowUsd === null ? "TODO" : formatUsd(item.borrowUsd)}</td>
      <td>${pill(item.borrowStatus || "OK", item.borrowStatus === "TODO" ? "amber" : "green")}</td>
    </tr>
  `).join("");
}

function renderBorrow(data) {
  els.borrowRows.innerHTML = data.borrowDemand.assets.map((item) => {
    const signal = classifyBorrowSignal(item);
    const judgement = pill(signal.label, signal.tone);
    return `
      <tr>
        <td><strong>${escapeHtml(item.asset)}</strong></td>
        <td>${formatSignedUsd(periodChangeUsd(item.supplyUsd, item.supplyChangePct))}<br><span class="muted-text">${formatPct(item.supplyChangePct)}</span></td>
        <td>${formatSignedUsd(periodChangeUsd(item.borrowUsd, item.borrowUsdChangePct))}<br><span class="muted-text">${formatPct(item.borrowUsdChangePct)}</span></td>
        <td>${formatPct(item.borrowAmountChangePct)}</td>
        <td>${formatPct(item.borrowUsdChangePct)}</td>
        <td>${formatPct(item.assetPriceChangePct)}</td>
        <td>${item.utilization.toFixed(1)}%</td>
        <td>${item.borrowApy.toFixed(1)}%<br><span class="muted-text">${formatPct(item.borrowApyChangePct)}</span></td>
        <td>${item.supplyApy.toFixed(1)}%<br><span class="muted-text">${formatPct(item.supplyApyChangePct)}</span></td>
        <td>${judgement}</td>
      </tr>
    `;
  }).join("");
}

function hoursBetween(from, to) {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "--";
  return `${((end - start) / (60 * 60 * 1000)).toFixed(1)}h`;
}

function buildHop2AnalysisRows(data) {
  const details = data.capitalOutflow.attributionDetails || [];
  const hop1ByAddress = new Map(details
    .filter((item) => item.hop === 1)
    .map((item) => [item.address, item]));
  return details
    .filter((item) => item.hop === 2)
    .map((hop2) => {
      const hop1 = hop1ByAddress.get(hop2.address) || {};
      const amountMatchPct = hop1.amountUsd > 0
        ? Math.min(999, (Number(hop2.amountUsd || 0) / Number(hop1.amountUsd || 1)) * 100)
        : null;
      return {
        sourceAddress: hop2.address,
        outflowAmountUsd: hop1.amountUsd || hop2.amountUsd,
        hop1,
        hop2,
        timeDelta: hoursBetween(hop1.eventTime, hop2.eventTime),
        amountMatchPct,
        txHash: hop2.txHash || ""
      };
    });
}

const outflowConfigs = {
  current: {
    title: "Top20 Current",
    copy: "排除内部地址后，按当日 supply_usd 排名。",
    head: ["Rank", "Address", "Supply", "Borrow", "Net Position", "Primary Asset", "Unreturned", "Return Rate"],
    rows(data) {
      return data.capitalOutflow.top20Current.map((item) => [
        item.rank,
        addressCell(item.address),
        formatUsd(item.supplyUsd),
        formatUsd(item.borrowUsd),
        formatUsd(item.netPositionUsd),
        item.primaryAsset,
        formatUsd(item.unreturnedOutflowUsd),
        `${item.returnRatePct.toFixed(1)}%`
      ]);
    }
  },
  lost: {
    title: "Top20 Lost",
    copy: (periodLabel) => `排除内部地址后，按 ${periodLabel} unreturned_outflow_usd 排名。`,
    head: ["Rank", "Address", "Beginning Supply", "Gross Withdraw", "Returned", "Unreturned", "Return Rate", "Top Destination"],
    rows(data) {
      return data.capitalOutflow.top20Lost.map((item) => [
        item.rank,
        addressCell(item.address),
        formatUsd(item.beginningSupplyUsd),
        formatUsd(item.grossWithdrawUsd),
        formatUsd(item.returnedOutflowUsd),
        formatUsd(item.unreturnedOutflowUsd),
        `${item.returnRatePct.toFixed(1)}%`,
        destinationDisplay(item.topDestination, item.destinationCategory, item.destinationAttribution || item.attribution, item)
      ]);
    }
  },
  roundtrip: {
    title: "Round Trip Detail",
    copy: "按同地址回流 JustLend 匹配，多笔流出/回流按时间顺序展示。",
    head: ["Address", "Outflow Time", "Outflow", "Strong Destination", "Weak Destination", "Return Time", "Return", "Market", "Time Away", "Status"],
    rows(data) {
      return data.capitalOutflow.roundTrips.map((item) => [
        addressCell(item.address),
        formatDateTime(item.outflowTime),
        `${formatUsd(item.outflowUsd)} ${item.outflowAsset}`,
        destinationDisplay(item.strongDestination, item.destinationCategory, item.destinationAttribution || "strong", item),
        item.weakDestination ? destinationDisplay(item.weakDestination, null, "weak", item) : "--",
        item.returnTime ? formatDateTime(item.returnTime) : "--",
        item.returnUsd ? `${formatUsd(item.returnUsd)} ${item.returnAsset}` : "--",
        item.returnMarket || "--",
        `${(item.timeAwayHours / 24).toFixed(1)} 天`,
        statusPill(item.status)
      ]);
    }
  },
  destinations: {
    title: "Destination Ranking",
    copy: "Overview 主结论只使用 1 跳强归因，Unknown 保留不强行解释。",
    head: ["Destination", "Category", "Amount", "Share", "Wallets", "Attribution"],
    rows(data) {
      return data.capitalOutflow.destinations.map((item) => [
        destinationDisplay(item.destination, item.category, item.attribution, item),
        item.category === "Unknown" && (item.destination === "Pending chain lookup" || item.destination === "待链上归因") ? "待查询" : item.category,
        formatUsd(item.amountUsd),
        `${item.sharePct.toFixed(1)}%`,
        item.walletCount,
        pill(item.attribution, item.attribution === "strong" ? "green" : item.attribution === "weak" ? "amber" : "muted")
      ]);
    }
  },
  attribution: {
    title: "一跳归因",
    copy: "展示 Top20 Lost 的 Hop 1 直接去向、归因等级和是否进入 Overview；二跳线索在“二跳分析”单独查看。",
    head: ["Address", "Amount", "Hop 1 Destination", "Category", "Attribution", "Confidence", "Used In Overview"],
    rows(data) {
      return data.capitalOutflow.attributionDetails.filter((item) => item.hop === 1).map((item) => [
        addressCell(item.address),
        formatUsd(item.amountUsd),
        destinationDisplay(item.destination, item.category, item.attribution, item),
        item.category,
        pill(item.attribution, item.attribution === "strong" ? "green" : item.attribution === "weak" ? "amber" : "muted"),
        `${Math.round(item.confidence * 100)}%`,
        item.usedInOverview ? pill("Yes", "green") : pill("No", "muted")
      ]);
    }
  },
  hop2: {
    title: "二跳分析",
    copy: "追踪一跳地址后 7D 内的后续去向，只作为弱线索，不进入 Overview 和 Destination Ranking。",
    head: ["Source Address", "Outflow Amount", "Hop 1", "Hop 1 Type", "Hop 2", "Hop 2 Type", "Time Delta", "Amount Match", "Attribution", "Evidence"],
    rows(data) {
      return buildHop2AnalysisRows(data).map((item) => [
        addressCell(item.sourceAddress),
        formatUsd(item.outflowAmountUsd),
        destinationDisplay(item.hop1.destination, item.hop1.category, item.hop1.attribution, item.hop1),
        item.hop1.attribution || "--",
        destinationDisplay(item.hop2.destination, item.hop2.category, item.hop2.attribution, item.hop2),
        item.hop2.category || "--",
        item.timeDelta,
        item.amountMatchPct === null ? "--" : `${item.amountMatchPct.toFixed(1)}%`,
        pill("weak", "amber"),
        item.txHash ? `<span class="address" title="${escapeHtml(item.txHash)}">${escapeHtml(item.txHash.slice(0, 12))}...</span>` : "--"
      ]);
    }
  }
};

function addressCell(address) {
  return `<span class="address" title="${escapeHtml(address)}">${shortAddress(address)}</span>`;
}

function statusPill(status) {
  if (status === "returned") return pill("returned", "green");
  if (status === "partially_returned") return pill("partially returned", "amber");
  return pill("not returned", "red");
}

function renderOutflow(data) {
  const config = outflowConfigs[activeOutflowTab];
  const summary = data.capitalOutflow.summary;
  const periodLabel = (data.period || activePeriod).toUpperCase();
  els.outflowSummary.innerHTML = [
    ["Beginning Supply", formatUsd(summary.beginningSupplyUsd), "top20_beginning_supply_usd"],
    ["Gross Withdraw", formatUsd(summary.grossWithdrawUsd), "主动 Withdraw / Redeem"],
    ["Gross Deposit", formatUsd(summary.grossDepositUsd), "Supply / Deposit 回流或新增"],
    ["Net Outflow", formatUsd(summary.netOutflowUsd), "辅助展示，不单独判断流失", "amber"],
    ["Returned", formatUsd(summary.returnedOutflowUsd), `${summary.returnRatePct.toFixed(1)}% return rate`],
    ["Unreturned", formatUsd(summary.unreturnedOutflowUsd), `${summary.unreturnedOutflowRatioPct.toFixed(2)}% of beginning supply`, "red"],
    ["Avg Time Away", `${summary.avgTimeAwayDays.toFixed(1)} 天`, "avg_time_away"]
  ].map(([label, value, copy, tone]) => `
    <article class="summary-tile ${tone || ""}">
      <span>${label}</span>
      <strong>${value}</strong>
      <p>${copy}</p>
    </article>
  `).join("");
  els.outflowTitle.textContent = config.title;
  els.outflowCopy.textContent = typeof config.copy === "function" ? config.copy(periodLabel) : config.copy;
  els.outflowRows.closest("table").dataset.outflowTable = activeOutflowTab;
  els.outflowHead.innerHTML = `<tr>${config.head.map((item) => `<th>${item}</th>`).join("")}</tr>`;
  els.outflowRows.innerHTML = config.rows(data).map((row) => `
    <tr>${row.map(tableCell).join("")}</tr>
  `).join("");
}

function renderSettings(data) {
  const config = data.config;
  const disabledAttr = isAdmin() ? "" : "disabled";
  updateAuthChrome();
  els.thresholdRolePill.textContent = isAdmin() ? "Admin" : "Login Required";
  els.thresholdRolePill.className = `pill ${isAdmin() ? "green" : "muted"}`;
  els.permissionNote.textContent = isAdmin()
    ? "当前角色可调整阈值，修改写入 SQLite，并立即影响当前视图。"
    : "Settings 需要 admin 登录后查看和修改。公开看板不需要登录。";

  els.thresholdRows.innerHTML = Object.values(thresholds).map((item) => `
    <div class="threshold-row" data-threshold="${escapeHtml(item.key)}">
      <div class="threshold-title">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.metricName)} · ${escapeHtml(item.operator)} · ${escapeHtml(item.unit)} · ${item.enabled ? "开启" : "关闭"}</span>
      </div>
      <label>
        阈值
        <input type="number" step="0.1" value="${item.value}" ${item.enabled && isAdmin() ? "" : "disabled"} data-threshold-value="${escapeHtml(item.key)}" />
      </label>
      <label>
        修改原因
        <input type="text" placeholder="${isAdmin() ? "必填" : "只读不可修改"}" data-threshold-reason="${escapeHtml(item.key)}" ${item.enabled && isAdmin() ? "" : "disabled"} />
      </label>
    </div>
  `).join("");

  els.thresholdChangeLogRows.innerHTML = (data.settings.thresholdChangeLog || []).length
    ? data.settings.thresholdChangeLog.map((item) => `
      <div class="change-log-item">
        <div>
          <strong>${escapeHtml(item.thresholdKey || item.summary || "threshold")}</strong>
          <span>${escapeHtml(item.updatedAt || "--")}</span>
        </div>
        <div>
          <strong>${item.oldValue === null || item.oldValue === undefined ? "--" : escapeHtml(item.oldValue)} → ${item.newValue === null || item.newValue === undefined ? "--" : escapeHtml(item.newValue)}</strong>
          <span>${escapeHtml(item.reason || "--")}</span>
        </div>
        <div>
          <strong>${escapeHtml(item.updatedBy || "system")}</strong>
          <span>${item.enabled === null || item.enabled === undefined ? "" : `enabled=${escapeHtml(item.enabled)}`}</span>
        </div>
      </div>
    `).join("")
    : `<div class="summary-item"><span>Change Log</span><strong>暂无阈值修改</strong><p>阈值调整并填写原因后会显示在这里。</p></div>`;

  els.dataSourceRows.innerHTML = config.dataSources.map((item) => `
    <div class="summary-item">
      <span>${escapeHtml(item.type)}</span>
      <strong>${escapeHtml(item.name)}</strong>
      <p>${escapeHtml(item.status)} · ${escapeHtml(item.cadence)}</p>
    </div>
  `).join("");

  els.assetScopeRows.innerHTML = config.assets.map((item) => `
    <div class="config-card">
      <span>${escapeHtml(item.group)}</span>
      <strong>${escapeHtml(item.symbol)}</strong>
      <p>CMC asset id: ${escapeHtml(item.cmcAssetId)} · ${item.enabled ? "enabled" : "disabled"}</p>
    </div>
  `).join("");

  els.attributionRulesRows.innerHTML = [
    ["Max Hops", config.attributionRules.maxHops, "一期最多追踪 2 跳，超过后保留 Unknown。"],
    ["Hop 1 Window", `${config.attributionRules.hop1WindowHours}h`, "Withdraw 后 24h 内第一跳或主要去向，强归因。"],
    ["Hop 2 Window", `${config.attributionRules.hop2WindowDays}D`, "Hop 1 未知地址 7D 内继续转向的已知实体，弱归因。"],
    ["Overview Uses", config.attributionRules.overviewUses, "Overview 主结论只使用 Hop 1 强归因。"],
    ["Unknown Policy", config.attributionRules.unknownPolicy, "Unknown 占比保留，不强行解释。"]
  ].map(([label, value, copy]) => `
    <div class="config-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <p>${escapeHtml(copy)}</p>
    </div>
  `).join("");

  els.internalAddressRows.innerHTML = data.settings.internalAddresses.map((item) => `
    <tr>
      <td class="address">${escapeHtml(item.address)}</td>
      <td>
        <div class="inline-edit">
          <input type="text" value="${escapeHtml(item.label)}" data-internal-label="${escapeHtml(item.address)}" ${disabledAttr} />
        </div>
      </td>
      <td>
        <label class="checkbox-line">
          <input type="checkbox" ${item.excludeFromTopHolder ? "checked" : ""} data-internal-exclude="${escapeHtml(item.address)}" ${disabledAttr} />
          排除
        </label>
      </td>
      <td>${pill(item.excludeFromFlowAnalysis ? "排除" : "保留", item.excludeFromFlowAnalysis ? "green" : "muted")}</td>
      <td>${pill(item.excludeFromAlert ? "排除" : "保留", item.excludeFromAlert ? "green" : "muted")}</td>
      <td>
        <div class="inline-edit">
          <input type="text" value="${escapeHtml(item.reason)}" data-internal-reason="${escapeHtml(item.address)}" ${disabledAttr} />
        </div>
      </td>
      <td><button class="btn secondary" type="button" data-internal-update="${escapeHtml(item.address)}" ${disabledAttr}>更新</button></td>
    </tr>
  `).join("");

  els.internalAddressLogRows.innerHTML = (data.settings.internalAddressChangeLog || []).length
    ? data.settings.internalAddressChangeLog.map((item) => `
      <div class="change-log-item">
        <div>
          <strong>${escapeHtml(item.action || item.summary || "change")}</strong>
          <span>${escapeHtml(item.updatedAt || "--")}</span>
        </div>
        <div>
          <strong class="address">${escapeHtml(item.address || item.thresholdKey || "--")}</strong>
          <span>${escapeHtml(item.reason || "--")}</span>
        </div>
        <div>
          <strong>${escapeHtml(item.updatedBy || "system")}</strong>
          <span>${item.newValue?.label ? `label=${escapeHtml(item.newValue.label)}` : ""}</span>
        </div>
      </div>
    `).join("")
    : `<div class="summary-item"><span>Change Log</span><strong>暂无持久化修改</strong><p>新增、批量导入或更新内部地址后会显示在这里。</p></div>`;

  [
    els.internalAddressInput,
    els.internalLabelInput,
    els.internalReasonInput,
    els.internalExcludeInput,
    els.internalImportText,
    els.internalImportReason,
    ...els.internalAddressForm.querySelectorAll("button"),
    ...els.internalImportForm.querySelectorAll("button")
  ].forEach((element) => {
    if (element) element.disabled = !isAdmin();
  });

  if (!isAdmin()) return;

  document.querySelectorAll("[data-threshold-value]").forEach((input) => {
    const applyLocalThresholdChange = () => {
      const key = input.getAttribute("data-threshold-value");
      const reason = document.querySelector(`[data-threshold-reason="${key}"]`)?.value.trim();
      if (!reason) {
        input.value = thresholds[key].value;
        showToast("修改原因必填");
        return;
      }
      const nextValue = Number(input.value);
      if (!Number.isFinite(nextValue)) return;
      thresholds[key].value = nextValue;
      useServerSignals = false;
      renderOverview(snapshot);
      renderMarket(snapshot);
      renderBorrow(snapshot);
      renderOutflow(snapshot);
      showToast("阈值已应用到当前视图");
      return { key, value: nextValue, reason };
    };
    input.addEventListener("input", applyLocalThresholdChange);
    input.addEventListener("change", async () => {
      const change = applyLocalThresholdChange();
      if (!change) return;
      try {
        await patchThreshold(change.key, { value: change.value, reason: change.reason });
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  document.querySelectorAll("[data-internal-update]").forEach((button) => {
    button.addEventListener("click", async () => {
      const address = button.getAttribute("data-internal-update");
      const label = document.querySelector(`[data-internal-label="${address}"]`)?.value.trim();
      const reason = document.querySelector(`[data-internal-reason="${address}"]`)?.value.trim();
      const exclude = document.querySelector(`[data-internal-exclude="${address}"]`)?.checked;
      if (!reason) {
        showToast("修改原因必填");
        return;
      }
      await patchInternalAddress(address, {
        label,
        reason,
        excludeFromTopHolder: exclude,
        excludeFromFlowAnalysis: exclude,
        excludeFromAlert: exclude
      });
    });
  });
}

async function refreshInternalAddressSettings() {
  if (!isAdmin()) return;
  const [addressesResponse, logResponse] = await Promise.all([
    fetch("/api/v1/settings/internal-addresses", { cache: "no-store" }),
    fetch("/api/v1/settings/internal-addresses/change-log", { cache: "no-store" })
  ]);
  const addressesPayload = await addressesResponse.json();
  const logPayload = await logResponse.json();
  if (!addressesResponse.ok) throw new Error(addressesPayload.error || "Internal address API failed");
  if (!logResponse.ok) throw new Error(logPayload.error || "Internal address log API failed");
  snapshot.settings.internalAddresses = addressesPayload.items;
  snapshot.settings.internalAddressChangeLog = logPayload.items;
  renderSettings(snapshot);
}

async function refreshThresholdSettings() {
  if (!isAdmin()) return;
  const [thresholdsResponse, logResponse] = await Promise.all([
    fetch("/api/v1/settings/thresholds", { cache: "no-store" }),
    fetch("/api/v1/settings/thresholds/change-log", { cache: "no-store" })
  ]);
  const thresholdPayload = await thresholdsResponse.json();
  const logPayload = await logResponse.json();
  if (!thresholdsResponse.ok) throw new Error(thresholdPayload.error || "Threshold API failed");
  if (!logResponse.ok) throw new Error(logPayload.error || "Threshold log API failed");
  normalizeThresholds(thresholdPayload.items);
  snapshot.settings.thresholdChangeLog = logPayload.items;
  renderOverview(snapshot);
  renderMarket(snapshot);
  renderBorrow(snapshot);
  renderOutflow(snapshot);
  renderSettings(snapshot);
}

async function loadSettingsDetails() {
  if (!isAdmin()) return false;
  const [thresholdsResponse, thresholdLogResponse, internalAddressResponse, internalAddressLogResponse] = await Promise.all([
    fetch("/api/v1/settings/thresholds", { cache: "no-store" }),
    fetch("/api/v1/settings/thresholds/change-log", { cache: "no-store" }),
    fetch("/api/v1/settings/internal-addresses", { cache: "no-store" }),
    fetch("/api/v1/settings/internal-addresses/change-log", { cache: "no-store" })
  ]);
  const thresholdPayload = await thresholdsResponse.json();
  const thresholdLogPayload = await thresholdLogResponse.json();
  const internalAddressPayload = await internalAddressResponse.json();
  const internalAddressLogPayload = await internalAddressLogResponse.json();
  if (!thresholdsResponse.ok) throw new Error(thresholdPayload.error || "Threshold API failed");
  if (!thresholdLogResponse.ok) throw new Error(thresholdLogPayload.error || "Threshold log API failed");
  if (!internalAddressResponse.ok) throw new Error(internalAddressPayload.error || "Internal address API failed");
  if (!internalAddressLogResponse.ok) throw new Error(internalAddressLogPayload.error || "Internal address log API failed");
  normalizeThresholds(thresholdPayload.items);
  snapshot.settings = {
    ...(snapshot.settings || {}),
    internalAddresses: internalAddressPayload.items,
    internalAddressChangeLog: internalAddressLogPayload.items,
    thresholdChangeLog: thresholdLogPayload.items
  };
  settingsLoaded = true;
  renderSettings(snapshot);
  return true;
}

async function refreshAuthSession() {
  const response = await fetch("/api/v1/auth/session", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Auth session API failed");
  authState = {
    authenticated: Boolean(payload.authenticated),
    username: payload.username || null
  };
  updateAuthChrome();
  return authState;
}

function showAuthModal() {
  pendingSettingsOpen = true;
  els.authError.textContent = "";
  els.authPassword.value = "";
  els.authModal.hidden = false;
  setTimeout(() => els.authPassword.focus(), 0);
}

function hideAuthModal() {
  els.authModal.hidden = true;
  els.authError.textContent = "";
  els.authPassword.value = "";
}

async function postJson(url, body, method = "POST") {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

async function createInternalAddress(body) {
  await postJson("/api/v1/settings/internal-addresses", body);
  await refreshInternalAddressSettings();
  showToast("内部地址已新增");
}

async function importInternalAddresses(body) {
  const payload = await postJson("/api/v1/settings/internal-addresses/import", body);
  await refreshInternalAddressSettings();
  showToast(`导入 ${payload.imported.length} 个，跳过 ${payload.skipped.length} 个`);
}

async function patchInternalAddress(address, body) {
  await postJson(`/api/v1/settings/internal-addresses/${encodeURIComponent(address)}`, body, "PATCH");
  await refreshInternalAddressSettings();
  showToast("内部地址已更新");
}

async function patchThreshold(key, body) {
  await postJson(`/api/v1/settings/thresholds/${encodeURIComponent(key)}`, body, "PATCH");
  await refreshThresholdSettings();
  showToast("阈值修改已记录");
}

function renderAll() {
  if (!snapshot) return;
  renderOverview(snapshot);
  renderMarket(snapshot);
  renderBorrow(snapshot);
  renderOutflow(snapshot);
  renderSettings(snapshot);
  hydrateTableCellTitles();
}

function activePageKey() {
  return document.querySelector(".nav-item.active")?.dataset.page || "overview";
}

function currentCsvDataset() {
  const page = activePageKey();
  if (page === "overview") return "overview-signals";
  if (page === "market") return "market-comparison";
  if (page === "borrow") return "borrow-demand";
  if (page === "outflow") {
    return {
      current: "top-current",
      lost: "top-lost",
      roundtrip: "round-trip",
      destinations: "destinations",
      attribution: "attribution-detail",
      hop2: "hop2-analysis"
    }[activeOutflowTab] || "top-current";
  }
  return null;
}

function exportCurrentCsv() {
  const dataset = currentCsvDataset();
  if (!dataset) {
    showToast("当前页面不支持 CSV 导出");
    return;
  }
  const params = new URLSearchParams({
    dataset,
    period: activePeriod
  });
  window.location.href = `/api/v1/export.csv?${params.toString()}`;
}

function periodizedSubtitle(page) {
  return pageMeta[page].subtitle.replaceAll("90D", activePeriod.toUpperCase());
}

async function setPage(page) {
  if (page === "settings") {
    if (!isAdmin()) {
      showAuthModal();
      return;
    }
    if (!settingsLoaded) {
      await loadSettingsDetails();
    }
  }
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === page);
  });
  document.querySelectorAll(".page-section").forEach((item) => {
    item.classList.toggle("active", item.id === `${page}Page`);
  });
  els.pageTitle.textContent = pageMeta[page].title;
  els.pageSubtitle.textContent = periodizedSubtitle(page);
  if (els.csvExportBtn) {
    els.csvExportBtn.disabled = page === "settings";
    els.csvExportBtn.title = page === "settings" ? "Settings 不支持 CSV 导出" : "导出当前视图 CSV";
  }
}

function setOutflowTab(tab) {
  activeOutflowTab = tab;
  document.querySelectorAll(".tab").forEach((item) => {
    item.classList.toggle("active", item.dataset.tab === tab);
  });
  renderOutflow(snapshot);
  hydrateTableCellTitles();
}

function setSettingsTab(tab) {
  activeSettingsTab = tab;
  document.querySelectorAll(".settings-tab").forEach((item) => {
    item.classList.toggle("active", item.dataset.settingsTab === tab);
  });
  document.querySelectorAll(".settings-panel").forEach((item) => {
    item.classList.toggle("active", item.dataset.settingsPanel === tab);
  });
}

async function loadSnapshot(period = activePeriod) {
  activePeriod = period;
  const [snapshotResponse, overviewResponse] = await Promise.all([
    fetch(`/api/snapshot?period=${encodeURIComponent(period)}`, { cache: "no-store" }),
    fetch(`/api/v1/overview?period=${encodeURIComponent(period)}`, { cache: "no-store" })
  ]);
  const data = await snapshotResponse.json();
  const overview = await overviewResponse.json();
  if (!snapshotResponse.ok) throw new Error(data.error || "Snapshot API failed");
  if (!overviewResponse.ok) throw new Error(overview.error || "Overview API failed");
  snapshot = {
    ...data,
    serverOverview: overview,
    settings: {
      ...data.settings,
      internalAddresses: settingsLoaded ? snapshot?.settings?.internalAddresses || [] : [],
      internalAddressChangeLog: settingsLoaded ? snapshot?.settings?.internalAddressChangeLog || [] : [],
      thresholdChangeLog: settingsLoaded ? snapshot?.settings?.thresholdChangeLog || [] : []
    }
  };
  normalizeThresholds(data.config.thresholds || []);
  if (isAdmin() && settingsLoaded) {
    await loadSettingsDetails();
  }
  useServerSignals = true;
  els.dataThrough.textContent = `${data.lastCompleteUtcDate || data.periodEnd?.slice(0, 10) || "--"} UTC`;
  els.snapshotBuilt.textContent = formatDateTime(data.generatedAt);
  els.sidebarPeriod.textContent = data.period.toUpperCase();
  els.periodSelect.value = data.period;
  renderAll();
  els.pageSubtitle.textContent = periodizedSubtitle(activePageKey());
}

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", async () => {
    try {
      await setPage(item.dataset.page);
    } catch (error) {
      showToast(error.message);
    }
  });
});

document.querySelectorAll("[data-tab]").forEach((item) => {
  item.addEventListener("click", () => setOutflowTab(item.dataset.tab));
});

document.querySelectorAll(".settings-tab").forEach((item) => {
  item.addEventListener("click", () => setSettingsTab(item.dataset.settingsTab));
});

els.csvExportBtn?.addEventListener("click", exportCurrentCsv);

els.authCancelBtn?.addEventListener("click", () => {
  pendingSettingsOpen = false;
  hideAuthModal();
});

els.authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.authError.textContent = "";
  try {
    const response = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: els.authUsername.value.trim(),
        password: els.authPassword.value
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "登录失败");
    authState = {
      authenticated: Boolean(payload.authenticated),
      username: payload.username || null
    };
    updateAuthChrome();
    hideAuthModal();
    showToast("Admin 已登录");
    if (pendingSettingsOpen) {
      pendingSettingsOpen = false;
      await setPage("settings");
    }
  } catch (error) {
    els.authError.textContent = error.message;
  }
});

els.periodSelect.addEventListener("change", async () => {
  try {
    await loadSnapshot(els.periodSelect.value);
    showToast(`${els.periodSelect.value.toUpperCase()} 视图已加载`);
  } catch (error) {
    showToast(error.message);
  }
});

els.internalAddressForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    if (!isAdmin()) {
      showToast("只读角色不能修改配置");
      return;
    }
    const reason = els.internalReasonInput.value.trim();
    if (!reason) {
      showToast("修改原因必填");
      return;
    }
    await createInternalAddress({
      address: els.internalAddressInput.value.trim(),
      label: els.internalLabelInput.value.trim() || "internal",
      reason,
      excludeFromTopHolder: els.internalExcludeInput.checked,
      excludeFromFlowAnalysis: els.internalExcludeInput.checked,
      excludeFromAlert: els.internalExcludeInput.checked
    });
    els.internalAddressForm.reset();
    els.internalLabelInput.value = "internal";
    els.internalExcludeInput.checked = true;
  } catch (error) {
    showToast(error.message);
  }
});

els.internalImportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    if (!isAdmin()) {
      showToast("只读角色不能修改配置");
      return;
    }
    const reason = els.internalImportReason.value.trim();
    if (!reason) {
      showToast("导入原因必填");
      return;
    }
    await importInternalAddresses({
      text: els.internalImportText.value,
      reason
    });
    els.internalImportForm.reset();
  } catch (error) {
    showToast(error.message);
  }
});

loadSnapshot().catch((error) => {
  els.headline.textContent = "数据读取失败";
  els.dataMode.textContent = error.message;
  showToast("数据读取失败");
});

refreshAuthSession().catch(() => {
  updateAuthChrome();
});
