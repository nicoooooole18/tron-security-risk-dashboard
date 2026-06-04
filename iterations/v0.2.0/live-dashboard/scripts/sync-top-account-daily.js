const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { parseCsv } = require("../lib/source-top-account-csv");

const execFileAsync = promisify(execFile);
const DAY_MS = 24 * 60 * 60 * 1000;

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function latestCompleteUtcDate(now = new Date()) {
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(utcMidnight - DAY_MS).toISOString().slice(0, 10);
}

function nextUtcDate(date) {
  const time = new Date(`${date}T00:00:00.000Z`).getTime();
  return new Date(time + DAY_MS).toISOString().slice(0, 10);
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function rowsToCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))
  ].join("\n");
}

function buildUrl(base, { from, end, accessToken }) {
  const url = new URL(base);
  url.searchParams.set("from", from);
  url.searchParams.set("end", end);
  url.searchParams.set("accessToken", accessToken);
  url.searchParams.set("format", "csv");
  return url.toString();
}

async function run() {
  const targetDate = env("TARGET_DATE", latestCompleteUtcDate());
  const endDate = nextUtcDate(targetDate);
  const apiBase = env("TOP_ACCOUNT_API_BASE", "https://labc.ablesdxd.link/admin/justlend/getDailyTopAccountDetails");
  const accessToken = env("LABC_ACCESS_TOKEN");
  const outputDir = env("LOCAL_SOURCE_CSV_DIR", path.join(__dirname, "../data/source-csv"));
  const upload = env("UPLOAD_TO_VPS", "false") === "true";
  const vpsTarget = env("VPS_SOURCE_CSV_TARGET", "openclaw@43.134.57.52:/home/openclaw/project/justlend-capital-data/source/");
  const sshKey = env("VPS_SSH_KEY", "/Users/lanyu/OpenClaw/openclaw2.pem");
  const sshPort = env("VPS_SSH_PORT", "6673");

  if (!accessToken) throw new Error("LABC_ACCESS_TOKEN is required");

  const url = buildUrl(apiBase, { from: targetDate, end: endDate, accessToken });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Top Account daily CSV returned HTTP ${response.status}`);
  const rows = parseCsv(await response.text());
  const targetRows = rows.filter((row) => row["日期"] === targetDate);
  if (!targetRows.length) {
    const availableDates = [...new Set(rows.map((row) => row["日期"]).filter(Boolean))].sort();
    throw new Error(`Top Account daily CSV did not include ${targetDate}; available dates: ${availableDates.join(",") || "none"}`);
  }

  await fs.mkdir(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, `top-account-daily-${targetDate}.csv`);
  await fs.writeFile(outputFile, `\uFEFF${rowsToCsv(targetRows)}\n`, "utf8");

  if (upload) {
    await execFileAsync("scp", [
      "-i", sshKey,
      "-P", sshPort,
      "-o", "IdentitiesOnly=yes",
      outputFile,
      vpsTarget
    ]);
  }

  console.log(JSON.stringify({
    status: "success",
    targetDate,
    rows: targetRows.length,
    outputFile,
    uploaded: upload,
    vpsTarget: upload ? vpsTarget : null
  }, null, 2));
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
