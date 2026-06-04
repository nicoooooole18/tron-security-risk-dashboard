const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function env(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function numberEnv(name, fallback) {
  const raw = env(name, "");
  if (raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function listEnv(name) {
  return env(name, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function productionPaths() {
  return {
    root: ROOT,
    sqliteDbPath: env("SQLITE_DB_PATH", path.join(ROOT, "data/capital-intelligence.sqlite")),
    sourceAdapter: env("SOURCE_ADAPTER", "json-export"),
    sourceJsonDir: env("SOURCE_JSON_DIR", path.join(ROOT, "data/source-json")),
    existingDbDsn: env("EXISTING_DB_DSN", ""),
    cmcApiKey: env("CMC_API_KEY", ""),
    externalFetchEnabled: env("EXTERNAL_FETCH_ENABLED", "false") === "true",
    jobLockTtlMinutes: numberEnv("SNAPSHOT_JOB_LOCK_TTL_MINUTES", 120),
    topAccountCsvFiles: listEnv("TOP_ACCOUNT_CSV_FILES"),
    lendInfoCsvFiles: listEnv("LEND_INFO_CSV_FILES"),
    lendInfoCsvUrl: env("LEND_INFO_CSV_URL", ""),
    autoFetchDailyCsv: env("AUTO_FETCH_DAILY_CSV", "false") === "true",
    sourceCsvDir: env("SOURCE_CSV_DIR", path.join(ROOT, "data/source-csv")),
    labcAccessToken: env("LABC_ACCESS_TOKEN", ""),
    lendInfoApiBase: env("LEND_INFO_API_BASE", ""),
    topAccountApiBase: env("TOP_ACCOUNT_API_BASE", ""),
    topAccountTrxUsd: numberEnv("TOP_ACCOUNT_TRX_USD", null),
    chainEnrichmentEnabled: env("CHAIN_ENRICHMENT_ENABLED", "false") === "true",
    chainProvider: env("CHAIN_PROVIDER", "tronscan"),
    chainLookbackTopLostLimit: numberEnv("CHAIN_LOOKBACK_TOP_LOST_LIMIT", 10),
    tronScanApiBase: env("TRONSCAN_API_BASE", "https://apilist.tronscanapi.com"),
    tronGridApiBase: env("TRONGRID_API_BASE", "https://api.trongrid.io")
  };
}

module.exports = {
  env,
  numberEnv,
  listEnv,
  productionPaths
};
