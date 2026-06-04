# JustLend Capital Intelligence Dashboard MVP

This is the first implementation shell for `iterations/v0.2.0/prd-justlend-capital-intelligence-dashboard-mvp.md`.

## Scope

- Pure HTML / CSS / JS frontend.
- Node.js static server with `/api/config` and `/api/snapshot`.
- Daily Snapshot fallback in `data/daily-snapshot.json`.
- Production data mode with `snapshot-job.js`, JSON export adapter, SQLite mart store, and web read-only serving.
- View periods: 90D, 30D, and 7D. 90D is the default; 30D/7D can use source period snapshots when provided, otherwise they are clearly marked as derived views.
- No dependency installation required.
- No competitor Borrow production connector yet; Borrow median stays TODO in MVP.

## Run

```bash
cd iterations/v0.2.0/live-dashboard
node server.js
```

Open:

```text
http://127.0.0.1:8790
```

Public analytical view:

```text
http://127.0.0.1:8790/
```

Settings / Data Config prompts for the admin password configured by environment variables.

## Production Data Mode

The production path is:

```text
json-export or existing-db adapter -> snapshot-job.js -> SQLite marts -> server.js APIs
```

Environment template:

```bash
cp .env.example .env
```

Supported variables:

- `SOURCE_ADAPTER=json-export | existing-db`
- `SOURCE_JSON_DIR=./data/source-json`
- `SQLITE_DB_PATH=./data/capital-intelligence.sqlite`
- `SNAPSHOT_JOB_LOCK_TTL_MINUTES=120`
- `EXTERNAL_FETCH_ENABLED=false`
- `CMC_API_KEY=`
- `EXISTING_DB_DSN=`
- `TOP_ACCOUNT_CSV_FILES=` comma-separated DailyTopAccountList CSV paths.
- `LEND_INFO_CSV_URL=` exportLendInfo CSV URL used for asset-level lending metrics and daily TRX/USD valuation.
- `LEND_INFO_CSV_FILES=` comma-separated exportLendInfo CSV paths.
- `AUTO_FETCH_DAILY_CSV=true` fetches the previous complete UTC day from LABC before snapshot generation.
- `SOURCE_CSV_DIR=` directory for downloaded daily incremental CSV files.
- `LABC_ACCESS_TOKEN=`, `LEND_INFO_API_BASE=`, `TOP_ACCOUNT_API_BASE=` configure the LABC daily CSV endpoints.
- `TOP_ACCOUNT_TRX_USD=` fallback TRX/USD price when `LEND_INFO_CSV_URL` is unavailable.
- `CHAIN_ENRICHMENT_ENABLED=false`
- `CHAIN_PROVIDER=tronscan | trongrid`
- `CHAIN_LOOKBACK_TOP_LOST_LIMIT=5`
- `TRONSCAN_API_BASE=https://apilist.tronscanapi.com`
- `TRONGRID_API_BASE=https://api.trongrid.io`

Run the daily snapshot job:

```bash
SOURCE_ADAPTER=json-export node snapshot-job.js
```

The JSON export adapter reads these files when present:

- `daily-snapshot.json` or `snapshot.json`
- optional period views embedded as `periodViews.30d` / `periodViews.7d` or `periodSnapshots.30d` / `periodSnapshots.7d`
- `user-positions-daily.json`
- `user-asset-positions-daily.json`
- `capital-flow-events.json`
- `capital-migration-paths.json`

exportLendInfo ingestion replaces asset-level mock metrics when `LEND_INFO_CSV_URL` is configured. It updates Overview, Borrow Demand, JustLend TVL, JustLend Borrow, and the JustLend TVL trend for the 7 MVP assets:

```bash
LEND_INFO_CSV_URL="https://example/exportLendInfo?from=...&end=..." SOURCE_ADAPTER=json-export node snapshot-job.js
```

Top Account CSV ingestion is optional and can replace mock Top20 holder data with real user-position facts:

```bash
TOP_ACCOUNT_CSV_FILES="/path/DailyTopAccountList_2026-02-20_2026-03-20_tokenInfo.csv,/path/DailyTopAccountList_2026-03-21_2026-04-20_tokenInfo.csv" \
LEND_INFO_CSV_URL="https://example/exportLendInfo?from=...&end=..." \
SOURCE_ADAPTER=json-export node snapshot-job.js
```

The Top Account CSV field `当日价格(TRX)` is valued as TRX, not USD. The job converts it to USD using the TRX reference price from `LEND_INFO_CSV_URL`; if that export is unavailable, `TOP_ACCOUNT_TRX_USD` can be used as an explicit fallback.

Daily incremental CSV refresh can be enabled without re-downloading the full 90D history. The job calculates the previous complete UTC date, downloads only that target date, writes it to `SOURCE_CSV_DIR`, and merges it with the historical CSV baseline:

