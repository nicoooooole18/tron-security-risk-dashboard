async function discoverExistingDb({ existingDbDsn }) {
  if (!existingDbDsn) {
    return {
      ready: false,
      message: "EXISTING_DB_DSN is not configured; existing-db adapter cannot run schema discovery."
    };
  }

  return {
    ready: false,
    message: "existing-db adapter is reserved for read-only production DB discovery. Provide schema mapping before enabling ingestion."
  };
}

async function loadExistingDb(options) {
  const discovery = await discoverExistingDb(options);
  throw new Error(discovery.message);
}

module.exports = {
  discoverExistingDb,
  loadExistingDb
};
