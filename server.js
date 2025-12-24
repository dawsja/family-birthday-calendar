/* eslint-disable no-console */
/**
 * Production single-process entrypoint for PM2.
 *
 * This runs ONE Node/Express process:
 * - Backend API is served at /api
 * - Frontend (built) is served from frontend/dist (same origin)
 *
 * Usage:
 *   npm run build
 *   NODE_ENV=production pm2 start server.js --name fbc
 */

const fs = require("node:fs");
const path = require("node:path");

// Default to production when running under PM2.
process.env.NODE_ENV = process.env.NODE_ENV || "production";

const backendEntry = path.join(__dirname, "backend", "dist", "index.js");
const frontendIndex = path.join(__dirname, "frontend", "dist", "index.html");

if (!fs.existsSync(backendEntry)) {
  console.error(
    "Missing backend build at backend/dist/index.js. Build first:\n\n  npm install\n  npm run build\n"
  );
  process.exit(1);
}

if (process.env.NODE_ENV === "production" && !fs.existsSync(frontendIndex)) {
  console.error(
    "Missing frontend build at frontend/dist/index.html. Build first:\n\n  npm install\n  npm run build\n"
  );
  process.exit(1);
}

// The backend is the Express server; it also serves frontend/dist in production.
// Requiring it here keeps this as a single process for PM2.
require(backendEntry);

