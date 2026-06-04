const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = __dirname;
const snapshot = readJson("data/daily-snapshot.json");
const config = readJson("config.json");
const apiBase = process.argv.find((item) => item.startsWith("--api="))?.slice(6);
const sqliteArg = process.argv.find((item) => item.startsWith("--sqlite="))?.slice(9);
const checks = [];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function check(name, condition, details = "") {
  checks.push({ name, pass: Boolean(condition), details });
}

function isUtcTimestamp(value) {
  return typeof value === "string" && value.endsWith("Z") && !Number.isNaN(new Date(value).getTime());
}

function isDescending(items, field) {
  return items.every((item, index) => index === 0 || items[index - 1][field] >= item[field]);
}

function isUnique(items, field) {
  return new Set(items.map((item) => item[field])).size === items.length;
}

function sum(items, field) {
  return (items || []).reduce((total, item) => total + Number(item[field] || 0), 0);
}

function runStaticChecks() {
  check("default period is 90d", snapshot.period === "90d" && config.dashboard.defaultPeriod === "90d");
  check("production data config exists", config.productionData?.sourceAdapter === "json-export" && config.productionData?.sqliteStore);
  check("snapshot timestamps are UTC", [snapshot.generatedAt, snapshot.periodStart, snapshot.periodEnd].every(isUtcTimestamp));
  check("last complete UTC date exists", /^\d{4}-\d{2}-\d{2}$/.test(snapshot.lastCompleteUtcDate || ""));
  check("asset scope has 7 MVP assets", config.assets.map((item) => item.symbol).join(",") === "USDT,USDD,TRX,sTRX,BTC,ETHB,ETH");
  check("asset scope has JustLend market ids", config.assets.every((item) => item.marketId && item.contractAddress));
  check("competitors include Venus", config.competitors.some((item) => item.name === "Venus"));
  check("market share is not present", !JSON.stringify(snapshot.marketComparison).toLowerCase().includes("marketshare"));
  const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const appJs = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const stylesCss = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
  const lendInfoSource = fs.readFileSync(path.join(ROOT, "lib/source-lend-info-csv.js"), "utf8");
  const topAccountSource = fs.readFileSync(path.join(ROOT, "lib/source-top-account-csv.js"), "utf8");
  const externalSource = fs.readFileSync(path.join(ROOT, "lib/external-sources.js"), "utf8");
  check("period select supports 90d 30d 7d", ["value=\"90d\"", "value=\"30d\"", "value=\"7d\""].every((item) => indexHtml.includes(item)) && !indexHtml.includes("30D TODO") && !indexHtml.includes("7D TODO"));
  check("visible period labels are dynamic", indexHtml.includes("overviewKicker") && indexHtml.includes("competitorChangeHead") && appJs.includes("els.overviewKicker.textContent = `${periodLabel} 核心结论`") && appJs.includes("els.competitorChangeHead.textContent = `${periodLabel} TVL Change`") && appJs.includes("Top20 ${periodLabel} 未回流资金"));
  check("snapshot job builds real period views", lendInfoSource.includes("const windows = [7, 30, 90]") && lendInfoSource.includes("periodViews") && lendInfoSource.includes("generated real 7D/30D/90D"));
  check("top account builds real outflow period views", topAccountSource.includes("for (const days of [7, 30, 90])") && topAccountSource.includes("generated real 7D/30D/90D Top20 outflow period views"));
  check("competitor tvl refreshes period views", externalSource.includes("enrichCompetitorTvlForWindow") && externalSource.includes("Object.entries(periodViews)"));
  check("overview uses high utilization asset count", appJs.includes("High Util Assets") && appJs.includes("HIGH_UTILIZATION_THRESHOLD = 60") && appJs.includes("highUtilAssetCountForPeriod") && !appJs.includes("[\"Utilization\""));
  check("overview kpis follow selected period", appJs.includes("periodChangeUsd") && appJs.includes("TVL Change") && appJs.includes("${periodLabel} period") && appJs.includes("formatSignedUsd(kpis.netFlowUsd)") && !appJs.includes("latest ${formatUsd"));
  check("market comparison explains metrics and chart colors", appJs.includes("infoTooltip") && appJs.includes("data-tip") && appJs.includes("chart-legend") && appJs.includes("Competitor Median TVL") && stylesCss.includes(".info-tip::after") && stylesCss.includes(".legend-dot.median"));
  check("market comparison uses period change values", indexHtml.includes("TVL Change USD") && appJs.includes("formatSignedUsd(periodChangeUsd(market.justlend.tvlUsd, market.justlend.tvlChangePct))") && appJs.includes("formatSignedUsd(periodChangeUsd(item.tvlUsd, item.tvlChangePct))"));
  check("typography tokens prevent card overlap", stylesCss.includes("--font-xs: 12px") && stylesCss.includes("--font-sm: 13px") && stylesCss.includes("--line-normal: 1.45") && stylesCss.includes(".comparison-item {\n  display: grid;") && stylesCss.includes("min-height: 132px") && stylesCss.includes(".comparison-item p {\n  margin: 8px 0 0;"));
  check("signed metric values keep parent font size", stylesCss.includes(".comparison-item > .label-with-tip") && !stylesCss.includes(".comparison-item span") && stylesCss.includes(".negative {\n  color: var(--red);\n  font-size: inherit;") && stylesCss.includes(".positive {\n  color: var(--green);\n  font-size: inherit;"));
  check("tables use fixed row ellipsis with hover titles", stylesCss.includes("table-layout: fixed") && stylesCss.includes(".cell-ellipsis") && stylesCss.includes("text-overflow: ellipsis") && appJs.includes("function hydrateTableCellTitles") && appJs.includes("row.map(tableCell)"));
  check("borrow demand uses period change columns", indexHtml.includes("Supply Change USD") && indexHtml.includes("Borrow Change USD") && appJs.includes("formatSignedUsd(periodChangeUsd(item.supplyUsd, item.supplyChangePct))") && appJs.includes("formatSignedUsd(periodChangeUsd(item.borrowUsd, item.borrowUsdChangePct))"));
  check("top20 current has 20 unique rows", snapshot.capitalOutflow.top20Current.length === 20 && isUnique(snapshot.capitalOutflow.top20Current, "address"));
  check("top20 current sorted by supplyUsd", isDescending(snapshot.capitalOutflow.top20Current, "supplyUsd"));
  check("top20 lost has 20 unique rows", snapshot.capitalOutflow.top20Lost.length === 20 && isUnique(snapshot.capitalOutflow.top20Lost, "address"));
  check("top20 lost sorted by unreturnedOutflowUsd", isDescending(snapshot.capitalOutflow.top20Lost, "unreturnedOutflowUsd"));
  check("round trip has returned statuses", new Set(snapshot.capitalOutflow.roundTrips.map((item) => item.status)).has("returned"));
  check("round trip has partially returned statuses", new Set(snapshot.capitalOutflow.roundTrips.map((item) => item.status)).has("partially_returned"));
  check("round trip has not returned statuses", new Set(snapshot.capitalOutflow.roundTrips.map((item) => item.status)).has("not_returned"));
  check("round trip records time away", snapshot.capitalOutflow.roundTrips.every((item) => Number.isFinite(item.timeAwayHours)));
  check("net outflow exists as auxiliary metric", Number.isFinite(snapshot.capitalOutflow.summary.netOutflowUsd));
  check("borrow demand has USD and amount fields", snapshot.borrowDemand.assets.every((item) => Number.isFinite(item.borrowUsd) && Number.isFinite(item.borrowAmount)));
  check("borrow demand has APY fields", snapshot.borrowDemand.assets.every((item) => Number.isFinite(item.borrowApy) && Number.isFinite(item.supplyApy)));
  check("price impact case exists", snapshot.borrowDemand.assets.some((item) => item.borrowUsdChangePct < -5 && item.borrowAmountChangePct >= 0));
  check("unknown attribution is preserved", snapshot.capitalOutflow.destinations.some((item) => item.category === "Unknown" && item.sharePct > 0));
  check("pending chain lookup has readable display state", appJs.includes("function destinationDisplay") && appJs.includes("待链上归因") && topAccountSource.includes("const PENDING_CHAIN_LOOKUP = \"待链上归因\""));
  check("top lost destinations backfill from chain attribution", fs.readFileSync(path.join(ROOT, "lib/chain-enrichment.js"), "utf8").includes("function backfillTopLostDestinations") && fs.readFileSync(path.join(ROOT, "server.js"), "utf8").includes("normalizeCapitalOutflowSnapshot") && appJs.includes("destinationAttribution || item.attribution"));
  check("hop2 attribution is detail-only", snapshot.capitalOutflow.attributionDetails.some((item) => item.hop === 2 && item.usedInOverview === false));
  check("overview attribution uses hop1 only", snapshot.capitalOutflow.attributionDetails.filter((item) => item.usedInOverview).every((item) => item.hop === 1));
  check("threshold defaults include 8 rules", config.thresholds.length === 8);
  check("collateral intent threshold is disabled", config.thresholds.some((item) => item.key === "collateral_intent_decline_usd" && item.enabled === false));
  check("internal addresses exclude top holder, flow, and alert", snapshot.settings.internalAddresses.every((item) => item.excludeFromTopHolder && item.excludeFromFlowAnalysis && item.excludeFromAlert));
  check("data quality covers 90d snapshot", snapshot.dataQuality.some((item) => item.source === "90D Start Snapshot"));
  check("data quality covers internal address filter", snapshot.dataQuality.some((item) => item.source === "Internal Address Filter"));
  check("data quality covers unknown attribution", snapshot.dataQuality.some((item) => item.source === "Attribution Unknown"));
  check("csv export enabled", config.permissions.csvExportEnabled === true);
  check("csv export button exists", indexHtml.includes("csvExportBtn") && indexHtml.includes("导出 CSV"));
  check("snapshot job exists", fs.existsSync(path.join(ROOT, "snapshot-job.js")));
  check("sqlite store exists", fs.existsSync(path.join(ROOT, "lib/sqlite-store.js")));
  check("json export adapter exists", fs.existsSync(path.join(ROOT, "lib/source-json-export.js")));
  check("existing db adapter exists", fs.existsSync(path.join(ROOT, "lib/source-existing-db.js")));
  check("lend info csv adapter exists", fs.existsSync(path.join(ROOT, "lib/source-lend-info-csv.js")));
  check("top account csv adapter exists", fs.existsSync(path.join(ROOT, "lib/source-top-account-csv.js")));
  check("chain enrichment module exists", fs.existsSync(path.join(ROOT, "lib/chain-enrichment.js")));
  const envExample = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  check("env template includes production variables", [
    "CMC_API_KEY",
    "SOURCE_ADAPTER",
    "SOURCE_JSON_DIR",
    "EXISTING_DB_DSN",
    "SQLITE_DB_PATH",
    "SNAPSHOT_JOB_LOCK_TTL_MINUTES",
    "TOP_ACCOUNT_CSV_FILES",
    "LEND_INFO_CSV_URL",
    "TOP_ACCOUNT_TRX_USD",
    "CHAIN_ENRICHMENT_ENABLED",
    "CHAIN_PROVIDER"
  ].every((name) => envExample.includes(name)));
  check("competitor borrow remains TODO", config.productionData.competitorBorrowPolicy.includes("TODO"));
}

