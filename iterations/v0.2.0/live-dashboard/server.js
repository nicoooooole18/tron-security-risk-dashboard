const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { productionPaths } = require("./lib/env");
const { SQLiteStore } = require("./lib/sqlite-store");
const { backfillTopLostDestinations } = require("./lib/chain-enrichment");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8790);
const HOST = process.env.HOST || "127.0.0.1";
const CONFIG_PATH = path.join(ROOT, "config.json");
const SNAPSHOT_PATH = path.join(ROOT, "data/daily-snapshot.json");
const PRODUCTION_PATHS = productionPaths();
const STORE = new SQLiteStore(PRODUCTION_PATHS.sqliteDbPath);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const AUTH_COOKIE = "jl_admin_session";
const SESSION_TTL_MS = Number(process.env.ADMIN_SESSION_TTL_HOURS || 12) * 60 * 60 * 1000;

let runtimeThresholds = null;
const runtimeThresholdChangeLog = [];
let runtimeInternalAddresses = null;
const runtimeInternalAddressChangeLog = [];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendJsonWithHeaders(res, status, payload, headers) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendCsv(res, filename, rows) {
  const csv = toCsv(rows);
  res.writeHead(200, {
    "content-type": "text/csv; charset=utf-8",
    "cache-control": "no-store",
    "content-disposition": `attachment; filename="${filename}"`
  });
  res.end(`\uFEFF${csv}`);
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return csvCell(JSON.stringify(value));
  const raw = String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))
  ].join("\n");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const index = item.indexOf("=");
      if (index === -1) return [item, ""];
      return [decodeURIComponent(item.slice(0, index)), decodeURIComponent(item.slice(index + 1))];
    }));
}

