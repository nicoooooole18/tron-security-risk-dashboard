const DAY_MS = 24 * 60 * 60 * 1000;

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

function classifyDestination(address) {
  const normalized = normalizeAddress(address);
  if (!normalized) return { destination: "Unknown", category: "Unknown" };
  return { destination: normalized, category: "Wallet / Contract" };
}

function tagFrom(row, side) {
  const tag = side === "from" ? row.from_address_tag : row.to_address_tag;
  if (!tag || typeof tag !== "object") return "";
  return tag.from_address_tag || tag.to_address_tag || "";
}

function classifyDestinationFromRow(row) {
  const address = transferTarget(row);
  const tag = tagFrom(row, "to");
  if (tag) {
    const normalizedTag = tag.trim();
    const lower = normalizedTag.toLowerCase();
    if (["htx", "binance", "okx", "bybit", "kucoin", "gate", "poloniex"].some((item) => lower.includes(item))) {
      return { destination: normalizedTag, category: "CEX", address };
    }
    if (["usdd", "psm", "justlend", "stusdt", "sun", "jtoken"].some((item) => lower.includes(item))) {
      return { destination: normalizedTag, category: "TRON Eco", address };
    }
    return { destination: normalizedTag, category: row.toAddressIsContract ? "Contract" : "Labeled Wallet", address };
  }
  const classified = classifyDestination(address);
  return { ...classified, address };
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

async function fetchTronScanTrc20Transfers(paths, address, startIso, endIso, contractAddress) {
  const params = new URLSearchParams({
    limit: "200",
    start: "0",
    relatedAddress: address,
    start_timestamp: String(new Date(startIso).getTime()),
    end_timestamp: String(new Date(endIso).getTime())
  });
  if (contractAddress) params.set("contract_address", contractAddress);
  const response = await fetch(`${paths.tronScanApiBase}/api/token_trc20/transfers?${params.toString()}`);
  if (!response.ok) throw new Error(`TronScan TRC20 transfers returned HTTP ${response.status}`);
  const json = await response.json();
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
  const response = await fetch(`${paths.tronGridApiBase}/v1/accounts/${address}/transactions/trc20?${params.toString()}`);
  if (!response.ok) throw new Error(`TronGrid TRC20 transfers returned HTTP ${response.status}`);
  const json = await response.json();
  return Array.isArray(json.data) ? json.data : [];
}

async function fetchTrc20Transfers(paths, address, startIso, endIso, contractAddress) {
  if (paths.chainProvider === "trongrid") {
    return fetchTronGridTrc20Transfers(paths, address, startIso, endIso, contractAddress);
  }
  return fetchTronScanTrc20Transfers(paths, address, startIso, endIso, contractAddress);
}

async function findHop1(paths, config, lostItem) {
  const contracts = contractByAsset(config);
  const contractAddress = contracts.get(lostItem.primaryAsset);
  if (!contractAddress || lostItem.primaryAsset === "TRX") return null;
  const anchor = lostItem.outflowTime || `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const start = addHoursSafe(anchor, -72);
  const end = addHoursSafe(anchor, 24);
  const rows = await fetchTrc20Transfers(paths, lostItem.address, start, end, contractAddress);
  const sorted = rows.sort((a, b) => rowTimeMs(a) - rowTimeMs(b));
  const redeemInflows = sorted.filter((row) => isRedeemInflow(row, lostItem.address, config));
  for (const redeem of redeemInflows) {
    const redeemTime = rowTimestamp(redeem);
    const redeemEnd = addHours(redeemTime, 24);
    const outgoingAfterRedeem = sorted
      .filter((row) => {
        const timestamp = rowTimestamp(row);
        return timestamp
          && timestamp >= redeemTime
          && timestamp <= redeemEnd
          && isOutgoing(row, lostItem.address);
      })
      .map((row) => ({
        row,
        amount: tokenAmount(row),
        time: rowTimestamp(row),
        target: transferTarget(row),
        redeemTime,
        redeemTxHash: txHash(redeem),
        txHash: txHash(row),
        destination: classifyDestinationFromRow(row),
        matchReason: "redeem_then_transfer"
      }))
      .filter((row) => row.target)
      .sort((a, b) => b.amount - a.amount);
    if (outgoingAfterRedeem.length) return outgoingAfterRedeem[0];
  }

  const outgoing = sorted
    .filter((row) => isOutgoing(row, lostItem.address))
    .map((row) => ({
      row,
      amount: tokenAmount(row),
      time: rowTimestamp(row),
      target: transferTarget(row),
      txHash: txHash(row),
      destination: classifyDestinationFromRow(row),
      matchReason: "expanded_window_transfer"
    }))
    .filter((row) => row.target)
    .sort((a, b) => b.amount - a.amount);
  return outgoing[0] || null;
}

async function findHop2(paths, config, asset, hop1Target, startIso) {
  const contracts = contractByAsset(config);
  const contractAddress = contracts.get(asset);
  if (!contractAddress || !hop1Target || asset === "TRX") return null;
  const rows = await fetchTrc20Transfers(paths, hop1Target, startIso, addDays(startIso, 7), contractAddress);
  const outgoing = rows
    .filter((row) => isOutgoing(row, hop1Target))
    .map((row) => ({
      row,
      amount: tokenAmount(row),
      time: rowTimestamp(row),
      target: transferTarget(row),
      txHash: txHash(row),
      destination: classifyDestinationFromRow(row),
      matchReason: "hop2_transfer"
    }))
    .filter((row) => row.target)
    .sort((a, b) => b.amount - a.amount);
  return outgoing[0] || null;
}

function destinationRows(attributionDetails) {
  const byDestination = new Map();
  for (const item of attributionDetails.filter((row) => row.hop === 1)) {
    const key = `${item.destination}|${item.category}`;
    const previous = byDestination.get(key) || {
      destination: item.destination,
      category: item.category,
      amountUsd: 0,
      walletCount: 0,
      attribution: item.attribution
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
      .filter((item) => item.hop === 1 && item.attribution === "strong" && item.address && item.destination)
      .map((item) => [normalizeAddress(item.address), item])
  );
  const roundTripByAddress = new Map(
    (capitalOutflow.roundTrips || [])
      .filter((item) => item.address && (hasResolvedDestination(item.strongDestination) || hasResolvedDestination(item.outflowDestination)))
      .map((item) => [normalizeAddress(item.address), item])
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
        destinationTxHash: hop1.txHash,
        destinationMatchReason: hop1.matchReason
      };
    }

    const roundTrip = roundTripByAddress.get(normalized);
    if (roundTrip) {
      return {
        ...item,
        topDestination: roundTrip.strongDestination || roundTrip.outflowDestination,
        destinationCategory: roundTrip.destinationCategory || roundTrip.outflowDestinationCategory,
        destinationAttribution: roundTrip.source === "chain-enriched" ? "strong" : item.destinationAttribution,
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

  const topLost = (snapshot.capitalOutflow?.top20Lost || []).slice(0, paths.chainLookbackTopLostLimit);
  const attributionDetails = [];
  const roundTrips = [...(snapshot.capitalOutflow?.roundTrips || [])];
  const errors = [];

  for (const lostItem of topLost) {
    try {
      const hop1 = await findHop1(paths, config, lostItem);
      if (!hop1) continue;
      const destination = hop1.destination || classifyDestination(hop1.target);
      attributionDetails.push({
        pathId: `${snapshot.lastCompleteUtcDate}-${lostItem.address}-hop1`,
        hop: 1,
        address: lostItem.address,
        amountUsd: lostItem.unreturnedOutflowUsd,
        destination: destination.destination,
        category: destination.category,
        confidence: 0.8,
        attribution: "strong",
        usedInOverview: true,
        eventTime: hop1.time,
        txHash: hop1.txHash,
        matchReason: hop1.matchReason,
        destinationAddress: destination.address || hop1.target
      });

      const existingRoundTrip = roundTrips.find((item) => item.address === lostItem.address);
      if (existingRoundTrip) {
        existingRoundTrip.strongDestination = destination.destination;
        existingRoundTrip.destinationCategory = destination.category;
        existingRoundTrip.outflowTxHash = hop1.txHash;
        existingRoundTrip.matchReason = hop1.matchReason;
        existingRoundTrip.source = "chain-enriched";
      }

      const hop2 = await findHop2(paths, config, lostItem.primaryAsset, hop1.target, hop1.time || lostItem.outflowTime);
      if (hop2) {
        const weakDestination = hop2.destination || classifyDestination(hop2.target);
        attributionDetails.push({
          pathId: `${snapshot.lastCompleteUtcDate}-${lostItem.address}-hop2`,
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
          destinationAddress: weakDestination.address || hop2.target
        });
        if (existingRoundTrip) existingRoundTrip.weakDestination = weakDestination.destination;
      }
    } catch (error) {
      errors.push(`${lostItem.address}: ${error.message}`);
    }
  }

  const nextSnapshot = {
    ...snapshot,
    capitalOutflow: {
      ...(snapshot.capitalOutflow || {}),
      roundTrips,
      attributionDetails: attributionDetails.length ? attributionDetails : snapshot.capitalOutflow?.attributionDetails || [],
      destinations: attributionDetails.length ? destinationRows(attributionDetails) : snapshot.capitalOutflow?.destinations || []
    }
  };
  nextSnapshot.capitalOutflow.top20Lost = backfillTopLostDestinations(nextSnapshot.capitalOutflow);

  return {
    snapshot: nextSnapshot,
    dataQuality: [
      {
        source: "Chain Path Enrichment",
        status: errors.length ? "partial" : "complete",
        message: attributionDetails.length
          ? `Queried ${topLost.length} Top20 Lost addresses via ${paths.chainProvider}; produced ${attributionDetails.length} hop attribution rows.${errors.length ? ` Errors: ${errors.slice(0, 3).join(" | ")}` : ""}`
          : `Queried ${topLost.length} Top20 Lost addresses via ${paths.chainProvider}, but no matching outgoing TRC20 transfers were found in attribution windows.${errors.length ? ` Errors: ${errors.slice(0, 3).join(" | ")}` : ""}`
      }
    ]
  };
}

module.exports = {
  enrichChainPaths,
  backfillTopLostDestinations
};
