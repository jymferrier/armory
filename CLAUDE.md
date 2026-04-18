# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # start with nodemon auto-reload (development)
npm start          # start production server
npm test           # run full Jest suite (--runInBand --forceExit)
npx jest test/auth.test.js          # run a single test file
npx jest --testNamePattern "login"  # run tests matching a name pattern

docker compose up -d   # start containerized (port 3000, or ARMORY_HOST_PORT)
docker compose down    # stop
```

No lint command is defined; no separate build step is needed.

## Architecture

**Armory** is a self-hosted Express.js + SQLite firearms inventory app. It runs as a single Docker container with two persistent volumes: `armory_data` (SQLite DB + sessions) and `armory_uploads` (photos/documents).

### Layers

| Layer | Location | Notes |
|-------|----------|-------|
| Entry point | `server.js` | Express setup, Helmet/CSRF/rate-limit middleware, route mounting |
| Database | `db.js` | better-sqlite3 (synchronous), 49+ migrations, 5 query modules |
| Routes | `routes/` | auth, inventory, trusts, optics, mags, settings, search, api |
| Middleware | `middleware/` | auth guards, CSRF, multer uploads, audit logging, asyncHandler |
| Views | `views/` | EJS templates |
| Constants | `lib/constants.js` | NFA_TYPES, field-cap helpers shared across routes and views |

### Data model highlights

- **Firearms** — the core entity. Tracks NFA details, dual pricing (actual vs. "what spouse thinks I paid"), trust assignments, round count, disposal.
- **Spouse mode** — a second user account with `is_spouse_view=1`. Sees filtered inventory and alternate price column; read-only.
- **Optics / Magazines** — separate tables with their own photo support.
- **Trusts** — NFA and non-NFA; firearms can be assigned to a trust.
- **Sessions** — SQLite-backed, 8-hour expiry. Invalidated immediately via `session_version` on password/role changes.

### Security conventions

- CSRF tokens stored in session, regenerated per request; validated in `middleware/csrf.js` for all mutating routes.
- File uploads: Multer replaces original filenames with UUIDs; file type checked by MIME + magic bytes in `middleware/upload.js`. Photos/docs served through authenticated `/api/` routes, never as public static files.
- Rate limiting: login (10/15 min), sensitive writes (20/15 min), exports (5/15 min), API (300/min).
- Account lockout tracked in-memory in `routes/auth.js` (10 attempts → 15 min cooldown).
- All SQL queries are parameterized; no raw string interpolation.

### Testing

Tests in `test/` use Jest + Supertest against isolated temporary SQLite databases created by `test/helpers/setup.js`. The `loginAs()` helper handles login + CSRF token extraction. Each test file is independent — do not share database state across files.

### Export / Import

Settings route handles CSV, JSON, and full ZIP export/import. Import runs inside a SQLite transaction and rolls back on validation errors. ZIP extraction is guarded against zip-slip and file-type bypass (fixed in the most recent commits).