```bash
AUTO_FETCH_DAILY_CSV=true \
AUTO_FETCH_LEND_INFO_DAILY=true \
AUTO_FETCH_TOP_ACCOUNT_DAILY=false \
SOURCE_CSV_DIR=/home/openclaw/project/justlend-capital-data/source \
LABC_ACCESS_TOKEN=... \
LEND_INFO_API_BASE=https://labc.ablesdxd.link/exportLendInfo \
TOP_ACCOUNT_API_BASE=https://labc.ablesdxd.link/admin/justlend/getDailyTopAccountDetails \
SOURCE_ADAPTER=json-export node snapshot-job.js
```

If the target date is missing from either daily endpoint, the job records a failed `job_run`, keeps serving the previous usable SQLite snapshot, and does not silently publish a snapshot with stale `Data Through`.

When the Top Account endpoint blocks the VPS IP, fetch the previous UTC day locally and upload it before the VPS snapshot job runs:

```bash
LABC_ACCESS_TOKEN=... \
UPLOAD_TO_VPS=true \
VPS_SSH_KEY=/Users/lanyu/OpenClaw/openclaw2.pem \
VPS_SSH_PORT=6673 \
VPS_SOURCE_CSV_TARGET=openclaw@43.134.57.52:/home/openclaw/project/justlend-capital-data/source/ \
node scripts/sync-top-account-daily.js
```

The VPS job can then use `AUTO_FETCH_LEND_INFO_DAILY=true` and `AUTO_FETCH_TOP_ACCOUNT_DAILY=false`: it fetches Lend Info itself, requires `top-account-daily-{targetDate}.csv` to have been uploaded, and fails loudly if that file is absent.

Chain path enrichment is intentionally off by default:

```bash
CHAIN_ENRICHMENT_ENABLED=true CHAIN_PROVIDER=tronscan CHAIN_LOOKBACK_TOP_LOST_LIMIT=10 node snapshot-job.js
```

When enabled, the job reverse-looks up Top20 Lost addresses only. Hop 1 first searches `outflowTime - 3D` to `outflowTime + 24h`, pairs JustLend redeem inflows with the following 24h user transfer when possible, and falls back to the largest expanded-window transfer. Hop 2 follows the Hop 1 counterparty for 7D and is written as weak/detail-only attribution.

If no export snapshot exists, the job uses `data/daily-snapshot.json` as a fallback so the SQLite pipeline can still be verified. `existing-db` is intentionally reserved for read-only schema discovery until the production table mapping is confirmed:

```bash
SOURCE_ADAPTER=existing-db EXISTING_DB_DSN=... node snapshot-job.js --discover-existing-db
```

External refresh is off by default. Set `EXTERNAL_FETCH_ENABLED=true` to try DeFiLlama TVL and CoinMarketCap quote checks during the job. Failures are written to Data Quality and do not overwrite the existing source snapshot.

## MVP Coverage

- Overview with 90D core conclusion and main anomaly signals.
- Market Comparison using JustLend vs competitor TVL median.
- Borrow Demand with `borrow_usd`, `borrow_amount`, utilization, and APY checks.
- Capital Outflow with Top20 Current, Top20 Lost, Round Trip, Destination Ranking, Attribution Detail.
- Capital Outflow summary explicitly keeps `net_outflow_usd` as an auxiliary metric, not a loss decision rule.
- Round Trip Detail includes row-level time away plus returned / partially returned / not returned status.
- Settings / Data Config with Thresholds, Internal Address, Asset Scope, Data Sources, and Attribution Rules tabs.
- Internal Address configuration displays Top20, Flow, and Alert exclusion state.
- Top20 Current and Top20 Lost render 20 rows from the latest Daily Snapshot, and the snapshot job persists them to `fact_top_holder_daily` and `fact_top_lost_holder_daily`.
- Top Account CSV can persist daily address-level facts to `fact_user_position_daily` and `fact_user_asset_position_daily`.
- exportLendInfo can persist real asset-level Borrow Demand metrics to `fact_asset_daily_metrics`.
- Hop / Round Trip chain paths can be enriched from TronScan or TronGrid for Top20 Lost only.
- Borrow Demand asset metrics are persisted to `fact_asset_daily_metrics`.
- Threshold changes update the current view and are recorded in the SQLite threshold change log when the store is available.
- Admin login protects Settings / Data Config and every Settings read/write API. Public analytical pages remain viewable without login.

## API

Compatibility endpoints:

- `GET /api/config`
- `GET /api/snapshot`

PRD v1 endpoints implemented against the latest SQLite Daily Snapshot, with mock fallback:

- `GET /api/v1/overview?period=90d`
- `GET /api/v1/overview?period=30d`
- `GET /api/v1/overview?period=7d`
- `GET /api/v1/market-comparison?period=90d`
- `GET /api/v1/borrow-demand?period=90d&asset=USDT`
- `GET /api/v1/capital-outflow/summary?period=90d`
- `GET /api/v1/capital-outflow/top-current?period=90d`
- `GET /api/v1/capital-outflow/top-lost?period=90d`
- `GET /api/v1/capital-outflow/round-trip?period=90d`
- `GET /api/v1/capital-outflow/destinations?period=90d`
- `GET /api/v1/capital-outflow/attribution-detail?period=90d`
- `GET /api/v1/settings/internal-addresses`
- `POST /api/v1/settings/internal-addresses`
- `POST /api/v1/settings/internal-addresses/import`
- `PATCH /api/v1/settings/internal-addresses/{address}`
- `GET /api/v1/settings/internal-addresses/change-log`
- `GET /api/v1/settings/thresholds`
- `PATCH /api/v1/settings/thresholds/{threshold_key}`
- `GET /api/v1/settings/thresholds/change-log`
- `GET /api/v1/settings/data-sources`
- `GET /api/v1/settings/asset-scope`
- `GET /api/v1/settings/attribution-rules`
- `GET /api/v1/export.csv?dataset=borrow-demand&period=90d`

Auth endpoints:

- `GET /api/v1/auth/session`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`

Settings endpoints require an admin session cookie. Configure `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `SESSION_SECRET` through environment variables. Unauthenticated Settings requests return `401`.

Settings writes persist to SQLite when the store is available. Runtime memory remains as a fallback.

CSV export is enabled for analytical views only. Supported `dataset` values:

- `overview-signals`
- `market-comparison`
- `borrow-demand`
- `top-current`
- `top-lost`
- `round-trip`
- `destinations`
- `attribution-detail`

Settings, internal addresses, and change logs are intentionally not exported.

## Verify

Static MVP checks:

```bash
node verify-mvp.js
```

Static checks plus local API checks:

```bash
node verify-mvp.js --api=http://127.0.0.1:8791
```

Production pipeline checks after running `snapshot-job.js`:

```bash
node verify-mvp.js --sqlite=./data/capital-intelligence.sqlite
```

## Deployment Preparation

Before deploying to GitHub/VPS, configure the runtime environment outside the repository:

- `LEND_INFO_CSV_URL`: production exportLendInfo CSV endpoint.
- `TOP_ACCOUNT_CSV_FILES`: comma-separated absolute paths to the latest DailyTopAccountList CSV exports.
- `SQLITE_DB_PATH`: persistent VPS path, for example `/var/lib/justlend-capital/capital-intelligence.sqlite`.
- `EXTERNAL_FETCH_ENABLED=true`: refresh DeFiLlama competitor TVL during the daily job.
- `CMC_API_KEY`: optional for independent CoinMarketCap quote checks; asset valuation currently uses exportLendInfo reference prices.
- `CHAIN_ENRICHMENT_ENABLED=true`: enable bounded Top20 Lost chain lookup after API quota and window rules are confirmed.
- `CHAIN_LOOKBACK_TOP_LOST_LIMIT`: start small, then increase after TronScan/TronGrid quota validation.

Recommended VPS process split:

- Web service: `node server.js`, read-only against latest SQLite snapshot.
- Daily job: run `node snapshot-job.js` after UTC 00:00, once the latest complete UTC date is available.
- Storage: keep SQLite and CSV exports outside the git checkout, with backups for the SQLite directory.
- Secrets: keep endpoint tokens and API keys in VPS environment variables or a secret manager, never in git.

Example daily job command:

```bash
cd /opt/justlend-capital/live-dashboard
SOURCE_ADAPTER=json-export \
LEND_INFO_CSV_URL="$LEND_INFO_CSV_URL" \
TOP_ACCOUNT_CSV_FILES="$TOP_ACCOUNT_CSV_FILES" \
SQLITE_DB_PATH="/var/lib/justlend-capital/capital-intelligence.sqlite" \
EXTERNAL_FETCH_ENABLED=true \
CHAIN_ENRICHMENT_ENABLED=true \
CHAIN_PROVIDER=tronscan \
CHAIN_LOOKBACK_TOP_LOST_LIMIT=10 \
node snapshot-job.js
```

Deployment gates:

- `node verify-mvp.js`
- `node verify-mvp.js --sqlite="$SQLITE_DB_PATH"`
- `node verify-mvp.js --api=http://127.0.0.1:<port> --sqlite="$SQLITE_DB_PATH"`
- API Data Quality includes `Lend Info CSV`, `Top Account CSV`, `DeFiLlama`, and `SQLite Application Store`.
- If chain enrichment is enabled, `/api/v1/capital-outflow/destinations?period=90d` should show labeled destinations when TronScan/TronGrid finds matching transfers. Current matching logic supports JustLend redeem-inflow to 24h user-transfer pairing and expanded-window fallback.

## Current Limitations

- `existing-db` ingestion needs production schema mapping before it can replace `json-export`.
- CoinMarketCap is checked through API only when `EXTERNAL_FETCH_ENABLED=true`; full asset-level repricing remains dependent on source export readiness.
- Top Account CSV is a Top Account list, not a complete user universe. Missing address-date rows are treated as top-list absence, not silently as full protocol zero balance.
- Chain path enrichment is bounded to Top20 Lost candidates and is disabled by default to avoid high-cost chain scans.
- Protocol Borrow connectors are TODO.
- Authentication is MVP-scoped to a single admin account from environment variables. Multi-user admin management, password reset, and audit login tables are not implemented.
