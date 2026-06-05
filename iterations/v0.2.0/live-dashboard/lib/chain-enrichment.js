const DAY_MS = 24 * 60 * 60 * 1000;
const { isJTokenUserProfileLabel, loadSharedAddressBook } = require("./shared-address-book");
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const CEX_KEYWORDS = ["htx", "binance", "okx", "bybit", "kucoin", "gate", "poloniex"];
const PROTOCOL_TAG_PATTERNS = [
  /justlend/i,
  /jtoken/i,
  /\bj(?:usdt|usdd|trx|strx|btc|ethb|eth)\s+token\b/i,
  /\bj(?:usdt|usdd|trx|strx|btc|ethb|eth)\s+market\b/i
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAddress(value) {
  return String(value || "").trim().replace(/^['"`]+|['"`]+$/g, "");
}

function addHours(isoTime, hours) {
  return new Date(new Date(isoTime).getTime() + hours * 60 * 60 * 1000).toISOString();
}

function addHoursSafe(isoTime, hours) {
  const timestamp = new Date(isoTime).getTime();
  if (!Number.isFinite(timestamp)) return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  return new Date(timestamp + hours * 60 * 60 * 1000).toISOString();
}

function addDays(isoTime, days) {
  return new Date(new Date(isoTime).getTime() + days * DAY_MS).toISOString();
}

function contractByAsset(config) {
  return new Map((config.assets || []).map((asset) => [asset.symbol, asset.contractAddress]).filter((item) => item[1]));
}

function protocolAddressSet(config) {
  const addresses = [];
  for (const asset of config.assets || []) {
    addresses.push(asset.marketId, asset.jTokenAddress);
  }
  for (const item of config.protocolAddresses || config.watchedAddresses || []) {
    addresses.push(item.address);
  }
  return new Set(addresses.map(normalizeAddress).filter(Boolean));
}

function classifyDestination(address) {
  const normalized = normalizeAddress(address);
  if (!normalized) return { destination: "Unknown", category: "Unknown", labelSource: "unknown", labelConfidence: 0 };
  return { destination: normalized, category: "Wallet / Contract", labelSource: "unknown", labelConfidence: 0, address: normalized };
}

function tagFrom(row, side) {
  const tag = side === "from" ? row.from_address_tag : row.to_address_tag;
  if (!tag || typeof tag !== "object") return "";
  return tag.from_address_tag || tag.to_address_tag || "";
}

function classifyTronScanTag(row) {
  const tag = tagFrom(row, "to");
  if (tag) {
    const normalizedTag = tag.trim();
    const lower = normalizedTag.toLowerCase();
    if (CEX_KEYWORDS.some((item) => lower.includes(item))) {
      return { destination: normalizedTag, category: "CEX", labelSource: "tronscan", labelConfidence: 0.85 };
    }
    if (["usdd", "psm", "justlend", "stusdt", "sun", "jtoken"].some((item) => lower.includes(item))) {
      return { destination: normalizedTag, category: "TRON Eco", labelSource: "tronscan", labelConfidence: 0.75 };
    }
    return { destination: normalizedTag, category: row.toAddressIsContract ? "Contract" : "Labeled Wallet", labelSource: "tronscan", labelConfidence: 0.75 };
  }
  return null;
}

function isProtocolInternalTag(value) {
  return PROTOCOL_TAG_PATTERNS.some((pattern) => pattern.test(String(value || "")));
}

function isProtocolInternalDestination(row, config, context) {
  const address = transferTarget(row);
  if (context?.protocolAddresses?.has(address) || protocolAddressSet(config).has(address)) return true;
  return isProtocolInternalTag(tagFrom(row, "to"));
}

function tokenAmount(row) {
  const raw = row.amount_str ?? row.quant ?? row.amount ?? row.value ?? 0;
  const decimals = Number(row.decimals ?? row.tokenInfo?.tokenDecimal ?? 6);
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0;
  if (String(raw).includes(".")) return value;
  return value / (10 ** decimals);
}

function rowTimestamp(row) {
  const raw = row.block_ts ?? row.block_timestamp ?? row.timestamp ?? row.time;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return new Date(numeric).toISOString();
  if (typeof raw === "string" && raw) return new Date(raw).toISOString();
  return null;
}

function rowTimeMs(row) {
  const timestamp = rowTimestamp(row);
  return timestamp ? new Date(timestamp).getTime() : 0;
}

function isOutgoing(row, address) {
  const from = normalizeAddress(row.from_address || row.from || row.ownerAddress || row.transferFromAddress);
  return from === normalizeAddress(address);
}

function transferTarget(row) {
  return normalizeAddress(row.to_address || row.to || row.toAddress || row.transferToAddress);
}

function transferSource(row) {
  return normalizeAddress(row.from_address || row.from || row.fromAddress || row.transferFromAddress);
}

function txHash(row) {
  return row.transaction_id || row.transactionHash || row.txID || row.hash || "";
}

function isRedeemInflow(row, address, config) {
  const to = transferTarget(row);
  if (to !== normalizeAddress(address)) return false;
  const from = transferSource(row);
  const marketIds = new Set((config.assets || []).map((asset) => normalizeAddress(asset.marketId)).filter(Boolean));
  const method = row.trigger_info?.methodName || row.trigger_info?.method || "";
  return marketIds.has(from) || /redeem/i.test(method) || /jtoken/i.test(tagFrom(row, "from"));
}

async function fetchJsonWithRetry(url, label, attempts = 3, headers = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, { headers });
    if (response.ok) return response.json();
    lastError = new Error(`${label} returned HTTP ${response.status}`);
    if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts) throw lastError;
    await sleep(1200 * attempt);
  }
  throw lastError || new Error(`${label} failed`);
}

