# Family Birthday Calendar (shared)

Secure, mobile-friendly “Google Calendar”-style web app for a family birthday calendar:

- **Shared calendar**: everyone sees the same calendar (no personal calendars).
- **Birthdays**: normal users set their birthday on first login → auto appears as an all‑day event each year.
- **Venmo**: normal users set their Venmo handle on first login → shown on birthday events.
- **Life updates**: anyone can add an all‑day “update” on a date (new job, moved, etc.).
- **Admin UI**: admins can create users + reset passwords.
- **Light/Dark mode**: toggle in the UI; respects system preference initially.

## Tech

- **Backend**: Node.js + Express + SQLite (`better-sqlite3`)
- **Frontend**: React + Vite + FullCalendar

## Security / hardening highlights

- **Argon2id password hashing**
- **Server-side sessions** stored in SQLite; session token is **httpOnly** cookie (`SameSite=Strict`)
- **CSRF protection** via per-session token (`x-csrf-token`) on all state-changing endpoints
- **Rate limiting** on login + overall API rate limit
- **Helmet** security headers (strict CSP in production)
- **Small request body limits** to reduce abuse

## Getting started (dev)

### 1) Install

```bash
npm install
```

### 2) Backend env

Copy `backend/.env.example` to `backend/.env` and set a strong bootstrap admin password:

```bash
cp backend/.env.example backend/.env
```

### 3) Run

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

On first backend start, if no admin exists, it will create one using:

- `BOOTSTRAP_ADMIN_USERNAME`
- `BOOTSTRAP_ADMIN_PASSWORD`

Then log in, open **Admin**, and create family users.

## Production build

```bash
npm run build
npm run start
```

The backend serves the compiled frontend from `frontend/dist` when `NODE_ENV=production`.

## PM2

This repo includes `sfdfd.js` as a single PM2 entrypoint.

### Production

```bash
npm run build
NODE_ENV=production pm2 start sfdfd.js --name fbc
```

### Dev (optional)

```bash
pm2 start sfdfd.js --name fbc-dev
```
