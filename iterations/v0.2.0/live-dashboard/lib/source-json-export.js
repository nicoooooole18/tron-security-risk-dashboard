const fs = require("node:fs/promises");
const path = require("node:path");

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function loadJsonExport({ sourceJsonDir, fallbackSnapshotPath }) {
  const dailySnapshotPath = path.join(sourceJsonDir, "daily-snapshot.json");
  const snapshotPath = path.join(sourceJsonDir, "snapshot.json");
  let sourcePath = dailySnapshotPath;
  let snapshot = await readJsonIfExists(dailySnapshotPath);
  if (!snapshot) {
    sourcePath = snapshotPath;
    snapshot = await readJsonIfExists(snapshotPath);
  }
  if (!snapshot) {
    sourcePath = fallbackSnapshotPath;
    snapshot = await readJsonIfExists(fallbackSnapshotPath);
  }

  if (!snapshot) {
    throw new Error(`json-export source not found in ${sourceJsonDir}`);
  }

  return {
    sourceAdapter: "json-export",
    snapshot,
    facts: {
      userPositions: await readJsonIfExists(path.join(sourceJsonDir, "user-positions-daily.json")) || [],
      userAssetPositions: await readJsonIfExists(path.join(sourceJsonDir, "user-asset-positions-daily.json")) || [],
      capitalFlowEvents: await readJsonIfExists(path.join(sourceJsonDir, "capital-flow-events.json")) || [],
      capitalMigrationPaths: await readJsonIfExists(path.join(sourceJsonDir, "capital-migration-paths.json")) || []
    },
    dataQuality: [
      {
        source: "Source Adapter",
        status: "complete",
        message: `json-export base snapshot loaded from ${sourcePath}; production adapters can override asset, Top20, and chain marts before SQLite persistence.`
      }
    ]
  };
}

module.exports = {
  loadJsonExport
};
