const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const DAY_MS = 24 * 60 * 60 * 1000;

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function latestCompleteUtcDate(now = new Date()) {
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(utcMidnight - DAY_MS).toISOString().slice(0, 10);
}

function loadEnvFile(filePath) {
  if (!filePath) return;
  const content = fs.readFileSync(path.resolve(filePath), "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function runCommand(command, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    maxBuffer: 20 * 1024 * 1024
  });
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
}

async function runRemote(command) {
  const sshKey = env("VPS_SSH_KEY", "/Users/lanyu/OpenClaw/openclaw2.pem");
  const sshPort = env("VPS_SSH_PORT", "6673");
  const sshUser = env("VPS_SSH_USER", "openclaw");
  const sshHost = env("VPS_SSH_HOST", "43.134.57.52");
  await runCommand("ssh", [
    "-i", sshKey,
    "-p", sshPort,
    "-o", "IdentitiesOnly=yes",
    `${sshUser}@${sshHost}`,
    command
  ]);
}

async function verifyPublicApi(targetDate) {
  const publicUrl = env("PUBLIC_DASHBOARD_URL", "http://43.134.57.52").replace(/\/$/, "");
  const response = await fetch(`${publicUrl}/api/snapshot?period=90d`);
  if (!response.ok) throw new Error(`Public snapshot API returned HTTP ${response.status}`);
  const snapshot = await response.json();
  if (snapshot.lastCompleteUtcDate !== targetDate) {
    throw new Error(
      `Public snapshot dataThrough mismatch: expected ${targetDate}, got ${snapshot.lastCompleteUtcDate || "empty"}`
    );
  }
  console.log(JSON.stringify({
    status: "verified",
    publicUrl,
    lastCompleteUtcDate: snapshot.lastCompleteUtcDate,
    generatedAt: snapshot.generatedAt
  }, null, 2));
}

async function run() {
  loadEnvFile(env("LOCAL_ENV_FILE"));

  const targetDate = env("TARGET_DATE", latestCompleteUtcDate());
  const dashboardDir = env(
    "VPS_DASHBOARD_DIR",
    "/home/openclaw/project/justlend-capital-dashboard/iterations/v0.2.0/live-dashboard"
  );
  const restartService = env("RESTART_VPS_SERVICE", "true") === "true";
  const verifyApi = env("VERIFY_PUBLIC_API", "true") === "true";

  await runCommand(process.execPath, [path.join(__dirname, "sync-top-account-daily.js")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      TARGET_DATE: targetDate,
      UPLOAD_TO_VPS: env("UPLOAD_TO_VPS", "true")
    }
  });

  await runRemote(`cd ${dashboardDir} && set -a && . ./.env && set +a && node snapshot-job.js`);

  if (restartService) {
    await runRemote("systemctl --user restart justlend-capital-dashboard.service");
  }

  if (verifyApi) {
    await verifyPublicApi(targetDate);
  }

  console.log(JSON.stringify({
    status: "success",
    targetDate,
    uploadedTopAccount: true,
    vpsSnapshotRefreshed: true,
    restartedService: restartService,
    verifiedPublicApi: verifyApi
  }, null, 2));
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
