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

async function fileExists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

function dailyFilePaths(sourceCsvDir, targetDate) {
  return {
    lendInfoFile: path.join(sourceCsvDir, `lend-info-daily-${targetDate}.csv`),
    topAccountFile: path.join(sourceCsvDir, `top-account-daily-${targetDate}.csv`)
  };
}

async function discoverDailyCsvFiles(sourceCsvDir) {
  const files = await fs.readdir(sourceCsvDir).catch(() => []);
  return {
    lendInfoFiles: files
      .filter((name) => /^lend-info-daily-\d{4}-\d{2}-\d{2}\.csv$/.test(name))
      .sort()
      .map((name) => path.join(sourceCsvDir, name)),
    topAccountFiles: files
      .filter((name) => /^top-account-daily-\d{4}-\d{2}-\d{2}\.csv$/.test(name))
      .sort()
      .map((name) => path.join(sourceCsvDir, name))
  };
}

async function assertCsvHasTargetDate(filePath, targetDate, sourceName) {
  if (!(await fileExists(filePath))) {
    throw new Error(`${sourceName} daily CSV is missing for target date ${targetDate}: ${filePath}`);
  }
  const rows = parseCsv(await fs.readFile(filePath, "utf8"));
  const targetRows = rows.filter((row) => row["日期"] === targetDate);
  if (!targetRows.length) {
    const availableDates = [...new Set(rows.map((row) => row["日期"]).filter(Boolean))].sort();
    throw new Error(`${sourceName} daily CSV file does not contain target date ${targetDate}; available dates: ${availableDates.join(",") || "none"}`);
  }
  return targetRows.length;
}

async function prepareDailyCsvSources(paths, targetDate) {
  if (!paths.autoFetchDailyCsv) {
    const discovered = await discoverDailyCsvFiles(paths.sourceCsvDir);
    return {
      paths: {
        ...paths,
        lendInfoCsvFiles: [...(paths.lendInfoCsvFiles || []), ...discovered.lendInfoFiles],
        topAccountCsvFiles: [...(paths.topAccountCsvFiles || []), ...discovered.topAccountFiles]
      },
      dataQuality: []
    };
  }
  if (!paths.labcAccessToken) throw new Error("LABC_ACCESS_TOKEN is required when AUTO_FETCH_DAILY_CSV=true");
  if (paths.autoFetchLendInfoDaily && !paths.lendInfoApiBase) throw new Error("LEND_INFO_API_BASE is required when AUTO_FETCH_LEND_INFO_DAILY=true");
  if (paths.autoFetchTopAccountDaily && !paths.topAccountApiBase) throw new Error("TOP_ACCOUNT_API_BASE is required when AUTO_FETCH_TOP_ACCOUNT_DAILY=true");

  const endDate = nextUtcDate(targetDate);
  const { lendInfoFile, topAccountFile } = dailyFilePaths(paths.sourceCsvDir, targetDate);
  const qualityMessages = [];

  if (paths.autoFetchLendInfoDaily) {
    const lendInfoUrl = buildUrl(paths.lendInfoApiBase, {
      from: targetDate,
      end: endDate,
      accessToken: paths.labcAccessToken
    });
    const lendInfo = await fetchCsvRows({ url: lendInfoUrl, targetDate, sourceName: "exportLendInfo daily CSV" });
    await writeDailyCsv(lendInfoFile, lendInfo.targetRows);
    qualityMessages.push(`exportLendInfo ${lendInfo.targetRows.length}/${lendInfo.rows.length} rows`);
  }

  if (paths.autoFetchTopAccountDaily) {
    const topAccountUrl = buildUrl(paths.topAccountApiBase, {
      from: targetDate,
      end: endDate,
      accessToken: paths.labcAccessToken,
      format: "csv"
    });
    const topAccount = await fetchCsvRows({ url: topAccountUrl, targetDate, sourceName: "Top Account daily CSV" });
    await writeDailyCsv(topAccountFile, topAccount.targetRows);
    qualityMessages.push(`Top Account ${topAccount.targetRows.length}/${topAccount.rows.length} rows`);
  } else {
    const targetRows = await assertCsvHasTargetDate(topAccountFile, targetDate, "Top Account");
    qualityMessages.push(`Top Account uploaded file ${targetRows} rows`);
  }

  if (!paths.autoFetchLendInfoDaily) {
    const targetRows = await assertCsvHasTargetDate(lendInfoFile, targetDate, "exportLendInfo");
    qualityMessages.push(`exportLendInfo uploaded file ${targetRows} rows`);
  }

  const discovered = await discoverDailyCsvFiles(paths.sourceCsvDir);

  return {
    paths: {
      ...paths,
      lendInfoCsvFiles: [...(paths.lendInfoCsvFiles || []), ...discovered.lendInfoFiles],
      topAccountCsvFiles: [...(paths.topAccountCsvFiles || []), ...discovered.topAccountFiles]
    },
    dataQuality: [
      {
        source: "Daily CSV Auto Fetch",
        status: "complete",
        message: `Prepared target date ${targetDate}: ${qualityMessages.join(", ")}.`
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
