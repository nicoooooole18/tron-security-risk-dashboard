const fs = require("node:fs/promises");
const path = require("node:path");

function resolvePath(root, filePath) {
  if (!filePath) return "";
  return path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
}

async function loadSharedAddressBook(root, filePath) {
  const resolved = resolvePath(root, filePath);
  if (!resolved) {
    return {
      metadata: { enabled: false, entriesCount: 0 },
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
        dataQuality: {
          source: "Shared Address Book",
          status: "missing",
          message: "Shared address book file is missing; label comparison is unavailable."
        }
      };
    }
    return {
      metadata: { enabled: true, entriesCount: 0 },
      dataQuality: {
        source: "Shared Address Book",
        status: "error",
        message: `Shared address book failed to load: ${error.message}`
      }
    };
  }
}

module.exports = {
  loadSharedAddressBook
};
