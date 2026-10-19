# License Key Panel

A standalone, self-hostable license key management panel for your own apps.
Node.js + Express with a JSON file database — no native modules, no build step.

## Requirements

- Node.js 18 or newer
- npm

## Quick start

```bash
cd panel-standalone
npm install
npm start
```

Open http://localhost:3000 in your browser.

To use a different port:

```bash
PORT=8080 npm start
```

## Default login

- **Master:** username `admin`, password `admin123`
- **Reseller:** create reseller accounts from *Manage Reseller* after signing in as master

Change the master password immediately after first login (Settings → Change Password).

## Data

All data is stored in `data/db.json` (created and seeded automatically on first
run). **Back this file up regularly** — it holds your keys, resellers, prices,
activity log and sessions. The panel logo (if uploaded) is stored as
`data/logo.png` / `data/logo.jpg` in the same folder.

## Free hosting options

- **Render:** push this folder to a GitHub repo, create a *Free Web Service*,
  set the start command to `npm start`. (The free tier may sleep when idle and
  its disk is ephemeral — back up `data/db.json` if you rely on it.)
- **Railway:** new project from the repo, `npm start` as the start command.
- **VPS (recommended for real use):** any small VPS with Node 18+:

```bash
npm install -g pm2
pm2 start server.js --name panel
pm2 save && pm2 startup
```

Put the panel behind HTTPS in production (reverse proxy with nginx/Caddy or
your host's TLS), keep it behind the login screen, and change the default
admin credentials.

## Connecting your app

Apps verify keys with a single public endpoint — no auth needed:

```
POST {panel-base-url}/verify
Content-Type: application/json

{ "key": "1DayXabc123def45", "deviceId": "unique-device-id", "deviceName": "Pixel 8 (optional)" }
```

Response on success:

```json
{ "valid": true, "duration": "1day", "durationLabel": "1 Day",
  "devicesUsed": 1, "maxDevices": 3, "expiresAt": 1760900000000,
  "message": "Login successful." }
```

Response on failure:

```json
{ "valid": false, "reason": "expired", "message": "This key has expired." }
```

Possible `reason` values: `maintenance`, `not_found`, `banned`, `revoked`,
`expired`, `blocked`, `device_limit`, `device_required`.

Notes:

- Expiry counts from **first activation**; a key shows "Not activated yet"
  until its first successful verify.
- A device is bound to the key on first verify. New devices are rejected once
  the device limit is reached (`device_limit`).
- Setting Server Control to OFF blocks only key verification/activation —
  panel logins stay open. App users see "Server in maintenance" plus your
  broadcast message.

## Notes

- This panel starts with a completely fresh database. Nothing is imported from
  any other (e.g. hosted) version — you create resellers and generate keys here
  from scratch.
- Reseller key generation deducts `price × device limit × count` from their
  balance. Master generation is free.
- Deleting an **unused** reseller key refunds its cost to that reseller;
  used keys are not refunded.
- In Manage Price (master) you can add your own durations (e.g. 15 Day) with
  a price, and delete any duration. Existing keys keep working after their
  duration is deleted. Re-adding a deleted built-in duration (e.g. 3 Day)
  restores it with the new price.
