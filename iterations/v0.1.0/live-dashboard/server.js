const http = require("node:http");
const crypto = require("node:crypto");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, "config.json");
const SNAPSHOT_CACHE_PATH = path.join(ROOT, "data/live-snapshot-cache.json");

function loadDotEnv(filePath) {
  if (!fsSync.existsSync(filePath)) return;
  const lines = fsSync.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function listFromEnv(key) {
  return String(process.env[key] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

loadDotEnv(path.resolve(process.cwd(), ".env"));
loadDotEnv(path.join(ROOT, ".env"));
loadDotEnv(path.resolve(ROOT, "../../..", ".env"));

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const TRONGRID_API_BASE = process.env.TRONGRID_API_BASE || "https://api.trongrid.io";
const TRONGRID_API_KEYS = [
  ...listFromEnv("TRON_PRO_API_KEYS"),
  process.env.TRON_PRO_API_KEY,
  process.env.TRONGRID_API_KEY
].filter(Boolean);
const TRONGRID_API_KEY = [...new Set(TRONGRID_API_KEYS)][0] || "";
const TRONGRID_REQUEST_DELAY_MS = Number(process.env.TRONGRID_REQUEST_DELAY_MS || 250);
const BLACKLIST_CACHE_TTL_MS = Number(process.env.BLACKLIST_CACHE_TTL_MS || 10 * 60 * 1000);
const BLACKLIST_UNKNOWN_CACHE_TTL_MS = Number(process.env.BLACKLIST_UNKNOWN_CACHE_TTL_MS || 30 * 1000);
const blacklistStatusCache = new Map();
let nextTronGridRequestAt = 0;
let snapshotCache = null;
let snapshotRefreshPromise = null;
let snapshotRefreshTimer = null;
const snapshotRefreshState = {
  inProgress: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_MAP = new Map([...BASE58_ALPHABET].map((char, index) => [char, BigInt(index)]));

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(Number(limit) || 1, items.length || 1));
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readConfig() {
  return JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
}

function snapshotRefreshMs(config) {
  const seconds = Number(process.env.SNAPSHOT_REFRESH_SECONDS || config.dashboard?.snapshotRefreshSeconds || 300);
  return Math.max(60, seconds) * 1000;
}

async function readSnapshotCache() {
  try {
    return JSON.parse(await fs.readFile(SNAPSHOT_CACHE_PATH, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    console.warn(`[snapshot] cache read failed: ${error.message}`);
    return null;
  }
}

async function writeSnapshotCache(snapshot) {
  await fs.mkdir(path.dirname(SNAPSHOT_CACHE_PATH), { recursive: true });
  await fs.writeFile(SNAPSHOT_CACHE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

function decorateSnapshot(snapshot, config, { servedFromCache }) {
  return {
    ...snapshot,
    cache: {
      servedFromCache,
      refreshInProgress: snapshotRefreshState.inProgress,
      lastStartedAt: snapshotRefreshState.lastStartedAt,
      lastFinishedAt: snapshotRefreshState.lastFinishedAt,
      lastError: snapshotRefreshState.lastError,
      refreshSeconds: Math.round(snapshotRefreshMs(config) / 1000)
    }
  };
}

async function buildPendingSnapshot(config) {
  const addressIntel = await buildAddressIntel(config);
  const watched = (config.watchedAddresses || []).filter((item) => item.enabled);
  return {
    generatedAt: new Date().toISOString(),
    configSummary: {
      watchedCount: watched.length,
      htxSeedCount: addressIntel.htxSeeds.size,
      platformSeedCount: addressIntel.platformSeeds.size,
      riskThresholdUsd: config.dashboard.riskThresholdUsd,
      tronGridApiKeyConfigured: Boolean(TRONGRID_API_KEY)
    },
    status: {
      level: "SYNCING",
      contractFrozen: false,
      p1Count: 0,
      userHitCount: 0,
      userUnknownCount: 0,
      watchCount: 0,
      eventCount: 0,
      htxDetectionEnabled: addressIntel.htxSeeds.size > 0
    },
    tokenStatus: {
      USDT: { frozenCount: 0, unknownCount: watched.length },
      USDC: { frozenCount: 0, unknownCount: watched.length }
    },
    addressBook: addressIntel.addressBook,
    userIntersection: {
      enabled: true,
      source: config.userAddressPool?.source || "--",
      totalCount: 0,
      scannedCount: 0,
      hitCount: 0,
      unknownCount: 0,
      results: [],
      hits: [],
      discovery: [],
      addressBook: null,
      emptyReason: "后台正在生成 JustLend 地址库和风险快照。"
    },
    addresses: watched.map((item) => ({
      ...item,
      blacklist: { status: "unknown", reason: "后台快照同步中" },
      blacklists: {
        USDT: { status: "unknown", reason: "后台快照同步中" },
        USDC: { status: "unknown", reason: "后台快照同步中" }
      },
      transferScanEnabled: item.trackTransfers !== false,
      transferError: null,
      recentInflowCount: 0,
      recentInflowAmount: 0
    })),
    events: [],
    notes: config.notes || []
  };
}

function normalizeAddress(address) {
  return String(address || "").trim();
}

function normalizeEntity(value) {
  return String(value || "").trim().toUpperCase();
}

function isUsableCexEntry(entry) {
  const confidence = String(entry.confidence || "").toLowerCase();
  return String(entry.chain || "").toLowerCase() === "tron"
    && normalizeAddress(entry.address)
    && String(entry.type || "").startsWith("cex_")
    && !["rejected", "non_cex"].includes(confidence);
}

function isHtxEntry(entry) {
  const entity = normalizeEntity(entry.entity);
  const label = String(entry.label || "");
  return entity === "HTX" || entity === "HUOBI" || /HTX|Huobi|火币/i.test(label);
}

function toIntelEntry(entry, role) {
  return {
    address: normalizeAddress(entry.address),
    entity: entry.entity || (role === "htx" ? "HTX" : "CEX"),
    label: entry.label || entry.address,
    type: entry.type || "cex_wallet",
    confidence: entry.confidence || "unknown",
    role,
    source: Array.isArray(entry.source) ? entry.source.join(", ") : entry.source || "cex_address_book"
  };
}

function addIntelEntry(map, entry) {
  if (!entry.address || map.has(entry.address)) return;
  map.set(entry.address, entry);
}

function addManualAddresses(map, addresses, role) {
  for (const address of addresses || []) {
    const normalized = normalizeAddress(address);
    if (!normalized || map.has(normalized)) continue;
    map.set(normalized, {
      address: normalized,
      entity: role === "htx" ? "HTX" : "Configured Platform",
      label: role === "htx" ? "HTX manual seed" : "Manual platform seed",
      type: "manual_seed",
      confidence: "manual",
      role,
      source: "config.json"
    });
  }
}

function normalizeUserPoolEntry(entry, index) {
  if (typeof entry === "string") {
    return {
      address: normalizeAddress(entry),
      role: "未标注",
      market: "--",
      source: "config.json",
      note: ""
    };
  }

  return {
    address: normalizeAddress(entry?.address),
    role: entry?.role || entry?.identity || "未标注",
    market: entry?.market || "--",
    source: entry?.source || "config.json",
    note: entry?.note || entry?.notes || "",
    index
  };
}

function getConfiguredUserPool(config) {
  const pool = config.userAddressPool || {};
  const addresses = Array.isArray(pool.addresses)
    ? pool.addresses.map(normalizeUserPoolEntry).filter((item) => item.address)
    : [];
  const configuredSources = Array.isArray(pool.onchainSources) ? pool.onchainSources : [];
  const autoSources = buildAutoJTokenSources(config, pool);
  return {
    enabled: pool.enabled !== false,
    source: pool.source || "config.json",
    addressBookPath: pool.addressBookPath || "../../../shared/address-book/data/justlend-address-book.json",
    scanLimit: Number(pool.scanLimit || 80),
    addresses,
    onchainSources: dedupeJTokenSources([...configuredSources, ...autoSources])
  };
}

function buildAutoJTokenSources(config, pool) {
  const auto = pool.autoJTokenSources || {};
  if (auto.enabled === false) return [];
  const includeLegacy = Boolean(auto.includeLegacyMarkets);
  const includeAssets = new Set((auto.includeAssets || []).map((asset) => String(asset).toUpperCase()));
  return (config.watchedAddresses || [])
    .filter((item) => item.enabled !== false)
    .filter((item) => String(item.role || "").includes("market"))
    .filter((item) => includeLegacy || !String(item.role || "").includes("legacy"))
    .filter((item) => !includeAssets.size || includeAssets.has(String(item.asset || "").toUpperCase()))
    .filter((item) => normalizeAddress(item.address))
    .map((item) => {
      const baseName = String(item.name || "jToken market").replace(/\s+market$/i, "");
      return {
        enabled: true,
        type: "jtoken_holders",
        name: `${baseName} holder`,
        market: item.market || "--",
        contract: item.address,
        transferLimit: Number(auto.transferLimit || 80),
        maxCandidates: Number(auto.maxCandidates || 12),
        source: "auto_watched_jtoken"
      };
    });
}

function dedupeJTokenSources(sources) {
  const byContract = new Map();
  for (const source of sources) {
    const contract = normalizeAddress(source?.contract);
    if (!contract || byContract.has(contract)) continue;
    byContract.set(contract, source);
  }
  return [...byContract.values()];
}

function isIgnoredPoolAddress(address, sourceContract) {
  const normalized = normalizeAddress(address);
  return !normalized
    || normalized === normalizeAddress(sourceContract)
    || normalized === "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
}

function resolveRootPath(filePath) {
  if (!filePath) return "";
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
}

async function readJustLendAddressBook(filePath) {
  const resolved = resolveRootPath(filePath);
  if (!resolved) return { path: "", entries: [], error: null };
  try {
    const parsed = JSON.parse(await fs.readFile(resolved, "utf8"));
    return {
      path: resolved,
      updatedAt: parsed.updatedAt || null,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      error: null
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { path: resolved, updatedAt: null, entries: [], error: null };
    }
    return { path: resolved, updatedAt: null, entries: [], error: error.message };
  }
}

async function writeJustLendAddressBook(filePath, entries) {
  const resolved = resolveRootPath(filePath);
  if (!resolved) return;
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const payload = {
    updatedAt: new Date().toISOString(),
    source: "live-dashboard",
    entries: entries.sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")))
  };
  await fs.writeFile(resolved, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function addressBookEntryToUser(entry) {
  return {
    address: normalizeAddress(entry.address),
    role: Array.isArray(entry.roles) && entry.roles.length ? entry.roles.join(" / ") : entry.role || "JustLend user",
    market: Array.isArray(entry.markets) && entry.markets.length ? entry.markets.join(" / ") : entry.market || "--",
    source: "justlend-address-book",
    note: [
      entry.currentHolder === true ? "current holder" : entry.currentHolder === false ? "historical participant" : "",
      entry.lastSeenAt ? `lastSeen=${entry.lastSeenAt}` : ""
    ].filter(Boolean).join("; ")
  };
}

function mergeAddressBookEntry(existing, discovered, nowIso) {
  const roles = new Set([...(existing.roles || []), discovered.role].filter(Boolean));
  const markets = new Set([...(existing.markets || []), discovered.market].filter(Boolean));
  const sources = new Set([...(existing.sources || []), discovered.source].filter(Boolean));
  return {
    address: discovered.address,
    roles: [...roles],
    markets: [...markets],
    sources: [...sources],
    firstSeenAt: existing.firstSeenAt || nowIso,
    lastSeenAt: nowIso,
    currentHolder: Boolean(discovered.currentHolder),
    lastBalanceRaw: discovered.balanceRaw || "0",
    note: discovered.note || existing.note || ""
  };
}

async function readCexAddressBook(config) {
  const bookPath = config.cexAddressBookPath;
  const enabled = config.riskSources?.useCexAddressBook !== false;
  if (!enabled || !bookPath) {
    return { enabled, path: bookPath || "", updatedAt: null, entries: [], error: null };
  }

  try {
    const parsed = JSON.parse(await fs.readFile(bookPath, "utf8"));
    return {
      enabled,
      path: bookPath,
      updatedAt: parsed.updatedAt || null,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      error: null
    };
  } catch (error) {
    return {
      enabled,
      path: bookPath,
      updatedAt: null,
      entries: [],
      error: error.message
    };
  }
}

async function buildAddressIntel(config) {
  const book = await readCexAddressBook(config);
  const htxMap = new Map();
  const platformMap = new Map();
  const byAddress = new Map();

  for (const entry of book.entries.filter(isUsableCexEntry)) {
    if (isHtxEntry(entry)) {
      addIntelEntry(htxMap, toIntelEntry(entry, "htx"));
    } else {
      addIntelEntry(platformMap, toIntelEntry(entry, "platform"));
    }
  }

  addManualAddresses(htxMap, config.riskSources?.htxSeedAddresses, "htx");
  addManualAddresses(platformMap, config.riskSources?.intermediatePlatformAddresses, "platform");

  for (const entry of htxMap.values()) addIntelEntry(byAddress, entry);
  for (const entry of platformMap.values()) {
    if (!htxMap.has(entry.address)) addIntelEntry(byAddress, entry);
  }

  return {
    addressBook: {
      enabled: book.enabled,
      path: book.path,
      updatedAt: book.updatedAt,
      error: book.error,
      totalEntryCount: book.entries.length,
      usableEntryCount: book.entries.filter(isUsableCexEntry).length,
      htxCount: htxMap.size,
      platformCount: platformMap.size
    },
    htxSeeds: new Set(htxMap.keys()),
    platformSeeds: new Set([...platformMap.keys()].filter((address) => !htxMap.has(address))),
    byAddress
  };
}

function base58ToHex(address) {
  let value = 0n;
  for (const char of address) {
    const mapped = BASE58_MAP.get(char);
    if (mapped === undefined) throw new Error(`Invalid base58 char: ${char}`);
    value = value * 58n + mapped;
  }

  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;

  let leadingZeroBytes = "";
  for (const char of address) {
    if (char !== "1") break;
    leadingZeroBytes += "00";
  }

  const fullHex = `${leadingZeroBytes}${hex}`;
  return fullHex.slice(0, 42);
}

function base58Encode(buffer) {
  let value = BigInt(`0x${buffer.toString("hex")}`);
  let output = "";
  while (value > 0n) {
    const mod = Number(value % 58n);
    output = BASE58_ALPHABET[mod] + output;
    value = value / 58n;
  }

  for (const byte of buffer) {
    if (byte !== 0) break;
    output = `1${output}`;
  }

  return output || "1";
}

function hexAddressToTronBase58(hexAddress) {
  const clean = String(hexAddress || "").replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{40}$/.test(clean)) return "";
  const payload = Buffer.from(`41${clean}`, "hex");
  const first = crypto.createHash("sha256").update(payload).digest();
  const second = crypto.createHash("sha256").update(first).digest();
  return base58Encode(Buffer.concat([payload, second.subarray(0, 4)]));
}

function encodeTronAddressParameter(base58Address) {
  const hex = base58ToHex(base58Address);
  return hex.padStart(64, "0");
}

function isTronGridUrl(url) {
  try {
    return new URL(url).hostname === new URL(TRONGRID_API_BASE).hostname;
  } catch {
    return false;
  }
}

function tronGridHeaders(url) {
  if (!TRONGRID_API_KEY || !isTronGridUrl(url)) return {};
  return { "TRON-PRO-API-KEY": TRONGRID_API_KEY };
}

async function throttleTronGrid(url) {
  if (!isTronGridUrl(url) || !TRONGRID_REQUEST_DELAY_MS) return;
  const now = Date.now();
  const waitMs = Math.max(0, nextTronGridRequestAt - now);
  nextTronGridRequestAt = Math.max(now, nextTronGridRequestAt) + TRONGRID_REQUEST_DELAY_MS;
  if (waitMs) await wait(waitMs);
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
  try {
    await throttleTronGrid(url);
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "accept": "application/json",
        ...tronGridHeaders(url),
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function triggerConstantContract({ contract, functionSelector, parameter }) {
  return fetchJson(`${TRONGRID_API_BASE}/wallet/triggerconstantcontract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      owner_address: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
      contract_address: contract,
      function_selector: functionSelector,
      parameter,
      visible: true
    })
  });
}

async function getTokenBlacklistStatus(tokenConfig, address) {
  const cacheKey = `${tokenConfig.symbol}:${normalizeAddress(address)}`;
  const cached = blacklistStatusCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const result = await triggerConstantContract({
      contract: tokenConfig.contract,
      functionSelector: tokenConfig.blacklistFunction || "getBlackListStatus(address)",
      parameter: encodeTronAddressParameter(address)
    });
    const raw = Array.isArray(result.constant_result) ? result.constant_result[0] : "";
    const value = !raw ? { status: "unknown", raw: result } : {
      status: raw.endsWith("1") ? "blacklisted" : "clear",
      raw
    };
    blacklistStatusCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + (value.status === "unknown" ? BLACKLIST_UNKNOWN_CACHE_TTL_MS : BLACKLIST_CACHE_TTL_MS)
    });
    return value;
  } catch (error) {
    const value = { status: "unknown", error: error.message };
    blacklistStatusCache.set(cacheKey, { value, expiresAt: Date.now() + BLACKLIST_UNKNOWN_CACHE_TTL_MS });
    return value;
  }
}

function decodeUintResult(raw) {
  if (!raw) return 0n;
  try {
    return BigInt(`0x${raw}`);
  } catch {
    return 0n;
  }
}

async function getContractUintValue(contract, functionSelector, address) {
  const result = await triggerConstantContract({
    contract,
    functionSelector,
    parameter: encodeTronAddressParameter(address)
  });
  const raw = Array.isArray(result.constant_result) ? result.constant_result[0] : "";
  return decodeUintResult(raw);
}

async function getTrc20TransfersByContract({ contract, limit = 80 }) {
  const url = new URL("https://apilist.tronscanapi.com/api/token_trc20/transfers");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("start", "0");
  url.searchParams.set("sort", "-timestamp");
  url.searchParams.set("count", "true");
  url.searchParams.set("contract_address", contract);

  const json = await fetchJson(url.toString());
  const rows = Array.isArray(json.token_transfers)
    ? json.token_transfers
    : Array.isArray(json.data)
      ? json.data
      : [];
  return rows.map((item) => normalizeTransfer(item, { contract, decimals: 6, symbol: "jToken" }));
}

async function getContractTransferEvents({ contract, limit = 80 }) {
  const url = new URL(`/v1/contracts/${contract}/events`, TRONGRID_API_BASE);
  url.searchParams.set("event_name", "Transfer");
  url.searchParams.set("only_confirmed", "true");
  url.searchParams.set("order_by", "block_timestamp,desc");
  url.searchParams.set("limit", String(limit));

  const json = await fetchJson(url.toString());
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows.map((item) => ({
    txid: item.transaction_id || "",
    blockTs: item.block_timestamp || null,
    from: hexAddressToTronBase58(item.result?.from),
    to: hexAddressToTronBase58(item.result?.to),
    contract,
    amount: Number(item.result?.amount || 0),
    amountRaw: String(item.result?.amount || ""),
    token: "jToken",
    raw: item
  }));
}

async function discoverJTokenHolders(source) {
  if (source.enabled === false || source.type !== "jtoken_holders" || !source.contract) {
    return { source: source.name || "jToken", scannedCandidates: 0, addresses: [], error: null };
  }

  try {
    let transfers = [];
    let provider = "tronscan_token_transfers";
    let tronscanError = null;

    try {
      transfers = await getTrc20TransfersByContract({
        contract: source.contract,
        limit: source.transferLimit || 80
      });
    } catch (error) {
      tronscanError = error.message;
      provider = "trongrid_contract_events";
      transfers = await getContractTransferEvents({
        contract: source.contract,
        limit: source.transferLimit || 80
      });
    }

    const candidates = [];
    const seen = new Set();

    for (const transfer of transfers) {
      for (const address of [transfer.from, transfer.to]) {
        const normalized = normalizeAddress(address);
        if (isIgnoredPoolAddress(normalized, source.contract) || seen.has(normalized)) continue;
        seen.add(normalized);
        candidates.push(normalized);
        if (candidates.length >= (source.maxCandidates || 20)) break;
      }
      if (candidates.length >= (source.maxCandidates || 20)) break;
    }

    const addresses = [];
    let currentHolderCount = 0;
    for (const address of candidates) {
      let balance = 0n;
      try {
        balance = await getContractUintValue(source.contract, "balanceOf(address)", address);
      } catch {
        balance = 0n;
      }

      if (balance > 0n) currentHolderCount += 1;
      const holderName = source.name || "jToken holder";
      if (balance > 0n) {
        addresses.push({
          address,
          role: holderName,
          market: source.market || "--",
          source: `onchain:${provider}`,
          currentHolder: true,
          balanceRaw: balance.toString(),
          note: `balanceOf > 0; candidateLimit=${source.maxCandidates || 20}${tronscanError ? "; tronscan fallback" : ""}`
        });
      } else {
        addresses.push({
          address,
          role: holderName.replace(/\s+holder$/i, " participant"),
          market: source.market || "--",
          source: `onchain:${provider}`,
          currentHolder: false,
          balanceRaw: "0",
          note: `recent jToken transfer candidate; balanceOf = 0; candidateLimit=${source.maxCandidates || 20}${tronscanError ? "; tronscan fallback" : ""}`
        });
      }
    }

    return {
      source: source.name || "jToken",
      scannedCandidates: candidates.length,
      currentHolderCount,
      addresses,
      provider,
      error: null
    };
  } catch (error) {
    return {
      source: source.name || "jToken",
      scannedCandidates: 0,
      addresses: [],
      error: error.message
    };
  }
}

async function buildUserAddressPool(config) {
  const pool = getConfiguredUserPool(config);
  const book = await readJustLendAddressBook(pool.addressBookPath);
  const bookByAddress = new Map(
    book.entries
      .map((entry) => [normalizeAddress(entry.address), entry])
      .filter(([address]) => address)
  );
  const byAddress = new Map(
    book.entries
      .map(addressBookEntryToUser)
      .filter((item) => item.address)
      .map((item) => [item.address, item])
  );
  for (const item of pool.addresses) {
    if (!byAddress.has(item.address)) byAddress.set(item.address, item);
  }
  const discovery = [];
  let bookChanged = false;
  const nowIso = new Date().toISOString();

  for (const source of pool.onchainSources) {
    const discovered = await discoverJTokenHolders(source);
    discovery.push(discovered);
    for (const item of discovered.addresses) {
      if (!byAddress.has(item.address)) byAddress.set(item.address, item);
      const existing = bookByAddress.get(item.address) || {};
      bookByAddress.set(item.address, mergeAddressBookEntry(existing, item, nowIso));
      bookChanged = true;
    }
  }

  if (bookChanged) {
    await writeJustLendAddressBook(pool.addressBookPath, [...bookByAddress.values()]);
  }

  const allAddresses = [...byAddress.values()];
  const scanLimit = Number.isFinite(pool.scanLimit) && pool.scanLimit > 0 ? pool.scanLimit : allAddresses.length;
  return {
    ...pool,
    addresses: allAddresses.slice(0, scanLimit),
    totalAddressBookCount: allAddresses.length,
    addressBook: {
      path: book.path,
      updatedAt: bookChanged ? nowIso : book.updatedAt,
      error: book.error,
      entryCount: bookByAddress.size,
      scannedCount: Math.min(scanLimit, allAddresses.length)
    },
    discovery
  };
}

function getHitAssets(blacklists) {
  return Object.entries(blacklists || {})
    .filter(([, value]) => value?.status === "blacklisted")
    .map(([symbol]) => symbol);
}

async function scanUserBlacklistIntersection(config, blacklistTokens) {
  const pool = await buildUserAddressPool(config);
  const results = [];

  if (!pool.enabled) {
    return {
      enabled: false,
      source: pool.source,
      totalCount: 0,
      scannedCount: 0,
      hitCount: 0,
      unknownCount: 0,
      results,
      hits: [],
      discovery: pool.discovery,
      addressBook: pool.addressBook,
      emptyReason: "用户地址池扫描未启用。"
    };
  }

  const scannedResults = await mapLimit(pool.addresses, 8, async (user) => {
    const blacklists = {};
    for (const token of blacklistTokens) {
      blacklists[token.symbol] = await getTokenBlacklistStatus(token, user.address);
    }

    const hitAssets = getHitAssets(blacklists);
    const hasUnknown = Object.values(blacklists).some((status) => status.status === "unknown");
    return {
      ...user,
      blacklists,
      hitAssets,
      level: hitAssets.length ? "P1" : hasUnknown ? "UNKNOWN" : "CLEAR",
      action: hitAssets.length
        ? "进入风险关注池，核查余额、债务、清算与迁移行为。"
        : hasUnknown
          ? "黑名单状态查询失败，待重试后再判断是否进入风险关注池。"
          : "无需进入风险关注池。"
    };
  });
  results.push(...scannedResults);

  const hits = results.filter((item) => item.hitAssets.length);
  return {
    enabled: true,
    source: pool.source,
    totalCount: pool.addresses.length,
    scannedCount: results.length,
    hitCount: hits.length,
    unknownCount: results.filter((item) => Object.values(item.blacklists).some((status) => status.status === "unknown")).length,
    results,
    hits,
    discovery: pool.discovery,
    addressBook: pool.addressBook,
    emptyReason: pool.addresses.length ? "" : "未从配置、JustLend 地址库或链上 jToken Transfer 候选中发现用户地址。"
  };
}

function normalizeTransfer(item, tokenConfig) {
  const decimals = Number(item.tokenInfo?.tokenDecimal ?? tokenConfig.decimals ?? 6);
  const amountRaw = Number(item.quant ?? item.amount ?? 0);
  const amount = amountRaw / 10 ** decimals;
  return {
    txid: item.transaction_id || item.transactionId || item.hash || "",
    blockTs: item.block_ts || item.block_timestamp || item.timestamp || null,
    from: item.from_address || item.from || "",
    to: item.to_address || item.to || "",
    contract: item.contract_address || item.contractAddress || tokenConfig.contract,
    amount,
    amountRaw: String(item.quant ?? item.amount ?? ""),
    token: item.tokenInfo?.tokenAbbr || tokenConfig.symbol,
    confirmed: item.confirmed,
    raw: item
  };
}

async function getTrc20Transfers({ tokenConfig, relatedAddress, limit = 50 }) {
  const url = new URL("https://apilist.tronscanapi.com/api/token_trc20/transfers");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("start", "0");
  url.searchParams.set("sort", "-timestamp");
  url.searchParams.set("count", "true");
  url.searchParams.set("contract_address", tokenConfig.contract);
  url.searchParams.set("relatedAddress", relatedAddress);

  const json = await fetchJson(url.toString());
  const rows = Array.isArray(json.token_transfers)
    ? json.token_transfers
    : Array.isArray(json.data)
      ? json.data
      : [];
  return rows.map((item) => normalizeTransfer(item, tokenConfig));
}

function hasChronologicalOrder(firstTs, secondTs) {
  if (!firstTs || !secondTs) return true;
  return Number(firstTs) <= Number(secondTs);
}

async function classifyTransfer({ transfer, tokenConfig, upstreamTransfers, addressIntel }) {
  const htxSeeds = addressIntel.htxSeeds;
  const platformSeeds = addressIntel.platformSeeds;
  const from = normalizeAddress(transfer.from);
  const fromEntry = addressIntel.byAddress.get(from);

  if (!htxSeeds.size) {
    return {
      enabled: false,
      tag: "SP_DISABLED",
      level: "UNCONFIGURED",
      reason: "HTX seed 地址未配置，未启用 SP-1 / SP-2 识别。"
    };
  }

  if (htxSeeds.has(from)) {
    return {
      enabled: true,
      tag: "HTX_SP0_direct",
      level: "P1",
      reason: `资金直接来自 ${fromEntry?.label || "HTX seed 地址"}。`,
      sourceLabel: fromEntry?.label || "HTX seed"
    };
  }

  const inboundFromHtx = upstreamTransfers.find((item) => {
    return normalizeAddress(item.to) === from && htxSeeds.has(normalizeAddress(item.from));
  });
  if (inboundFromHtx) {
    const source = addressIntel.byAddress.get(normalizeAddress(inboundFromHtx.from));
    return {
      enabled: true,
      tag: "HTX_SP1_wallet_inflow",
      level: "P1",
      reason: `${source?.label || "HTX seed 地址"} 先进入 TRON 钱包，再进入 JustLend watched address。`,
      sourceLabel: source?.label || "HTX seed",
      evidenceTxid: inboundFromHtx.txid
    };
  }

  const inboundFromPlatform = upstreamTransfers.find((item) => {
    return normalizeAddress(item.to) === from && platformSeeds.has(normalizeAddress(item.from));
  });
  if (inboundFromPlatform) {
    const platformAddress = normalizeAddress(inboundFromPlatform.from);
    const source = addressIntel.byAddress.get(platformAddress);
    let platformTransfers = [];
    try {
      platformTransfers = await getTrc20Transfers({
        tokenConfig,
        relatedAddress: platformAddress,
        limit: 30
      });
    } catch {
      platformTransfers = [];
    }

    const htxToPlatform = platformTransfers.find((item) => {
      return normalizeAddress(item.to) === platformAddress
        && htxSeeds.has(normalizeAddress(item.from))
        && hasChronologicalOrder(item.blockTs, inboundFromPlatform.blockTs);
    });

    if (htxToPlatform) {
      const htxSource = addressIntel.byAddress.get(normalizeAddress(htxToPlatform.from));
      return {
        enabled: true,
        tag: "HTX_SP2_platform_proven",
        level: "P1",
        reason: `${htxSource?.label || "HTX seed 地址"} 先进入 ${source?.label || "平台地址"}，再出金到钱包并进入 JustLend。`,
        sourceLabel: htxSource?.label || "HTX seed",
        evidenceTxid: htxToPlatform.txid,
        bridgeTxid: inboundFromPlatform.txid
      };
    }

    return {
      enabled: true,
      tag: "CEX_WALLET_INFLOW",
      level: "CLEAR",
      reason: `${source?.label || "平台地址"} 出金到钱包后进入 JustLend；未发现 HTX -> 平台的链上证据，按 HTX 风险未命中处理。`,
      sourceLabel: source?.label || "platform",
      evidenceTxid: inboundFromPlatform.txid
    };
  }

  return {
    enabled: true,
    tag: "NO_HTX_SP_MATCH",
    level: "CLEAR",
    reason: "未命中 HTX SP-1 / SP-2 路径。"
  };
}

async function buildSnapshot() {
  const config = await readConfig();
  const addressIntel = await buildAddressIntel(config);
  const usdt = config.tokens.USDT;
  const blacklistTokens = ["USDT", "USDC"]
    .map((symbol) => config.tokens[symbol])
    .filter(Boolean);
  const watched = config.watchedAddresses.filter((item) => item.enabled);

  const addressResults = [];
  const eventResults = [];

  for (const item of watched) {
    const blacklists = {};
    for (const token of blacklistTokens) {
      blacklists[token.symbol] = await getTokenBlacklistStatus(token, item.address);
    }
    const blacklist = blacklists.USDT || { status: "unknown", reason: "USDT blacklist token 未配置" };

    const transferScanEnabled = item.trackTransfers !== false;
    let transfers = [];
    let transferError = null;
    if (transferScanEnabled) {
      try {
        const related = await getTrc20Transfers({ tokenConfig: usdt, relatedAddress: item.address, limit: 50 });
        transfers = related.filter((transfer) => normalizeAddress(transfer.to) === normalizeAddress(item.address));
      } catch (error) {
        transferError = error.message;
      }
    }

    addressResults.push({
      ...item,
      blacklist,
      blacklists,
      transferScanEnabled,
      transferError,
      recentInflowCount: transfers.length,
      recentInflowAmount: transfers.reduce((sum, transfer) => sum + transfer.amount, 0)
    });

    for (const transfer of transfers.slice(0, 20)) {
      let upstreamTransfers = [];
      try {
        upstreamTransfers = await getTrc20Transfers({ tokenConfig: usdt, relatedAddress: transfer.from, limit: 30 });
      } catch {
        upstreamTransfers = [];
      }

      const sp = await classifyTransfer({ transfer, tokenConfig: usdt, upstreamTransfers, addressIntel });
      const amountWatch = transfer.amount >= config.dashboard.riskThresholdUsd;
      const level = sp.level;

      eventResults.push({
        watchedAddress: item.address,
        watchedName: item.name,
        market: item.market,
        asset: item.asset,
        txid: transfer.txid,
        blockTs: transfer.blockTs,
        from: transfer.from,
        to: transfer.to,
        amount: transfer.amount,
        amountWatch,
        token: transfer.token,
        level,
        sp,
        reason: sp.enabled ? sp.reason : "真实链上流入；HTX SP 识别待配置 seed 地址。"
      });
    }
  }

  const userIntersection = await scanUserBlacklistIntersection(config, blacklistTokens);
  const p1Events = eventResults.filter((item) => item.level === "P1");
  const userHitCount = userIntersection.hitCount;
  const watchEvents = eventResults.filter((item) => item.amountWatch);
  const frozenAddresses = addressResults.filter((item) => {
    return Object.values(item.blacklists || {}).some((blacklist) => blacklist.status === "blacklisted");
  });
  const usdtFrozenAddresses = addressResults.filter((item) => item.blacklists?.USDT?.status === "blacklisted");
  const usdcFrozenAddresses = addressResults.filter((item) => item.blacklists?.USDC?.status === "blacklisted");

  return {
    generatedAt: new Date().toISOString(),
    configSummary: {
      watchedCount: watched.length,
      htxSeedCount: addressIntel.htxSeeds.size,
      platformSeedCount: addressIntel.platformSeeds.size,
      riskThresholdUsd: config.dashboard.riskThresholdUsd,
      tronGridApiKeyConfigured: Boolean(TRONGRID_API_KEY)
    },
    status: {
      level: frozenAddresses.length ? "P0" : userHitCount || p1Events.length ? "P1" : "CLEAR",
      contractFrozen: frozenAddresses.length > 0,
      p1Count: p1Events.length,
      userHitCount,
      userUnknownCount: userIntersection.unknownCount,
      watchCount: watchEvents.length,
      eventCount: eventResults.length,
      htxDetectionEnabled: addressIntel.htxSeeds.size > 0
    },
    tokenStatus: {
      USDT: {
        frozenCount: usdtFrozenAddresses.length,
        unknownCount: addressResults.filter((item) => item.blacklists?.USDT?.status === "unknown").length
      },
      USDC: {
        frozenCount: usdcFrozenAddresses.length,
        unknownCount: addressResults.filter((item) => item.blacklists?.USDC?.status === "unknown").length
      }
    },
    addressBook: addressIntel.addressBook,
    userIntersection,
    addresses: addressResults,
    events: eventResults.sort((a, b) => Number(b.blockTs || 0) - Number(a.blockTs || 0)),
    notes: config.notes
  };
}

async function refreshSnapshot(reason = "scheduled") {
  if (snapshotRefreshPromise) return snapshotRefreshPromise;
  snapshotRefreshState.inProgress = true;
  snapshotRefreshState.lastStartedAt = new Date().toISOString();
  snapshotRefreshState.lastError = null;

  snapshotRefreshPromise = (async () => {
    console.log(`[snapshot] refresh started reason=${reason}`);
    const snapshot = await buildSnapshot();
    snapshotCache = snapshot;
    await writeSnapshotCache(snapshot);
    snapshotRefreshState.lastFinishedAt = new Date().toISOString();
    console.log(`[snapshot] refresh finished generatedAt=${snapshot.generatedAt}`);
    return snapshot;
  })()
    .catch((error) => {
      snapshotRefreshState.lastError = error.message;
      console.error(`[snapshot] refresh failed: ${error.stack || error.message}`);
      throw error;
    })
    .finally(() => {
      snapshotRefreshState.inProgress = false;
      snapshotRefreshPromise = null;
    });

  return snapshotRefreshPromise;
}

function triggerSnapshotRefresh(reason) {
  refreshSnapshot(reason).catch(() => {});
}

async function getSnapshotResponse({ forceRefresh = false } = {}) {
  const config = await readConfig();
  if (!snapshotCache) snapshotCache = await readSnapshotCache();

  const refreshMs = snapshotRefreshMs(config);
  const generatedAt = snapshotCache?.generatedAt ? new Date(snapshotCache.generatedAt).getTime() : 0;
  const stale = !generatedAt || Date.now() - generatedAt > refreshMs;

  if (forceRefresh || stale || !snapshotCache) {
    triggerSnapshotRefresh(forceRefresh ? "manual" : snapshotCache ? "stale" : "initial");
  }

  if (!snapshotCache) {
    const pending = await buildPendingSnapshot(config);
    return decorateSnapshot(pending, config, { servedFromCache: false });
  }

  return decorateSnapshot(snapshotCache, config, { servedFromCache: true });
}

async function startSnapshotService() {
  const config = await readConfig();
  snapshotCache = await readSnapshotCache();
  if (snapshotCache) {
    console.log(`[snapshot] loaded cache generatedAt=${snapshotCache.generatedAt}`);
  }
  triggerSnapshotRefresh(snapshotCache ? "startup-refresh" : "startup-initial");

  if (snapshotRefreshTimer) clearInterval(snapshotRefreshTimer);
  snapshotRefreshTimer = setInterval(() => {
    triggerSnapshotRefresh("scheduled");
  }, snapshotRefreshMs(config));
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
    res.writeHead(200, { "content-type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/config") {
      sendJson(res, 200, await readConfig());
      return;
    }
    if (url.pathname === "/api/snapshot") {
      sendJson(res, 200, await getSnapshotResponse({ forceRefresh: url.searchParams.get("refresh") === "1" }));
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message, stack: error.stack });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`JustLend live dashboard listening on http://${HOST}:${PORT}`);
  startSnapshotService().catch((error) => {
    console.error(`[snapshot] service failed: ${error.stack || error.message}`);
  });
});
