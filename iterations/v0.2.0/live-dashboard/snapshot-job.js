const path = require("node:path");
const fs = require("node:fs/promises");
const { productionPaths } = require("./lib/env");
const { SQLiteStore } = require("./lib/sqlite-store");
const { loadJsonExport } = require("./lib/source-json-export");
const { discoverExistingDb, loadExistingDb } = require("./lib/source-existing-db");
const { enrichExternalData } = require("./lib/external-sources");
const { enrichLendInfoCsv } = require("./lib/source-lend-info-csv");
const { enrichTopAccountCsv } = require("./lib/source-top-account-csv");
const { enrichChainPaths } = require("./lib/chain-enrichment");
const { prepareDailyCsvSources, nextUtcDate } = require("./lib/daily-csv-fetch");

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, "config.json");
const FALLBACK_SNAPSHOT_PATH = path.join(ROOT, "data/daily-snapshot.json");

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function latestCompleteUtcDate(now = new Date()) {
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(utcMidnight - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function mergeDataQuality(snapshot, extraItems) {
  const items = [...(snapshot.dataQuality || [])];
  for (const item of extraItems || []) {
    const existingIndex = items.findIndex((existing) => existing.source === item.source);
    if (existingIndex >= 0) items[existingIndex] = item;
    else items.push(item);
  }
  return items;
}

function normalizeSnapshot(sourceSnapshot, config, extraQuality) {
  const snapshot = JSON.parse(JSON.stringify(sourceSnapshot));
  snapshot.period = snapshot.period || config.dashboard.defaultPeriod || "90d";
  snapshot.generatedAt = new Date().toISOString();
  snapshot.lastCompleteUtcDate = snapshot.lastCompleteUtcDate || latestCompleteUtcDate();
  snapshot.status = {
    ...(snapshot.status || {}),
    mode: "SQLITE_DAILY_SNAPSHOT",
    sourceAdapter: process.env.SOURCE_ADAPTER || config.productionData?.sourceAdapter || "json-export",
    dataQualityLevel: snapshot.status?.dataQualityLevel || "CHECK_DATA_QUALITY"
  };
  snapshot.dataQuality = mergeDataQuality(snapshot, [
    ...extraQuality,
    {
      source: "Competitor Borrow",
      status: "todo",
      message: "MVP production data keeps competitor Borrow median as TODO; Market Comparison only uses TVL median."
    },
    {
      source: "SQLite Application Store",
      status: "complete",
      message: "Daily snapshot marts are persisted to SQLite and served read-only by the web API."
    }
  ]);
  snapshot.settings = snapshot.settings || {};
  snapshot.settings.internalAddresses = snapshot.settings.internalAddresses || [];
  return snapshot;
}

async function loadSource(paths) {
  if (paths.sourceAdapter === "existing-db") {
    return loadExistingDb(paths);
  }
  if (paths.sourceAdapter !== "json-export") {
    throw new Error(`Unsupported SOURCE_ADAPTER=${paths.sourceAdapter}; expected json-export or existing-db.`);
  }
  return loadJsonExport({
    sourceJsonDir: paths.sourceJsonDir,
    fallbackSnapshotPath: FALLBACK_SNAPSHOT_PATH
  });
}

async function run() {
  let paths = productionPaths();
  const config = await readJson(CONFIG_PATH);
  const store = new SQLiteStore(paths.sqliteDbPath);
  const owner = `snapshot-job-${process.pid}-${Date.now()}`;
  const targetDate = latestCompleteUtcDate();
  const runId = `${targetDate}-${Date.now()}`;
  const startedAt = new Date().toISOString();

  if (process.argv.includes("--discover-existing-db")) {
    await store.init();
    const discovery = await discoverExistingDb(paths);
    console.log(JSON.stringify(discovery, null, 2));
    return;
  }

  const acquired = await store.acquireJobLock("daily-snapshot", paths.jobLockTtlMinutes, owner);
  if (!acquired) {
    throw new Error("snapshot job lock is already held; skip this run to avoid duplicate aggregation.");
  }

  try {
    const dailyCsv = await prepareDailyCsvSources(paths, targetDate);
    paths = dailyCsv.paths;
    const source = await loadSource(paths);
    const lendInfo = await enrichLendInfoCsv({
      snapshot: source.snapshot,
      config,
      paths
    });
    const external = await enrichExternalData(lendInfo.snapshot, config, paths);
    const topAccount = await enrichTopAccountCsv({
      snapshot: external.snapshot,
      facts: source.facts,
      config,
      paths
    });
    const chain = await enrichChainPaths(topAccount.snapshot, config, paths);
    const snapshot = normalizeSnapshot(chain.snapshot, config, [
      ...(dailyCsv.dataQuality || []),
      ...(source.dataQuality || []),
      ...(lendInfo.dataQuality || []),
      ...(external.dataQuality || []),
      ...(topAccount.dataQuality || []),
      ...(chain.dataQuality || [])
    ]);
    if (paths.autoFetchDailyCsv && snapshot.lastCompleteUtcDate !== targetDate) {
      throw new Error(`Daily freshness check failed: expected Data Through ${targetDate}, actual ${snapshot.lastCompleteUtcDate || "unknown"}. The snapshot was not updated.`);
    }
    await store.persistSnapshot(snapshot, config, topAccount.facts, {
      runId,
      startedAt,
      sourceAdapter: source.sourceAdapter
    });
    console.log(JSON.stringify({
      status: "success",
      sourceAdapter: source.sourceAdapter,
      sqliteDbPath: paths.sqliteDbPath,
      snapshotDate: snapshot.lastCompleteUtcDate,
      generatedAt: snapshot.generatedAt,
      expectedDataThrough: targetDate,
      nextFetchEndDate: nextUtcDate(targetDate)
    }, null, 2));
  } catch (error) {
    await store.recordJobFailure({
      runId,
      snapshotDate: targetDate,
      startedAt,
      sourceAdapter: paths.sourceAdapter,
      errorMessage: error.message
    }).catch(() => {});
    throw error;
  } finally {
    await store.releaseJobLock("daily-snapshot", owner);
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
