const els = {
  statusStrip: document.getElementById("statusStrip"),
  statusTitle: document.getElementById("statusTitle"),
  statusDesc: document.getElementById("statusDesc"),
  statusPill: document.getElementById("statusPill"),
  metricUsdt: document.getElementById("metricUsdt"),
  metricUsdc: document.getElementById("metricUsdc"),
  metricEvents: document.getElementById("metricEvents"),
  metricHtx: document.getElementById("metricHtx"),
  syncTime: document.getElementById("syncTime"),
  addressRows: document.getElementById("addressRows"),
  eventRows: document.getElementById("eventRows"),
  userRows: document.getElementById("userRows"),
  watchedCount: document.getElementById("watchedCount"),
  eventCount: document.getElementById("eventCount"),
  userIntersectionCount: document.getElementById("userIntersectionCount"),
  userPoolNotice: document.getElementById("userPoolNotice"),
  protocolTab: document.getElementById("protocolTab"),
  userTab: document.getElementById("userTab"),
  protocolPanel: document.getElementById("protocolPanel"),
  userPanel: document.getElementById("userPanel"),
  configHtx: document.getElementById("configHtx"),
  configPlatform: document.getElementById("configPlatform"),
  configTronGrid: document.getElementById("configTronGrid"),
  configThreshold: document.getElementById("configThreshold"),
  configWatched: document.getElementById("configWatched"),
  configNotice: document.getElementById("configNotice"),
  configOpenBtn: document.getElementById("configOpenBtn"),
  configCloseBtn: document.getElementById("configCloseBtn"),
  configModal: document.getElementById("configModal"),
  notes: document.getElementById("notes"),
  refreshBtn: document.getElementById("refreshBtn"),
  hitOnlyToggle: document.getElementById("hitOnlyToggle"),
  toast: document.getElementById("toast")
};

let currentSnapshot = null;
let showOnlyHits = false;
let activeAddressTab = "protocol";

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  setTimeout(() => els.toast.classList.remove("show"), 1600);
}

function formatTime(value) {
  if (!value) return "--";
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2
  });
}