function runSqliteChecks(dbPath) {
  const absolutePath = path.isAbsolute(dbPath) ? dbPath : path.join(ROOT, dbPath);
  check("sqlite db exists", fs.existsSync(absolutePath), absolutePath);
  if (!fs.existsSync(absolutePath)) return;
  const tables = JSON.parse(execFileSync("sqlite3", ["-json", absolutePath, "SELECT name FROM sqlite_master WHERE type='table';"], { encoding: "utf8" }));
  const tableNames = new Set(tables.map((item) => item.name));
  [
    "dim_asset",
    "dim_protocol",
    "dim_internal_address",
    "dim_threshold_config",
    "fact_user_position_daily",
    "fact_user_asset_position_daily",
    "fact_top_holder_daily",
    "fact_top_lost_holder_daily",
    "fact_asset_daily_metrics",
    "fact_capital_flow_event",
    "fact_capital_migration_path",
    "fact_capital_round_trip",
    "mart_overview_daily",
    "mart_market_comparison_daily",
    "mart_borrow_demand_daily",
    "mart_capital_outflow_daily",
    "mart_anomaly_signal_daily",
    "app_snapshot_daily",
    "job_lock"
  ].forEach((name) => check(`sqlite table ${name} exists`, tableNames.has(name)));
  const rows = JSON.parse(execFileSync("sqlite3", ["-json", absolutePath, "SELECT snapshot_date, generated_at, payload_json FROM app_snapshot_daily ORDER BY snapshot_date DESC LIMIT 1;"], { encoding: "utf8" }) || "[]");
  check("sqlite latest snapshot exists", rows.length === 1);
  if (rows.length) {
    const persisted = JSON.parse(rows[0].payload_json);
    check("sqlite latest snapshot has 90d period", persisted.period === "90d");
    check("sqlite latest snapshot uses production data mode", persisted.status?.mode === "SQLITE_DAILY_SNAPSHOT");
    check("sqlite latest snapshot top20 current has 20 rows", persisted.capitalOutflow?.top20Current?.length === 20);
    check("sqlite latest snapshot top20 lost has 20 rows", persisted.capitalOutflow?.top20Lost?.length === 20);
    check("sqlite data quality marks sqlite store", persisted.dataQuality?.some((item) => item.source === "SQLite Application Store"));
    check("sqlite data quality marks lend info csv when configured", !persisted.dataQuality?.some((item) => item.source === "Lend Info CSV") || persisted.dataQuality.some((item) => item.source === "Lend Info CSV" && item.status === "complete"));
    check("sqlite asset-level metrics are non-mock when lend info is loaded", !persisted.dataQuality?.some((item) => item.source === "Lend Info CSV" && item.status === "complete") || persisted.borrowDemand?.assets?.every((item) => item.source === "lend-info-csv"));
  }
  const latestDateSql = "(SELECT MAX(snapshot_date) FROM app_snapshot_daily)";
  const factTopCurrent = JSON.parse(execFileSync("sqlite3", ["-json", absolutePath, `SELECT rank, user_address, supply_usd FROM fact_top_holder_daily WHERE snapshot_date=${latestDateSql} ORDER BY rank;`], { encoding: "utf8" }) || "[]");
  const factTopLost = JSON.parse(execFileSync("sqlite3", ["-json", absolutePath, `SELECT rank, user_address, unreturned_outflow_usd FROM fact_top_lost_holder_daily WHERE snapshot_date=${latestDateSql} ORDER BY rank;`], { encoding: "utf8" }) || "[]");
  const factAssetMetrics = JSON.parse(execFileSync("sqlite3", ["-json", absolutePath, `SELECT asset, borrow_usd, borrow_amount, utilization, borrow_apy, supply_apy FROM fact_asset_daily_metrics WHERE snapshot_date=${latestDateSql} ORDER BY asset;`], { encoding: "utf8" }) || "[]");
  check("sqlite fact_top_holder_daily has 20 rows", factTopCurrent.length === 20);
  check("sqlite fact_top_holder_daily sorted by supply", isDescending(factTopCurrent, "supply_usd"));
  check("sqlite fact_top_lost_holder_daily has 20 rows", factTopLost.length === 20);
  check("sqlite fact_top_lost_holder_daily sorted by unreturned outflow", isDescending(factTopLost, "unreturned_outflow_usd"));
  check("sqlite fact_asset_daily_metrics has 7 assets", factAssetMetrics.length === 7);
  check("sqlite fact_asset_daily_metrics covers asset scope", factAssetMetrics.map((item) => item.asset).sort().join(",") === config.assets.map((item) => item.symbol).sort().join(","));
  check("sqlite fact_asset_daily_metrics has borrow and APY", factAssetMetrics.every((item) => Number.isFinite(item.borrow_usd) && Number.isFinite(item.borrow_amount) && Number.isFinite(item.borrow_apy) && Number.isFinite(item.supply_apy)));
}

