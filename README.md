# ReadyRoom

Squadron / wing management for a DCS community — **roster, qualifications, sortie activity, and ops**.

ReadyRoom is the org/command layer that sits above the rest of the tooling. It is a
**standalone** site (its own database, useful on its own), and it pairs with the other
tools when they're connected:

- **VectorBot** — Discord-side capture + the live DCS telemetry feed.
- **Mizmaker** — the mission planner (linked to ops, later).

The single most important thing ReadyRoom owns is the **identity bridge**: a map from the
freeform in-game DCS pilot name (which is all the telemetry gives us) to a real roster
member. That's what lets sortie data light up per-pilot logbooks, currency, and activity.

## Stack

- **Backend**: Node + Express 5, `node:sqlite` (no native build step), Discord OAuth, SQLite-backed sessions.
- **Frontend**: React + Vite (SPA served by the backend in production).
- **Deploy**: Railway, with the SQLite file on a mounted volume (`DB_PATH=/data/readyroom.db`).

## Data model

```
wing ──< squadron ──< member ──< pilot_alias   (alias = in-game DCS name -> member)
                         member ──< member_qual >── qual
sortie  (ingested telemetry, attributed to a member via pilot_alias)
```

## Local development

```bash
npm install                # backend deps
npm run dashboard          # Vite dev server for the SPA (separate terminal)
# in another terminal:
ALLOW_DEV_LOGIN=1 npm run dev   # backend on :4700 with a no-Discord login bypass
```

Then open the backend at http://localhost:4700 and visit `/auth/dev-login` once to sign in
as a local super-admin (dev only). For a production-like run, build the SPA first:

```bash
npm run build && npm start
```

## Configuration

See `.env.example`. Key vars: `PORT`, `DB_PATH`, `SESSION_SECRET`, `DISCORD_CLIENT_ID`,
`DISCORD_CLIENT_SECRET`, `ROOT_ADMIN_IDS` (bootstrap super-admins), `BASE_URL`.

## Sortie ingest (forward-looking)

Each wing has a token. POST sortie batches to `/ingest/<token>`:

```json
{ "type": "sorties", "source": "dcs", "sorties": [
  { "pilot": "Maverick", "airframe": "F-14B", "seconds": 3600, "started_at": 1700000000000 }
] }
```

Pilots are matched to members through the alias map; unmatched names surface under
`GET /api/unmatched-aliases?wing_id=` for an admin to claim.
