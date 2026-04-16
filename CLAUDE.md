# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Development server with nodemon auto-reload
npm start        # Production server
npm test         # Run all tests (Jest, isolated, sequential)
```

Run a single test file:
```bash
npx jest test/auth.test.js --forceExit
```

Docker:
```bash
docker compose up -d                        # Start on port 3000
ARMORY_HOST_PORT=8080 docker compose up -d  # Custom port
```

## Architecture

**Armory** is a self-hosted firearms inventory management web app. Stack: Express.js + EJS templates + Better-SQLite3 (synchronous driver). No build step — plain server-side rendering.

### Request flow

```
server.js  →  routes/*.js  →  middleware/{auth,csrf,upload,audit}.js  →  db.js  →  views/*.ejs
```

- `server.js` — bootstraps Express, session store, Helmet/rate-limiter, mounts all routers
- `db.js` — single file containing all schema migrations (49 tracked in `schema_migrations`) and all query functions; runs migrations on every startup
- `routes/` — 7 modules: `auth`, `inventory`, `trusts`, `optics`, `mags`, `settings`, `search`, plus `api` for authenticated file serving
- `middleware/` — `auth.js` (requireAuth/requireAdmin), `csrf.js` (token + multipart handling), `upload.js` (Multer), `audit.js` (JSON audit log to stdout), `asyncHandler.js`
- `views/` — EJS templates with `partials/header.ejs` and `partials/footer.ejs`
- `public/` — static CSS and client-side JS

### Database

Single SQLite file (`better-sqlite3`, synchronous). All migrations live in `db.js` and run automatically on startup. Key tables: `firearms`, `optics_items`, `mags`, `trusts`, `users`, plus photo/document metadata tables for each entity type.

### Security model

- **CSRF**: Token injected per-request via `res.locals.csrfToken`; for multipart routes, Multer runs first then `csrf.js` validates from `req.body`
- **Sessions**: Per-request `session_version` check in `requireAuth` — changing a user's role/password immediately invalidates their active sessions
- **File uploads**: UUID filenames stored in `uploads/{photos,documents,optic-photos,trust-documents}/`; file serving goes through `/api/*` routes that verify session before streaming
- **Spouse mode**: Read-only accounts that see only `spouse_visible` items and `spouse_price` instead of actual price — not a security boundary, an information layer
- **Rate limits**: 4 tiers — login (10/15 min), sensitive writes (20/15 min), exports (5/15 min), general API (300/min)
- **PDF generation**: puppeteer-core + system Chromium (pre-installed in Docker image)

### Testing

Tests use Supertest against a real in-process Express app with an isolated temp SQLite DB per suite (`test/helpers/setup.js` → `createTestEnv()`). No mocks for the database — tests hit the actual query layer.

### Environment variables

See `.env.example`. Required for production: `SESSION_SECRET` (32+ chars), `NODE_ENV=production`. Database paths default to `./data/armory.db` and `./data/sessions.db`.