function emptyLabelStats() {
  return {
    addressBookLookups: 0,
    addressBookHits: 0,
    tronScanTagLookups: 0,
    tronScanTagHits: 0,
    arkhamLookups: 0,
    arkhamHits: 0,
    arkhamErrors: 0,
    arkhamSkipped: 0,
    protocolInternalSkipped: 0
  };
}

function formatHitRate(hits, lookups) {
  return lookups > 0 ? `${hits}/${lookups} (${((hits / lookups) * 100).toFixed(1)}%)` : "0/0";
}

function isAddressBookUserProfileDestination(value, category, labelSource) {
  const profileSource = labelSource === "address_book" || labelSource === "address_book_profile";
  const profileCategory = category === "JustLend User" || category === "User Wallet";
  return (profileSource && (profileCategory || isJTokenUserProfileLabel(value)))
    || (profileCategory && isJTokenUserProfileLabel(value));
}

function addressBookUserProfileDestination(match, address) {
  return {
    destination: "地址库用户",
    category: "User Wallet",
    address,
    labelSource: "address_book_profile",
    labelConfidence: Math.min(Number(match.confidence || 0.7), 0.45),
    profileLabel: match.label,
    flowEntityEligible: false
  };
}

function overviewEligibleDestination(destination) {
  if (!destination || destination.flowEntityEligible === false) return false;
  if (destination.labelSource === "address_book_profile") return false;
  return !["Unknown", "Wallet / Contract", "Address Book", "JustLend Address Book", "JustLend User", "User Wallet", "N/A", "待查询"].includes(destination.category);
}

function normalizeProfileDestinationFields(item) {
  const destination = item.destination || item.topDestination || item.strongDestination || item.outflowDestination;
  const category = item.category || item.destinationCategory || item.outflowDestinationCategory;
  const labelSource = item.labelSource || item.destinationLabelSource || item.strongDestinationLabelSource || item.outflowDestinationLabelSource;
  if (!isAddressBookUserProfileDestination(destination, category, labelSource)) return item;
  const profileLabel = item.profileLabel || item.destinationProfileLabel || item.strongDestinationProfileLabel || item.outflowDestinationProfileLabel || destination;
  return {
    ...item,
    destination: item.destination ? "地址库用户" : item.destination,
    topDestination: item.topDestination ? "地址库用户" : item.topDestination,
    strongDestination: item.strongDestination ? "地址库用户" : item.strongDestination,
    outflowDestination: item.outflowDestination ? "地址库用户" : item.outflowDestination,
    category: item.category ? "User Wallet" : item.category,
    destinationCategory: item.destinationCategory ? "User Wallet" : item.destinationCategory,
    outflowDestinationCategory: item.outflowDestinationCategory ? "User Wallet" : item.outflowDestinationCategory,
    attribution: item.attribution === "strong" ? "profile" : item.attribution,
    destinationAttribution: item.destinationAttribution === "strong" ? "profile" : item.destinationAttribution,
    usedInOverview: false,
    labelSource: item.labelSource === "address_book" ? "address_book_profile" : item.labelSource,
    destinationLabelSource: item.destinationLabelSource === "address_book" ? "address_book_profile" : item.destinationLabelSource,
    strongDestinationLabelSource: item.strongDestinationLabelSource === "address_book" ? "address_book_profile" : item.strongDestinationLabelSource,
    outflowDestinationLabelSource: item.outflowDestinationLabelSource === "address_book" ? "address_book_profile" : item.outflowDestinationLabelSource,
    profileLabel,
    destinationProfileLabel: item.destinationProfileLabel || profileLabel,
    strongDestinationProfileLabel: item.strongDestinationProfileLabel || profileLabel,
    outflowDestinationProfileLabel: item.outflowDestinationProfileLabel || profileLabel
  };
}