function authSignature(payload) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createSessionCookie(username) {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const nonce = crypto.randomBytes(16).toString("base64url");
  const payload = `${username}.${expiresAt}.${nonce}`;
  const token = `${payload}.${authSignature(payload)}`;
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

function clearSessionCookie() {
  return `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function getAdminSession(req) {
  if (!SESSION_SECRET) return null;
  const token = parseCookies(req)[AUTH_COOKIE];
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [username, expiresAtText, nonce, signature] = parts;
  const payload = `${username}.${expiresAtText}.${nonce}`;
  if (!constantTimeEqual(signature, authSignature(payload))) return null;
  const expiresAt = Number(expiresAtText);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  if (username !== ADMIN_USERNAME) return null;
  return { username, expiresAt };
}

function isAdminAuthenticated(req) {
  return Boolean(getAdminSession(req));
}

function requireAdmin(req, res) {
  if (!isAdminAuthenticated(req)) {
    sendJson(res, 401, { error: "admin login required" });
    return false;
  }
  return true;
}

async function serveAuthApi(req, res, url) {
  if (url.pathname === "/api/v1/auth/session" && req.method === "GET") {
    const session = getAdminSession(req);
    sendJson(res, 200, {
      authenticated: Boolean(session),
      username: session?.username || null
    });
    return true;
  }

  if (url.pathname === "/api/v1/auth/login" && req.method === "POST") {
    if (!ADMIN_PASSWORD || !SESSION_SECRET) {
      sendJson(res, 503, { error: "admin password is not configured" });
      return true;
    }
    const body = await readRequestBody(req);
    const username = String(body.username || "");
    const password = String(body.password || "");
    if (!constantTimeEqual(username, ADMIN_USERNAME) || !constantTimeEqual(password, ADMIN_PASSWORD)) {
      sendJson(res, 401, { error: "invalid admin credentials" });
      return true;
    }
    sendJsonWithHeaders(res, 200, { authenticated: true, username: ADMIN_USERNAME }, {
      "set-cookie": createSessionCookie(ADMIN_USERNAME)
    });
    return true;
  }

  if (url.pathname === "/api/v1/auth/logout" && req.method === "POST") {
    sendJsonWithHeaders(res, 200, { authenticated: false }, {
      "set-cookie": clearSessionCookie()
    });
    return true;
  }

  return false;
}

async function getRuntimeThresholds(config) {
  if (!runtimeThresholds) {
    runtimeThresholds = (config.thresholds || []).map((item) => ({ ...item }));
  }
  return runtimeThresholds.map((item) => ({ ...item }));
}

async function getRuntimeInternalAddresses(snapshot) {
  if (!runtimeInternalAddresses) {
    runtimeInternalAddresses = (snapshot.settings?.internalAddresses || []).map((item) => normalizeInternalAddressEntry(item));
  }
  return runtimeInternalAddresses.map((item) => ({ ...item }));
}

async function buildApiContext() {
  const [config, staticSnapshot] = await Promise.all([
    readJson(CONFIG_PATH),
    readJson(SNAPSHOT_PATH)
  ]);
  const persistedSnapshot = await STORE.latestSnapshot().catch(() => null);
  const snapshot = persistedSnapshot || staticSnapshot;
  const thresholds = await STORE.readThresholds(config.thresholds)
    .catch(() => getRuntimeThresholds(config));
  runtimeThresholds = thresholds.map((item) => ({ ...item }));
  const fallbackInternalAddresses = await getRuntimeInternalAddresses(snapshot);
  const internalAddresses = await STORE.readInternalAddresses(fallbackInternalAddresses)
    .catch(() => fallbackInternalAddresses);
  runtimeInternalAddresses = internalAddresses.map((item) => ({ ...item }));
  const decoratedSnapshot = {
    ...snapshot,
    settings: {
      ...(snapshot.settings || {}),
      internalAddresses
    }
  };
  return {
    config: {
      ...config,
      thresholds
    },
    snapshot: decoratedSnapshot,
    thresholds,
    internalAddresses,
    servedFromSQLite: Boolean(persistedSnapshot)
  };
}

function withLatestJobQuality(snapshot, latestJobRun) {
  if (latestJobRun?.status !== "failed") return snapshot;
  return {
    ...snapshot,
    dataQuality: [
      ...(snapshot.dataQuality || []),
      {
        source: "Daily Snapshot Job",
        status: "error",
        message: `Latest job failed for expected Data Through ${latestJobRun.snapshot_date}: ${latestJobRun.error_message || "unknown error"}. Previous usable snapshot is still being served.`
      }
    ]
  };
}

async function getSnapshot(period) {
  const { config, snapshot, servedFromSQLite } = await buildApiContext();
  const latestJobRun = await STORE.latestJobRun().catch(() => null);
  const viewSnapshot = withLatestJobQuality(
    normalizeCapitalOutflowSnapshot(derivePeriodSnapshot(snapshot, period || snapshot.period)),
    latestJobRun
  );
  const { settings, ...publicSnapshot } = viewSnapshot;
  return {
    ...publicSnapshot,
    config,
    cache: {
      servedFromCache: true,
      refreshInProgress: false,
      refreshMode: servedFromSQLite ? "daily_snapshot_sqlite" : "daily_snapshot_mock_fallback",
      refreshSeconds: 86400,
      sqliteDbPath: PRODUCTION_PATHS.sqliteDbPath,
      sourceAdapter: PRODUCTION_PATHS.sourceAdapter,
      latestJobRun
    }
  };
}

function thresholdMap(thresholds) {
  return Object.fromEntries((thresholds || []).map((item) => [item.key, item]));
}

function thresholdValue(thresholds, key) {
  return thresholdMap(thresholds)[key]?.value;
}

function thresholdEnabled(thresholds, key) {
  return Boolean(thresholdMap(thresholds)[key]?.enabled);
}

function hasNumber(value) {
  return Number.isFinite(Number(value));
}

function formatPctValue(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function classifyBorrowSignal(asset, thresholds) {
  const declineThreshold = thresholdValue(thresholds, "borrow_demand_decline_pct");
  const required = [
    asset.borrowUsdChangePct,
    asset.borrowAmountChangePct,
    asset.supplyChangePct,
    asset.utilizationChangePct,
    asset.borrowApyChangePct,
    asset.assetPriceChangePct
  ];
  if (!thresholdEnabled(thresholds, "borrow_demand_decline_pct") || !hasNumber(declineThreshold) || !required.every(hasNumber)) {
    return { type: "insufficient", evidence: "关键变化率字段缺失或阈值未启用。" };
  }

  const usdDecline = asset.borrowUsdChangePct < declineThreshold;
  const amountDecline = asset.borrowAmountChangePct < 0;
  const supplyContraction = asset.supplyChangePct < declineThreshold;
  const utilizationWeakening = asset.utilizationChangePct < 0;
  const rateCostUp = asset.borrowApyChangePct > 0;
  const evidence = `阈值 ${declineThreshold}%，Supply ${formatPctValue(asset.supplyChangePct)}，Utilization ${formatPctValue(asset.utilizationChangePct)}，Borrow APY ${formatPctValue(asset.borrowApyChangePct)}。`;

  if (usdDecline && !amountDecline) {
    return { type: "price_impact", evidence: `asset_price_change ${formatPctValue(asset.assetPriceChangePct)}，borrow_amount 未下降。` };
  }
  if (usdDecline && amountDecline && rateCostUp) {
    return { type: "rate_cost", evidence };
  }
  if (usdDecline && amountDecline && (supplyContraction || !utilizationWeakening)) {
    return { type: "supply_contraction", evidence };
  }
  if (usdDecline && amountDecline && utilizationWeakening) {
    return { type: "demand_weakening", evidence };
  }
  return { type: "normal", evidence };
}

function compactUsd(value) {
  const number = Number(value || 0);
  if (Math.abs(number) >= 1_000_000_000) return `$${(number / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(number) >= 1_000_000) return `$${(number / 1_000_000).toFixed(1)}M`;
  if (Math.abs(number) >= 1_000) return `$${(number / 1_000).toFixed(1)}K`;
  return `$${number.toFixed(0)}`;
}

function shortAddress(address) {
  if (!address) return "--";
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

function normalizeAddress(value) {
  return String(value || "").trim();
}

function normalizeInternalAddressEntry(entry = {}, existing = {}) {
  const address = normalizeAddress(entry.address || existing.address);
  return {
    address,
    chain: entry.chain || existing.chain || "TRON",
    label: String(entry.label || existing.label || "internal").trim(),
    ownerName: String(entry.ownerName || existing.ownerName || "").trim(),
    excludeFromTopHolder: entry.excludeFromTopHolder === undefined
      ? existing.excludeFromTopHolder !== false
      : Boolean(entry.excludeFromTopHolder),
    excludeFromFlowAnalysis: entry.excludeFromFlowAnalysis === undefined
      ? existing.excludeFromFlowAnalysis !== false
      : Boolean(entry.excludeFromFlowAnalysis),
    excludeFromAlert: entry.excludeFromAlert === undefined
      ? existing.excludeFromAlert !== false
      : Boolean(entry.excludeFromAlert),
    reason: String(entry.reason || existing.reason || "").trim(),
    updatedBy: entry.updatedBy || existing.updatedBy || "local-admin",
    updatedAt: new Date().toISOString()
  };
}

function parseInternalAddressImport(body) {
  if (Array.isArray(body.items)) return body.items;
  const text = String(body.text || "");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [address, label, reason] = line.split(",").map((item) => item?.trim());
      return {
        address,
        label: label || "internal",
        reason: reason || body.reason || "Batch import"
      };
    });
}

function requireReason(body, res) {
  if (!body.reason || !String(body.reason).trim()) {
    sendJson(res, 400, { error: "reason is required" });
    return false;
  }
  return true;
}

function logInternalAddressChange({ action, oldValue, newValue, reason, updatedBy }) {
  runtimeInternalAddressChangeLog.unshift({
    action,
    address: newValue?.address || oldValue?.address,
    oldValue: oldValue || null,
    newValue: newValue || null,
    updatedBy: updatedBy || "local-admin",
    updatedAt: new Date().toISOString(),
    reason
  });
}

function buildAnomalySignals(snapshot, thresholds) {
  const signals = [];
  const periodLabel = (snapshot.period || "90d").toUpperCase();
  const market = snapshot.marketComparison;
  const borrowAssets = snapshot.borrowDemand.assets || [];
  const outflow = snapshot.capitalOutflow.summary;
  const destinations = snapshot.capitalOutflow.destinations || [];

  const underperformance = market.relative.tvlUnderperformancePctPoint;
  if (
    thresholdEnabled(thresholds, "competitor_underperformance_pct")
    && underperformance > thresholdValue(thresholds, "competitor_underperformance_pct")
  ) {
    signals.push({
      key: "competitor_underperformance",
      severity: "high",
      title: "JustLend 跑输竞品中位数",
      phenomenon: `JustLend ${periodLabel} TVL ${market.justlend.tvlChangePct.toFixed(1)}%，竞品中位数 ${market.competitorMedian.tvlChangePct.toFixed(1)}%。`,
      impact: "JustLend 表现弱于同类借贷协议。",
      evidence: `相对差值 ${underperformance.toFixed(1)} pct，超过 ${thresholdValue(thresholds, "competitor_underperformance_pct")} pct 阈值。`,
      confidence: "高",
      entry: "Market Comparison"
    });
  }

  for (const asset of borrowAssets) {
    const signal = classifyBorrowSignal(asset, thresholds);
    if (signal.type === "demand_weakening") {
      signals.push({
        key: `borrow_demand_decline_${asset.asset.toLowerCase()}`,
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
        key: `price_impact_${asset.asset.toLowerCase()}`,
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

  if (
    thresholdEnabled(thresholds, "top20_unreturned_ratio_pct")
    && outflow.unreturnedOutflowRatioPct > thresholdValue(thresholds, "top20_unreturned_ratio_pct")
  ) {
    signals.push({
      key: "top20_unreturned_outflow",
      severity: "high",
      title: "Top20 未回流资金流出",
      phenomenon: `Top20 ${periodLabel} 未回流资金 ${compactUsd(outflow.unreturnedOutflowUsd)}。`,
      impact: "该部分资金尚未回到 JustLend，更接近真实大户流失。",
      evidence: `未回流率 ${outflow.unreturnedOutflowRatioPct.toFixed(2)}%，超过 ${thresholdValue(thresholds, "top20_unreturned_ratio_pct")}% 阈值。`,
      confidence: "高",
      entry: "Capital Outflow"
    });
  }

  const whaleThreshold = thresholdValue(thresholds, "single_whale_unreturned_usd");
  const whale = (snapshot.capitalOutflow.top20Lost || []).find((item) => item.unreturnedOutflowUsd > whaleThreshold);
  if (thresholdEnabled(thresholds, "single_whale_unreturned_usd") && whale) {
    signals.push({
      key: "single_whale_unreturned",
      severity: "medium",
      title: "单个大户未回流流出超阈值",
      phenomenon: `${shortAddress(whale.address)} 未回流 ${compactUsd(whale.unreturnedOutflowUsd)}。`,
      impact: "重点用户可能正在撤资，需要结合目的地和回流路径核查。",
      evidence: `阈值 ${compactUsd(whaleThreshold)}，Top destination: ${whale.topDestination}。`,
      confidence: "中",
      entry: "Capital Outflow"
    });
  }

  const concentrated = destinations.find((item) => {
    return item.attribution === "strong"
      && item.sharePct > thresholdValue(thresholds, "destination_concentration_pct");
  });
  if (thresholdEnabled(thresholds, "destination_concentration_pct") && concentrated) {
    signals.push({
      key: "destination_concentration",
      severity: "medium",
      title: "1 跳强归因目的地集中",
      phenomenon: `${concentrated.destination} 承接 Top20 流出 ${concentrated.sharePct.toFixed(1)}%。`,
      impact: "大户资金集中流向同一类目的地。",
      evidence: `超过 ${thresholdValue(thresholds, "destination_concentration_pct")}% 阈值；Overview 只使用 Hop 1 强归因。`,
      confidence: "中",
      entry: "Capital Outflow"
    });
  }

  return signals;
}

const SUPPORTED_PERIODS = new Set(["90d", "30d", "7d"]);

function periodDays(period) {
  if (period === "7d") return 7;
  if (period === "30d") return 30;
  return 90;
}

function scaleNumber(value, factor) {
  if (value === null || value === undefined) return value;
  return Number.isFinite(Number(value)) ? Number(value) * factor : value;
}

function scalePct(value, factor) {
  if (value === null || value === undefined) return value;
  return Number.isFinite(Number(value)) ? Number((Number(value) * factor).toFixed(2)) : value;
}

function addDaysIso(dateValue, days) {
  const date = new Date(dateValue);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function periodStartFromEnd(periodEnd, period) {
  return addDaysIso(periodEnd, -periodDays(period));
}

function derivePeriodSnapshot(snapshot, requestedPeriod) {
  const period = SUPPORTED_PERIODS.has(requestedPeriod) ? requestedPeriod : snapshot.period || "90d";
  if (period === snapshot.period) return snapshot;

  const explicit = snapshot.periodViews?.[period] || snapshot.periodSnapshots?.[period];
  if (explicit) {
    return {
      ...snapshot,
      ...explicit,
      period,
      settings: snapshot.settings,
      dataQuality: [
        ...(explicit.dataQuality || snapshot.dataQuality || []),
        {
          source: "Period View",
          status: "complete",
          message: `${period.toUpperCase()} view loaded from source snapshot.`
        }
      ]
    };
  }

  const factor = periodDays(period) / periodDays(snapshot.period || "90d");
  const derived = JSON.parse(JSON.stringify(snapshot));
  derived.period = period;
  derived.periodStart = periodStartFromEnd(snapshot.periodEnd, period);
  derived.overview = {
    ...derived.overview,
    headline: derived.overview.headline.replace("90D", period.toUpperCase()),
    kpis: {
      ...derived.overview.kpis,
      tvlChangePct: scalePct(derived.overview.kpis.tvlChangePct, factor),
      supplyChangePct: scalePct(derived.overview.kpis.supplyChangePct, factor),
      borrowChangePct: scalePct(derived.overview.kpis.borrowChangePct, factor),
      utilizationChangePct: scalePct(derived.overview.kpis.utilizationChangePct, factor),
      netFlowUsd: scaleNumber(derived.overview.kpis.netFlowUsd, factor)
    }
  };
  derived.marketComparison = {
    ...derived.marketComparison,
    justlend: {
      ...derived.marketComparison.justlend,
      tvlChangePct: scalePct(derived.marketComparison.justlend.tvlChangePct, factor)
    },
    competitorMedian: {
      ...derived.marketComparison.competitorMedian,
      tvlChangePct: scalePct(derived.marketComparison.competitorMedian.tvlChangePct, factor)
    },
    competitors: (derived.marketComparison.competitors || []).map((item) => ({
      ...item,
      tvlChangePct: scalePct(item.tvlChangePct, factor),
      borrowChangePct: item.borrowChangePct === null ? null : scalePct(item.borrowChangePct, factor)
    }))
  };
  derived.marketComparison.relative = {
    ...derived.marketComparison.relative,
    tvlUnderperformancePctPoint: Number((
      derived.marketComparison.competitorMedian.tvlChangePct - derived.marketComparison.justlend.tvlChangePct
    ).toFixed(2)),
    borrowUnderperformancePctPoint: null
  };
  derived.borrowDemand.assets = (derived.borrowDemand.assets || []).map((item) => ({
    ...item,
    supplyChangePct: scalePct(item.supplyChangePct, factor),
    borrowAmountChangePct: scalePct(item.borrowAmountChangePct, factor),
    borrowUsdChangePct: scalePct(item.borrowUsdChangePct, factor),
    assetPriceChangePct: scalePct(item.assetPriceChangePct, factor),
    utilizationChangePct: scalePct(item.utilizationChangePct, factor),
    borrowApyChangePct: scalePct(item.borrowApyChangePct, factor),
    supplyApyChangePct: scalePct(item.supplyApyChangePct, factor)
  }));
  const summary = derived.capitalOutflow.summary;
  summary.grossWithdrawUsd = scaleNumber(summary.grossWithdrawUsd, factor);
  summary.grossDepositUsd = scaleNumber(summary.grossDepositUsd, factor);
  summary.netOutflowUsd = scaleNumber(summary.netOutflowUsd, factor);
  summary.returnedOutflowUsd = scaleNumber(summary.returnedOutflowUsd, factor);
  summary.unreturnedOutflowUsd = scaleNumber(summary.unreturnedOutflowUsd, factor);
  summary.unreturnedOutflowRatioPct = Number(((summary.unreturnedOutflowUsd / summary.beginningSupplyUsd) * 100).toFixed(2));
  derived.capitalOutflow.top20Current = (derived.capitalOutflow.top20Current || []).map((item) => ({
    ...item,
    unreturnedOutflowUsd: scaleNumber(item.unreturnedOutflowUsd, factor)
  }));
  derived.capitalOutflow.top20Lost = (derived.capitalOutflow.top20Lost || [])
    .map((item) => ({
      ...item,
      grossWithdrawUsd: scaleNumber(item.grossWithdrawUsd, factor),
      returnedOutflowUsd: scaleNumber(item.returnedOutflowUsd, factor),
      unreturnedOutflowUsd: scaleNumber(item.unreturnedOutflowUsd, factor)
    }))
    .sort((a, b) => b.unreturnedOutflowUsd - a.unreturnedOutflowUsd)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  derived.capitalOutflow.destinations = (derived.capitalOutflow.destinations || []).map((item) => ({
    ...item,
    amountUsd: scaleNumber(item.amountUsd, factor)
  }));
  derived.capitalOutflow.attributionDetails = (derived.capitalOutflow.attributionDetails || []).map((item) => ({
    ...item,
    amountUsd: scaleNumber(item.amountUsd, factor)
  }));
  derived.capitalOutflow.roundTrips = (derived.capitalOutflow.roundTrips || []).map((item) => ({
    ...item,
    outflowUsd: scaleNumber(item.outflowUsd, factor),
    returnUsd: scaleNumber(item.returnUsd, factor)
  }));
  derived.dataQuality = [
    ...(derived.dataQuality || []),
    {
      source: "Derived Period View",
      status: "derived",
      message: `${period.toUpperCase()} view is derived from the latest 90D snapshot until source-specific ${period.toUpperCase()} exports are provided.`
    }
  ];
  return derived;
}

function normalizeCapitalOutflowSnapshot(snapshot) {
  if (!snapshot?.capitalOutflow) return snapshot;
  const capitalOutflow = {
    ...snapshot.capitalOutflow,
    top20Lost: backfillTopLostDestinations(snapshot.capitalOutflow)
  };
  return { ...snapshot, capitalOutflow };
}

function withWindow(payload, snapshot, period) {
  return {
    period: period || snapshot.period,
    generatedAt: snapshot.generatedAt,
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    lastCompleteUtcDate: snapshot.lastCompleteUtcDate,
    ...payload
  };
}

function exportRows(dataset, snapshot, thresholds) {
  const signals = buildAnomalySignals(snapshot, thresholds);
  const outflow = snapshot.capitalOutflow || {};
  const market = snapshot.marketComparison || {};
  const prefix = {
    period: snapshot.period,
    period_start: snapshot.periodStart,
    period_end: snapshot.periodEnd,
    snapshot_date: snapshot.lastCompleteUtcDate,
    generated_at: snapshot.generatedAt
  };

  if (dataset === "overview-signals") {
    return signals.map((item) => ({
      ...prefix,
      key: item.key,
      severity: item.severity,
      title: item.title,
      phenomenon: item.phenomenon,
      impact: item.impact,
      evidence: item.evidence,
      confidence: item.confidence,
      entry: item.entry
    }));
  }
  if (dataset === "market-comparison") {
    return [
      {
        ...prefix,
        protocol: market.justlend?.name || "JustLend",
        tvl_usd: market.justlend?.tvlUsd,
        tvl_change_pct: market.justlend?.tvlChangePct,
        borrow_usd: market.justlend?.borrowUsd,
        borrow_change_pct: market.justlend?.borrowChangePct,
        borrow_status: ""
      },
      ...((market.competitors || []).map((item) => ({
        ...prefix,
        protocol: item.name,
        tvl_usd: item.tvlUsd,
        tvl_change_pct: item.tvlChangePct,
        borrow_usd: item.borrowUsd,
        borrow_change_pct: item.borrowChangePct,
        borrow_status: item.borrowStatus || ""
      })))
    ];
  }
  if (dataset === "borrow-demand") {
    return (snapshot.borrowDemand?.assets || []).map((item) => ({
      ...prefix,
      asset: item.asset,
      supply_usd: item.supplyUsd,
      supply_change_pct: item.supplyChangePct,
      borrow_amount: item.borrowAmount,
      borrow_amount_change_pct: item.borrowAmountChangePct,
      borrow_usd: item.borrowUsd,
      borrow_usd_change_pct: item.borrowUsdChangePct,
      asset_price_change_pct: item.assetPriceChangePct,
      utilization_pct: item.utilization,
      utilization_change_pct: item.utilizationChangePct,
      borrow_apy: item.borrowApy,
      supply_apy: item.supplyApy,
      source: item.source || ""
    }));
  }
  if (dataset === "top-current") {
    return (outflow.top20Current || []).map((item) => ({
      ...prefix,
      rank: item.rank,
      address: item.address,
      supply_usd: item.supplyUsd,
      borrow_usd: item.borrowUsd,
      net_position_usd: item.netPositionUsd,
      primary_asset: item.primaryAsset,
      unreturned_outflow_usd: item.unreturnedOutflowUsd,
      return_rate_pct: item.returnRatePct,
      source: item.source || ""
    }));
  }
  if (dataset === "top-lost") {
    return (outflow.top20Lost || []).map((item) => ({
      ...prefix,
      rank: item.rank,
      address: item.address,
      beginning_supply_usd: item.beginningSupplyUsd,
      gross_withdraw_usd: item.grossWithdrawUsd,
      returned_outflow_usd: item.returnedOutflowUsd,
      unreturned_outflow_usd: item.unreturnedOutflowUsd,
      return_rate_pct: item.returnRatePct,
      top_destination: item.topDestination,
      destination_category: item.destinationCategory || "",
      destination_attribution: item.destinationAttribution || "",
      destination_address: item.destinationAddress || "",
      destination_tx_hash: item.destinationTxHash || "",
      destination_match_reason: item.destinationMatchReason || "",
      primary_asset: item.primaryAsset,
      status: item.status,
      source: item.source || ""
    }));
  }
  if (dataset === "round-trip") {
    return (outflow.roundTrips || []).map((item) => ({
      ...prefix,
      address: item.address,
      outflow_time: item.outflowTime,
      outflow_asset: item.outflowAsset,
      outflow_usd: item.outflowUsd,
      strong_destination: item.strongDestination || item.outflowDestination,
      destination_category: item.destinationCategory || item.outflowDestinationCategory,
      weak_destination: item.weakDestination,
      return_time: item.returnTime,
      return_asset: item.returnAsset,
      return_usd: item.returnUsd,
      return_market: item.returnMarket,
      time_away_hours: item.timeAwayHours,
      status: item.status,
      match_reason: item.matchReason || "",
      outflow_tx_hash: item.outflowTxHash || ""
    }));
  }
  if (dataset === "destinations") {
    return (outflow.destinations || []).map((item) => ({
      ...prefix,
      destination: item.destination,
      category: item.category,
      amount_usd: item.amountUsd,
      share_pct: item.sharePct,
      wallet_count: item.walletCount,
      attribution: item.attribution
    }));
  }
  if (dataset === "attribution-detail") {
    return (outflow.attributionDetails || []).map((item) => ({
      ...prefix,
      hop: item.hop,
      address: item.address,
      amount_usd: item.amountUsd,
      destination: item.destination,
      destination_address: item.destinationAddress || "",
      category: item.category,
      confidence: item.confidence,
      attribution: item.attribution,
      used_in_overview: item.usedInOverview,
      event_time: item.eventTime || "",
      tx_hash: item.txHash || "",
      match_reason: item.matchReason || ""
    }));
  }
  return null;
}

async function serveV1Api(req, res, url) {
  const { config, snapshot, thresholds, internalAddresses } = await buildApiContext();
  const route = url.pathname;
  const period = url.searchParams.get("period") || snapshot.period;
  const latestJobRun = await STORE.latestJobRun().catch(() => null);
  const viewSnapshot = withLatestJobQuality(
    normalizeCapitalOutflowSnapshot(derivePeriodSnapshot(snapshot, period)),
    latestJobRun
  );

  if (route === "/api/v1/export.csv") {
    if (!config.permissions?.csvExportEnabled) {
      sendJson(res, 403, { error: "csv export is disabled" });
      return true;
    }
    const dataset = url.searchParams.get("dataset") || "overview-signals";
    const rows = exportRows(dataset, viewSnapshot, thresholds);
    if (!rows) {
      sendJson(res, 400, { error: "unsupported csv dataset" });
      return true;
    }
    const filename = `justlend-${dataset}-${viewSnapshot.period || period}-${viewSnapshot.lastCompleteUtcDate || "snapshot"}.csv`;
    sendCsv(res, filename, rows);
    return true;
  }

  if (route === "/api/v1/overview") {
    sendJson(res, 200, withWindow({
      headline: viewSnapshot.overview.headline,
      kpis: viewSnapshot.overview.kpis,
      anomalySignals: buildAnomalySignals(viewSnapshot, thresholds),
      roundTripSummary: viewSnapshot.capitalOutflow.summary,
      dataQuality: viewSnapshot.dataQuality
    }, viewSnapshot, period));
    return true;
  }

  if (route === "/api/v1/market-comparison") {
    sendJson(res, 200, withWindow(viewSnapshot.marketComparison, viewSnapshot, period));
    return true;
  }

  if (route === "/api/v1/borrow-demand") {
    const asset = url.searchParams.get("asset");
    const assets = asset
      ? viewSnapshot.borrowDemand.assets.filter((item) => item.asset.toLowerCase() === asset.toLowerCase())
      : viewSnapshot.borrowDemand.assets;
    sendJson(res, 200, withWindow({ assets }, viewSnapshot, period));
    return true;
  }

  if (route === "/api/v1/capital-outflow/summary") {
    sendJson(res, 200, withWindow(viewSnapshot.capitalOutflow.summary, viewSnapshot, period));
    return true;
  }

  if (route === "/api/v1/capital-outflow/top-current") {
    sendJson(res, 200, withWindow({ items: viewSnapshot.capitalOutflow.top20Current }, viewSnapshot, period));
    return true;
  }

  if (route === "/api/v1/capital-outflow/top-lost") {
    sendJson(res, 200, withWindow({ items: viewSnapshot.capitalOutflow.top20Lost }, viewSnapshot, period));
    return true;
  }

  if (route === "/api/v1/capital-outflow/round-trip") {
    sendJson(res, 200, withWindow({ items: viewSnapshot.capitalOutflow.roundTrips }, viewSnapshot, period));
    return true;
  }

  if (route === "/api/v1/capital-outflow/destinations") {
    sendJson(res, 200, withWindow({ items: viewSnapshot.capitalOutflow.destinations }, viewSnapshot, period));
    return true;
  }

  if (route === "/api/v1/capital-outflow/attribution-detail") {
    sendJson(res, 200, withWindow({ items: viewSnapshot.capitalOutflow.attributionDetails }, viewSnapshot, period));
    return true;
  }

  if (route === "/api/v1/settings/internal-addresses" && req.method === "GET") {
    if (!requireAdmin(req, res)) return true;
    sendJson(res, 200, { items: internalAddresses });
    return true;
  }

  if (route === "/api/v1/settings/internal-addresses" && req.method === "POST") {
    if (!requireAdmin(req, res)) return true;
    const body = await readRequestBody(req);
    if (!requireReason(body, res)) return true;
    const item = normalizeInternalAddressEntry(body);
    if (!item.address) {
      sendJson(res, 400, { error: "address is required" });
      return true;
    }
    if (runtimeInternalAddresses.some((entry) => normalizeAddress(entry.address) === item.address)) {
      sendJson(res, 409, { error: "address already exists" });
      return true;
    }
    runtimeInternalAddresses.unshift(item);
    logInternalAddressChange({
      action: "create",
      oldValue: null,
      newValue: item,
      reason: body.reason,
      updatedBy: item.updatedBy
    });
    await STORE.upsertInternalAddress(item).catch(() => {});
    await STORE.logInternalAddressChange({
      action: "create",
      oldValue: null,
      newValue: item,
      reason: body.reason,
      updatedBy: item.updatedBy
    }).catch(() => {});
    sendJson(res, 201, { item });
    return true;
  }

  if (route === "/api/v1/settings/internal-addresses/import" && req.method === "POST") {
    if (!requireAdmin(req, res)) return true;
    const body = await readRequestBody(req);
    if (!requireReason(body, res)) return true;
    const entries = parseInternalAddressImport(body);
    const imported = [];
    const skipped = [];
    for (const raw of entries) {
      const item = normalizeInternalAddressEntry({ ...raw, reason: raw.reason || body.reason, updatedBy: body.updatedBy });
      if (!item.address) {
        skipped.push({ entry: raw, reason: "address is required" });
        continue;
      }
      const existingIndex = runtimeInternalAddresses.findIndex((entry) => normalizeAddress(entry.address) === item.address);
      if (existingIndex >= 0) {
        skipped.push({ entry: raw, reason: "address already exists" });
        continue;
      }
      runtimeInternalAddresses.unshift(item);
      imported.push(item);
      logInternalAddressChange({
        action: "import",
        oldValue: null,
        newValue: item,
        reason: body.reason,
        updatedBy: item.updatedBy
      });
      await STORE.upsertInternalAddress(item).catch(() => {});
      await STORE.logInternalAddressChange({
        action: "import",
        oldValue: null,
        newValue: item,
        reason: body.reason,
        updatedBy: item.updatedBy
      }).catch(() => {});
    }
    sendJson(res, 200, { imported, skipped });
    return true;
  }

  if (route.startsWith("/api/v1/settings/internal-addresses/") && req.method === "PATCH") {
    if (!requireAdmin(req, res)) return true;
    const address = decodeURIComponent(route.split("/").pop());
    const body = await readRequestBody(req);
    if (!requireReason(body, res)) return true;
    const index = runtimeInternalAddresses.findIndex((item) => normalizeAddress(item.address) === normalizeAddress(address));
    if (index === -1) {
      sendJson(res, 404, { error: "internal address not found" });
      return true;
    }
    const oldValue = { ...runtimeInternalAddresses[index] };
    const item = normalizeInternalAddressEntry(body, oldValue);
    runtimeInternalAddresses[index] = item;
    logInternalAddressChange({
      action: "update",
      oldValue,
      newValue: item,
      reason: body.reason,
      updatedBy: item.updatedBy
    });
    await STORE.upsertInternalAddress(item).catch(() => {});
    await STORE.logInternalAddressChange({
      action: "update",
      oldValue,
      newValue: item,
      reason: body.reason,
      updatedBy: item.updatedBy
    }).catch(() => {});
    sendJson(res, 200, { item });
    return true;
  }

  if (route === "/api/v1/settings/internal-addresses/change-log") {
    if (!requireAdmin(req, res)) return true;
    const persistedLog = await STORE.readInternalAddressChangeLog().catch(() => []);
    sendJson(res, 200, { items: [...persistedLog, ...runtimeInternalAddressChangeLog] });
    return true;
  }

  if (route === "/api/v1/settings/thresholds" && req.method === "GET") {
    if (!requireAdmin(req, res)) return true;
    sendJson(res, 200, { items: thresholds });
    return true;
  }

  if (route.startsWith("/api/v1/settings/thresholds/") && req.method === "PATCH") {
    if (!requireAdmin(req, res)) return true;
    const key = decodeURIComponent(route.split("/").pop());
    const body = await readRequestBody(req);
    if (!body.reason || !String(body.reason).trim()) {
      sendJson(res, 400, { error: "reason is required" });
      return true;
    }
    const index = runtimeThresholds.findIndex((item) => item.key === key);
    if (index === -1) {
      sendJson(res, 404, { error: "threshold not found" });
      return true;
    }
    const oldValue = runtimeThresholds[index].value;
    if (body.value !== undefined) runtimeThresholds[index].value = Number(body.value);
    if (body.enabled !== undefined) runtimeThresholds[index].enabled = Boolean(body.enabled);
    runtimeThresholds[index].updatedAt = new Date().toISOString();
    runtimeThresholds[index].updatedBy = body.updatedBy || "local-admin";
    runtimeThresholdChangeLog.unshift({
      thresholdKey: key,
      oldValue,
      newValue: runtimeThresholds[index].value,
      enabled: runtimeThresholds[index].enabled,
      updatedBy: runtimeThresholds[index].updatedBy,
      updatedAt: runtimeThresholds[index].updatedAt,
      reason: String(body.reason)
    });
    await STORE.updateThreshold(runtimeThresholds[index], oldValue, String(body.reason)).catch(() => {});
    sendJson(res, 200, { item: { ...runtimeThresholds[index] } });
    return true;
  }

  if (route === "/api/v1/settings/thresholds/change-log") {
    if (!requireAdmin(req, res)) return true;
    const persistedLog = await STORE.readThresholdChangeLog().catch(() => []);
    sendJson(res, 200, {
      items: [
        ...persistedLog,
        ...runtimeThresholdChangeLog,
        ...(snapshot.settings.changeLog || []).map((item) => ({
          thresholdKey: item.target,
          oldValue: null,
          newValue: null,
          enabled: null,
          updatedBy: item.user,
          updatedAt: item.time,
          reason: item.reason,
          summary: item.summary
        }))
      ]
    });
    return true;
  }

  if (route === "/api/v1/settings/data-sources") {
    if (!requireAdmin(req, res)) return true;
    sendJson(res, 200, { items: config.dataSources });
    return true;
  }

  if (route === "/api/v1/settings/asset-scope") {
    if (!requireAdmin(req, res)) return true;
    sendJson(res, 200, { items: config.assets });
    return true;
  }

  if (route === "/api/v1/settings/attribution-rules") {
    if (!requireAdmin(req, res)) return true;
    sendJson(res, 200, config.attributionRules);
    return true;
  }

  return false;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(ROOT, requested));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "content-type": MIME_TYPES[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(content);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/config") {
      sendJson(res, 200, await readJson(CONFIG_PATH));
      return;
    }

    if (url.pathname === "/api/snapshot") {
      sendJson(res, 200, await getSnapshot(url.searchParams.get("period")));
      return;
    }

    if (url.pathname.startsWith("/api/v1/auth/")) {
      const handled = await serveAuthApi(req, res, url);
      if (!handled) sendJson(res, 404, { error: "Auth route not found" });
      return;
    }

    if (url.pathname.startsWith("/api/v1/")) {
      const handled = await serveV1Api(req, res, url);
      if (!handled) sendJson(res, 404, { error: "API route not found" });
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message, stack: error.stack });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`JustLend Capital Intelligence Dashboard listening on http://${HOST}:${PORT}`);
});
