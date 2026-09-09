"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const DAY = 86400000;
const ZERO = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";

function validAddress(address) {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address || "")) return false;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const char of address) value = value * 58n + BigInt(alphabet.indexOf(char));
  const bytes = Buffer.from(value.toString(16).padStart(50, "0"), "hex");
  const hash = crypto.createHash("sha256").update(crypto.createHash("sha256").update(bytes.subarray(0, 21)).digest()).digest();
  return bytes.length === 25 && bytes[0] === 65 && bytes.subarray(21).equals(hash.subarray(0, 4));
}

function transferKey(row) {
  // Account TRC20 responses do not always include log index. Identical rows are
  // conservatively collapsed; never count the same transfer once per scanned wallet.
  return [row.txid, row.contract, row.from, row.to, row.amountRaw, row.eventIndex ?? ""].join(":");
}

function normalizeRow(item, tokens) {
  if (item.type !== "Transfer" || item.confirmed === false) return null;
  const contract = item.token_info?.address;
  const token = tokens.get(contract);
  if (!token || !/^[0-9a-f]{64}$/i.test(item.transaction_id || "")) return null;
  const raw = String(item.value || "");
  const blockTs = Number(item.block_timestamp);
  if (!/^\d+$/.test(raw) || BigInt(raw) === 0n || !Number.isFinite(blockTs) || blockTs <= 0) return null;
  if (!validAddress(item.from) || !validAddress(item.to) || item.from === ZERO || item.to === ZERO) return null;
  return { txid: item.transaction_id, from: item.from, to: item.to, contract,
    token: token.symbol, decimals: token.decimals, jToken: Boolean(token.jToken),
    amountRaw: raw, amount: Number(raw) / 10 ** token.decimals, blockTs,
    eventIndex: item.event_index ?? null };
}

function precedes(a, b) {
  // Equal timestamps do not establish order, even within a transaction.
  return a.blockTs < b.blockTs;
}