function addressBookLabel(address, context) {
  const normalized = normalizeAddress(address);
  if (!normalized || !context.addressBookIndex) return null;
  context.labelStats.addressBookLookups += 1;
  const match = context.addressBookIndex.get(normalized);
  if (!match) return null;
  context.labelStats.addressBookHits += 1;
  if (match.profileOnly || isAddressBookUserProfileDestination(match.label, match.category, "address_book")) {
    return addressBookUserProfileDestination(match, normalized);
  }
  return {
    destination: match.label,
    category: match.category,
    address: normalized,
    labelSource: "address_book",
    labelConfidence: match.confidence
  };
}

function tronScanLabel(row, context) {
  context.labelStats.tronScanTagLookups += 1;
  const match = classifyTronScanTag(row);
  if (!match) return null;
  context.labelStats.tronScanTagHits += 1;
  return {
    ...match,
    address: transferTarget(row)
  };
}

function arkhamLabelFromJson(json, address) {
  const entity = json.entity || json.arkhamEntity || json.predictedEntity || {};
  const label = json.label
    || json.addressLabel
    || json.name
    || entity.name
    || entity.label
    || (Array.isArray(json.tags) ? json.tags.map((item) => item.name || item.label || item.id).filter(Boolean).join(" / ") : "");
  if (!label) return null;
  const lower = String(label).toLowerCase();
  return {
    destination: label,
    category: CEX_KEYWORDS.some((item) => lower.includes(item)) ? "CEX" : "Arkham Label",
    address,
    labelSource: "arkham",
    labelConfidence: Number(json.confidence || json.confidenceScore || entity.confidence || 0.65)
  };
}

async function arkhamLabel(address, context) {
  if (!context.paths.arkhamLabelEnabled || !context.paths.arkhamApiKey) {
    context.labelStats.arkhamSkipped += 1;
    return null;
  }
  context.labelStats.arkhamLookups += 1;
  const base = String(context.paths.arkhamApiBase || "https://api.arkm.com").replace(/\/$/, "");
  const url = new URL(`${base}/intelligence/address/${encodeURIComponent(address)}`);
  if (context.paths.arkhamChain) url.searchParams.set("chain", context.paths.arkhamChain);
  const json = await fetchJsonWithRetry(url.toString(), "Arkham address intelligence", 2, {
    "API-Key": context.paths.arkhamApiKey
  });
  const match = arkhamLabelFromJson(json, address);
  if (match) context.labelStats.arkhamHits += 1;
  return match;
}

async function resolveDestination(row, context) {
  const address = transferTarget(row);
  const fromBook = addressBookLabel(address, context);
  if (fromBook) return fromBook;
  const fromTronScan = tronScanLabel(row, context);
  if (fromTronScan) return fromTronScan;
  try {
    const fromArkham = await arkhamLabel(address, context);
    if (fromArkham) return fromArkham;
  } catch (error) {
    context.labelStats.arkhamErrors = (context.labelStats.arkhamErrors || 0) + 1;
  }
  return classifyDestination(address);
}