async function runApiChecks(base) {
  const [overview, overview7d, snapshot90d, snapshot7d, snapshot30d, overview30d, market7d, market90d, topCurrent30d, topLost7d, topCurrent, topLost, roundTrip, borrowCsv, topLostCsv] = await Promise.all([
    fetchJson(base, "/api/v1/overview?period=90d"),
    fetchJson(base, "/api/v1/overview?period=7d"),
    fetchJson(base, "/api/snapshot?period=90d"),
    fetchJson(base, "/api/snapshot?period=7d"),
    fetchJson(base, "/api/snapshot?period=30d"),
    fetchJson(base, "/api/v1/overview?period=30d"),
    fetchJson(base, "/api/v1/market-comparison?period=7d"),
    fetchJson(base, "/api/v1/market-comparison?period=90d"),
    fetchJson(base, "/api/v1/capital-outflow/top-current?period=30d"),
    fetchJson(base, "/api/v1/capital-outflow/top-lost?period=7d"),
    fetchJson(base, "/api/v1/capital-outflow/top-current?period=90d"),
    fetchJson(base, "/api/v1/capital-outflow/top-lost?period=90d"),
    fetchJson(base, "/api/v1/capital-outflow/round-trip?period=90d"),
    fetchText(base, "/api/v1/export.csv?dataset=borrow-demand&period=90d"),
    fetchText(base, "/api/v1/export.csv?dataset=top-lost&period=90d")
  ]);

  check("api overview returns anomaly signals", Array.isArray(overview.anomalySignals) && overview.anomalySignals.length > 0);
  check("api overview signals use selected period", overview7d.period === "7d" && !JSON.stringify(overview7d.anomalySignals || []).includes("90D"));
  check("api overview returns data quality", Array.isArray(overview.dataQuality) && overview.dataQuality.length >= snapshot.dataQuality.length);
  check("api overview includes production data quality when sqlite is active", !sqliteArg || overview.dataQuality.some((item) => item.source === "SQLite Application Store"));
  check("api snapshot supports 30d", snapshot30d.period === "30d" && snapshot30d.periodStart !== snapshot30d.periodEnd);
  check("api period views are real snapshots", [snapshot7d, snapshot30d, overview30d].every((item) => item.dataQuality.some((quality) => quality.source === "Period View" && quality.status === "complete")) && ![snapshot7d, snapshot30d, overview30d].some((item) => item.dataQuality.some((quality) => quality.source === "Derived Period View")));
  check("api 7d market comparison is not scaled from 90d", market7d.period === "7d" && Number.isFinite(market7d.justlend?.tvlChangePct) && Number.isFinite(market90d.justlend?.tvlChangePct) && Math.abs(market7d.justlend.tvlChangePct - market90d.justlend.tvlChangePct * 7 / 90) > 0.05);
  check("api 30d top current returns 20 rows", topCurrent30d.items?.length === 20);
  check("api 7d top lost returns 20 rows", topLost7d.items?.length === 20);
  check("api 7d top lost is not inherited from 90d", Math.abs(sum(topLost7d.items, "unreturnedOutflowUsd") - sum(topLost.items, "unreturnedOutflowUsd")) > 1);
  check("api top current returns 20 rows", topCurrent.items?.length === 20);
  check("api top lost returns 20 rows", topLost.items?.length === 20);
  check("api round trip returns time away", roundTrip.items?.every((item) => Number.isFinite(item.timeAwayHours)));
  check("api public snapshot does not expose settings", snapshot90d.settings === undefined);
  check("api public snapshot includes threshold config for view calculations", snapshot90d.config?.thresholds?.length === 8);
  check("api borrow demand csv exports", borrowCsv.includes("asset,supply_usd") && borrowCsv.includes("USDT"));
  check("api top lost csv exports", topLostCsv.includes("rank,address") && topLostCsv.includes("unreturned_outflow_usd"));

  const unauthSettings = await fetch(`${base}/api/v1/settings/thresholds`);
  check("api settings read requires admin login", unauthSettings.status === 401);

  const unauthPatch = await fetch(`${base}/api/v1/settings/thresholds/borrow_demand_decline_pct`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: -5, reason: "verify readonly gate" })
  });
  check("api settings write requires admin login", unauthPatch.status === 401);
}

async function fetchJson(base, route) {
  const response = await fetch(`${base}${route}`);
  if (!response.ok) throw new Error(`${route} returned ${response.status}`);
  return response.json();
}

async function fetchText(base, route) {
  const response = await fetch(`${base}${route}`);
  if (!response.ok) throw new Error(`${route} returned ${response.status}`);
  return response.text();
}

function printResults() {
  const failed = checks.filter((item) => !item.pass);
  for (const item of checks) {
    console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}${item.details ? ` - ${item.details}` : ""}`);
  }
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exit(1);
}

(async () => {
  runStaticChecks();
  if (sqliteArg) runSqliteChecks(sqliteArg);
  if (apiBase) await runApiChecks(apiBase.replace(/\/$/, ""));
  printResults();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
