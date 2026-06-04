const fs = require("node:fs/promises");
const path = require("node:path");

function resolvePath(root, filePath) {
  if (!filePath) return "";
  return path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
}

function normalizeAddress(value) {
  return String(value || "").trim().replace(/^['"`]+|['"`]+$/g, "");
}

function labelFromEntry(entry) {
  if (entry.label) return entry.label;
  if (entry.name) return entry.name;
  if (Array.isArray(entry.roles) && entry.roles.length) return entry.roles.join(" / ");
  if (entry.role) return entry.role;
  if (Array.isArray(entry.markets) && entry.markets.length) return entry.markets.join(" / ");
  if (entry.market) return entry.market;
  return "Address Book Match";
}

function categoryFromEntry(entry, label) {
  const text = [
    label,
    entry.category,
    entry.type,
    entry.ownerName,
    ...(entry.sources || []),
    ...(entry.roles || []),
    ...(entry.markets || [])
  ].filter(Boolean).join(" ").toLowerCase();
  if (["htx", "binance", "okx", "bybit", "kucoin", "gate", "poloniex"].some((item) => text.includes(item))) {
    return "CEX";
  }
  if (["justlend", "jtoken", "jusdt", "jusdd", "jtrx", "jstrx", "jbtc", "jeth"].some((item) => text.includes(item))) {
    return "JustLend Address Book";
  }
  return entry.category || "Address Book";
}

function buildAddressBookIndex(entries) {
  const byAddress = new Map();
  for (const entry of entries || []) {
    const address = normalizeAddress(entry.address);
    if (!address || byAddress.has(address)) continue;
    const label = labelFromEntry(entry);
    byAddress.set(address, {
      address,
      label,
      category: categoryFromEntry(entry, label),
      source: "address_book",
      confidence: 0.7,
      entry
    });
  }
  return byAddress;
}

async function loadSharedAddressBook(root, filePath) {
  const resolved = resolvePath(root, filePath);
  if (!resolved) {
    return {
      metadata: { enabled: false, entriesCount: 0 },
      entries: [],
      index: new Map(),
      dataQuality: {
        source: "Shared Address Book",
        status: "not_configured",
        message: "ADDRESS_BOOK_PATH is not configured."
      }
    };
  }

  try {
    const parsed = JSON.parse(await fs.readFile(resolved, "utf8"));
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    return {
      metadata: {
        enabled: true,
        source: parsed.source || "shared-address-book",
        updatedAt: parsed.updatedAt || null,
        entriesCount: entries.length
      },
      entries,
      index: buildAddressBookIndex(entries),
      dataQuality: {
        source: "Shared Address Book",
        status: "complete",
        message: `Shared address book loaded with ${entries.length} entries.`
      }
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        metadata: { enabled: true, entriesCount: 0 },
        entries: [],
        index: new Map(),
        dataQuality: {
          source: "Shared Address Book",
          status: "missing",
          message: "Shared address book file is missing; label comparison is unavailable."
        }
      };
    }
    return {
      metadata: { enabled: true, entriesCount: 0 },
      entries: [],
      index: new Map(),
      dataQuality: {
        source: "Shared Address Book",
        status: "error",
        message: `Shared address book failed to load: ${error.message}`
      }
    };
  }
}

module.exports = {
  buildAddressBookIndex,
  loadSharedAddressBook,
  normalizeAddress
};