async function fetchTronScanTrc20Transfers(paths, address, startIso, endIso, contractAddress) {
  const params = new URLSearchParams({
    limit: "200",
    start: "0",
    relatedAddress: address,
    start_timestamp: String(new Date(startIso).getTime()),
    end_timestamp: String(new Date(endIso).getTime())
  });
  if (contractAddress) params.set("contract_address", contractAddress);
  const json = await fetchJsonWithRetry(`${paths.tronScanApiBase}/api/token_trc20/transfers?${params.toString()}`, "TronScan TRC20 transfers");
  return Array.isArray(json.token_transfers) ? json.token_transfers : Array.isArray(json.data) ? json.data : [];
}

async function fetchTronGridTrc20Transfers(paths, address, startIso, endIso, contractAddress) {
  const params = new URLSearchParams({
    only_confirmed: "true",
    limit: "200",
    min_timestamp: String(new Date(startIso).getTime()),
    max_timestamp: String(new Date(endIso).getTime())
  });
  if (contractAddress) params.set("contract_address", contractAddress);
  const json = await fetchJsonWithRetry(`${paths.tronGridApiBase}/v1/accounts/${address}/transactions/trc20?${params.toString()}`, "TronGrid TRC20 transfers");
  return Array.isArray(json.data) ? json.data : [];
}

async function fetchTrc20Transfers(paths, address, startIso, endIso, contractAddress) {
  if (paths.chainProvider === "trongrid") {
    return fetchTronGridTrc20Transfers(paths, address, startIso, endIso, contractAddress);
  }
  return fetchTronScanTrc20Transfers(paths, address, startIso, endIso, contractAddress);
}

function externalOutgoingRows(rows, address, config, context) {
  return rows.filter((row) => {
    if (!isOutgoing(row, address)) return false;
    if (isProtocolInternalDestination(row, config, context)) {
      context.labelStats.protocolInternalSkipped += 1;
      return false;
    }
    return true;
  });
}

