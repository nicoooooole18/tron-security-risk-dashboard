const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "NULL";
}

class SQLiteStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
  }

  async exec(sql) {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    await new Promise((resolve, reject) => {
      const child = spawn("sqlite3", [this.dbPath], { stdio: ["pipe", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr || `sqlite3 exited with ${code}`));
      });
      child.stdin.end(sql);
    });
  }

  async queryJson(sql) {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    const { stdout } = await execFileAsync("sqlite3", ["-json", this.dbPath, sql], { maxBuffer: 1024 * 1024 * 16 });
    const raw = stdout.trim();
    return raw ? JSON.parse(raw) : [];
  }

  async init() {
    await this.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS job_lock (
  lock_key TEXT PRIMARY KEY,
  locked_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  owner TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job_run (
  run_id TEXT PRIMARY KEY,
  snapshot_date TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  source_adapter TEXT NOT NULL,
  error_message TEXT
);
CREATE TABLE IF NOT EXISTS dim_protocol (
  protocol_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  chain TEXT,
  defillama_slug TEXT,
  is_competitor INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS dim_asset (
  asset_id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  chain TEXT,
  contract_address TEXT,
  market_id TEXT,
  asset_group TEXT,
  cmc_asset_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS dim_internal_address (
  address TEXT PRIMARY KEY,
  chain TEXT NOT NULL DEFAULT 'TRON',
  label TEXT NOT NULL,
  owner_name TEXT,
  exclude_from_top_holder INTEGER NOT NULL DEFAULT 1,
  exclude_from_flow_analysis INTEGER NOT NULL DEFAULT 1,
  exclude_from_alert INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  effective_from TEXT,
  effective_to TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dim_address_label (
  address TEXT NOT NULL,
  chain TEXT NOT NULL DEFAULT 'TRON',
  entity_name TEXT,
  entity_type TEXT,
  protocol_id TEXT,
  confidence REAL,
  source TEXT,
  updated_at TEXT,
  PRIMARY KEY(address, chain)
);
CREATE TABLE IF NOT EXISTS dim_threshold_config (
  threshold_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  metric_name TEXT,
  operator TEXT,
  value REAL,
  unit TEXT,
  scope_type TEXT,
  scope_value TEXT,
  default_value REAL,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS fact_user_position_daily (
  snapshot_date TEXT NOT NULL,
  user_address TEXT NOT NULL,
  supply_usd REAL,
  borrow_usd REAL,
  net_position_usd REAL,
  payload_json TEXT,
  PRIMARY KEY(snapshot_date, user_address)
);
CREATE TABLE IF NOT EXISTS fact_user_asset_position_daily (
  snapshot_date TEXT NOT NULL,
  user_address TEXT NOT NULL,
  asset TEXT NOT NULL,
  supply_amount REAL,
  supply_usd REAL,
  borrow_amount REAL,
  borrow_usd REAL,
  payload_json TEXT,
  PRIMARY KEY(snapshot_date, user_address, asset)
);
CREATE TABLE IF NOT EXISTS fact_top_holder_daily (
  snapshot_date TEXT NOT NULL,
  rank INTEGER NOT NULL,
  user_address TEXT NOT NULL,
  supply_usd REAL,
  borrow_usd REAL,
  net_position_usd REAL,
  primary_asset TEXT,
  unreturned_outflow_usd REAL,
  return_rate_pct REAL,
  payload_json TEXT,
  PRIMARY KEY(snapshot_date, rank)
);
CREATE TABLE IF NOT EXISTS fact_top_lost_holder_daily (
  snapshot_date TEXT NOT NULL,
  rank INTEGER NOT NULL,
  user_address TEXT NOT NULL,
  beginning_supply_usd REAL,
  gross_withdraw_usd REAL,
  returned_outflow_usd REAL,
  unreturned_outflow_usd REAL,
  return_rate_pct REAL,
  top_destination TEXT,
  payload_json TEXT,
  PRIMARY KEY(snapshot_date, rank)
);
CREATE TABLE IF NOT EXISTS fact_asset_daily_metrics (
  snapshot_date TEXT NOT NULL,
  asset TEXT NOT NULL,
  supply_usd REAL,
  supply_change_pct REAL,
  borrow_amount REAL,
  borrow_amount_change_pct REAL,
  borrow_usd REAL,
  borrow_usd_change_pct REAL,
  asset_price_change_pct REAL,
  utilization REAL,
  utilization_change_pct REAL,
  borrow_apy REAL,
  borrow_apy_change_pct REAL,
  supply_apy REAL,
  supply_apy_change_pct REAL,
  payload_json TEXT,
  PRIMARY KEY(snapshot_date, asset)
);
CREATE TABLE IF NOT EXISTS fact_capital_flow_event (
  event_id TEXT PRIMARY KEY,
  snapshot_date TEXT NOT NULL,
  event_time TEXT,
  user_address TEXT,
  asset TEXT,
  action TEXT,
  amount REAL,
  amount_usd REAL,
  tx_hash TEXT,
  counterparty_address TEXT,
  payload_json TEXT
);
CREATE TABLE IF NOT EXISTS fact_capital_migration_path (
  path_id TEXT PRIMARY KEY,
  snapshot_date TEXT NOT NULL,
  user_address TEXT,
  hop INTEGER,
  destination TEXT,
  destination_category TEXT,
  attribution TEXT,
  amount_usd REAL,
  used_in_overview INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT
);
CREATE TABLE IF NOT EXISTS fact_capital_round_trip (
  round_trip_id TEXT PRIMARY KEY,
  snapshot_date TEXT NOT NULL,
  user_address TEXT,
  outflow_time TEXT,
  outflow_asset TEXT,
  outflow_amount REAL,
  outflow_usd REAL,
  outflow_destination TEXT,
  outflow_destination_category TEXT,
  weak_destination TEXT,
  return_time TEXT,
  return_asset TEXT,
  return_amount REAL,
  return_usd REAL,
  return_market TEXT,
  time_away_hours REAL,
  round_trip_delta_usd REAL,
  status TEXT,
  payload_json TEXT
);
CREATE TABLE IF NOT EXISTS fact_threshold_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  threshold_key TEXT NOT NULL,
  old_value REAL,
  new_value REAL,
  enabled INTEGER,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  reason TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS internal_address_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  address TEXT,
  old_value_json TEXT,
  new_value_json TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  reason TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mart_overview_daily (
  snapshot_date TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mart_market_comparison_daily (
  snapshot_date TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mart_borrow_demand_daily (
  snapshot_date TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mart_capital_outflow_daily (
  snapshot_date TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mart_anomaly_signal_daily (
  snapshot_date TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_snapshot_daily (
  snapshot_date TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
`);
  }

  async acquireJobLock(lockKey, ttlMinutes, owner) {
    await this.init();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
    const rows = await this.queryJson(`SELECT * FROM job_lock WHERE lock_key=${sqlString(lockKey)};`);
    if (rows.length && new Date(rows[0].expires_at).getTime() > now.getTime()) return false;
    await this.exec(`
INSERT OR REPLACE INTO job_lock(lock_key, locked_at, expires_at, owner)
VALUES(${sqlString(lockKey)}, ${sqlString(now.toISOString())}, ${sqlString(expiresAt)}, ${sqlString(owner)});
`);
    return true;
  }

  async releaseJobLock(lockKey, owner) {
    await this.exec(`DELETE FROM job_lock WHERE lock_key=${sqlString(lockKey)} AND owner=${sqlString(owner)};`);
  }

  async latestSnapshot() {
    await this.init();
    const rows = await this.queryJson("SELECT payload_json FROM app_snapshot_daily ORDER BY snapshot_date DESC LIMIT 1;");
    if (!rows.length) return null;
    return JSON.parse(rows[0].payload_json);
  }

  async latestJobRun() {
    await this.init();
    const rows = await this.queryJson("SELECT * FROM job_run ORDER BY started_at DESC LIMIT 1;");
    return rows[0] || null;
  }

  async readThresholds(fallback = []) {
    await this.init();
    const rows = await this.queryJson("SELECT * FROM dim_threshold_config ORDER BY threshold_key;");
    if (!rows.length) return fallback.map((item) => ({ ...item }));
    return rows.map((row) => ({
      key: row.threshold_key,
      name: row.name,
      metricName: row.metric_name,
      operator: row.operator,
      value: Number(row.value),
      unit: row.unit,
      scopeType: row.scope_type,
      scopeValue: row.scope_value || undefined,
      defaultValue: row.default_value === null ? undefined : Number(row.default_value),
      enabled: Boolean(row.is_active),
      updatedBy: row.updated_by,
      updatedAt: row.updated_at
    }));
  }

  async readInternalAddresses(fallback = []) {
    await this.init();
    const rows = await this.queryJson("SELECT * FROM dim_internal_address ORDER BY updated_at DESC;");
    if (!rows.length) return fallback.map((item) => ({ ...item }));
    return rows.map((row) => ({
      address: row.address,
      chain: row.chain,
      label: row.label,
      ownerName: row.owner_name || "",
      excludeFromTopHolder: Boolean(row.exclude_from_top_holder),
      excludeFromFlowAnalysis: Boolean(row.exclude_from_flow_analysis),
      excludeFromAlert: Boolean(row.exclude_from_alert),
      reason: row.reason || "",
      updatedBy: row.updated_by || "local-admin",
      updatedAt: row.updated_at
    }));
  }

  async upsertThreshold(item) {
    await this.exec(`
INSERT OR REPLACE INTO dim_threshold_config(
  threshold_key, name, metric_name, operator, value, unit, scope_type, scope_value,
  default_value, is_active, updated_by, updated_at
) VALUES(
  ${sqlString(item.key)}, ${sqlString(item.name)}, ${sqlString(item.metricName)}, ${sqlString(item.operator)},
  ${sqlNumber(item.value)}, ${sqlString(item.unit)}, ${sqlString(item.scopeType)}, ${sqlString(item.scopeValue || "")},
  ${sqlNumber(item.defaultValue === undefined ? item.value : item.defaultValue)}, ${item.enabled === false ? 0 : 1},
  ${sqlString(item.updatedBy || "snapshot-job")}, ${sqlString(item.updatedAt || new Date().toISOString())}
);
`);
  }

  async updateThreshold(item, oldValue, reason) {
    await this.upsertThreshold(item);
    await this.exec(`
INSERT INTO fact_threshold_change_log(threshold_key, old_value, new_value, enabled, updated_by, updated_at, reason)
VALUES(${sqlString(item.key)}, ${sqlNumber(oldValue)}, ${sqlNumber(item.value)}, ${item.enabled ? 1 : 0},
${sqlString(item.updatedBy || "local-admin")}, ${sqlString(item.updatedAt)}, ${sqlString(reason)});
`);
  }

  async readThresholdChangeLog() {
    await this.init();
    const rows = await this.queryJson("SELECT * FROM fact_threshold_change_log ORDER BY updated_at DESC LIMIT 100;");
    return rows.map((row) => ({
      thresholdKey: row.threshold_key,
      oldValue: row.old_value,
      newValue: row.new_value,
      enabled: Boolean(row.enabled),
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
      reason: row.reason
    }));
  }

  async upsertInternalAddress(item) {
    await this.exec(`
INSERT OR REPLACE INTO dim_internal_address(
  address, chain, label, owner_name, exclude_from_top_holder, exclude_from_flow_analysis,
  exclude_from_alert, reason, effective_from, effective_to, updated_by, updated_at
) VALUES(
  ${sqlString(item.address)}, ${sqlString(item.chain || "TRON")}, ${sqlString(item.label || "internal")},
  ${sqlString(item.ownerName || "")}, ${item.excludeFromTopHolder === false ? 0 : 1},
  ${item.excludeFromFlowAnalysis === false ? 0 : 1}, ${item.excludeFromAlert === false ? 0 : 1},
  ${sqlString(item.reason || "")}, ${sqlString(item.effectiveFrom || "")}, ${sqlString(item.effectiveTo || "")},
  ${sqlString(item.updatedBy || "local-admin")}, ${sqlString(item.updatedAt || new Date().toISOString())}
);
`);
  }

  async logInternalAddressChange({ action, oldValue, newValue, reason, updatedBy }) {
    await this.exec(`
INSERT INTO internal_address_change_log(action, address, old_value_json, new_value_json, updated_by, updated_at, reason)
VALUES(
  ${sqlString(action)}, ${sqlString(newValue?.address || oldValue?.address || "")},
  ${sqlString(oldValue ? JSON.stringify(oldValue) : null)}, ${sqlString(newValue ? JSON.stringify(newValue) : null)},
  ${sqlString(updatedBy || "local-admin")}, ${sqlString(new Date().toISOString())}, ${sqlString(reason)}
);
`);
  }

  async readInternalAddressChangeLog() {
    await this.init();
    const rows = await this.queryJson("SELECT * FROM internal_address_change_log ORDER BY updated_at DESC LIMIT 100;");
    return rows.map((row) => ({
      action: row.action,
      address: row.address,
      oldValue: row.old_value_json ? JSON.parse(row.old_value_json) : null,
      newValue: row.new_value_json ? JSON.parse(row.new_value_json) : null,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
      reason: row.reason
    }));
  }

  async persistSnapshot(snapshot, config, facts = {}, job = {}) {
    await this.init();
    const snapshotDate = snapshot.lastCompleteUtcDate;
    const now = new Date().toISOString();
    const runId = job.runId || `${snapshotDate}-${Date.now()}`;
    await this.exec(`
BEGIN;
INSERT OR REPLACE INTO job_run(run_id, snapshot_date, status, started_at, finished_at, source_adapter, error_message)
VALUES(${sqlString(runId)}, ${sqlString(snapshotDate)}, 'running', ${sqlString(job.startedAt || now)}, NULL, ${sqlString(job.sourceAdapter || "json-export")}, NULL);
DELETE FROM dim_protocol;
${(config.competitors || []).map((item) => `
INSERT INTO dim_protocol(protocol_id, name, category, chain, defillama_slug, is_competitor, is_active)
VALUES(${sqlString(item.protocolId)}, ${sqlString(item.name)}, 'lending', 'multi-chain', ${sqlString(item.defillamaSlug)}, 1, ${item.enabled === false ? 0 : 1});`).join("\n")}
DELETE FROM dim_asset;
${(config.assets || []).map((item) => `
INSERT INTO dim_asset(asset_id, symbol, chain, contract_address, market_id, asset_group, cmc_asset_id, is_active)
VALUES(${sqlString(item.symbol.toLowerCase())}, ${sqlString(item.symbol)}, 'TRON', ${sqlString(item.contractAddress || "")}, ${sqlString(item.marketId || "")}, ${sqlString(item.group)}, ${sqlString(item.cmcAssetId)}, ${item.enabled === false ? 0 : 1});`).join("\n")}
${(config.thresholds || []).map((item) => `
INSERT OR IGNORE INTO dim_threshold_config(threshold_key, name, metric_name, operator, value, unit, scope_type, scope_value, default_value, is_active, updated_by, updated_at)
VALUES(${sqlString(item.key)}, ${sqlString(item.name)}, ${sqlString(item.metricName)}, ${sqlString(item.operator)}, ${sqlNumber(item.value)}, ${sqlString(item.unit)}, ${sqlString(item.scopeType)}, ${sqlString(item.scopeValue || "")}, ${sqlNumber(item.defaultValue === undefined ? item.value : item.defaultValue)}, ${item.enabled === false ? 0 : 1}, 'snapshot-job', ${sqlString(now)});`).join("\n")}
${(snapshot.settings?.internalAddresses || []).map((item) => `
INSERT OR IGNORE INTO dim_internal_address(address, chain, label, owner_name, exclude_from_top_holder, exclude_from_flow_analysis, exclude_from_alert, reason, updated_by, updated_at)
VALUES(${sqlString(item.address)}, ${sqlString(item.chain || "TRON")}, ${sqlString(item.label || "internal")}, ${sqlString(item.ownerName || "")}, ${item.excludeFromTopHolder === false ? 0 : 1}, ${item.excludeFromFlowAnalysis === false ? 0 : 1}, ${item.excludeFromAlert === false ? 0 : 1}, ${sqlString(item.reason || "")}, ${sqlString(item.updatedBy || "snapshot-job")}, ${sqlString(item.updatedAt || now)});`).join("\n")}
${(facts.userPositions || []).map((item) => `
DELETE FROM fact_user_position_daily
WHERE snapshot_date=${sqlString(item.snapshotDate || snapshotDate)}
  AND user_address=${sqlString(item.userAddress || item.address)};
INSERT OR REPLACE INTO fact_user_position_daily(snapshot_date, user_address, supply_usd, borrow_usd, net_position_usd, payload_json)
VALUES(${sqlString(item.snapshotDate || snapshotDate)}, ${sqlString(item.userAddress || item.address)}, ${sqlNumber(item.supplyUsd)}, ${sqlNumber(item.borrowUsd)}, ${sqlNumber(item.netPositionUsd)}, ${sqlString(JSON.stringify(item))});`).join("\n")}
${(facts.userAssetPositions || []).map((item) => `
DELETE FROM fact_user_asset_position_daily
WHERE snapshot_date=${sqlString(item.snapshotDate || snapshotDate)}
  AND user_address=${sqlString(item.userAddress || item.address)}
  AND asset=${sqlString(item.asset)};
INSERT OR REPLACE INTO fact_user_asset_position_daily(snapshot_date, user_address, asset, supply_amount, supply_usd, borrow_amount, borrow_usd, payload_json)
VALUES(${sqlString(item.snapshotDate || snapshotDate)}, ${sqlString(item.userAddress || item.address)}, ${sqlString(item.asset)}, ${sqlNumber(item.supplyAmount)}, ${sqlNumber(item.supplyUsd)}, ${sqlNumber(item.borrowAmount)}, ${sqlNumber(item.borrowUsd)}, ${sqlString(JSON.stringify(item))});`).join("\n")}
DELETE FROM fact_top_holder_daily WHERE snapshot_date=${sqlString(snapshotDate)};
${(snapshot.capitalOutflow?.top20Current || []).map((item) => `
INSERT INTO fact_top_holder_daily(snapshot_date, rank, user_address, supply_usd, borrow_usd, net_position_usd, primary_asset, unreturned_outflow_usd, return_rate_pct, payload_json)
VALUES(${sqlString(snapshotDate)}, ${sqlNumber(item.rank)}, ${sqlString(item.address || item.userAddress)}, ${sqlNumber(item.supplyUsd)}, ${sqlNumber(item.borrowUsd)}, ${sqlNumber(item.netPositionUsd)}, ${sqlString(item.primaryAsset || "")}, ${sqlNumber(item.unreturnedOutflowUsd)}, ${sqlNumber(item.returnRatePct)}, ${sqlString(JSON.stringify(item))});`).join("\n")}
DELETE FROM fact_top_lost_holder_daily WHERE snapshot_date=${sqlString(snapshotDate)};
${(snapshot.capitalOutflow?.top20Lost || []).map((item) => `
INSERT INTO fact_top_lost_holder_daily(snapshot_date, rank, user_address, beginning_supply_usd, gross_withdraw_usd, returned_outflow_usd, unreturned_outflow_usd, return_rate_pct, top_destination, payload_json)
VALUES(${sqlString(snapshotDate)}, ${sqlNumber(item.rank)}, ${sqlString(item.address || item.userAddress)}, ${sqlNumber(item.beginningSupplyUsd)}, ${sqlNumber(item.grossWithdrawUsd)}, ${sqlNumber(item.returnedOutflowUsd)}, ${sqlNumber(item.unreturnedOutflowUsd)}, ${sqlNumber(item.returnRatePct)}, ${sqlString(item.topDestination || "")}, ${sqlString(JSON.stringify(item))});`).join("\n")}
DELETE FROM fact_asset_daily_metrics WHERE snapshot_date=${sqlString(snapshotDate)};
${(snapshot.borrowDemand?.assets || []).map((item) => `
INSERT INTO fact_asset_daily_metrics(snapshot_date, asset, supply_usd, supply_change_pct, borrow_amount, borrow_amount_change_pct, borrow_usd, borrow_usd_change_pct, asset_price_change_pct, utilization, utilization_change_pct, borrow_apy, borrow_apy_change_pct, supply_apy, supply_apy_change_pct, payload_json)
VALUES(${sqlString(snapshotDate)}, ${sqlString(item.asset)}, ${sqlNumber(item.supplyUsd)}, ${sqlNumber(item.supplyChangePct)}, ${sqlNumber(item.borrowAmount)}, ${sqlNumber(item.borrowAmountChangePct)}, ${sqlNumber(item.borrowUsd)}, ${sqlNumber(item.borrowUsdChangePct)}, ${sqlNumber(item.assetPriceChangePct)}, ${sqlNumber(item.utilization)}, ${sqlNumber(item.utilizationChangePct)}, ${sqlNumber(item.borrowApy)}, ${sqlNumber(item.borrowApyChangePct)}, ${sqlNumber(item.supplyApy)}, ${sqlNumber(item.supplyApyChangePct)}, ${sqlString(JSON.stringify(item))});`).join("\n")}
DELETE FROM fact_capital_flow_event WHERE snapshot_date=${sqlString(snapshotDate)};
${(facts.capitalFlowEvents || []).map((item, index) => `
INSERT INTO fact_capital_flow_event(event_id, snapshot_date, event_time, user_address, asset, action, amount, amount_usd, tx_hash, counterparty_address, payload_json)
VALUES(${sqlString(item.eventId || item.id || `${snapshotDate}-flow-${index}`)}, ${sqlString(snapshotDate)}, ${sqlString(item.eventTime || item.time)}, ${sqlString(item.userAddress || item.address)}, ${sqlString(item.asset)}, ${sqlString(item.action)}, ${sqlNumber(item.amount)}, ${sqlNumber(item.amountUsd || item.usd)}, ${sqlString(item.txHash || "")}, ${sqlString(item.counterpartyAddress || item.counterparty || "")}, ${sqlString(JSON.stringify(item))});`).join("\n")}
DELETE FROM fact_capital_migration_path WHERE snapshot_date=${sqlString(snapshotDate)};
${((facts.capitalMigrationPaths?.length ? facts.capitalMigrationPaths : snapshot.capitalOutflow?.attributionDetails) || []).map((item, index) => `
INSERT INTO fact_capital_migration_path(path_id, snapshot_date, user_address, hop, destination, destination_category, attribution, amount_usd, used_in_overview, payload_json)
VALUES(${sqlString(item.pathId || item.id || `${snapshotDate}-path-${index}`)}, ${sqlString(snapshotDate)}, ${sqlString(item.userAddress || item.address || "")}, ${sqlNumber(item.hop)}, ${sqlString(item.destination || "")}, ${sqlString(item.category || item.destinationCategory || "")}, ${sqlString(item.attribution || "")}, ${sqlNumber(item.amountUsd)}, ${item.usedInOverview ? 1 : 0}, ${sqlString(JSON.stringify(item))});`).join("\n")}
DELETE FROM fact_capital_round_trip WHERE snapshot_date=${sqlString(snapshotDate)};
${(snapshot.capitalOutflow?.roundTrips || []).map((item, index) => `
INSERT INTO fact_capital_round_trip(round_trip_id, snapshot_date, user_address, outflow_time, outflow_asset, outflow_amount, outflow_usd, outflow_destination, outflow_destination_category, weak_destination, return_time, return_asset, return_amount, return_usd, return_market, time_away_hours, round_trip_delta_usd, status, payload_json)
VALUES(${sqlString(item.roundTripId || item.id || `${snapshotDate}-rt-${index}`)}, ${sqlString(snapshotDate)}, ${sqlString(item.address || item.userAddress)}, ${sqlString(item.outflowTime || "")}, ${sqlString(item.outflowAsset || "")}, ${sqlNumber(item.outflowAmount)}, ${sqlNumber(item.outflowUsd)}, ${sqlString(item.outflowDestination || item.strongDestination || item.destination || "")}, ${sqlString(item.outflowDestinationCategory || item.destinationCategory || item.category || "")}, ${sqlString(item.weakDestination || "")}, ${sqlString(item.returnTime || "")}, ${sqlString(item.returnAsset || "")}, ${sqlNumber(item.returnAmount)}, ${sqlNumber(item.returnUsd)}, ${sqlString(item.returnMarket || "")}, ${sqlNumber(item.timeAwayHours)}, ${sqlNumber(item.roundTripDeltaUsd)}, ${sqlString(item.status)}, ${sqlString(JSON.stringify(item))});`).join("\n")}
INSERT OR REPLACE INTO mart_overview_daily(snapshot_date, payload_json, updated_at)
VALUES(${sqlString(snapshotDate)}, ${sqlString(JSON.stringify(snapshot.overview))}, ${sqlString(now)});
INSERT OR REPLACE INTO mart_market_comparison_daily(snapshot_date, payload_json, updated_at)
VALUES(${sqlString(snapshotDate)}, ${sqlString(JSON.stringify(snapshot.marketComparison))}, ${sqlString(now)});
INSERT OR REPLACE INTO mart_borrow_demand_daily(snapshot_date, payload_json, updated_at)
VALUES(${sqlString(snapshotDate)}, ${sqlString(JSON.stringify(snapshot.borrowDemand))}, ${sqlString(now)});
INSERT OR REPLACE INTO mart_capital_outflow_daily(snapshot_date, payload_json, updated_at)
VALUES(${sqlString(snapshotDate)}, ${sqlString(JSON.stringify(snapshot.capitalOutflow))}, ${sqlString(now)});
INSERT OR REPLACE INTO mart_anomaly_signal_daily(snapshot_date, payload_json, updated_at)
VALUES(${sqlString(snapshotDate)}, ${sqlString(JSON.stringify(snapshot.overview?.anomalySignals || []))}, ${sqlString(now)});
INSERT OR REPLACE INTO app_snapshot_daily(snapshot_date, generated_at, payload_json)
VALUES(${sqlString(snapshotDate)}, ${sqlString(snapshot.generatedAt)}, ${sqlString(JSON.stringify(snapshot))});
UPDATE job_run SET status='success', finished_at=${sqlString(now)} WHERE run_id=${sqlString(runId)};
COMMIT;
`);
  }
}

module.exports = {
  SQLiteStore
};