function shortAddress(address) {
  if (!address) return "--";
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

function pill(text, type = "muted") {
  return `<span class="pill ${type}">${text}</span>`;
}

function riskPill(level) {
  if (level === "P0") return pill("P0", "red");
  if (level === "P1") return pill("P1", "amber");
  if (level === "UNKNOWN") return pill("未知", "muted");
  if (level === "UNCONFIGURED") return pill("未配置", "amber");
  return pill("未命中", "green");
}

function blacklistPill(status) {
  if (status === "blacklisted") return pill("已冻结", "red");
  if (status === "clear") return pill("未命中", "green");
  return pill("未知", "muted");
}

function hitAssetsText(hitAssets = []) {
  return hitAssets.length ? hitAssets.join(" / ") : "无";
}

function inflowText(item) {
  if (!item.transferScanEnabled) return "未扫描";
  if (item.transferError) return "读取失败";
  return `${item.recentInflowCount} 笔 / ${formatAmount(item.recentInflowAmount)} ${item.asset}`;
}

function discoveryText(discovery = []) {
  const usable = discovery.filter((item) => item);
  if (!usable.length) return "";
  const visible = usable.slice(0, 4).map((item) => {
    if (item.error) return `${item.source} 链上发现失败：${item.error}`;
    return `${item.source} 候选 ${item.scannedCandidates || 0} 个，入库 ${item.addresses?.length || 0} 个，当前 holder ${item.currentHolderCount || 0} 个`;
  });
  if (usable.length > visible.length) visible.push(`另 ${usable.length - visible.length} 个 jToken 来源已扫描`);
  return visible.join("；");
}

function tokenMetric(tokenStatus = {}) {
  if (tokenStatus.frozenCount > 0) return `${tokenStatus.frozenCount} 命中`;
  if (tokenStatus.unknownCount > 0) return "未知";
  return "未命中";
}

function tokenMetricClass(tokenStatus = {}) {
  if (tokenStatus.frozenCount > 0) return "danger-text";
  if (tokenStatus.unknownCount > 0) return "muted-text";
  return "safe-text";
}

function isHitEvent(item) {
  return item.level === "P1" || String(item.sp?.tag || "").startsWith("HTX_");
}

function setAddressTab(tab) {
  activeAddressTab = tab;
  const showUser = tab === "user";
  els.protocolTab.classList.toggle("active", !showUser);
  els.userTab.classList.toggle("active", showUser);
  els.protocolTab.setAttribute("aria-selected", String(!showUser));
  els.userTab.setAttribute("aria-selected", String(showUser));
  els.protocolPanel.classList.toggle("active", !showUser);
  els.userPanel.classList.toggle("active", showUser);
  els.watchedCount.textContent = showUser
    ? els.userIntersectionCount.textContent
    : currentSnapshot
      ? `${currentSnapshot.addresses.length} 个协议地址`
      : "--";
}

function openConfigModal() {
  els.configModal.classList.add("show");
  els.configModal.setAttribute("aria-hidden", "false");
  els.configCloseBtn.focus();
}

function closeConfigModal() {
  els.configModal.classList.remove("show");
  els.configModal.setAttribute("aria-hidden", "true");
  els.configOpenBtn.focus();
}

function render(snapshot) {
  currentSnapshot = snapshot;
  const frozen = snapshot.addresses.filter((item) => item.blacklist.status === "blacklisted");
  const p1Events = snapshot.events.filter((item) => item.level === "P1");
  const userIntersection = snapshot.userIntersection || { results: [], hits: [], hitCount: 0, scannedCount: 0 };
  const statusLevel = snapshot.status.level;
  const addressBook = snapshot.addressBook || {};
  const visibleEvents = showOnlyHits ? snapshot.events.filter(isHitEvent) : snapshot.events;

  els.statusTitle.textContent = statusLevel === "SYNCING"
    ? "数据同步中"
    : statusLevel === "P0"
    ? "P0 冻结命中"
    : statusLevel === "P1"
      ? "P1 待核查"
      : "未命中";
  els.statusDesc.textContent = statusLevel === "SYNCING"
    ? "后台正在生成 JustLend 地址库和风险快照；当前页面不会阻塞等待链上全量扫描。"
    : snapshot.status.contractFrozen
    ? `发现 ${frozen.length} 个 watched address 命中冻结名单。`
    : userIntersection.hitCount
      ? `合约未冻结；发现 ${userIntersection.hitCount} 个 JustLend 用户地址命中黑名单。`
    : userIntersection.unknownCount
      ? `合约未冻结；${userIntersection.unknownCount} 个用户地址黑名单状态待重试。`
    : p1Events.length
      ? `合约未冻结；发现 ${p1Events.length} 笔 P1 高风险流入。`
      : "合约未冻结；未发现用户黑名单交集或 HTX 相关入金路径。";
  els.statusStrip.className = `status-strip ${statusLevel === "P0" ? "danger" : statusLevel === "P1" || statusLevel === "SYNCING" ? "warning" : "clear"}`;
  els.statusPill.textContent = snapshot.cache?.refreshInProgress
    ? "后台同步中"
    : snapshot.status.htxDetectionEnabled ? "HTX SP 已启用" : "HTX SP 未配置";
  els.statusPill.className = `pill ${snapshot.cache?.refreshInProgress ? "amber" : snapshot.status.htxDetectionEnabled ? "green" : "amber"}`;

  els.metricUsdt.textContent = tokenMetric(snapshot.tokenStatus?.USDT);
  els.metricUsdt.className = tokenMetricClass(snapshot.tokenStatus?.USDT);
  els.metricUsdc.textContent = tokenMetric(snapshot.tokenStatus?.USDC);
  els.metricUsdc.className = tokenMetricClass(snapshot.tokenStatus?.USDC);
  els.metricEvents.textContent = String(p1Events.length);
  els.metricHtx.textContent = snapshot.status.htxDetectionEnabled ? "已启用" : "未配置";
  els.syncTime.textContent = `${new Date(snapshot.generatedAt).toLocaleTimeString("zh-CN", { hour12: false })}${snapshot.cache?.servedFromCache ? " · 缓存" : ""}`;

  els.configHtx.textContent = `${snapshot.configSummary.htxSeedCount} 个`;
  els.configPlatform.textContent = `${snapshot.configSummary.platformSeedCount} 个`;
  els.configTronGrid.textContent = snapshot.configSummary.tronGridApiKeyConfigured ? "已配置" : "未配置";
  els.configThreshold.textContent = `${formatAmount(snapshot.configSummary.riskThresholdUsd)} USDT`;
  els.configWatched.textContent = `${snapshot.configSummary.watchedCount} 个`;
  if (addressBook.error) {
    els.configNotice.textContent = `CEX 地址库读取失败：${addressBook.error}。当前仅使用 config.json 中的手工地址。`;
  } else if (snapshot.status.htxDetectionEnabled && addressBook.enabled) {
    els.configNotice.textContent = `已复用 CEX 地址库：HTX ${addressBook.htxCount || 0} 个用于风险识别，其他平台 ${addressBook.platformCount || 0} 个仅作路径上下文；更新于 ${addressBook.updatedAt || "--"}。`;
  } else if (snapshot.status.htxDetectionEnabled) {
    els.configNotice.textContent = "当前已通过 config.json 手工地址启用 HTX SP 路径识别。";
  } else {
    els.configNotice.textContent = "HTX seed 地址未配置，当前不会产生 SP-1 / SP-2 命中。请接入 CEX 地址库或在 config.json 中补充经确认的 HTX 地址标签。";
  }

  els.addressRows.innerHTML = snapshot.addresses.map((item) => `
    <tr>
      <td>${item.name}<br><span class="label">${item.role}</span></td>
      <td>${item.market}</td>
      <td class="address" title="${item.address}">${shortAddress(item.address)}</td>
      <td>
        ${blacklistPill(item.blacklists?.USDT?.status || item.blacklist.status)}
        <span class="label compact">USDT</span>
        ${blacklistPill(item.blacklists?.USDC?.status)}
        <span class="label compact">USDC</span>
      </td>
      <td>${inflowText(item)}</td>
    </tr>
  `).join("");

  els.userIntersectionCount.textContent = userIntersection.scannedCount
    ? `${userIntersection.hitCount} / ${userIntersection.scannedCount} 命中${userIntersection.unknownCount ? ` · ${userIntersection.unknownCount} 未知` : ""}`
    : "待接入";
  els.userIntersectionCount.className = `pill ${userIntersection.hitCount ? "amber" : userIntersection.unknownCount ? "muted" : userIntersection.scannedCount ? "green" : "muted"}`;
  setAddressTab(activeAddressTab);
  const userDiscoveryText = discoveryText(userIntersection.discovery);
  const userBook = userIntersection.addressBook || {};
  els.userPoolNotice.textContent = userIntersection.emptyReason
    ? `${userIntersection.emptyReason} ${userDiscoveryText ? `${userDiscoveryText}。` : ""}当前不会伪造“用户地址池 ∩ 黑名单”结果。`
    : `JustLend 地址库 ${userBook.entryCount || userIntersection.totalCount || 0} 个，当前扫描 ${userIntersection.scannedCount} 个；数据来源：${userIntersection.source || "--"}。${userDiscoveryText ? ` ${userDiscoveryText}。` : ""}`;
  els.userRows.innerHTML = userIntersection.results.length
    ? userIntersection.results.map((item) => `
      <tr>
        <td class="address" title="${item.address}">${shortAddress(item.address)}</td>
        <td>${item.role}<br><span class="label">${item.market}</span></td>
        <td>
          ${blacklistPill(item.blacklists?.USDT?.status)}
          <span class="label compact">USDT</span>
          ${blacklistPill(item.blacklists?.USDC?.status)}
          <span class="label compact">USDC</span>
        </td>
        <td>${hitAssetsText(item.hitAssets)}</td>
        <td>${item.action}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="5">待接入 JustLend 当前用户地址池。接入后将展示用户地址与 USDT / USDC 黑名单的交集。</td></tr>`;

  els.hitOnlyToggle.classList.toggle("active", showOnlyHits);
  els.hitOnlyToggle.setAttribute("aria-pressed", String(showOnlyHits));
  els.eventCount.textContent = showOnlyHits
    ? `${visibleEvents.length} / ${snapshot.events.length} 条`
    : `${snapshot.events.length} 条`;
  els.eventRows.innerHTML = visibleEvents.length
    ? visibleEvents.map((item) => `
      <tr>
        <td>${formatTime(item.blockTs)}</td>
        <td>${riskPill(item.level)}</td>
        <td>${item.market}<br><span class="label">${item.watchedName}</span></td>
        <td>${formatAmount(item.amount)} ${item.token}${item.amountWatch ? `<br><span class="label">大额观察</span>` : ""}</td>
        <td class="address" title="${item.from}">${shortAddress(item.from)}</td>
        <td>${item.sp.tag}<br><span class="label">${item.reason}</span></td>
        <td class="address">${item.txid ? `<a href="https://tronscan.org/#/transaction/${item.txid}" target="_blank" rel="noreferrer">${item.txid.slice(0, 10)}...</a>` : "--"}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="7">${showOnlyHits ? "当前没有命中 HTX SP 路径的流入。" : "当前未读取到 watched address 的近期 USDT 流入。"}</td></tr>`;

  els.notes.innerHTML = snapshot.notes.map((item) => `<li>${item}</li>`).join("");
}

async function loadSnapshot(forceRefresh = false) {
  els.refreshBtn.disabled = true;
  els.refreshBtn.textContent = forceRefresh ? "后台刷新中" : "读取中";
  try {
    const response = await fetch(`/api/snapshot${forceRefresh ? "?refresh=1" : ""}`, { cache: "no-store" });
    const snapshot = await response.json();
    if (!response.ok) throw new Error(snapshot.error || "API 请求失败");
    render(snapshot);
    showToast(snapshot.cache?.refreshInProgress ? "已触发后台刷新" : "快照已读取");
  } catch (error) {
    els.statusTitle.textContent = "数据读取失败";
    els.statusDesc.textContent = error.message;
    els.statusPill.textContent = "ERROR";
    els.statusPill.className = "pill red";
    showToast("数据读取失败");
  } finally {
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = "刷新数据";
  }
}

els.hitOnlyToggle.addEventListener("click", () => {
  showOnlyHits = !showOnlyHits;
  if (currentSnapshot) render(currentSnapshot);
});

els.protocolTab.addEventListener("click", () => setAddressTab("protocol"));
els.userTab.addEventListener("click", () => setAddressTab("user"));
els.configOpenBtn.addEventListener("click", openConfigModal);
els.configCloseBtn.addEventListener("click", closeConfigModal);
els.configModal.addEventListener("click", (event) => {
  if (event.target === els.configModal) closeConfigModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && els.configModal.classList.contains("show")) {
    closeConfigModal();
  }
});

els.refreshBtn.addEventListener("click", () => loadSnapshot(true));
loadSnapshot(false);
