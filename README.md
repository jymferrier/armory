# ARMORY — Firearms Inventory System

A self-hosted, Dockerized web application for cataloguing a personal firearms inventory. Supports photos, NFA documents, and secure multi-user access.

---

## Features

- **Inventory management** — manufacturer, model, caliber, serial number, optics/accessories, notes
- **Photo gallery** — multiple photos per firearm, primary photo selection
- **NFA support** — NFA flag, item type classification, ATF Form and Form 5320 uploads
- **Document storage** — upload and download PDF/image documents per firearm
- **Session authentication** — form-based login with bcrypt password hashing
- **User management** — add/remove users, change passwords
- **Search** — filter inventory by manufacturer, model, serial, or caliber
- **Fully containerized** — runs as a single Docker container with persistent volumes

---

## Quick Start

### Prerequisites
- Docker + Docker Compose

### 1. Clone / download the project

```bash
git clone <your-repo> armory
cd armory
```

### 2. Configure environment (optional)

Edit `docker-compose.yml` and set:

```yaml
environment:
  - SESSION_SECRET=your-long-random-secret-here   # CHANGE THIS
  - DEFAULT_USER=admin                             # initial login username
  - DEFAULT_PASS=armory123                         # initial login password
```

> **Important:** Change `SESSION_SECRET` to a random 32+ character string before deploying.

### 3. Build and run

```bash
docker compose up -d --build
```

### 4. Access the app

Open **http://localhost:3000** and log in with your configured credentials.

---

## Data Persistence

All data is stored in named Docker volumes:

| Volume | Contents |
|--------|----------|
| `armory_data` | SQLite database (`armory.db`) and sessions |
| `armory_uploads` | Firearm photos and documents |

To back up your data:

```bash
# Find volume paths
docker volume inspect armory_data
docker volume inspect armory_uploads

# Or copy out of a running container
docker cp armory:/app/data ./backup/data
docker cp armory:/app/uploads ./backup/uploads
```

---

## Running Without Docker (Development)

```bash
npm install
node server.js
# or with auto-reload:
npm install -g nodemon
nodemon server.js
```

---

## Changing the Port

Edit `docker-compose.yml`:

```yaml
ports:
  - "8080:3000"   # maps host port 8080 → container port 3000
```

---

## Security Notes

- Passwords are hashed with bcrypt (cost factor 10)
- Sessions are stored in SQLite and expire after 8 hours
- File uploads are validated by MIME type and extension
- Uploaded filenames are replaced with UUIDs (no path traversal risk)
- The app runs as a non-root user inside the container
- For production, place behind a reverse proxy (nginx/Caddy) with HTTPS

---

## Supported File Types

| Upload Type | Accepted Formats |
|-------------|-----------------|
| Photos | JPG, PNG, GIF, WEBP (max 20MB each) |
| Documents | PDF, JPG, PNG, GIF, WEBP, DOC, DOCX (max 50MB each) |

Up to 20 photos and unlimited documents per firearm.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `N` | New firearm (from inventory page) |
| `/` | Focus search box |