async function findHop1(paths, config, lostItem, context) {
  const anchor = lostItem.outflowTime || `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const start = addHoursSafe(anchor, -72);
  const end = addHoursSafe(anchor, 24);
  const rows = await fetchTrc20Transfers(paths, lostItem.address, start, end, null);
  const sorted = rows.sort((a, b) => rowTimeMs(a) - rowTimeMs(b));
  const redeemInflows = sorted.filter((row) => isRedeemInflow(row, lostItem.address, config));
  for (const redeem of redeemInflows) {
    const redeemTime = rowTimestamp(redeem);
    const redeemEnd = addHours(redeemTime, 24);
    const outgoingAfterRedeem = externalOutgoingRows(sorted, lostItem.address, config, context)
      .filter((row) => {
        const timestamp = rowTimestamp(row);
        return timestamp
          && timestamp >= redeemTime
          && timestamp <= redeemEnd;
      })
      .map((row) => ({
        row,
        amount: tokenAmount(row),
        time: rowTimestamp(row),
        target: transferTarget(row),
        redeemTime,
        redeemTxHash: txHash(redeem),
        txHash: txHash(row),
        matchReason: "redeem_then_transfer"
      }))
      .filter((row) => row.target)
      .sort((a, b) => b.amount - a.amount);
    if (outgoingAfterRedeem.length) {
      const selected = outgoingAfterRedeem[0];
      return { ...selected, destination: await resolveDestination(selected.row, context) };
    }
  }

  const outgoing = externalOutgoingRows(sorted, lostItem.address, config, context)
    .map((row) => ({
      row,
      amount: tokenAmount(row),
      time: rowTimestamp(row),
      target: transferTarget(row),
      txHash: txHash(row),
      matchReason: "expanded_window_transfer"
    }))
    .filter((row) => row.target)
    .sort((a, b) => b.amount - a.amount);
  if (!outgoing.length) return null;
  const selected = outgoing[0];
  return { ...selected, destination: await resolveDestination(selected.row, context) };
}

async function findHop2(paths, config, asset, hop1Target, startIso, context) {
  if (!hop1Target) return null;
  const rows = await fetchTrc20Transfers(paths, hop1Target, startIso, addDays(startIso, 7), null);
  const outgoing = externalOutgoingRows(rows, hop1Target, config, context)
    .map((row) => ({
      row,
      amount: tokenAmount(row),
      time: rowTimestamp(row),
      target: transferTarget(row),
      txHash: txHash(row),
      matchReason: "hop2_transfer"
    }))
    .filter((row) => row.target)
    .sort((a, b) => b.amount - a.amount);
  if (!outgoing.length) return null;
  const selected = outgoing[0];
  return { ...selected, destination: await resolveDestination(selected.row, context) };
}

function destinationRows(attributionDetails) {
  const byDestination = new Map();
  for (const item of attributionDetails.filter((row) => row.hop === 1 && row.usedInOverview && row.attribution === "strong")) {
    const key = `${item.destination}|${item.category}`;
    const previous = byDestination.get(key) || {
      destination: item.destination,
      category: item.category,
      amountUsd: 0,
      walletCount: 0,
      attribution: item.attribution,
      labelSource: item.labelSource,
      labelConfidence: item.labelConfidence
    };
    previous.amountUsd += item.amountUsd || 0;
    previous.walletCount += 1;
    byDestination.set(key, previous);
  }
  const total = [...byDestination.values()].reduce((sum, item) => sum + item.amountUsd, 0);
  return [...byDestination.values()]
    .sort((a, b) => b.amountUsd - a.amountUsd)
    .map((item) => ({
      ...item,
      amountUsd: Math.round(item.amountUsd),
      sharePct: total > 0 ? Number(((item.amountUsd / total) * 100).toFixed(1)) : 0
    }));
}

function hasResolvedDestination(value) {
  return Boolean(value && value !== "Pending chain lookup" && value !== "待链上归因");
}

function backfillTopLostDestinations(capitalOutflow) {
  const hop1ByAddress = new Map(
    (capitalOutflow.attributionDetails || [])
      .filter((item) => item.hop === 1 && item.address && item.destination)
      .map((item) => [normalizeAddress(item.address), normalizeProfileDestinationFields(item)])
  );
  const roundTripByAddress = new Map(
    (capitalOutflow.roundTrips || [])
      .filter((item) => item.address && (hasResolvedDestination(item.strongDestination) || hasResolvedDestination(item.outflowDestination)))
      .map((item) => [normalizeAddress(item.address), normalizeProfileDestinationFields(item)])
  );

  return (capitalOutflow.top20Lost || []).map((item) => {
    const normalized = normalizeAddress(item.address);
    const hop1 = hop1ByAddress.get(normalized);
    if (hop1) {
      return {
        ...item,
        topDestination: hop1.destination,
        destinationCategory: hop1.category,
        destinationAddress: hop1.destinationAddress,
        destinationAttribution: hop1.attribution,
        destinationConfidence: hop1.confidence,
        destinationLabelSource: hop1.labelSource,
        destinationLabelConfidence: hop1.labelConfidence,
        destinationProfileLabel: hop1.profileLabel,
        destinationTxHash: hop1.txHash,
        destinationMatchReason: hop1.matchReason
      };
    }

    const roundTrip = roundTripByAddress.get(normalized);
    if (roundTrip) {
      const roundTripAttribution = isAddressBookUserProfileDestination(
        roundTrip.strongDestination || roundTrip.outflowDestination,
        roundTrip.destinationCategory || roundTrip.outflowDestinationCategory,
        roundTrip.strongDestinationLabelSource || roundTrip.outflowDestinationLabelSource
      ) ? "profile" : roundTrip.source === "chain-enriched" ? "strong" : item.destinationAttribution;
      return {
        ...item,
        topDestination: roundTrip.strongDestination || roundTrip.outflowDestination,
        destinationCategory: roundTrip.destinationCategory || roundTrip.outflowDestinationCategory,
        destinationAttribution: roundTripAttribution,
        destinationLabelSource: roundTrip.strongDestinationLabelSource || roundTrip.outflowDestinationLabelSource,
        destinationLabelConfidence: roundTrip.strongDestinationLabelConfidence || roundTrip.outflowDestinationLabelConfidence,
        destinationProfileLabel: roundTrip.strongDestinationProfileLabel || roundTrip.outflowDestinationProfileLabel,
        destinationTxHash: roundTrip.outflowTxHash,
        destinationMatchReason: roundTrip.matchReason
      };
    }

    if ((item.grossWithdrawUsd || 0) <= 0) {
      return {
        ...item,
        topDestination: "无流出",
        destinationCategory: "N/A",
        destinationAttribution: "none"
      };
    }
    if ((item.unreturnedOutflowUsd || 0) <= 0) {
      return {
        ...item,
        topDestination: "已回流",
        destinationCategory: "N/A",
        destinationAttribution: "returned"
      };
    }
    if (!item.topDestination || item.topDestination === "Pending chain lookup") {
      return {
        ...item,
        topDestination: "待链上归因",
        destinationCategory: "待查询",
        destinationAttribution: "pending"
      };
    }

    return item;
  });
}

async function enrichCapitalOutflow(capitalOutflow, snapshotDate, config, paths, context) {
  const topLost = (capitalOutflow?.top20Lost || []).slice(0, paths.chainLookbackTopLostLimit);
  const attributionDetails = [];
  const roundTrips = [...(capitalOutflow?.roundTrips || [])];
  const errors = [];

  for (const lostItem of topLost) {
    try {
      await sleep(350);
      const hop1 = await findHop1(paths, config, lostItem, context);
      if (!hop1) continue;
      const destination = hop1.destination || classifyDestination(hop1.target);
      if (destination.category === "TRON Eco" && isProtocolInternalTag(destination.destination)) {
        context.labelStats.protocolInternalSkipped += 1;
        continue;
      }
      const usedInOverview = overviewEligibleDestination(destination);
      attributionDetails.push({
        pathId: `${snapshotDate}-${lostItem.address}-hop1`,
        hop: 1,
        address: lostItem.address,
        amountUsd: lostItem.unreturnedOutflowUsd,
        destination: destination.destination,
        category: destination.category,
        confidence: usedInOverview ? 0.8 : 0.35,
        attribution: usedInOverview ? "strong" : "profile",
        usedInOverview,
        eventTime: hop1.time,
        txHash: hop1.txHash,
        matchReason: hop1.matchReason,
        destinationAddress: destination.address || hop1.target,
        labelSource: destination.labelSource,
        labelConfidence: destination.labelConfidence,
        profileLabel: destination.profileLabel
      });

      const existingRoundTrip = roundTrips.find((item) => item.address === lostItem.address);
      if (existingRoundTrip) {
        existingRoundTrip.strongDestination = destination.destination;
        existingRoundTrip.destinationCategory = destination.category;
        existingRoundTrip.outflowTxHash = hop1.txHash;
        existingRoundTrip.matchReason = hop1.matchReason;
        existingRoundTrip.strongDestinationLabelSource = destination.labelSource;
        existingRoundTrip.strongDestinationLabelConfidence = destination.labelConfidence;
        existingRoundTrip.strongDestinationProfileLabel = destination.profileLabel;
        existingRoundTrip.source = "chain-enriched";
      }

      const hop2 = await findHop2(paths, config, lostItem.primaryAsset, hop1.target, hop1.time || lostItem.outflowTime, context);
      if (hop2) {
        const weakDestination = hop2.destination || classifyDestination(hop2.target);
        attributionDetails.push({
          pathId: `${snapshotDate}-${lostItem.address}-hop2`,
          hop: 2,
          address: lostItem.address,
          amountUsd: Math.round((lostItem.unreturnedOutflowUsd || 0) * 0.8),
          destination: weakDestination.destination,
          category: weakDestination.category,
          confidence: 0.45,
          attribution: "weak",
          usedInOverview: false,
          eventTime: hop2.time,
          txHash: hop2.txHash,
          matchReason: hop2.matchReason,
          destinationAddress: weakDestination.address || hop2.target,
          labelSource: weakDestination.labelSource,
          labelConfidence: weakDestination.labelConfidence,
          profileLabel: weakDestination.profileLabel
        });
        if (existingRoundTrip) {
          existingRoundTrip.weakDestination = weakDestination.destination;
          existingRoundTrip.weakDestinationLabelSource = weakDestination.labelSource;
          existingRoundTrip.weakDestinationLabelConfidence = weakDestination.labelConfidence;
          existingRoundTrip.weakDestinationProfileLabel = weakDestination.profileLabel;
        }
      }
    } catch (error) {
      errors.push(`${lostItem.address}: ${error.message}`);
    }
  }

  const nextCapitalOutflow = {
    ...(capitalOutflow || {}),
    roundTrips,
    attributionDetails: attributionDetails.length ? attributionDetails : capitalOutflow?.attributionDetails || [],
    destinations: attributionDetails.length ? destinationRows(attributionDetails) : capitalOutflow?.destinations || []
  };
  nextCapitalOutflow.top20Lost = backfillTopLostDestinations(nextCapitalOutflow);

  return {
    capitalOutflow: nextCapitalOutflow,
    queriedCount: topLost.length,
    attributionCount: attributionDetails.length,
    errors
  };
}

function periodViewEntries(snapshot) {
  const primaryPeriod = snapshot.period || "90d";
  return Object.entries(snapshot.periodViews || {})
    .filter(([, view]) => view?.capitalOutflow)
    .filter(([period]) => period !== primaryPeriod)
    .sort(([a], [b]) => a.localeCompare(b));
}

async function enrichChainPaths(snapshot, config, paths) {
  if (!paths.chainEnrichmentEnabled) {
    return {
      snapshot,
      dataQuality: [
        {
          source: "Chain Path Enrichment",
          status: "disabled",
          message: "CHAIN_ENRICHMENT_ENABLED=false; Hop and Round Trip chain paths remain position-derived or pending lookup."
        }
      ]
    };
  }

  const nextSnapshot = { ...snapshot, periodViews: { ...(snapshot.periodViews || {}) } };
  const addressBook = await loadSharedAddressBook(paths.root, paths.addressBookPath);
  const context = {
    paths,
    addressBookIndex: addressBook.index,
    protocolAddresses: protocolAddressSet(config),
    labelStats: emptyLabelStats()
  };
  const results = [];

  const primary = await enrichCapitalOutflow(snapshot.capitalOutflow, snapshot.lastCompleteUtcDate, config, paths, context);
  nextSnapshot.capitalOutflow = primary.capitalOutflow;
  results.push({ period: snapshot.period || "90d", ...primary });

  for (const [period, view] of periodViewEntries(snapshot)) {
    const result = await enrichCapitalOutflow(view.capitalOutflow, view.lastCompleteUtcDate || snapshot.lastCompleteUtcDate, config, paths, context);
    nextSnapshot.periodViews[period] = {
      ...view,
      capitalOutflow: result.capitalOutflow
    };
    results.push({ period, ...result });
  }

  const queriedTotal = results.reduce((sum, item) => sum + item.queriedCount, 0);
  const attributionTotal = results.reduce((sum, item) => sum + item.attributionCount, 0);
  const errors = results.flatMap((item) => item.errors.map((error) => `${item.period}: ${error}`));
  const periodSummary = results.map((item) => `${item.period} ${item.attributionCount}/${item.queriedCount}`).join(", ");
  const labelStats = context.labelStats;
  return {
    snapshot: nextSnapshot,
    dataQuality: [
      {
        source: "Chain Path Enrichment",
        status: errors.length ? "partial" : "complete",
        message: attributionTotal
          ? `Queried ${queriedTotal} Top Lost period-addresses via ${paths.chainProvider}; produced ${attributionTotal} hop attribution rows across periods (${periodSummary}).${errors.length ? ` Errors: ${errors.slice(0, 3).join(" | ")}` : ""}`
          : `Queried ${queriedTotal} Top Lost period-addresses via ${paths.chainProvider}, but no matching outgoing TRC20 transfers were found in attribution windows (${periodSummary}).${errors.length ? ` Errors: ${errors.slice(0, 3).join(" | ")}` : ""}`
      },
      {
        source: "Chain Label Resolution",
        status: paths.arkhamLabelEnabled && !paths.arkhamApiKey ? "partial" : "complete",
        message: `Destination labels resolved in order: address book -> TronScan tag -> Arkham. Address book hit rate ${formatHitRate(labelStats.addressBookHits, labelStats.addressBookLookups)}; TronScan tag hit rate ${formatHitRate(labelStats.tronScanTagHits, labelStats.tronScanTagLookups)}; Arkham hit rate ${formatHitRate(labelStats.arkhamHits, labelStats.arkhamLookups)}${paths.arkhamLabelEnabled ? "" : " (Arkham disabled)"}${paths.arkhamLabelEnabled && !paths.arkhamApiKey ? " (Arkham key missing)" : ""}. Protocol-internal destinations skipped: ${labelStats.protocolInternalSkipped}. Arkham errors: ${labelStats.arkhamErrors}.`
      }
    ]
  };
}

module.exports = {
  enrichChainPaths,
  backfillTopLostDestinations,
  normalizeProfileDestinationFields,
  overviewEligibleDestination
};
