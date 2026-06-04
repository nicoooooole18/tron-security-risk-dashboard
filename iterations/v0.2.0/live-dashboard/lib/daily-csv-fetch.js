const fs = require("node:fs/promises");
const path = require("node:path");
const { parseCsv } = require("./source-top-account-csv");

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

function nextUtcDate(date) {
  const time = new Date(`${date}T00:00:00.000Z`).getTime();
  return new Date(time + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function buildUrl(base, { from, end, accessToken, format }) {
  if (!base) throw new Error("daily CSV API base is not configured");
  const url = new URL(base);
  url.searchParams.set("from", from);
  url.searchParams.set("end", end);
  if (accessToken) url.searchParams.set("accessToken", accessToken);
  if (format) url.searchParams.set("format", format);
  return url.toString();
}

async function fetchCsvRows({ url, targetDate, sourceName }) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${sourceName} returned HTTP ${response.status}`);
  const text = await response.text();
  const rows = parseCsv(text);
  const targetRows = rows.filter((row) => row["日期"] === targetDate);
  if (!targetRows.length) {
    const availableDates = [...new Set(rows.map((row) => row["日期"]).filter(Boolean))].sort();
    throw new Error(`${sourceName} did not return target date ${targetDate}; available dates: ${availableDates.join(",") || "none"}`);
  }
  return { rows, targetRows };
}

async function writeDailyCsv(filePath, rows) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `\uFEFF${rowsToCsv(rows)}\n`, "utf8");
}

async function prepareDailyCsvSources(paths, targetDate) {
  if (!paths.autoFetchDailyCsv) {
    return {
      paths,
      dataQuality: []
    };
  }
  if (!paths.labcAccessToken) throw new Error("LABC_ACCESS_TOKEN is required when AUTO_FETCH_DAILY_CSV=true");
  if (!paths.lendInfoApiBase) throw new Error("LEND_INFO_API_BASE is required when AUTO_FETCH_DAILY_CSV=true");
  if (!paths.topAccountApiBase) throw new Error("TOP_ACCOUNT_API_BASE is required when AUTO_FETCH_DAILY_CSV=true");

  const endDate = nextUtcDate(targetDate);
  const lendInfoUrl = buildUrl(paths.lendInfoApiBase, {
    from: targetDate,
    end: endDate,
    accessToken: paths.labcAccessToken
  });
  const topAccountUrl = buildUrl(paths.topAccountApiBase, {
    from: targetDate,
    end: endDate,
    accessToken: paths.labcAccessToken,
    format: "csv"
  });

  const [lendInfo, topAccount] = await Promise.all([
    fetchCsvRows({ url: lendInfoUrl, targetDate, sourceName: "exportLendInfo daily CSV" }),
    fetchCsvRows({ url: topAccountUrl, targetDate, sourceName: "Top Account daily CSV" })
  ]);

  const lendInfoFile = path.join(paths.sourceCsvDir, `lend-info-daily-${targetDate}.csv`);
  const topAccountFile = path.join(paths.sourceCsvDir, `top-account-daily-${targetDate}.csv`);
  await Promise.all([
    writeDailyCsv(lendInfoFile, lendInfo.targetRows),
    writeDailyCsv(topAccountFile, topAccount.targetRows)
  ]);

  return {
    paths: {
      ...paths,
      lendInfoCsvFiles: [...(paths.lendInfoCsvFiles || []), lendInfoFile],
      topAccountCsvFiles: [...(paths.topAccountCsvFiles || []), topAccountFile]
    },
    dataQuality: [
      {
        source: "Daily CSV Auto Fetch",
        status: "complete",
        message: `Fetched target date ${targetDate}: exportLendInfo ${lendInfo.targetRows.length}/${lendInfo.rows.length} rows, Top Account ${topAccount.targetRows.length}/${topAccount.rows.length} rows.`
      }
    ],
    files: {
      lendInfoFile,
      topAccountFile
    }
  };
}

module.exports = {
  prepareDailyCsvSources,
  nextUtcDate
};
