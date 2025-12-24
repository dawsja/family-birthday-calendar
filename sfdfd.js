/* eslint-disable no-console */
/**
 * Single entrypoint for PM2.
 *
 * - In production (NODE_ENV=production): starts backend only (it serves frontend/dist).
 * - Otherwise: starts backend + frontend dev servers.
 *
 * Usage:
 *   pm2 start sfdfd.js --name fbc
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function run(cmd, args, opts = {}) {
  const p = spawn(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...(opts.env ?? {}) },
    cwd: opts.cwd ?? process.cwd()
  });

  p.on("exit", (code, signal) => {
    if (signal) {
      console.log(`[${opts.name ?? cmd}] exited with signal ${signal}`);
      return;
    }
    if (code !== 0) {
      console.log(`[${opts.name ?? cmd}] exited with code ${code}`);
      process.exitCode = code ?? 1;
    }
  });

  return p;
}

function hasFrontendDist() {
  return fs.existsSync(path.join(__dirname, "frontend", "dist", "index.html"));
}

function startProduction() {
  if (!hasFrontendDist()) {
    console.log("frontend/dist missing. Build first: npm run build");
  }
  // backend serves frontend/dist when NODE_ENV=production
  run("npm", ["run", "start", "--workspace", "backend"], {
    name: "backend",
    env: { NODE_ENV: "production" }
  });
}

function startDev() {
  run("npm", ["run", "dev", "--workspace", "backend"], { name: "backend" });
  run("npm", ["run", "dev", "--workspace", "frontend", "--", "--host", "0.0.0.0"], {
    name: "frontend"
  });
}

if ((process.env.NODE_ENV ?? "").toLowerCase() === "production") {
  startProduction();
} else {
  startDev();
}

