const fs = require("node:fs/promises");
const path = require("node:path");

const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_CHAIN_LOOKUP = "待链上归因";

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map((item) => item.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""]));
  });
}

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

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

function sortDates(rows) {
  return [...new Set(rows.map((item) => item.snapshotDate))].sort();
}

function normalizeAddress(value) {
  return String(value || "").trim().replace(/^['"`]+|['"`]+$/g, "");
}

function buildMarketMap(config) {
  return new Map((config.assets || [])
    .filter((asset) => asset.marketId)
    .map((asset) => [asset.marketId, asset.symbol]));
}

function buildExcludedAddressSet(config, snapshot) {
  const excluded = new Set();
  for (const item of snapshot.settings?.internalAddresses || []) {
    if (item.excludeFromTopHolder !== false) excluded.add(normalizeAddress(item.address));
  }
  for (const asset of config.assets || []) {
    if (asset.marketId) excluded.add(normalizeAddress(asset.marketId));
    if (asset.contractAddress) excluded.add(normalizeAddress(asset.contractAddress));
  }
  return excluded;
}

async function loadTrxUsdByDate(paths) {
  if (!paths.lendInfoCsvUrl && !paths.lendInfoCsvFiles?.length && !Number.isFinite(paths.topAccountTrxUsd)) return { prices: new Map(), quality: null };
  if (!paths.lendInfoCsvUrl) {
    const prices = new Map();
    for (const filePath of paths.lendInfoCsvFiles || []) {
      const rows = parseCsv(await fs.readFile(path.resolve(filePath), "utf8"));
      for (const row of rows) {
        if (row["币种"] === "TRX") prices.set(row["日期"], toNumber(row["参考价格"]));
      }
    }
    if (prices.size) {
      return {
        prices,
        fallback: Number.isFinite(paths.topAccountTrxUsd) ? paths.topAccountTrxUsd : null,
        quality: {
          source: "TRX USD Price",
          status: "complete",
          message: `Loaded ${prices.size} daily TRX/USD prices from lend info CSV files.`
        }
      };
    }
    return {
      prices,
      fallback: paths.topAccountTrxUsd,
      quality: {
        source: "TRX USD Price",
        status: "partial",
        message: `Top Account CSV valuation uses TOP_ACCOUNT_TRX_USD=${paths.topAccountTrxUsd}; per-day TRX/USD export is not configured.`
      }
    };
  }

  try {
    const response = await fetch(paths.lendInfoCsvUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = parseCsv(await response.text());
    const prices = new Map();
    for (const row of rows) {
      if (row["币种"] === "TRX") prices.set(row["日期"], toNumber(row["参考价格"]));
    }
    for (const filePath of paths.lendInfoCsvFiles || []) {
      const fileRows = parseCsv(await fs.readFile(path.resolve(filePath), "utf8"));
      for (const row of fileRows) {
        if (row["币种"] === "TRX") prices.set(row["日期"], toNumber(row["参考价格"]));
      }
    }
    return {
      prices,
      fallback: Number.isFinite(paths.topAccountTrxUsd) ? paths.topAccountTrxUsd : null,
      quality: {
        source: "TRX USD Price",
        status: prices.size ? "complete" : "partial",
        message: prices.size
          ? `Loaded ${prices.size} daily TRX/USD prices from lend info export.`
          : "Lend info export responded, but no TRX price rows were found."
      }
    };
  } catch (error) {
    return {
      prices: new Map(),
      fallback: Number.isFinite(paths.topAccountTrxUsd) ? paths.topAccountTrxUsd : null,
      quality: {
        source: "TRX USD Price",
        status: "error",
        message: `Failed to load TRX/USD from lend info export: ${error.message}.`
      }
    };
  }
}

async function readTopAccountRows(files) {
  const rows = [];
  const seen = new Set();
  for (const filePath of files) {
    const absolutePath = path.resolve(filePath);
    const parsed = parseCsv(await fs.readFile(absolutePath, "utf8"));
    for (const row of parsed) {
      const dedupeKey = JSON.stringify(row);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      rows.push({ ...row, sourceFile: absolutePath });
    }
  }
  return rows;
}

function aggregateRows(rows, config, snapshot, trxPriceState) {
  const marketMap = buildMarketMap(config);
  const excludedAddresses = buildExcludedAddressSet(config, snapshot);
  const userAssetByKey = new Map();

  for (const row of rows) {
    const asset = marketMap.get(row["市场"]);
    const address = normalizeAddress(row["用户地址"]);
    if (!asset || !address || excludedAddresses.has(address)) continue;

    const snapshotDate = row["日期"];
    const trxUsd = trxPriceState.prices.get(snapshotDate) || trxPriceState.fallback;
    if (!Number.isFinite(trxUsd) || trxUsd <= 0) continue;

    const supplyAmount = toNumber(row["存款(jToken)"]) * toNumber(row["jToken兌換率"]);
    const borrowAmount = toNumber(row["借贷(token)"]);
    const priceInTrx = toNumber(row["当日价格(TRX)"]);
    const supplyUsd = supplyAmount * priceInTrx * trxUsd;
    const borrowUsd = borrowAmount * priceInTrx * trxUsd;
    const key = `${snapshotDate}|${address}|${asset}`;
    const previous = userAssetByKey.get(key) || {
      snapshotDate,
      userAddress: address,
      asset,
      supplyAmount: 0,
      supplyUsd: 0,
      borrowAmount: 0,
      borrowUsd: 0,
      source: "top-account-csv"
    };
    previous.supplyAmount += supplyAmount;
    previous.supplyUsd += supplyUsd;
    previous.borrowAmount += borrowAmount;
    previous.borrowUsd += borrowUsd;
    previous.priceInTrx = priceInTrx;
    previous.trxUsd = trxUsd;
    userAssetByKey.set(key, previous);
  }

  const userAssetPositions = [...userAssetByKey.values()];
  const userPositions = aggregateUserPositions(userAssetPositions);
  return { userAssetPositions, userPositions, excludedAddresses };
}

function aggregateUserPositions(userAssetPositions) {
  const byUserDate = new Map();
  for (const item of userAssetPositions) {
    const key = `${item.snapshotDate}|${item.userAddress}`;
    const previous = byUserDate.get(key) || {
      snapshotDate: item.snapshotDate,
      userAddress: item.userAddress,
      supplyUsd: 0,
      borrowUsd: 0,
      assets: {}
    };
    previous.supplyUsd += item.supplyUsd;
    previous.borrowUsd += item.borrowUsd;
    previous.assets[item.asset] = (previous.assets[item.asset] || 0) + item.supplyUsd;
    byUserDate.set(key, previous);
  }
  return [...byUserDate.values()].map((item) => ({
    snapshotDate: item.snapshotDate,
    userAddress: item.userAddress,
    supplyUsd: item.supplyUsd,
    borrowUsd: item.borrowUsd,
    netPositionUsd: item.supplyUsd - item.borrowUsd,
    primaryAsset: Object.entries(item.assets).sort((a, b) => b[1] - a[1])[0]?.[0] || ""
  }));
}

function unitUsd(position) {
  const amount = Number(position?.supplyAmount || 0);
  const usd = Number(position?.supplyUsd || 0);
  return amount > 0 && Number.isFinite(usd) ? usd / amount : 0;
}

function groupAssetPositions(userAssetPositions, dates) {
  const dateSet = new Set(dates);
  const byAddressAsset = new Map();
  for (const item of userAssetPositions.filter((position) => dateSet.has(position.snapshotDate))) {
    const key = `${item.userAddress}|${item.asset}`;
    if (!byAddressAsset.has(key)) byAddressAsset.set(key, []);
    byAddressAsset.get(key).push(item);
  }
  for (const rows of byAddressAsset.values()) {
    rows.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  }
  return byAddressAsset;
}

function assetWithdrawalRows(beginning, assetPositionsByAddress, latestDate) {
  const rows = [];
  const prefix = `${beginning.userAddress}|`;
  for (const [key, history] of assetPositionsByAddress.entries()) {
    if (!key.startsWith(prefix)) continue;
    const beginningPosition = history.find((item) => item.snapshotDate === beginning.snapshotDate);
    if (!beginningPosition || beginningPosition.supplyAmount <= 0) continue;
    const latestPosition = history.find((item) => item.snapshotDate === latestDate) || history.at(-1);
    const minPosition = history.reduce((min, item) => (
      item.supplyAmount < min.supplyAmount ? item : min
    ), beginningPosition);
    const grossWithdrawAmount = Math.max(0, beginningPosition.supplyAmount - minPosition.supplyAmount);
    const unreturnedAmount = Math.max(0, beginningPosition.supplyAmount - (latestPosition?.supplyAmount || 0));
    if (grossWithdrawAmount <= 0 && unreturnedAmount <= 0) continue;
    const valuationPosition = latestPosition || minPosition;
    const grossWithdrawUsd = grossWithdrawAmount * unitUsd(valuationPosition);
    const unreturnedOutflowUsd = unreturnedAmount * unitUsd(valuationPosition);
    const returnedOutflowUsd = Math.max(0, grossWithdrawUsd - unreturnedOutflowUsd);
    rows.push({
      asset: beginningPosition.asset,
      grossWithdrawAmount,
      unreturnedAmount,
      grossWithdrawUsd,
      returnedOutflowUsd,
      unreturnedOutflowUsd,
      outflowDate: minPosition.snapshotDate,
      beginningSupplyUsd: beginningPosition.supplyUsd,
      endingSupplyUsd: latestPosition?.supplyUsd || 0,
      priceEffectUsd: Math.max(0, (beginningPosition.supplyUsd - (latestPosition?.supplyUsd || 0)) - unreturnedOutflowUsd)
    });
  }
  return rows;
}

function selectWindowDates(dates, latestDate, days) {
  const start = addDays(latestDate, -(days - 1));
  return dates.filter((date) => date >= start && date <= latestDate);
}

function periodKey(days) {
  return `${days}d`;
}

function latestTop20(userPositions, latestDate) {
  return userPositions
    .filter((item) => item.snapshotDate === latestDate)
    .sort((a, b) => b.supplyUsd - a.supplyUsd)
    .slice(0, 20)
    .map((item, index) => ({
      rank: index + 1,
      address: item.userAddress,
      supplyUsd: Math.round(item.supplyUsd),
      borrowUsd: Math.round(item.borrowUsd),
      netPositionUsd: Math.round(item.netPositionUsd),
      primaryAsset: item.primaryAsset,
      unreturnedOutflowUsd: 0,
      returnRatePct: 100,
      source: "top-account-csv"
    }));
}

function top20Lost(userPositions, userAssetPositions, latestDate, days) {
  const dates = selectWindowDates(sortDates(userPositions), latestDate, days);
  const earliestDate = dates[0];
  const assetPositionsByAddress = groupAssetPositions(userAssetPositions, dates);

  const beginningTop = userPositions
    .filter((item) => item.snapshotDate === earliestDate)
    .sort((a, b) => b.supplyUsd - a.supplyUsd)
    .slice(0, 20);

  return beginningTop.map((beginning) => {
    const withdrawals = assetWithdrawalRows(beginning, assetPositionsByAddress, latestDate);
    const grossWithdrawUsd = withdrawals.reduce((sum, item) => sum + item.grossWithdrawUsd, 0);
    const unreturnedOutflowUsd = withdrawals.reduce((sum, item) => sum + item.unreturnedOutflowUsd, 0);
    const returnedOutflowUsd = Math.max(0, grossWithdrawUsd - unreturnedOutflowUsd);
    const returnRatePct = grossWithdrawUsd > 0 ? (returnedOutflowUsd / grossWithdrawUsd) * 100 : 100;
    const primary = withdrawals
      .sort((a, b) => b.unreturnedOutflowUsd - a.unreturnedOutflowUsd || b.grossWithdrawUsd - a.grossWithdrawUsd)[0];
    const status = grossWithdrawUsd === 0
      ? "returned"
      : unreturnedOutflowUsd <= 1
        ? "returned"
        : returnedOutflowUsd > 0
          ? "partially_returned"
          : "not_returned";
    return {
      address: beginning.userAddress,
      beginningSupplyUsd: Math.round(beginning.supplyUsd),
      grossWithdrawUsd: Math.round(grossWithdrawUsd),
      returnedOutflowUsd: Math.round(returnedOutflowUsd),
      unreturnedOutflowUsd: Math.round(unreturnedOutflowUsd),
      returnRatePct: Number(returnRatePct.toFixed(1)),
      topDestination: PENDING_CHAIN_LOOKUP,
      primaryAsset: primary?.asset || beginning.primaryAsset,
      outflowTime: `${primary?.outflowDate || latestDate}T00:00:00.000Z`,
      status,
      source: "top-account-csv",
      outflowBasis: "supply_amount_delta",
      priceEffectUsd: Math.round(withdrawals.reduce((sum, item) => sum + item.priceEffectUsd, 0))
    };
  }).filter((item) => item.grossWithdrawUsd > 0)
    .sort((a, b) => b.unreturnedOutflowUsd - a.unreturnedOutflowUsd)
    .slice(0, 20)
    .map((item, index) => ({ rank: index + 1, ...item }));
}

function buildRoundTrips(topLost, latestDate) {
  return topLost.map((item, index) => {
    const outflowUsd = item.grossWithdrawUsd || item.unreturnedOutflowUsd;
    const returnedUsd = item.returnedOutflowUsd || 0;
    return {
      roundTripId: `${latestDate}-position-rt-${index + 1}`,
      address: item.address,
      outflowTime: item.outflowTime,
      outflowAsset: item.primaryAsset,
      outflowUsd,
      strongDestination: PENDING_CHAIN_LOOKUP,
      destinationCategory: "Unknown",
      weakDestination: null,
      returnTime: returnedUsd > 0 ? `${latestDate}T00:00:00.000Z` : null,
      returnAsset: item.primaryAsset,
      returnUsd: returnedUsd,
      returnMarket: returnedUsd > 0 ? `j${item.primaryAsset}` : null,
      timeAwayHours: Math.max(24, (new Date(`${latestDate}T00:00:00.000Z`).getTime() - new Date(item.outflowTime).getTime()) / (60 * 60 * 1000)),
      status: item.status,
      source: "top-account-csv-position-delta"
    };
  });
}

function buildCapitalOutflow(snapshot, topCurrent, topLost, latestDate) {
  const roundTrips = buildRoundTrips(topLost, latestDate);
  const totalGrossWithdrawUsd = topLost.reduce((sum, item) => sum + item.grossWithdrawUsd, 0);
  const totalReturnedOutflowUsd = topLost.reduce((sum, item) => sum + item.returnedOutflowUsd, 0);
  const totalUnreturnedOutflowUsd = topLost.reduce((sum, item) => sum + item.unreturnedOutflowUsd, 0);
  const beginningSupplyUsd = topLost.reduce((sum, item) => sum + item.beginningSupplyUsd, 0);
  const summary = {
    ...(snapshot.capitalOutflow?.summary || {}),
    beginningSupplyUsd: Math.round(beginningSupplyUsd),
    grossWithdrawUsd: Math.round(totalGrossWithdrawUsd),
    returnedOutflowUsd: Math.round(totalReturnedOutflowUsd),
    unreturnedOutflowUsd: Math.round(totalUnreturnedOutflowUsd),
    netOutflowUsd: Math.round(totalUnreturnedOutflowUsd),
    unreturnedOutflowRatioPct: beginningSupplyUsd > 0 ? Number(((totalUnreturnedOutflowUsd / beginningSupplyUsd) * 100).toFixed(2)) : 0,
    returnRatePct: totalGrossWithdrawUsd > 0 ? Number(((totalReturnedOutflowUsd / totalGrossWithdrawUsd) * 100).toFixed(1)) : 100,
    unknownStrongAttributionPct: 100,
    top20BeginningSupplyUsd: Math.round(beginningSupplyUsd),
    totalGrossWithdrawUsd: Math.round(totalGrossWithdrawUsd),
    totalReturnedOutflowUsd: Math.round(totalReturnedOutflowUsd),
    totalUnreturnedOutflowUsd: Math.round(totalUnreturnedOutflowUsd),
    source: "top-account-csv"
  };

  return {
    ...(snapshot.capitalOutflow || {}),
    summary,
    top20Current: topCurrent,
    top20Lost: topLost,
    roundTrips,
    destinations: [
      {
        destination: PENDING_CHAIN_LOOKUP,
        category: "Unknown",
        amountUsd: Math.round(totalUnreturnedOutflowUsd),
        sharePct: 100,
        walletCount: topLost.filter((item) => item.unreturnedOutflowUsd > 0).length,
        attribution: "unknown"
      }
    ],
    attributionDetails: topLost.slice(0, 20).map((item, index) => ({
      pathId: `${latestDate}-pending-path-${index + 1}`,
      hop: 1,
      address: item.address,
      amountUsd: item.unreturnedOutflowUsd,
      destination: PENDING_CHAIN_LOOKUP,
      category: "Unknown",
      confidence: 0,
      attribution: "unknown",
      usedInOverview: false
    }))
  };
}

function mergeFacts(baseFacts, topFacts) {
  return {
    ...(baseFacts || {}),
    userPositions: topFacts.userPositions,
    userAssetPositions: topFacts.userAssetPositions
  };
}

async function enrichTopAccountCsv({ snapshot, facts, config, paths }) {
  if (!paths.topAccountCsvFiles?.length) {
    return {
      snapshot,
      facts,
      dataQuality: [
        {
          source: "Top Account CSV",
          status: "todo",
          message: "TOP_ACCOUNT_CSV_FILES is not configured; Top20 remains sourced from the base snapshot."
        }
      ]
    };
  }

  const rawRows = await readTopAccountRows(paths.topAccountCsvFiles);
  const trxPriceState = await loadTrxUsdByDate(paths);
  const topFacts = aggregateRows(rawRows, config, snapshot, trxPriceState);
  const dates = sortDates(topFacts.userPositions);
  const latestDate = dates.at(-1);
  if (!latestDate) {
    return {
      snapshot,
      facts,
      dataQuality: [
        trxPriceState.quality,
        {
          source: "Top Account CSV",
          status: "error",
          message: "Top Account CSV files were loaded, but no supported asset rows could be valued."
        }
      ].filter(Boolean)
    };
  }

  const topCurrent = latestTop20(topFacts.userPositions, latestDate);
  const periodViews = { ...(snapshot.periodViews || {}) };
  for (const days of [7, 30, 90]) {
    const key = periodKey(days);
    const periodStart = selectWindowDates(dates, latestDate, days)[0];
    const periodTopLost = top20Lost(topFacts.userPositions, topFacts.userAssetPositions, latestDate, days);
    periodViews[key] = {
      ...(periodViews[key] || {}),
      period: key,
      periodStart: `${periodStart}T00:00:00.000Z`,
      periodEnd: `${latestDate}T00:00:00.000Z`,
      lastCompleteUtcDate: latestDate,
      capitalOutflow: buildCapitalOutflow(snapshot, topCurrent, periodTopLost, latestDate)
    };
  }
  const nextSnapshot = {
    ...snapshot,
    lastCompleteUtcDate: latestDate,
    periodEnd: `${latestDate}T00:00:00.000Z`,
    periodStart: `${selectWindowDates(dates, latestDate, 90)[0]}T00:00:00.000Z`,
    capitalOutflow: periodViews["90d"].capitalOutflow,
    periodViews
  };

  return {
    snapshot: nextSnapshot,
    facts: mergeFacts(facts, topFacts),
    dataQuality: [
      trxPriceState.quality,
      {
        source: "Top Account CSV",
        status: "complete",
        message: `Loaded ${rawRows.length} CSV rows, valued ${topFacts.userAssetPositions.length} user-asset rows across ${dates.length} days, and generated real 7D/30D/90D Top20 outflow period views.`
      },
      {
        source: "Internal Address Filter",
        status: "complete",
        message: `Top Account CSV excludes ${topFacts.excludedAddresses.size} configured internal, market, and token contract addresses.`
      },
      {
        source: "Round Trip",
        status: "partial",
        message: "Round Trip status is derived from Top Account position deltas; destinations remain 待链上归因 until chain enrichment finds matching transfers."
      }
    ].filter(Boolean)
  };
}

module.exports = {
  enrichTopAccountCsv,
  parseCsv
};
