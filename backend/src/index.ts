import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { getEnv } from "./env";
import { authMiddleware, requireCsrf } from "./auth";
import authRoutes from "./routes/authRoutes";
import meRoutes from "./routes/meRoutes";
import calendarRoutes from "./routes/calendarRoutes";
import adminRoutes from "./routes/adminRoutes";
import updateRoutes from "./routes/updateRoutes";
import { getDb } from "./db";

const env = getEnv();

// Ensure DB initialized early (includes bootstrap admin).
getDb();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    redact: ["req.headers.authorization", "req.headers.cookie"]
  })
);

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "50kb" }));
app.use(cookieParser());

// Security headers
app.use(
  helmet({
    contentSecurityPolicy:
      env.NODE_ENV === "production"
        ? {
            useDefaults: true,
            directives: {
              "default-src": ["'self'"],
              "base-uri": ["'self'"],
              "frame-ancestors": ["'none'"],
              "img-src": ["'self'", "data:"],
              // Tailwind + FullCalendar include inline styles; keep tight otherwise.
              "style-src": ["'self'", "'unsafe-inline'"],
              // Some CSP implementations split these out. FullCalendar injects a <style> tag at runtime.
              "style-src-elem": ["'self'", "'unsafe-inline'"],
              "style-src-attr": ["'self'", "'unsafe-inline'"],
              // FullCalendar embeds its icon font via a data: URL in injected CSS.
              "font-src": ["'self'", "data:"],
              "script-src": ["'self'"],
              "connect-src": ["'self'"],
              "object-src": ["'none'"],
              "upgrade-insecure-requests": []
            }
          }
        : false
  })
);

// CORS for local dev only (frontend runs on a different port).
if (env.NODE_ENV !== "production") {
  app.use(
    cors({
      origin: env.APP_ORIGIN,
      credentials: true
    })
  );
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api", apiLimiter);
app.use(authMiddleware);

// CSRF protection for all state-changing API calls except login.
app.use("/api", (req, res, next) => {
  if (
    req.path === "/auth/login" ||
    req.path === "/auth/logout" ||
    req.path === "/auth/set-password"
  ) {
    return next();
  }
  return requireCsrf(req, res, next);
});

app.use("/api/auth", authRoutes);
app.use("/api/me", meRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/updates", updateRoutes);
app.use("/api/admin", adminRoutes);

app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));

// Serve built frontend in production.
if (env.NODE_ENV === "production") {
  const distDir = path.join(__dirname, "../../frontend/dist");
  const indexHtml = path.join(distDir, "index.html");
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(distDir, { index: false, maxAge: "1h" }));
    // Express v5 uses a newer path-to-regexp which doesn't accept "*" as a path string.
    // Use a RegExp catch-all for SPA routing.
    app.get(/.*/, (_req, res) => res.sendFile(indexHtml));
  }
}

// Central error handler (avoid leaking internals).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err);
  return res.status(500).json({ error: "internal_error" });
});

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on :${env.PORT} (${env.NODE_ENV})`);
});

