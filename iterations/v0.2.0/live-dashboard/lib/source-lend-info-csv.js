const { parseCsv } = require("./source-top-account-csv");

const DAY_MS = 24 * 60 * 60 * 1000;

function toNumber(value) {
  const number = Number(String(value ?? "").trim());
  return Number.isFinite(number) ? number : 0;
}

function pctChange(start, end) {
  if (!Number.isFinite(start) || start === 0) return null;
  return ((end - start) / start) * 100;
}

function addDays(date, days) {
  const time = new Date(`${date}T00:00:00.000Z`).getTime();
  return new Date(time + days * DAY_MS).toISOString().slice(0, 10);
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function round(value, decimals = 0) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function supportedAssets(config) {
  return new Set((config.assets || []).filter((item) => item.enabled !== false).map((item) => item.symbol));
}

function normalizeRows(rows, config) {
  const assets = supportedAssets(config);
  return rows
    .filter((row) => assets.has(row["币种"]))
    .map((row) => {
      const asset = row["币种"];
      const priceUsd = toNumber(row["参考价格"]);
      const supplyAmount = toNumber(row["存款总量"]);
      const borrowAmount = toNumber(row["借款总量"]);
      const depositFlowAmount = toNumber(row["存款日流水额"]);
      const withdrawFlowAmount = toNumber(row["提现日流水额"]);
      const borrowFlowAmount = toNumber(row["借款日流水额"]);
      const repayFlowAmount = toNumber(row["还款日流水额"]);
      const liquidationAmount = toNumber(row["被清算数额"]);
      const liquidityAmount = toNumber(row["流动性"]);
      return {
        snapshotDate: row["日期"],
        asset,
        priceUsd,
        supplyAmount,
        borrowAmount,
        supplyUsd: supplyAmount * priceUsd,
        borrowUsd: borrowAmount * priceUsd,
        depositFlowUsd: depositFlowAmount * priceUsd,
        withdrawFlowUsd: withdrawFlowAmount * priceUsd,
        borrowFlowUsd: borrowFlowAmount * priceUsd,
        repayFlowUsd: repayFlowAmount * priceUsd,
        liquidationUsd: liquidationAmount * priceUsd,
        liquidityUsd: liquidityAmount * priceUsd,
        supplyAddressCount: toNumber(row["存款地址总量"]),
        borrowAddressCount: toNumber(row["借款地址总量"]),
        totalSupplyUsers: toNumber(row["总存款人数"]),
        totalBorrowUsers: toNumber(row["总借款人数"]),
        source: "lend-info-csv"
      };
    });
}

function datesFrom(rows) {
  return [...new Set(rows.map((item) => item.snapshotDate))].sort();
}

function rowsByDate(rows, date) {
  return rows.filter((item) => item.snapshotDate === date);
}

function totals(rows) {
  const supplyUsd = rows.reduce((sum, item) => sum + item.supplyUsd, 0);
  const borrowUsd = rows.reduce((sum, item) => sum + item.borrowUsd, 0);
  return {
    tvlUsd: supplyUsd,
    supplyUsd,
    borrowUsd,
    utilization: supplyUsd > 0 ? (borrowUsd / supplyUsd) * 100 : 0,
    liquidityUsd: rows.reduce((sum, item) => sum + item.liquidityUsd, 0),
    depositFlowUsd: rows.reduce((sum, item) => sum + item.depositFlowUsd, 0),
    withdrawFlowUsd: rows.reduce((sum, item) => sum + item.withdrawFlowUsd, 0),
    borrowFlowUsd: rows.reduce((sum, item) => sum + item.borrowFlowUsd, 0),
    repayFlowUsd: rows.reduce((sum, item) => sum + item.repayFlowUsd, 0),
    liquidationUsd: rows.reduce((sum, item) => sum + item.liquidationUsd, 0)
  };
}

function selectWindow(rows, days) {
  const dates = datesFrom(rows);
  const latestDate = dates.at(-1);
  if (!latestDate) return { rows: [], dates: [], latestDate: null, startDate: null };
  const requestedStart = addDays(latestDate, -(days - 1));
  const windowDates = dates.filter((date) => date >= requestedStart && date <= latestDate);
  return {
    rows: rows.filter((item) => windowDates.includes(item.snapshotDate)),
    dates: windowDates,
    latestDate,
    startDate: windowDates[0]
  };
}

function buildBorrowDemand(windowRows, startDate, latestDate, snapshot, config) {
  const previousByAsset = new Map((snapshot.borrowDemand?.assets || []).map((item) => [item.asset, item]));
  return (config.assets || [])
    .filter((assetConfig) => assetConfig.enabled !== false)
    .map((assetConfig) => {
      const asset = assetConfig.symbol;
      const latest = rowsByDate(windowRows, latestDate).find((item) => item.asset === asset);
      const start = rowsByDate(windowRows, startDate).find((item) => item.asset === asset);
      const previous = previousByAsset.get(asset) || {};
      if (!latest) {
        return {
          asset,
          supplyUsd: 0,
          supplyChangePct: null,
          borrowAmount: 0,
          borrowAmountChangePct: null,
          borrowUsd: 0,
          borrowUsdChangePct: null,
          assetPriceChangePct: null,
          utilization: 0,
          utilizationChangePct: null,
          borrowApy: finiteOr(previous.borrowApy, 0),
          borrowApyChangePct: finiteOr(previous.borrowApyChangePct, 0),
          supplyApy: finiteOr(previous.supplyApy, 0),
          supplyApyChangePct: finiteOr(previous.supplyApyChangePct, 0),
          source: "lend-info-csv-missing-asset"
        };
      }
      const latestUtilization = latest.supplyUsd > 0 ? (latest.borrowUsd / latest.supplyUsd) * 100 : 0;
      const startUtilization = start?.supplyUsd > 0 ? (start.borrowUsd / start.supplyUsd) * 100 : null;
      return {
        asset,
        supplyUsd: Math.round(latest.supplyUsd),
        supplyChangePct: round(pctChange(start?.supplyUsd, latest.supplyUsd), 1),
        borrowAmount: round(latest.borrowAmount, 6),
        borrowAmountChangePct: round(pctChange(start?.borrowAmount, latest.borrowAmount), 1),
        borrowUsd: Math.round(latest.borrowUsd),
        borrowUsdChangePct: round(pctChange(start?.borrowUsd, latest.borrowUsd), 1),
        assetPriceChangePct: round(pctChange(start?.priceUsd, latest.priceUsd), 1),
        utilization: round(latestUtilization, 1),
        utilizationChangePct: startUtilization === null ? null : round(latestUtilization - startUtilization, 1),
        borrowApy: finiteOr(previous.borrowApy, 0),
        borrowApyChangePct: finiteOr(previous.borrowApyChangePct, 0),
        supplyApy: finiteOr(previous.supplyApy, 0),
        supplyApyChangePct: finiteOr(previous.supplyApyChangePct, 0),
        depositFlowUsd: Math.round(latest.depositFlowUsd),
        withdrawFlowUsd: Math.round(latest.withdrawFlowUsd),
        borrowFlowUsd: Math.round(latest.borrowFlowUsd),
        repayFlowUsd: Math.round(latest.repayFlowUsd),
        liquidityUsd: Math.round(latest.liquidityUsd),
        source: "lend-info-csv"
      };
    });
}

function sampleTrend(windowRows, dates, previousTrend = []) {
  if (!dates.length) return previousTrend;
  const points = [];
  const step = Math.max(1, Math.floor((dates.length - 1) / 6));
  for (let index = 0; index < dates.length; index += step) points.push(dates[index]);
  if (!points.includes(dates.at(-1))) points.push(dates.at(-1));
  return points.slice(-7).map((date, index) => ({
    date,
    justlendTvl: Math.round(totals(rowsByDate(windowRows, date)).tvlUsd),
    competitorMedianTvl: finiteOr(previousTrend[index]?.competitorMedianTvl, 100)
  }));
}

function periodKey(days) {
  return `${days}d`;
}

function normalizeMarketComparison(value) {
  if (value?.marketComparison && value?.overview) return value.marketComparison;
  return value || {};
}

function buildPeriodView(snapshot, config, normalizedRows, days) {
  const window = selectWindow(normalizedRows, days);
  if (!window.latestDate || !window.startDate) return null;

  const latestTotals = totals(rowsByDate(window.rows, window.latestDate));
  const startTotals = totals(rowsByDate(window.rows, window.startDate));
  const windowTotals = totals(window.rows);
  const tvlChangePct = round(pctChange(startTotals.tvlUsd, latestTotals.tvlUsd), 1);
  const borrowChangePct = round(pctChange(startTotals.borrowUsd, latestTotals.borrowUsd), 1);
  const supplyChangePct = round(pctChange(startTotals.supplyUsd, latestTotals.supplyUsd), 1);
  const utilizationChangePct = round(latestTotals.utilization - startTotals.utilization, 1);
  const borrowDemand = {
    assets: buildBorrowDemand(window.rows, window.startDate, window.latestDate, snapshot, config)
  };
  const baseMarketComparison = normalizeMarketComparison(snapshot.marketComparison);
  const competitorMedian = baseMarketComparison.competitorMedian || {};
  const competitorTvlChangePct = competitorMedian.tvlChangePct;
  const key = periodKey(days);
  const overview = {
    ...snapshot.overview,
    headline: `JustLend ${key.toUpperCase()} 资产级存借数据已接入真实快照，Top20 未回流资金是主要异常信号。`,
    kpis: {
      ...(snapshot.overview?.kpis || {}),
      tvlUsd: Math.round(latestTotals.tvlUsd),
      tvlChangePct,
      supplyUsd: Math.round(latestTotals.supplyUsd),
      supplyChangePct,
      borrowUsd: Math.round(latestTotals.borrowUsd),
      borrowChangePct,
      utilization: round(latestTotals.utilization, 1),
      utilizationChangePct,
      netFlowUsd: Math.round(windowTotals.depositFlowUsd - windowTotals.withdrawFlowUsd)
    }
  };

  return {
    period: key,
    periodStart: `${window.startDate}T00:00:00.000Z`,
    periodEnd: `${window.latestDate}T00:00:00.000Z`,
    lastCompleteUtcDate: window.latestDate,
    overview,
    borrowDemand,
    marketComparison: {
      ...baseMarketComparison,
      justlend: {
        ...(baseMarketComparison.justlend || {}),
        protocolId: "justlend",
        name: "JustLend",
        tvlUsd: Math.round(latestTotals.tvlUsd),
        tvlChangePct,
        borrowUsd: Math.round(latestTotals.borrowUsd),
        borrowChangePct
      },
      relative: {
        ...(baseMarketComparison.relative || {}),
        tvlUnderperformancePctPoint: Number.isFinite(competitorTvlChangePct) && Number.isFinite(tvlChangePct)
          ? round(competitorTvlChangePct - tvlChangePct, 1)
          : null,
        borrowUnderperformancePctPoint: null
      },
      trend: sampleTrend(window.rows, window.dates, baseMarketComparison.trend || [])
    }
  };
}

function buildSnapshot(snapshot, config, normalizedRows) {
  const windows = [7, 30, 90];
  const periodViews = {};
  for (const days of windows) {
    const view = buildPeriodView(snapshot, config, normalizedRows, days);
    if (view?.period === periodKey(days) && view.periodStart && view.periodEnd) periodViews[periodKey(days)] = view;
  }
  const primary = periodViews["90d"];
  if (!primary) return snapshot;

  return {
    ...snapshot,
    ...primary,
    period: "90d",
    status: {
      ...(snapshot.status || {}),
      summary: "Production asset-level lending metrics are loaded from exportLendInfo; 7D/30D/90D period views are calculated from real daily rows.",
      dataQualityLevel: "PARTIAL_PRODUCTION"
    },
    periodViews: {
      ...(snapshot.periodViews || {}),
      ...periodViews
    },
    dataQuality: (snapshot.dataQuality || []).filter((item) => item.source !== "Daily Snapshot")
  };
}

async function enrichLendInfoCsv({ snapshot, config, paths }) {
  if (!paths.lendInfoCsvUrl) {
    return {
      snapshot,
      dataQuality: [
        {
          source: "Lend Info CSV",
          status: "todo",
          message: "LEND_INFO_CSV_URL is not configured; Overview and Borrow Demand remain sourced from the base snapshot."
        }
      ]
    };
  }

  try {
    const response = await fetch(paths.lendInfoCsvUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rawRows = parseCsv(await response.text());
    const normalizedRows = normalizeRows(rawRows, config);
    const nextSnapshot = buildSnapshot(snapshot, config, normalizedRows);
    const dates = datesFrom(normalizedRows);
    return {
      snapshot: nextSnapshot,
      dataQuality: [
        {
          source: "Lend Info CSV",
          status: normalizedRows.length ? "complete" : "error",
          message: normalizedRows.length
            ? `Loaded ${rawRows.length} exportLendInfo rows, kept ${normalizedRows.length} MVP asset rows across ${dates.length} days, and generated real 7D/30D/90D asset-level period views.`
            : "exportLendInfo responded, but no MVP asset rows were found."
        },
        {
          source: "Asset APY",
          status: "partial",
          message: "exportLendInfo does not include APY; Borrow Demand keeps APY values from the base snapshot until a rate source is connected."
        }
      ]
    };
  } catch (error) {
    return {
      snapshot,
      dataQuality: [
        {
          source: "Lend Info CSV",
          status: "error",
          message: `Failed to load exportLendInfo: ${error.message}.`
        }
      ]
    };
  }
}

module.exports = {
  enrichLendInfoCsv
};