function buildFindings({ transfers, seeds, watched, hubs, config, now }) {
  const seedSet = new Set(seeds.map(s => s.address));
  const protocol = new Map(watched.filter(w => w.enabled).map(w => [w.address, w]));
  const incoming = new Map();
  const outgoing = new Map();
  for (const row of transfers) {
    if (!incoming.has(row.to)) incoming.set(row.to, []);
    if (!outgoing.has(row.from)) outgoing.set(row.from, []);
    incoming.get(row.to).push(row); outgoing.get(row.from).push(row);
  }
  for (const rows of incoming.values()) rows.sort((a, b) => b.blockTs - a.blockTs);
  const events = [];
  const graphBudget = { visits: 0, truncated: false };
  function trace(last, depth = 0, visited = new Set()) {
    graphBudget.visits++;
    if (graphBudget.visits > 200000) { graphBudget.truncated = true; return null; }
    if (seedSet.has(last.from)) return [last];
    if (depth >= 2 || hubs.has(last.from) || protocol.has(last.from) || visited.has(last.from)) return null;
    const seen = new Set([...visited, last.from]);
    for (const prior of incoming.get(last.from) || []) {
      if (prior.contract !== last.contract || !precedes(prior, last)) continue;
      const prefix = trace(prior, depth + 1, seen);
      if (prefix) return [...prefix, last];
    }
    return null;
  }
  for (const row of transfers.filter(r => protocol.has(r.to) && !protocol.has(r.from)).sort((a,b) => b.blockTs-a.blockTs)) {
    const chain = trace(row);
    let kind = chain ? `FLOW_${chain.length - 1}` : null;
    let evidence = chain;
    if (!chain) {
      // Sending to a seed is interaction evidence, not evidence of seed-origin funds.
      const interaction = (outgoing.get(row.from) || []).find(r => seedSet.has(r.to) && precedes(r, row));
      const differentAsset = (incoming.get(row.from) || []).find(r => seedSet.has(r.from) && precedes(r, row));
      if (interaction || differentAsset) {
        kind = "INTERACTION"; evidence = [interaction || differentAsset, row];
      }
    }
    if (!kind) continue;
    const dust = chain && chain.some(r => r.token === "USDT" && r.amount <= config.dustUsdtAmount);
    const publicHub = evidence.some(r => hubs.has(r.from) || hubs.has(r.to));
    events.push({ ...row, id: transferKey(row), kind, level: kind === "INTERACTION" || dust || publicHub ? "P2" : "P1",
      seed: seedSet.has(evidence[0].from) ? evidence[0].from : evidence[0].to,
      market: protocol.get(row.to).name, intermediaries: chain ? chain.length - 1 : null,
      evidence, dust: Boolean(dust), publicHub, anomalies: [],
      reason: kind === "INTERACTION" ? "仅能证明账户交互，不能认定本笔资金来自新币。"
        : "同资产、时间有序的转账路径；账户资金可能混同，入金总额不等于涉案金额。" });
  }
  const groupedEvents = new Map(), earliestEvent = new Map();
  for (const event of events) {
    const key = `${event.from}:${event.contract}`;
    if (!groupedEvents.has(key)) groupedEvents.set(key, []);
    groupedEvents.get(key).push(event);
    if (!earliestEvent.has(event.from) || event.blockTs < earliestEvent.get(event.from)) earliestEvent.set(event.from, event.blockTs);
  }
  for (const group of groupedEvents.values()) {
    group.sort((a,b) => a.blockTs-b.blockTs);
    let start = 0, sum = 0;
    for (let end = 0; end < group.length; end++) {
      sum += group[end].amount;
      while (group[start].blockTs < group[end].blockTs - config.aggregateWindowHours * 3600000) sum -= group[start++].amount;
      if (group[end].token === "USDT" && end-start+1 >= config.aggregateMinTransfers && sum >= config.largeUsdtAmount)
        group[end].anomalies.push("24h 多笔累计大额（疑似拆分）");
    }
  }
  for (const event of events) {
    if (event.token === "USDT" && event.amount >= config.largeUsdtAmount) event.anomalies.push("大额 USDT 入金");
    const sources = (incoming.get(event.from) || []).filter(r => seedSet.has(r.from)
      && precedes(r, event) && r.blockTs >= event.blockTs - config.aggregateWindowHours * 3600000);
    if (new Set(sources.map(r => r.from)).size >= 2) event.anomalies.push("多个新币 seed 汇集后入金");
    if ((incoming.get(event.from) || []).some(r => protocol.has(r.from) && r.blockTs > event.blockTs
      && r.blockTs - event.blockTs <= config.rapidWindowHours * 3600000)) event.anomalies.push("入金后 1h 内收到协议出金（待核用途）");
  }
  const rights = transfers.filter(r => r.jToken && !protocol.has(r.from) && !protocol.has(r.to)
    && (seedSet.has(r.from) || earliestEvent.get(r.from) < r.blockTs))
    .map(r => ({ ...r, id: transferKey(r), kind: "JTOKEN_RIGHTS", level: "P2", evidence: [r], anomalies: [],
      reason: "相关账户转出 jToken 存款权益；仅为账户关联，底层资产来源待核。" }));
  const seedTransfers = transfers.filter(r => seedSet.has(r.from) || seedSet.has(r.to));
  return { events, rights, graphTruncated: graphBudget.truncated,
    seedTransfers: seedTransfers.sort((a,b) => b.blockTs-a.blockTs),
    summary: { inflowCount: events.length, strongPathCount: events.filter(e => e.kind !== "INTERACTION").length,
      interactionCount: events.filter(e => e.kind === "INTERACTION").length,
      p1Count: events.filter(e => e.level === "P1").length, rightsCount: rights.length,
      inflowUsdt: events.filter(e => e.token === "USDT").reduce((sum,e) => sum+e.amount,0),
      seedTransferCount: seedTransfers.length, analyzedAt: new Date(now).toISOString() } };
}

async function atomicJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(data), { mode: 0o600 });
  await fs.rename(`${file}.tmp`, file);
}

