function median(values) {
  const items = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!items.length) return null;
  const middle = Math.floor(items.length / 2);
  return items.length % 2 ? items[middle] : (items[middle - 1] + items[middle]) / 2;
}

function pctChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function unixSeconds(dateString) {
  return Math.floor(new Date(`${dateString}T00:00:00Z`).getTime() / 1000);
}

function normalizeMarketComparison(value) {
  if (value?.marketComparison && value?.overview) return value.marketComparison;
  return value || {};
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function fetchDefiLlamaProtocolTvl(slug, periodStart, periodEnd) {
  const payload = await fetchJson(`https://api.llama.fi/protocol/${encodeURIComponent(slug)}`);
  const tvl = Array.isArray(payload.tvl) ? payload.tvl : [];
  const startTs = unixSeconds(periodStart.slice(0, 10));
  const endTs = unixSeconds(periodEnd.slice(0, 10));
  const startPoint = tvl.filter((item) => Number(item.date) <= startTs).at(-1) || tvl[0];
  const endPoint = tvl.filter((item) => Number(item.date) <= endTs).at(-1) || tvl.at(-1);
  return {
    tvlUsd: Number(endPoint?.totalLiquidityUSD),
    tvlChangePct: pctChange(Number(endPoint?.totalLiquidityUSD), Number(startPoint?.totalLiquidityUSD))
  };
}

async function enrichCompetitorTvlForWindow(current, config, periodStart, periodEnd) {
  const base = normalizeMarketComparison(current);
  const competitors = config.competitors || [];
  const protocols = [];
  for (const competitor of competitors) {
    if (competitor.enabled === false) continue;
    const tvl = await fetchDefiLlamaProtocolTvl(competitor.defillamaSlug, periodStart, periodEnd);
    protocols.push({
      name: competitor.name,
      tvlUsd: tvl.tvlUsd,
      tvlChangePct: tvl.tvlChangePct,
      borrowUsd: null,
      borrowChangePct: null,
      borrowStatus: "TODO"
    });
  }
  const medianChange = median(protocols.map((item) => item.tvlChangePct));
  const medianTvl = median(protocols.map((item) => item.tvlUsd));
  return {
    ...base,
    competitorMedian: {
      ...(base.competitorMedian || {}),
      tvlUsd: medianTvl,
      tvlChangePct: medianChange,
      borrowUsd: null,
      borrowChangePct: null,
      borrowStatus: "TODO / Data unavailable"
    },
    competitors: protocols,
    protocols,
    relative: {
      ...(base.relative || {}),
      tvlUnderperformancePctPoint: Number.isFinite(base.justlend?.tvlChangePct) && Number.isFinite(medianChange)
        ? medianChange - base.justlend.tvlChangePct
        : null,
      borrowUnderperformancePctPoint: null
    }
  };
}

async function enrichCompetitorTvl(snapshot, config) {
  const next = JSON.parse(JSON.stringify(snapshot));
  next.marketComparison = await enrichCompetitorTvlForWindow(
    next.marketComparison || {},
    config,
    next.periodStart,
    next.periodEnd
  );

  const periodViews = next.periodViews || {};
  for (const [period, view] of Object.entries(periodViews)) {
    if (!view?.periodStart || !view?.periodEnd) continue;
    periodViews[period] = {
      ...view,
      marketComparison: await enrichCompetitorTvlForWindow(
        view.marketComparison || {},
        config,
        view.periodStart,
        view.periodEnd
      )
    };
  }
  next.periodViews = periodViews;
  return next;
}

async function fetchCoinMarketCapQuotes(assetIds, cmcApiKey) {
  if (!cmcApiKey) throw new Error("CMC_API_KEY is not configured.");
  const url = `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?id=${assetIds.join(",")}`;
  return fetchJson(url, {
    headers: {
      "X-CMC_PRO_API_KEY": cmcApiKey
    }
  });
}

async function enrichExternalData(snapshot, config, paths) {
  const next = JSON.parse(JSON.stringify(snapshot));
  const quality = [];

  if (!paths.externalFetchEnabled) {
    quality.push({
      source: "External Fetch",
      status: "disabled",
      message: "Set EXTERNAL_FETCH_ENABLED=true to refresh DeFiLlama TVL and CoinMarketCap quotes during the snapshot job."
    });
    return { snapshot: next, dataQuality: quality };
  }

  try {
    const competitorSnapshot = await enrichCompetitorTvl(next, config);
    Object.assign(next, competitorSnapshot);
    quality.push({
      source: "DeFiLlama",
      status: "complete",
      message: "Competitor TVL median refreshed from DeFiLlama protocol TVL."
    });
  } catch (error) {
    quality.push({
      source: "DeFiLlama",
      status: "failed",
      message: `Competitor TVL refresh failed; existing snapshot values are preserved. ${error.message}`
    });
  }

  try {
    const ids = (config.assets || []).map((item) => item.cmcAssetId).filter((item) => item && item !== "TODO");
    if (!paths.cmcApiKey) {
      quality.push({
        source: "CoinMarketCap",
        status: "not_configured",
        message: "CMC_API_KEY is not configured. Snapshot valuation uses exportLendInfo reference prices; configure CMC for independent price-source checks before VPS deployment."
      });
    } else {
      await fetchCoinMarketCapQuotes(ids, paths.cmcApiKey);
      quality.push({
        source: "CoinMarketCap",
        status: "complete",
        message: "CoinMarketCap API key is valid and quotes endpoint responded. Snapshot price valuation remains driven by source export until asset-level repricing is enabled."
      });
    }
  } catch (error) {
    quality.push({
      source: "CoinMarketCap",
      status: "failed",
      message: `CoinMarketCap quote check failed or key is missing. ${error.message}`
    });
  }

  return { snapshot: next, dataQuality: quality };
}

module.exports = {
  enrichExternalData
};
