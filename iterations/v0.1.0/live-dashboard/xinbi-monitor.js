"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const investigation = require("./xinbi-investigation");
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
  const index = item.event_index;
  return { txid: item.transaction_id, from: item.from, to: item.to, contract,
    token: token.symbol, decimals: token.decimals, jToken: Boolean(token.jToken),
    amountRaw: raw, amount: Number(raw) / 10 ** token.decimals, blockTs,
    eventIndex: index !== undefined && index !== null && /^\d+$/.test(String(index)) ? Number(index) : null };
}

function precedes(a, b) {
  return a.blockTs < b.blockTs || (a.blockTs === b.blockTs && a.txid === b.txid
    && Number.isInteger(a.eventIndex) && Number.isInteger(b.eventIndex) && a.eventIndex < b.eventIndex);
}

function buildFindings({ transfers, seeds, watched, hubs, config, now, investigationAccounts = [] }) {
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
    const maxDepth = investigationAccounts.includes(last.from) ? 3 : 2;
    if (depth >= maxDepth || hubs.has(last.from) || protocol.has(last.from) || visited.has(last.from)) return null;
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
    if (!earliestEvent.has(event.from) || precedes(event, earliestEvent.get(event.from))) earliestEvent.set(event.from, event);
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
    if ((incoming.get(event.from) || []).some(r => protocol.has(r.from) && r.contract === event.contract && r.blockTs > event.blockTs
      && r.blockTs - event.blockTs <= config.rapidWindowHours * 3600000)) event.anomalies.push("入金后 1h 内收到协议出金（待核用途）");
  }
  // Track account association across rights transfers without claiming fungible-token provenance.
  const rightsAccounts = new Map([...seedSet, ...investigationAccounts].map(a => [a, { since: 0, hops: 0 }]));
  for (const [a, edge] of earliestEvent) if (!rightsAccounts.has(a)) rightsAccounts.set(a, { since: edge.blockTs, edge, hops: 0 });
  const rights = [], redemptionCandidates = [];
  for (const r of transfers.filter(r => r.jToken).sort((a,b) => a.blockTs-b.blockTs || (a.eventIndex ?? 0)-(b.eventIndex ?? 0))) {
    const origin = rightsAccounts.get(r.from);
    if (!origin || (origin.edge ? !precedes(origin.edge, r) : origin.since >= r.blockTs) || protocol.has(r.from) || hubs.has(r.from)) continue;
    if (protocol.has(r.to)) {
      redemptionCandidates.push({ ...r, id: transferKey(r), kind: "REDEEM_CANDIDATE", level: "P2", evidence: [r],
        reason: "关联账户向市场转回 jToken，需结合 Redeem 事件确认，不能仅凭 Transfer 认定赎回。" });
      continue;
    }
    rights.push({ ...r, id: transferKey(r), kind: "JTOKEN_RIGHTS", level: "P2", evidence: [r], anomalies: [],
      reason: "关联账户转出 jToken 存款权益；接收方继续跟踪，资金归属与控制人待核。" });
    if (!hubs.has(r.to) && origin.hops < (config.rightsMaxHops ?? 4) && !rightsAccounts.has(r.to))
      rightsAccounts.set(r.to, { since: r.blockTs, edge: r, hops: origin.hops + 1 });
  }
  const seedTransfers = transfers.filter(r => seedSet.has(r.from) || seedSet.has(r.to));
  return { events, rights, redemptionCandidates, graphTruncated: graphBudget.truncated,
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
    investigations: snapshot?.investigations?.length === 0 ? [] : [investigationSnapshotForState()],
      runtime: { ...status, running: Boolean(running), lastError,
        stale: !snapshot?.generatedAt || Date.now() - Date.parse(snapshot.generatedAt) > 900000 } };
  }
  function investigationSnapshotForState() { return investigation.investigationSnapshot(state); }

  async function fetchEvents(txid) {
    let cursor = ""; const events = [];
    for (let page = 0; page < 5; page++) {
      const url = new URL(`/v1/transactions/${txid}/events`, apiBase);
      url.search = new URLSearchParams({ only_confirmed: "true", limit: "200" });
      if (cursor) url.searchParams.set("fingerprint", cursor);
      const response = await fetchJson(url.toString());
      if (response.success === false || !Array.isArray(response.data)) throw new Error("transaction event response missing data");
      for (const entry of response.data) {
        if (entry.transaction_id && entry.transaction_id !== txid) throw new Error("transaction event hash mismatch");
        if (entry.confirmed === false) continue;
        const result = { ...entry.result };
        for (const key of ["from", "to", "src", "dst", "payer", "borrower", "minter", "redeemer", "liquidator"]) {
          if (/^(0x|41)?[0-9a-f]{40}$/i.test(result[key] || "")) result[key] = hexToAddress(result[key].replace(/^(0x|41)(?=[0-9a-f]{40}$)/i, ""));
        }
        result.from ??= result.src; result.to ??= result.dst;
        events.push({ ...entry, result });
      }
      const next = response.meta?.fingerprint || "";
      if (!next) return { events, partial: false };
      if (next === cursor) throw new Error("transaction event cursor repeated");
      cursor = next;
    }
    return { events, partial: true };
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
    const priorityAccounts = config.priorityAccounts || [];
    if (priorityAccounts.some(a => !validAddress(a.address) || !seedSet.has(a.origin) || a.depth !== 1)) throw new Error("优先关联地址配置无效");
    const caseAccounts = config.investigationEnabled === false ? [] : investigation.addresses;
    const caseSet = new Set(caseAccounts.map(a => a.address));
    const prioritySet = new Set([...seedSet, ...priorityAccounts.map(a => a.address), ...caseSet]);
    let capReached = false;
    let rightsLimitReached = false;
    function addAccount(address, depth, weak = false, rights = false) {
      if (protocol.has(address) || address === ZERO || !validAddress(address)) return;
      const existing = state.accounts[address];
      if (rights && !existing?.rightsTracked && !prioritySet.has(address)
        && Object.values(state.accounts).filter(a => a.rightsTracked).length >= (config.maxRightsAccounts ?? 200)) {
        rightsLimitReached = true; return false;
      }
      if (existing) {
        if (depth < existing.depth || (existing.weak && !weak)) {
          existing.depth = Math.min(depth, existing.depth);
          // Replay history after promotion so previously scanned edges expand
          // with the new source/depth, including rows evicted by storage limits.
          existing.history = { since, until: now, cursor: "", done: false };
          existing.backfillDone = false;
        }
        if (!weak) existing.weak = false;
        return true;
      }
      if (rights && Object.values(state.accounts).filter(a => a.rightsTracked).length >= (config.maxRightsAccounts ?? 200)) {
        rightsLimitReached = true; return;
      }
      if (!rights && !prioritySet.has(address) && Object.keys(state.accounts).length >= config.maxAddresses) {
        capReached = true;
        // Do not let inbound-only contacts crowd out seed-origin outflow wallets.
        const victim = !weak && Object.entries(state.accounts).find(([a,v]) => v.weak && !prioritySet.has(a));
        if (victim) delete state.accounts[victim[0]]; else return;
      }
      state.accounts[address] = { depth, weak, lastScan: 0, oldest: now, backfillDone: false, cursor: "", error: null };
      return true;
    }
    for (const s of seeds) addAccount(s.address, 0);
    for (const a of priorityAccounts) addAccount(a.address, a.depth);
    for (const a of caseAccounts) addAccount(a.address, a.depth);
    const txMap = new Map(state.transfers.filter(r => r.blockTs >= since).map(r => [transferKey(r), r]));
    state.investigationVerification ||= {};
    state.investigationBalances ||= {};
    state.investigationEvents ||= {};
    state.operations ||= {};
    // Fixed evidence and verified event logs are never evicted by the rolling transfer cap.
    status.stage = "investigation";
    if (caseAccounts.length) {
      for (const step of investigation.steps) {
        const previous = state.investigationVerification[step.txid];
        if (previous?.status === "verified" && now - Date.parse(previous.checkedAt) < DAY) continue;
        try {
          const result = await fetchEvents(step.txid);
          const verdict = investigation.verifyStep(step, result.events);
          if (result.partial) throw new Error("事件分页未完成，不能确认完整证据");
          if (result.events.some(e => e.block_timestamp && Number(e.block_timestamp) !== step.blockTs)) throw new Error("事件时间与登记证据不符");
          state.investigationVerification[step.txid] = { ...verdict, checkedAt: new Date().toISOString() };
          if (verdict.status === "verified") state.investigationEvents[step.txid] = result.events;
          else delete state.investigationEvents[step.txid];
        } catch (error) {
          state.investigationVerification[step.txid] = { status: "error", error: error.message,
            lastVerifiedAt: previous?.status === "verified" ? previous.checkedAt : previous?.lastVerifiedAt,
            checkedAt: new Date().toISOString() };
        }
      }
      for (const a of caseAccounts) {
        try {
          const raw = String(await readBalance(investigation.JUSDT, a.address));
          if (!/^\d+$/.test(raw)) throw new Error("jUSDT 余额格式无效");
          state.investigationBalances[a.address] = { raw, status: "ok", checkedAt: new Date().toISOString() };
        } catch (error) { state.investigationBalances[a.address] = { raw: null, status: "error", error: error.message, checkedAt: new Date().toISOString() }; }
      }
    }
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
    const candidates = Object.entries(state.accounts).filter(([a]) => !hubs.has(a) || seedSet.has(a))
      .sort(([a,x],[b,y]) => (prioritySet.has(b) ? 1 : 0) - (prioritySet.has(a) ? 1 : 0)
        || x.lastScan-y.lastScan || Number(x.weak)-Number(y.weak) || x.depth-y.depth);
    const priorityQueue = candidates.filter(([a]) => prioritySet.has(a));
    const remaining = Math.max(config.addressesPerCycle - priorityQueue.length, 2);
    // Reserve half the rotating slots for rights receivers, while keeping
    // ordinary candidates moving even when the rights queue is saturated.
    const rightsQueue = candidates.filter(([a,v]) => !prioritySet.has(a) && v.rightsTracked).slice(0, Math.ceil(remaining / 2));
    const selected = new Set([...priorityQueue, ...rightsQueue].map(([a]) => a));
    const queue = [...priorityQueue, ...rightsQueue, ...candidates.filter(([a]) => !selected.has(a)).slice(0, remaining - rightsQueue.length)];
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
            if (row.from === address && row.jToken && !protocol.has(row.to) && !hubs.has(row.to)
              && (!account.weak || caseSet.has(address)) && (account.rightsHops || 0) < (config.rightsMaxHops ?? 4)) {
              const added = addAccount(row.to, account.depth + 1, false, true);
              const recipient = added && state.accounts[row.to];
              if (recipient) {
                recipient.rightsTracked = true;
                recipient.rightsHops = Math.min(recipient.rightsHops ?? Infinity, (account.rightsHops || 0) + 1);
              }
            }
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
    const evidenceMap = new Map(state.transfers.map(r => [transferKey(r), r]));
    for (const [txid, entries] of Object.entries(state.investigationEvents)) {
      if (!caseAccounts.length) break;
      for (const e of entries.filter(e => e.event_name === "Transfer")) {
        const row = normalizeRow({ type: "Transfer", transaction_id: txid, from: e.result.from, to: e.result.to,
          value: e.result.value ?? e.result.amount ?? e.result.wad, token_info: { address: e.contract_address }, event_index: e.event_index,
          block_timestamp: e.block_timestamp || investigation.steps.find(s => s.txid === txid)?.blockTs }, tokens);
        if (row && row.blockTs >= since) {
          evidenceMap.delete(transferKey({ ...row, eventIndex: null }));
          evidenceMap.set(transferKey(row), row);
        }
      }
    }
    const analysisTransfers = [...evidenceMap.values()];
    const findings = buildFindings({ transfers: analysisTransfers, seeds, watched, hubs, config, now, investigationAccounts: [...caseSet] });
    status.stage = "operations";
    const operationsToFetch = [...new Map([...findings.events, ...findings.redemptionCandidates].map(e => [e.txid, e])).values()]
      .filter(e => !state.operations[e.txid] || state.operations[e.txid].error || state.operations[e.txid].partial).slice(0, config.operationLimit);
    for (const event of operationsToFetch) {
      try {
        const result = state.investigationEvents[event.txid] ? { events: state.investigationEvents[event.txid], partial: false } : await fetchEvents(event.txid);
        const actions = result.events.filter(r => protocol.has(r.contract_address)
          && ["Mint", "RepayBorrow", "LiquidateBorrow", "Borrow", "Redeem"].includes(r.event_name))
          .map(r => { const result = { ...r.result };
            for (const key of ["payer", "borrower", "minter", "redeemer", "liquidator"]) {
              if (/^(0x|41)?[0-9a-f]{40}$/i.test(result[key] || "")) result[key] = hexToAddress(result[key].replace(/^(0x|41)(?=[0-9a-f]{40}$)/i, ""));
            }
            return { action: r.event_name === "RepayBorrow" && result.payer && result.borrower && result.payer !== result.borrower
              ? "RepayBorrowBehalf" : r.event_name, contract: r.contract_address, result };
          });
        state.operations[event.txid] = { actions, partial: result.partial, checkedAt: new Date().toISOString() };
      } catch (error) { state.operations[event.txid] = { actions: [], error: error.message }; }
    }
    for (const e of findings.events) e.operation = state.operations[e.txid] || { actions: [], pending: true };
    const redemptions = findings.redemptionCandidates.map(e => {
      const operation = state.operations[e.txid] || { actions: [], pending: true };
      const action = !operation.partial && !operation.error && operation.actions.find(a => a.action === "Redeem"
        && a.contract === e.contract && a.result.redeemer === e.from && String(a.result.redeemTokens) === e.amountRaw);
      return { ...e, operation, kind: action ? "REDEEM" : "REDEEM_CANDIDATE",
        redeemedUnderlyingRaw: action?.result.redeemAmount ?? null,
        reason: action ? "已核对市场 Redeem 事件；关联账户赎回，不等同于已证明每一份权益的原始资金来源。" : e.reason };
    });
    const activeTx = new Set(analysisTransfers.map(r => r.txid));
    state.operations = Object.fromEntries(Object.entries(state.operations).filter(([id]) => activeTx.has(id)));
    state.changes = state.changes.slice(-500);
    const accounts = Object.entries(state.accounts);
    const limitations = [
      "覆盖配置内 TRC20 资产及 jToken；TRX 原生转账、跨链、DEX 换币后的资金同源证明及全量历史仓位未覆盖。",
      "常规资金路径最多经过 2 个中转地址；登记事件补充代理合约路径和交易内事件顺序；公共平台停止穿透。",
      "入金金额为命中交易总额，不是涉案金额；小额污染及仅交互线索按 P2 待核查。",
      "同 tx / 资产 / 收发方 / 原始金额且无 log index 的重复记录保守去重，可能少计同笔交易的相同 Transfer。",
      "地址发现受数量和请求预算限制，候选账户轮询检查；归属标签来自人工核验的公开清单，不自动推断同一控制人。"
    ];
    snapshot = { version: 1, enabled: true, generatedAt: new Date().toISOString(), source: config.source, sources: config.sources || [], priorityAccounts,
      reportedAt: config.reportedAt, seedCount: seeds.length, reportedSeedCount: config.reportedSeedCount,
      addresses: seeds.map(s => state.seedStatus[s.address]), changes: state.changes,
      ...findings, redemptionCandidates: undefined, redemptions: redemptions.slice(0, 100),
      investigations: caseAccounts.length ? [investigationSnapshotForState()] : [],
      events: findings.events.slice(0, 500), rights: findings.rights.slice(0, 100), seedTransfers: findings.seedTransfers.slice(0, 100),
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
        rightsMaxHops: config.rightsMaxHops ?? 4,
        rightsLimitReached,
        rightsTrackedAccounts: accounts.filter(([,a]) => a.rightsTracked).length,
        displayTruncated: findings.events.length > 500 || findings.rights.length > 100 || redemptions.length > 100,
        operationsPending: [...findings.events, ...redemptions].filter(e => e.operation.pending || e.operation.error || e.operation.partial).length,
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