function createXinbiMonitor({ root, readConfig, fetchJson, apiBase, blacklist, readBalance, getHubs, hexToAddress }) {
  const statePath = path.join(root, "data/xinbi-monitor-state.json");
  let state = { version: 1, accounts: {}, transfers: [], seedStatus: {}, changes: [], operations: {} };
  let snapshot = null, running = null, lastError = null, timer = null;
  let status = { stage: "pending", processed: 0, total: 0, startedAt: null };
  async function load() {
    try { const saved = JSON.parse(await fs.readFile(statePath, "utf8"));
      if (saved.version !== 1 || !Array.isArray(saved.transfers)) throw new Error("unsupported monitor state");
      state = saved;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    try { snapshot = JSON.parse(await fs.readFile(path.join(root, "data/xinbi-snapshot.json"), "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  function getSnapshot() {
    return { ...(snapshot || { version: 1, summary: {}, addresses: [], events: [], rights: [], seedTransfers: [],
      coverage: { status: "pending", limitations: ["首次扫描尚未完成，不能据此判断无风险。"] } }),
      runtime: { ...status, running: Boolean(running), lastError,
        stale: !snapshot?.generatedAt || Date.now() - Date.parse(snapshot.generatedAt) > 900000 } };
  }
  async function run() {
    const full = await readConfig(); const config = full.riskSources?.xinbi;
    if (!config?.enabled) { snapshot = { generatedAt: new Date().toISOString(), enabled: false }; return; }
    const seeds = config.seeds || [];
    if (!seeds.length || seeds.some(s => !validAddress(s.address))) throw new Error("新币 seed 地址缺失或 checksum 无效");
    const now = Date.now(), since = now - config.lookbackDays * DAY;
    const watched = full.watchedAddresses.filter(w => w.enabled);
    const protocol = new Set(watched.map(w => w.address));
    const tokens = new Map(Object.values(full.tokens).map(t => [t.contract, t]));
    for (const token of config.extraTokens || []) tokens.set(token.contract, token);
    for (const w of watched) if (/^j\w+ market$/.test(w.name)) tokens.set(w.address, { symbol: w.name.replace(" market", ""), decimals: 8, jToken: true });
    const hubs = await getHubs(full);
    const seedSet = new Set(seeds.map(s => s.address));
    let capReached = false;
    function addAccount(address, depth, weak = false) {
      if (protocol.has(address) || address === ZERO || !validAddress(address)) return;
      const existing = state.accounts[address];
      if (existing) { if (depth < existing.depth) existing.depth = depth; if (!weak) existing.weak = false; return; }
      if (Object.keys(state.accounts).length >= config.maxAddresses) {
        capReached = true;
        // Do not let inbound-only contacts crowd out seed-origin outflow wallets.
        const victim = !weak && Object.entries(state.accounts).find(([a,v]) => v.weak && !seedSet.has(a));
        if (victim) delete state.accounts[victim[0]]; else return;
      }
      state.accounts[address] = { depth, weak, lastScan: 0, oldest: now, backfillDone: false, cursor: "", error: null };
    }
    for (const s of seeds) addAccount(s.address, 0);
    const txMap = new Map(state.transfers.filter(r => r.blockTs >= since).map(r => [transferKey(r), r]));
    status = { stage: "addresses", processed: 0, total: seeds.length, startedAt: new Date().toISOString() };
    for (const s of seeds) {
      const previous = state.seedStatus[s.address];
      const result = await blacklist(full.tokens.USDT, s.address);
      let balanceRaw = null, balanceError = null;
      try { balanceRaw = String(await readBalance(full.tokens.USDT.contract, s.address)); }
      catch (error) { balanceError = error.message; }
      if (previous?.status && previous.status !== "unknown" && result.status !== "unknown" && previous.status !== result.status) {
        state.changes.push({ address: s.address, from: previous.status, to: result.status, observedAt: new Date().toISOString() });
      }
      state.seedStatus[s.address] = { ...s, status: result.status, error: result.error || null,
        balanceRaw, balance: balanceRaw === null ? null : Number(balanceRaw) / 1e6,
        balanceError, checkedAt: new Date().toISOString() };
      status.processed++;
    }
    const queue = Object.entries(state.accounts).filter(([a]) => !hubs.has(a) || seedSet.has(a))
      .sort(([a,x],[b,y]) => (seedSet.has(b) ? 1 : 0) - (seedSet.has(a) ? 1 : 0) || x.lastScan-y.lastScan || Number(x.weak)-Number(y.weak) || x.depth-y.depth)
      .slice(0, config.addressesPerCycle);
    status = { ...status, stage: "transfers", processed: 0, total: queue.length };
    for (const [address, account] of queue) {
      try {
        // Two independent fixed-window cursors: new transfers and historical
        // backfill. Never change a fingerprint's query window between requests.
        if (!account.history) account.history = { since, until: now, cursor: "", done: false };
        if (!account.head) account.head = { since: Math.max(since, (account.headThrough || now) - 1000), until: now, cursor: "" };
        for (let page = 0; page < config.pagesPerAddress; page++) {
          const isHistory = page > 0 || !account.lastSuccess;
          const stream = isHistory ? account.history : account.head;
          if (isHistory && stream.done) continue;
          const url = new URL(`/v1/accounts/${address}/transactions/trc20`, apiBase);
          url.search = new URLSearchParams({ only_confirmed: "true", limit: String(config.pageSize),
            order_by: "block_timestamp,desc", min_timestamp: String(stream.since), max_timestamp: String(stream.until) });
          if (stream.cursor) url.searchParams.set("fingerprint", stream.cursor);
          const response = await fetchJson(url.toString());
          if (response.success === false || !Array.isArray(response.data)) throw new Error("TRC20 response missing data");
          const rows = response.data;
          for (const item of rows) {
            const row = normalizeRow(item, tokens);
            if (!row || row.blockTs < since || row.blockTs > now) continue;
            txMap.set(transferKey(row), row);
            if (row.from === address && account.depth < 2 && !account.weak && !row.jToken) addAccount(row.to, account.depth + 1);
            if (seedSet.has(address) && row.to === address) addAccount(row.from, 1, true);
          }
          account.oldest = Math.min(account.oldest || now, ...rows.map(r => Number(r.block_timestamp) || now));
          const next = response.meta?.fingerprint || "";
          const complete = !next || !rows.length;
          stream.cursor = next;
          if (isHistory) {
            stream.done = complete; account.backfillDone = complete;
          } else if (complete) {
            account.headThrough = stream.until; account.head = null;
          }
        }
        account.error = null; account.lastSuccess = Date.now();
      } catch (error) { account.error = error.message;
        // Invalid/expired provider cursors restart that stream with its original
        // time bounds. Other failures retain the cursor and already fetched rows.
        if (/400|fingerprint|cursor/i.test(error.message)) {
          if (account.head) account.head.cursor = "";
          if (account.history) { account.history.cursor = ""; account.history.done = false; account.backfillDone = false; }
        } }
      account.lastScan = Date.now(); status.processed++;
    }
    state.transfers = [...txMap.values()].sort((a,b) => b.blockTs-a.blockTs);
    const storageTruncated = state.transfers.length > config.maxStoredTransfers;
    state.transfers = state.transfers.slice(0, config.maxStoredTransfers);
    const findings = buildFindings({ transfers: state.transfers, seeds, watched, hubs, config, now });
    status.stage = "operations";
    const operationsToFetch = findings.events.filter(e => !state.operations[e.txid] || state.operations[e.txid].error).slice(0, config.operationLimit);
    for (const event of operationsToFetch) {
      try {
        const url = new URL(`/v1/transactions/${event.txid}/events`, apiBase);
        url.search = new URLSearchParams({ only_confirmed: "true", limit: "200" });
        const response = await fetchJson(url.toString());
        if (response.success === false || !Array.isArray(response.data)) throw new Error("transaction event response missing data");
        const actions = response.data.filter(r => protocol.has(r.contract_address)
          && ["Mint", "RepayBorrow", "LiquidateBorrow", "Borrow", "Redeem"].includes(r.event_name))
          .map(r => { const result = { ...r.result };
            for (const key of ["payer", "borrower", "minter", "redeemer", "liquidator"]) {
              if (/^(0x|41)?[0-9a-f]{40}$/i.test(result[key] || "")) result[key] = hexToAddress(result[key].replace(/^(0x|41)(?=[0-9a-f]{40}$)/i, ""));
            }
            return { action: r.event_name === "RepayBorrow" && result.payer && result.borrower && result.payer !== result.borrower
              ? "RepayBorrowBehalf" : r.event_name, contract: r.contract_address, result };
          });
        state.operations[event.txid] = { actions, partial: Boolean(response.meta?.fingerprint), checkedAt: new Date().toISOString() };
      } catch (error) { state.operations[event.txid] = { actions: [], error: error.message }; }
    }
    for (const e of findings.events) e.operation = state.operations[e.txid] || { actions: [], pending: true };
    const activeTx = new Set(state.transfers.map(r => r.txid));
    state.operations = Object.fromEntries(Object.entries(state.operations).filter(([id]) => activeTx.has(id)));
    state.changes = state.changes.slice(-500);
    const accounts = Object.entries(state.accounts);
    const limitations = [
      "覆盖配置内 TRC20 资产及 jToken；TRX 原生转账、跨链、DEX 换币后的资金同源证明及全量历史仓位未覆盖。",
      "路径最多经过 2 个中转地址；公共平台地址停止穿透，不将共同使用交易所认定为资金同源。",
      "入金金额为命中交易总额，不是涉案金额；小额污染及仅交互线索按 P2 待核查。",
      "同 tx / 资产 / 收发方 / 原始金额且无 log index 的重复记录保守去重，可能少计同笔交易的相同 Transfer。",
      "地址发现受数量和请求预算限制，候选账户轮询检查；归属标签来自人工核验的公开清单，不自动推断同一控制人。"
    ];
    snapshot = { version: 1, enabled: true, generatedAt: new Date().toISOString(), source: config.source,
      reportedAt: config.reportedAt, seedCount: seeds.length, reportedSeedCount: config.reportedSeedCount,
      addresses: seeds.map(s => state.seedStatus[s.address]), changes: state.changes,
      ...findings, events: findings.events.slice(0, 500), rights: findings.rights.slice(0, 100), seedTransfers: findings.seedTransfers.slice(0, 100),
      coverage: { status: "bounded", since: new Date(since).toISOString(), until: new Date(now).toISOString(),
        assets: [...tokens.values()].map(t => t.symbol), totalAccounts: accounts.length,
        scannedAccounts: accounts.filter(([,a]) => a.lastSuccess).length,
        pendingAccounts: accounts.filter(([,a]) => !a.lastSuccess).length,
        headPendingAccounts: accounts.filter(([,a]) => a.head?.cursor).length,
        oldestAccountScan: accounts.length ? Math.min(...accounts.map(([,a]) => a.lastSuccess || 0)) : null,
        incompleteHistoryAccounts: accounts.filter(([,a]) => !a.backfillDone).length,
        errors: accounts.filter(([,a]) => a.error).map(([address,a]) => ({ address, error: a.error })),
        stoppedHubs: accounts.filter(([a]) => hubs.has(a) && !seedSet.has(a)).length,
        addressLimitReached: capReached || accounts.length >= config.maxAddresses,
        storageTruncated, graphTruncated: findings.graphTruncated,
        operationsPending: findings.events.filter(e => e.operation.pending || e.operation.error || e.operation.partial).length,
        storedTransfers: state.transfers.length, refreshSeconds: config.refreshSeconds, limitations } };
    await atomicJson(statePath, state);
    await atomicJson(path.join(root, "data/xinbi-snapshot.json"), snapshot);
    status.stage = "idle";
  }
  function refresh() {
    if (running) return running;
    running = run().then(() => { lastError = null; }).catch(error => {
      lastError = error.message; status.stage = "error"; console.error(`[xinbi] ${error.message}`);
    }).finally(() => { running = null; });
    return running;
  }
  async function start() {
    try { await load(); } catch (error) { lastError = error.message; status.stage = "error"; throw error; }
    const config = (await readConfig()).riskSources?.xinbi;
    if (!config?.enabled) return;
    refresh(); timer = setInterval(refresh, Math.max(60, config.refreshSeconds || 300) * 1000);
    timer.unref();
  }
  return { start, refresh, getSnapshot, stop() { if (timer) clearInterval(timer); } };
}

module.exports = { validAddress, transferKey, normalizeRow, precedes, buildFindings, createXinbiMonitor };
