# ARMORY — Firearms Inventory System

A self-hosted, Dockerized web application for cataloguing a personal firearms inventory. Supports photos, NFA documents, trust assignment documents, and secure multi-user access.

---

## Screenshots

### Inventory — Grid View
![Inventory Grid](screenshots/02-inventory-grid.png)

### Inventory — List View
![Inventory List](screenshots/03-inventory-list.png)

### Firearm Detail
![Firearm Detail](screenshots/04-firearm-detail.png)

### NFA Item Detail
![NFA Detail](screenshots/05-nfa-detail.png)

### Add Firearm
![Add Firearm Form](screenshots/06-add-form.png)

### Trust Management
![Trusts](screenshots/07-trusts-list.png)

### Trust Assignment
![Trust Detail](screenshots/08-trust-detail.png)

### Settings
![Settings](screenshots/09-settings.png)

---

## Features

- **Inventory management** — manufacturer, model, caliber, serial, barrel length, optics/accessories (tag-based), notes
- **Grid & list views** — toggle between card grid and compact list; preference saved per browser
- **NFA tracking** — Form 1 / Form 4, FMI flag, tax stamp serial, ATF submit/approval dates, wait-time tracker
- **Trust assignment** — manage NFA trusts, assign any inventory item, generate printable legal assignment documents
- **Round count** — log rounds fired per firearm with a quick-add form; cumulative total tracked automatically
- **Acquisition records** — acquired date, acquired from, price paid, transfer date, FFL transferred from
- **3D printed firearms** — checkbox renames Manufacturer → Creator
- **Photo gallery** — multiple photos per firearm, primary photo selection, drag-and-drop upload
- **Document storage** — upload ATF forms, Form 5320, and additional documents per firearm
- **Export / Import** — CSV and JSON export; CSV and JSON import for bulk data transfer
- **Database purge** — typed confirmation (`PURGE`) required to wipe all data
- **Search** — searches across make, model, serial, caliber, optics tags, notes, and item type
- **Manufacturer autocomplete** — datalist populated from existing entries
- **Disposition tracking** — mark items as transferred/sold with date and method
- **Session authentication** — form-based login with bcrypt password hashing
- **User management** — add/remove users, change passwords

---

## Quick Start

**Requirements:** Docker and Docker Compose

```bash
git clone https://github.com/jymferrier/armory.git
cd armory
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000) and log in.

Default credentials: `admin` / `armory123`

> **Change your password** in Settings after first login.

### Custom port

```bash
ARMORY_HOST_PORT=8080 docker compose up -d
```

Or edit `docker-compose.yml` directly and set `SESSION_SECRET` to a random 32+ character string before deploying.

---

## Data Persistence

All data is stored in named Docker volumes:

| Volume | Contents |
|--------|----------|
| `armory_data` | SQLite database (`armory.db`) and sessions |
| `armory_uploads` | Firearm photos and documents |

To back up your data:

```bash
docker cp armory:/app/data ./backup/data
docker cp armory:/app/uploads ./backup/uploads
```

Or export a full JSON snapshot any time from **Settings → Export JSON**.

---

## Running Without Docker (Development)

```bash
npm install
node server.js
# or with auto-reload:
npx nodemon server.js
```

---

## Security Notes

- Passwords are hashed with bcrypt (cost factor 10)
- Sessions stored in SQLite, expire after 8 hours
- Uploaded filenames replaced with UUIDs (no path traversal risk)
- App runs as non-root user inside the container
- For production, place behind a reverse proxy (nginx/Caddy) with HTTPS

---

## Supported File Types

| Upload Type | Accepted Formats |
|-------------|-----------------|
| Photos | JPG, PNG, GIF, WEBP — max 20MB each |
| Documents | PDF, JPG, PNG, DOC, DOCX — max 50MB each |
