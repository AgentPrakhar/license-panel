/* License Key Panel - standalone server
 * Node.js + Express only. JSON file database at data/db.json.
 * Run: npm install && npm start
 */
const express = require("express");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const DURATIONS = {
  "5hour": { ms: 5 * 3600 * 1000, label: "5 Hour", prefix: "5hourX" },
  "1day": { ms: 24 * 3600 * 1000, label: "1 Day", prefix: "1DayX" },
  "3day": { ms: 3 * 24 * 3600 * 1000, label: "3 Day", prefix: "3DayX" },
  "7day": { ms: 7 * 24 * 3600 * 1000, label: "7 Day", prefix: "7DayX" },
  "30day": { ms: 30 * 24 * 3600 * 1000, label: "30 Day", prefix: "30DayX" },
  "60day": { ms: 60 * 24 * 3600 * 1000, label: "60 Day", prefix: "60DayX" },
  "lifetime": { ms: null, label: "Lifetime", prefix: "LifetimeX" },
};
const DURATION_ORDER = ["5hour", "1day", "3day", "7day", "30day", "60day", "lifetime"];
const DEFAULT_PRICES = { "5hour": 30, "1day": 80, "3day": 150, "7day": 300, "30day": 500, "60day": 1000, "lifetime": 1500 };
const EXPIRING_SOON_MS = 3 * 24 * 3600 * 1000;

/* ---------------- utils ---------------- */
function uid() { return crypto.randomBytes(12).toString("hex"); }
function token() { return crypto.randomBytes(32).toString("hex"); }
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  try {
    const h = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(h, "hex"), Buffer.from(hash, "hex"));
  } catch { return false; }
}
function randomKeyCode(prefix) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 11; i++) s += chars[crypto.randomInt(0, chars.length)];
  return prefix + s;
}
function isExpired(key) {
  return key.expiresAt != null && key.expiresAt < Date.now();
}
function escCsv(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* ---------------- database ---------------- */
function blankDb() {
  const { salt, hash } = hashPassword("admin123");
  return {
    master: { username: "admin", salt, hash, role: "Administrator", logo: null },
    resellers: [],
    keys: [],
    prices: { ...DEFAULT_PRICES },
    referrals: [],
    activity: [],
    server: { enabled: true, broadcast: "" },
    sessions: {},
  };
}
function loadDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const db = blankDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    console.log("Created fresh database at data/db.json (default login: admin / admin123)");
    return db;
  }
  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  db.master = db.master || blankDb().master;
  db.resellers = db.resellers || [];
  db.keys = db.keys || [];
  db.prices = { ...DEFAULT_PRICES, ...(db.prices || {}) };
  db.referrals = db.referrals || [];
  db.activity = db.activity || [];
  db.server = db.server || { enabled: true, broadcast: "" };
  db.sessions = db.sessions || {};
  return db;
}
let db = loadDb();
function saveDb() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

function logActivity(type, fields) {
  db.activity.unshift({ id: uid(), ts: Date.now(), type, keyCode: null, resellerName: null, deviceId: null, detail: null, amount: null, ...(fields || {}) });
  if (db.activity.length > 5000) db.activity.length = 5000;
  saveDb();
}

/* ---------------- app ---------------- */
const app = express();
app.use(express.json({ limit: "3mb" }));

// CORS: allow apps (e.g. the Key Login APK WebView) to call /verify cross-origin.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Public: logo
app.get("/logo", (req, res) => {
  const png = path.join(DATA_DIR, "logo.png");
  const jpg = path.join(DATA_DIR, "logo.jpg");
  if (fs.existsSync(png)) return res.sendFile(png);
  if (fs.existsSync(jpg)) return res.sendFile(jpg);
  res.status(404).end();
});

/* ---------------- auth ---------------- */
function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const t = header.startsWith("Bearer ") ? header.slice(7) : null;
  const sess = t && db.sessions[t];
  if (!sess) return res.status(401).json({ ok: false, error: "Unauthorized." });
  req.token = t;
  req.session = sess;
  next();
}
function requireMaster(req, res, next) {
  if (req.session.role !== "master") return res.status(403).json({ ok: false, error: "Master only." });
  next();
}
function scopeKeys(req) {
  if (req.session.role === "master") return db.keys.filter((k) => k.createdBy === "master");
  return db.keys.filter((k) => k.createdBy === req.session.resellerId);
}

app.post("/api/login", (req, res) => {
  const { mode, username, password } = req.body || {};
  if (mode !== "master" && mode !== "reseller")
    return res.status(400).json({ ok: false, error: "Invalid login mode." });
  const u = String(username || "").trim();
  if (!u || !password) return res.status(401).json({ ok: false, error: "Invalid username or password." });

  if (mode === "master") {
    const m = db.master;
    if (m.username.toLowerCase() !== u.toLowerCase() || !verifyPassword(password, m.salt, m.hash))
      return res.status(401).json({ ok: false, error: "Invalid username or password." });
    const t = token();
    db.sessions[t] = { role: "master", resellerId: null, username: m.username, createdAt: Date.now() };
    saveDb();
    logActivity("login", { detail: "Master signed in." });
    return res.json({ ok: true, token: t, role: "master", username: m.username, displayName: m.role });
  }
  const r = db.resellers.find((x) => x.username.toLowerCase() === u.toLowerCase());
  if (!r || !verifyPassword(password, r.salt, r.hash))
    return res.status(401).json({ ok: false, error: "Invalid username or password." });
  const t = token();
  db.sessions[t] = { role: "reseller", resellerId: r.id, username: r.username, createdAt: Date.now() };
  saveDb();
  logActivity("login", { resellerName: r.username, detail: "Reseller signed in." });
  return res.json({ ok: true, token: t, role: "reseller", username: r.username, displayName: r.name, balance: r.balance });
});

app.post("/api/logout", authRequired, (req, res) => {
  delete db.sessions[req.token];
  saveDb();
  res.json({ ok: true });
});

app.get("/api/me", authRequired, (req, res) => {
  if (req.session.role === "master") {
    return res.json({ ok: true, role: "master", username: db.master.username, displayName: db.master.role, logo: db.master.logo });
  }
  const r = db.resellers.find((x) => x.id === req.session.resellerId);
  if (!r) return res.status(401).json({ ok: false, error: "Account not found." });
  res.json({ ok: true, role: "reseller", username: r.username, displayName: r.name, balance: r.balance, logo: db.master.logo });
});

/* ---------------- dashboard ---------------- */
app.get("/api/dashboard", authRequired, (req, res) => {
  const keys = scopeKeys(req);
  const used = keys.filter((k) => k.activatedAt != null).length;
  const expiringSoon = keys.filter((k) => k.status === "active" && k.expiresAt != null &&
    k.expiresAt - Date.now() > 0 && k.expiresAt - Date.now() <= EXPIRING_SOON_MS).length;
  res.json({
    ok: true,
    totalKeys: keys.length,
    usedKeys: used,
    unusedKeys: keys.length - used,
    totalResellers: req.session.role === "master" ? db.resellers.length : 0,
    expiringSoon,
  });
});

/* ---------------- keys ---------------- */
function keyMatchesFilter(k, status) {
  const now = Date.now();
  switch (status) {
    case "all": return true;
    case "active": return k.status === "active" && !isExpired(k);
    case "used": return k.activatedAt != null;
    case "unused": return k.activatedAt == null;
    case "expired": return isExpired(k);
    case "revoked": return k.status === "revoked";
    case "banned": return k.status === "banned";
    case "expiring": return k.status === "active" && k.expiresAt != null &&
      k.expiresAt - now > 0 && k.expiresAt - now <= EXPIRING_SOON_MS;
    default: return true;
  }
}

app.get("/api/keys", authRequired, (req, res) => {
  let keys = scopeKeys(req);
  const { search, status = "all", sort = "newest", page = "1", perPage = "20" } = req.query;
  if (search) {
    const s = String(search).toLowerCase();
    keys = keys.filter((k) => (k.code || "").toLowerCase().includes(s) || (k.note || "").toLowerCase().includes(s));
  }
  keys = keys.filter((k) => keyMatchesFilter(k, status));
  keys = keys.slice();
  if (sort === "expiry") {
    keys.sort((a, b) => {
      const ea = a.expiresAt == null ? Infinity : a.expiresAt;
      const eb = b.expiresAt == null ? Infinity : b.expiresAt;
      return ea - eb;
    });
  } else {
    keys.sort((a, b) => b.createdAt - a.createdAt);
  }
  const pp = Math.min(100, Math.max(1, parseInt(perPage, 10) || 20));
  const pg = Math.max(1, parseInt(page, 10) || 1);
  res.json({ ok: true, keys: keys.slice((pg - 1) * pp, pg * pp), total: keys.length, page: pg, perPage: pp });
});

app.get("/api/keys/export", authRequired, (req, res) => {
  const keys = scopeKeys(req).slice().sort((a, b) => b.createdAt - a.createdAt);
  const rows = [["Code", "Duration", "Status", "Devices", "Max Devices", "Note", "Created", "Activated", "Expires", "Cost Paid"]];
  for (const k of keys) {
    rows.push([
      k.code, DURATIONS[k.duration] ? DURATIONS[k.duration].label : k.duration, k.status,
      k.devices.length, k.maxDevices, k.note || "",
      new Date(k.createdAt).toISOString(), k.activatedAt ? new Date(k.activatedAt).toISOString() : "",
      k.expiresAt ? new Date(k.expiresAt).toISOString() : "Never",
      k.costPaid != null ? k.costPaid : "",
    ]);
  }
  const csv = rows.map((r) => r.map(escCsv).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="license-keys.csv"');
  res.send(csv);
});

app.post("/api/keys", authRequired, (req, res) => {
  const { mode, duration, count, maxDevices, note, customKey } = req.body || {};
  if (!DURATIONS[duration]) return res.status(400).json({ ok: false, error: "Invalid duration." });
  const n = parseInt(count, 10);
  if (!Number.isFinite(n) || n < 1 || n > 50)
    return res.status(400).json({ ok: false, error: "Count must be between 1 and 50." });
  const md = parseInt(maxDevices, 10);
  if (!Number.isFinite(md) || md < 1 || md > 9999)
    return res.status(400).json({ ok: false, error: "Device limit must be between 1 and 9999." });
  const price = Number(db.prices[duration]) || 0;
  const totalCost = price * md * n;
  const isReseller = req.session.role === "reseller";
  let reseller = null;
  if (isReseller) {
    reseller = db.resellers.find((x) => x.id === req.session.resellerId);
    if (!reseller) return res.status(401).json({ ok: false, error: "Account not found." });
    if (reseller.balance < totalCost)
      return res.status(400).json({ ok: false, error: "Insufficient balance." });
  }
  const codes = [];
  if (mode === "custom") {
    const ck = String(customKey || "").trim();
    if (!ck) return res.status(400).json({ ok: false, error: "Enter a key." });
    if (n !== 1) return res.status(400).json({ ok: false, error: "Custom key mode generates one key." });
    if (db.keys.some((k) => k.code === ck))
      return res.status(400).json({ ok: false, error: "Key already exists." });
    codes.push(ck);
  } else {
    for (let i = 0; i < n; i++) {
      let code;
      do { code = randomKeyCode(DURATIONS[duration].prefix); } while (db.keys.some((k) => k.code === code) || codes.includes(code));
      codes.push(code);
    }
  }
  const createdBy = isReseller ? reseller.id : "master";
  const created = [];
  for (const code of codes) {
    const costPaid = isReseller ? price * md : 0;
    const key = {
      id: uid(), code, duration, maxDevices: md, devices: [],
      note: String(note || "").trim(), status: "active",
      createdAt: Date.now(), activatedAt: null, expiresAt: null,
      createdBy, costPaid,
    };
    db.keys.push(key);
    created.push(key);
    logActivity("generated", {
      keyCode: code,
      resellerName: isReseller ? reseller.username : null,
      detail: `${DURATIONS[duration].label} key generated${isReseller ? " by " + reseller.username : ""}.`,
      amount: isReseller ? costPaid : null,
    });
  }
  if (isReseller) {
    reseller.balance -= totalCost;
    saveDb();
  } else saveDb();
  const out = { ok: true, keys: created, totalCost };
  if (isReseller) out.balance = reseller.balance;
  res.json(out);
});

function findScopedKey(req, id) {
  return scopeKeys(req).find((k) => k.id === id);
}

app.patch("/api/keys/:id", authRequired, (req, res) => {
  const key = findScopedKey(req, req.params.id);
  if (!key) return res.status(404).json({ ok: false, error: "Key not found." });
  const { note, maxDevices } = req.body || {};
  if (note !== undefined) key.note = String(note).trim();
  if (maxDevices !== undefined) {
    const md = parseInt(maxDevices, 10);
    if (!Number.isFinite(md) || md < 1 || md > 9999)
      return res.status(400).json({ ok: false, error: "Device limit must be between 1 and 9999." });
    key.maxDevices = md;
  }
  saveDb();
  res.json({ ok: true, key });
});

app.post("/api/keys/:id/status", authRequired, (req, res) => {
  const key = findScopedKey(req, req.params.id);
  if (!key) return res.status(404).json({ ok: false, error: "Key not found." });
  const { status } = req.body || {};
  if (!["active", "revoked", "banned"].includes(status))
    return res.status(400).json({ ok: false, error: "Invalid status." });
  key.status = status;
  saveDb();
  res.json({ ok: true });
});

app.post("/api/keys/:id/renew", authRequired, (req, res) => {
  const key = findScopedKey(req, req.params.id);
  if (!key) return res.status(404).json({ ok: false, error: "Key not found." });
  const isReseller = req.session.role === "reseller";
  let reseller = null;
  const price = Number(db.prices[key.duration]) || 0;
  const cost = price * key.maxDevices;
  if (isReseller) {
    reseller = db.resellers.find((x) => x.id === req.session.resellerId);
    if (!reseller) return res.status(401).json({ ok: false, error: "Account not found." });
    if (reseller.balance < cost)
      return res.status(400).json({ ok: false, error: "Insufficient balance." });
    reseller.balance -= cost;
  }
  key.activatedAt = null;
  key.expiresAt = null;
  if (key.status !== "active") key.status = "active";
  logActivity("renewed", {
    keyCode: key.code,
    resellerName: isReseller ? reseller.username : null,
    detail: `Key renewed (${DURATIONS[key.duration].label}).`,
    amount: isReseller ? cost : null,
  });
  saveDb();
  const out = { ok: true, key };
  if (isReseller) out.balance = reseller.balance;
  res.json(out);
});

function deleteKey(key, actorName) {
  let refunded = 0;
  if (key.createdBy !== "master" && key.activatedAt == null && key.devices.length === 0 && key.costPaid > 0) {
    const owner = db.resellers.find((x) => x.id === key.createdBy);
    if (owner) {
      owner.balance += key.costPaid;
      refunded = key.costPaid;
      logActivity("refunded", { keyCode: key.code, resellerName: owner.username, detail: `Refunded ${key.costPaid} for unused key.`, amount: key.costPaid });
    }
  }
  db.keys = db.keys.filter((k) => k.id !== key.id);
  logActivity("deleted", { keyCode: key.code, resellerName: actorName || null, detail: "Key deleted." });
  return refunded;
}

app.delete("/api/keys/:id", authRequired, (req, res) => {
  const key = findScopedKey(req, req.params.id);
  if (!key) return res.status(404).json({ ok: false, error: "Key not found." });
  const actor = req.session.role === "reseller" ? req.session.username : null;
  const refunded = deleteKey(key, actor);
  saveDb();
  res.json({ ok: true, refunded });
});

app.post("/api/keys/bulk", authRequired, (req, res) => {
  const { ids, action } = req.body || {};
  if (!Array.isArray(ids) || !["revoke", "ban", "reactivate", "delete"].includes(action))
    return res.status(400).json({ ok: false, error: "Invalid request." });
  const scoped = scopeKeys(req);
  let refundedTotal = 0;
  const actor = req.session.role === "reseller" ? req.session.username : null;
  for (const id of ids) {
    const key = scoped.find((k) => k.id === id);
    if (!key) continue;
    if (action === "revoke") key.status = "revoked";
    else if (action === "ban") key.status = "banned";
    else if (action === "reactivate") key.status = "active";
    else if (action === "delete") refundedTotal += deleteKey(key, actor);
  }
  saveDb();
  res.json({ ok: true, refundedTotal });
});

/* devices per key */
app.get("/api/keys/:id/devices", authRequired, (req, res) => {
  const key = findScopedKey(req, req.params.id);
  if (!key) return res.status(404).json({ ok: false, error: "Key not found." });
  res.json({ ok: true, devices: key.devices, maxDevices: key.maxDevices });
});
app.post("/api/keys/:id/devices/:deviceId/block", authRequired, (req, res) => {
  const key = findScopedKey(req, req.params.id);
  const d = key && key.devices.find((x) => x.id === req.params.deviceId);
  if (!d) return res.status(404).json({ ok: false, error: "Device not found." });
  d.blocked = true; saveDb(); res.json({ ok: true });
});
app.post("/api/keys/:id/devices/:deviceId/unblock", authRequired, (req, res) => {
  const key = findScopedKey(req, req.params.id);
  const d = key && key.devices.find((x) => x.id === req.params.deviceId);
  if (!d) return res.status(404).json({ ok: false, error: "Device not found." });
  d.blocked = false; saveDb(); res.json({ ok: true });
});
app.delete("/api/keys/:id/devices/:deviceId", authRequired, (req, res) => {
  const key = findScopedKey(req, req.params.id);
  if (!key) return res.status(404).json({ ok: false, error: "Key not found." });
  const exists = key.devices.some((x) => x.id === req.params.deviceId);
  if (!exists) return res.status(404).json({ ok: false, error: "Device not found." });
  key.devices = key.devices.filter((x) => x.id !== req.params.deviceId);
  saveDb(); res.json({ ok: true });
});

/* ---------------- prices ---------------- */
app.get("/api/prices", authRequired, (req, res) => {
  res.json({ ok: true, prices: db.prices });
});
app.put("/api/prices", authRequired, requireMaster, (req, res) => {
  const { prices } = req.body || {};
  if (!prices || typeof prices !== "object")
    return res.status(400).json({ ok: false, error: "Invalid prices." });
  for (const d of DURATION_ORDER) {
    if (prices[d] === undefined) continue;
    const v = Number(prices[d]);
    if (!Number.isFinite(v) || v < 0) return res.status(400).json({ ok: false, error: "Invalid price value." });
    db.prices[d] = v;
  }
  saveDb();
  res.json({ ok: true, prices: db.prices });
});

/* ---------------- resellers ---------------- */
function resellerPublic(r) {
  const keys = db.keys.filter((k) => k.createdBy === r.id);
  return {
    id: r.id, name: r.name, username: r.username, contact: r.contact || "",
    balance: r.balance, referralCode: r.referralCode || "", createdAt: r.createdAt,
    stats: {
      totalKeys: keys.length,
      activeKeys: keys.filter((k) => k.status === "active" && !isExpired(k)).length,
      earned: keys.reduce((s, k) => s + (k.costPaid || 0), 0),
    },
  };
}

app.get("/api/resellers", authRequired, requireMaster, (req, res) => {
  res.json({ ok: true, resellers: db.resellers.map(resellerPublic) });
});

app.post("/api/resellers", authRequired, requireMaster, (req, res) => {
  const { name, username, password, contact, balance, referralCode } = req.body || {};
  const nm = String(name || "").trim();
  const un = String(username || "").trim();
  if (!nm) return res.status(400).json({ ok: false, error: "Enter a name." });
  if (!un) return res.status(400).json({ ok: false, error: "Enter a username." });
  if (db.resellers.some((r) => r.username.toLowerCase() === un.toLowerCase()))
    return res.status(400).json({ ok: false, error: "Username already exists." });
  if (!password || String(password).length < 4)
    return res.status(400).json({ ok: false, error: "Password must be at least 4 characters." });
  const bal = balance === "" || balance == null ? 0 : Number(balance);
  if (!Number.isFinite(bal)) return res.status(400).json({ ok: false, error: "Invalid balance." });
  let refCode = String(referralCode || "").trim();
  if (refCode) {
    const ref = db.referrals.find((x) => x.code.toUpperCase() === refCode.toUpperCase());
    if (!ref || !ref.active) return res.status(400).json({ ok: false, error: "Referral code is invalid." });
    ref.uses += 1;
    refCode = ref.code;
  } else refCode = "";
  const { salt, hash } = hashPassword(String(password));
  const r = {
    id: uid(), name: nm, username: un, salt, hash,
    contact: String(contact || "").trim(), balance: bal,
    referralCode: refCode, createdAt: Date.now(),
  };
  db.resellers.push(r);
  saveDb();
  res.json({ ok: true, reseller: resellerPublic(r) });
});

app.patch("/api/resellers/:id", authRequired, requireMaster, (req, res) => {
  const r = db.resellers.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ ok: false, error: "Reseller not found." });
  const { name, username, contact, balance, addBalance, password } = req.body || {};
  if (name !== undefined) {
    const nm = String(name).trim();
    if (!nm) return res.status(400).json({ ok: false, error: "Enter a name." });
    r.name = nm;
  }
  if (username !== undefined) {
    const un = String(username).trim();
    if (!un) return res.status(400).json({ ok: false, error: "Enter a username." });
    if (db.resellers.some((x) => x.id !== r.id && x.username.toLowerCase() === un.toLowerCase()))
      return res.status(400).json({ ok: false, error: "Username already exists." });
    r.username = un;
  }
  if (contact !== undefined) r.contact = String(contact).trim();
  if (balance !== undefined) {
    const b = Number(balance);
    if (!Number.isFinite(b)) return res.status(400).json({ ok: false, error: "Invalid balance." });
    r.balance = b;
  }
  if (addBalance !== undefined) {
    const b = Number(addBalance);
    if (!Number.isFinite(b)) return res.status(400).json({ ok: false, error: "Invalid amount." });
    r.balance += b;
  }
  if (password !== undefined && password !== "") {
    if (String(password).length < 4)
      return res.status(400).json({ ok: false, error: "Password must be at least 4 characters." });
    const { salt, hash } = hashPassword(String(password));
    r.salt = salt; r.hash = hash;
  }
  saveDb();
  res.json({ ok: true, reseller: resellerPublic(r) });
});

app.delete("/api/resellers/:id", authRequired, requireMaster, (req, res) => {
  const r = db.resellers.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ ok: false, error: "Reseller not found." });
  db.resellers = db.resellers.filter((x) => x.id !== r.id);
  db.keys = db.keys.filter((k) => k.createdBy !== r.id); // no refund
  for (const t of Object.keys(db.sessions)) {
    if (db.sessions[t].resellerId === r.id) delete db.sessions[t];
  }
  logActivity("deleted", { resellerName: r.username, detail: "Reseller removed." });
  saveDb();
  res.json({ ok: true });
});

/* ---------------- referrals ---------------- */
function makeReferralCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[crypto.randomInt(0, chars.length)];
  return "REF-" + s;
}
app.get("/api/referrals", authRequired, requireMaster, (req, res) => {
  res.json({ ok: true, referrals: db.referrals.slice().sort((a, b) => b.createdAt - a.createdAt) });
});
app.post("/api/referrals", authRequired, requireMaster, (req, res) => {
  const { note } = req.body || {};
  let code;
  do { code = makeReferralCode(); } while (db.referrals.some((r) => r.code === code));
  const ref = { id: uid(), code, note: String(note || "").trim(), link: "", createdAt: Date.now(), uses: 0, active: true };
  db.referrals.push(ref);
  saveDb();
  res.json({ ok: true, referral: ref });
});
app.patch("/api/referrals/:id", authRequired, requireMaster, (req, res) => {
  const ref = db.referrals.find((x) => x.id === req.params.id);
  if (!ref) return res.status(404).json({ ok: false, error: "Referral not found." });
  if (req.body && req.body.active !== undefined) ref.active = !!req.body.active;
  if (req.body && req.body.note !== undefined) ref.note = String(req.body.note).trim();
  saveDb();
  res.json({ ok: true, referral: ref });
});
app.delete("/api/referrals/:id", authRequired, requireMaster, (req, res) => {
  db.referrals = db.referrals.filter((x) => x.id !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

/* ---------------- sales report ---------------- */
app.get("/api/sales", authRequired, requireMaster, (req, res) => {
  const from = req.query.from ? new Date(req.query.from + "T00:00:00Z").getTime() : 0;
  const to = req.query.to ? new Date(req.query.to + "T23:59:59Z").getTime() : Date.now();
  const rows = {};
  for (const a of db.activity) {
    if (a.ts < from || a.ts > to) continue;
    if (!a.resellerName) continue;
    if (a.type === "generated" && a.amount > 0) {
      rows[a.resellerName] = rows[a.resellerName] || { reseller: a.resellerName, keysSold: 0, earned: 0 };
      rows[a.resellerName].keysSold += 1;
      rows[a.resellerName].earned += a.amount;
    } else if (a.type === "refunded" && a.amount > 0) {
      rows[a.resellerName] = rows[a.resellerName] || { reseller: a.resellerName, keysSold: 0, earned: 0 };
      rows[a.resellerName].earned -= a.amount;
    }
  }
  const list = Object.values(rows).sort((a, b) => b.earned - a.earned);
  const totals = { keysSold: list.reduce((s, r) => s + r.keysSold, 0), earned: list.reduce((s, r) => s + r.earned, 0) };
  res.json({ ok: true, rows: list, totals, top: list[0] || null });
});

/* ---------------- activity ---------------- */
app.get("/api/activity", authRequired, (req, res) => {
  const { type = "all", search = "", page = "1" } = req.query;
  let items = db.activity;
  if (req.session.role === "reseller") {
    items = items.filter((a) => a.resellerName === req.session.username);
  }
  if (type !== "all") items = items.filter((a) => a.type === type);
  if (search) {
    const s = String(search).toLowerCase();
    items = items.filter((a) =>
      (a.keyCode || "").toLowerCase().includes(s) ||
      (a.resellerName || "").toLowerCase().includes(s) ||
      (a.deviceId || "").toLowerCase().includes(s) ||
      (a.detail || "").toLowerCase().includes(s));
  }
  const pp = 25;
  const pg = Math.max(1, parseInt(page, 10) || 1);
  res.json({ ok: true, activity: items.slice((pg - 1) * pp, pg * pp), total: items.length, page: pg, perPage: pp });
});

/* ---------------- server control ---------------- */
app.get("/api/server", authRequired, (req, res) => {
  res.json({ ok: true, server: db.server });
});
app.put("/api/server", authRequired, requireMaster, (req, res) => {
  const { enabled, broadcast } = req.body || {};
  if (enabled !== undefined) db.server.enabled = !!enabled;
  if (broadcast !== undefined) db.server.broadcast = String(broadcast).slice(0, 500);
  saveDb();
  res.json({ ok: true, server: db.server });
});

/* ---------------- settings ---------------- */
app.post("/api/settings/password", authRequired, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const isMaster = req.session.role === "master";
  const acct = isMaster ? db.master : db.resellers.find((x) => x.id === req.session.resellerId);
  if (!acct) return res.status(401).json({ ok: false, error: "Account not found." });
  if (!verifyPassword(currentPassword || "", acct.salt, acct.hash))
    return res.status(400).json({ ok: false, error: "Current password is incorrect." });
  if (!newPassword || String(newPassword).length < 4)
    return res.status(400).json({ ok: false, error: "New password must be at least 4 characters." });
  const { salt, hash } = hashPassword(String(newPassword));
  acct.salt = salt; acct.hash = hash;
  saveDb();
  res.json({ ok: true });
});

app.put("/api/settings/profile", authRequired, requireMaster, (req, res) => {
  const { username, role } = req.body || {};
  if (username !== undefined) {
    const un = String(username).trim();
    if (!un) return res.status(400).json({ ok: false, error: "Enter a username." });
    db.master.username = un;
    for (const t of Object.keys(db.sessions)) {
      if (db.sessions[t].role === "master") db.sessions[t].username = un;
    }
  }
  if (role !== undefined) {
    const rl = String(role).trim();
    if (!rl) return res.status(400).json({ ok: false, error: "Enter a role." });
    db.master.role = rl;
  }
  saveDb();
  res.json({ ok: true, username: db.master.username, role: db.master.role });
});

function logoPath() {
  const png = path.join(DATA_DIR, "logo.png");
  const jpg = path.join(DATA_DIR, "logo.jpg");
  if (fs.existsSync(png)) return png;
  if (fs.existsSync(jpg)) return jpg;
  return null;
}
app.post("/api/settings/logo", authRequired, requireMaster, (req, res) => {
  const { dataUrl } = req.body || {};
  if (!dataUrl || typeof dataUrl !== "string")
    return res.status(400).json({ ok: false, error: "No image provided." });
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
  if (!m) return res.status(400).json({ ok: false, error: "Only PNG or JPEG images are accepted." });
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 2 * 1024 * 1024)
    return res.status(400).json({ ok: false, error: "Image must be 2MB or smaller." });
  const ext = m[1] === "png" ? "png" : "jpg";
  for (const f of ["logo.png", "logo.jpg"]) {
    const p = path.join(DATA_DIR, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  fs.writeFileSync(path.join(DATA_DIR, "logo." + ext), buf);
  db.master.logo = true;
  saveDb();
  res.json({ ok: true });
});
app.delete("/api/settings/logo", authRequired, requireMaster, (req, res) => {
  for (const f of ["logo.png", "logo.jpg"]) {
    const p = path.join(DATA_DIR, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  db.master.logo = null;
  saveDb();
  res.json({ ok: true });
});

/* ---------------- public verify (no auth) ---------------- */
app.post("/verify", (req, res) => {
  const { key, deviceId, deviceName } = req.body || {};
  const code = String(key || "").trim();
  const devId = String(deviceId || "").trim();
  if (!db.server.enabled) {
    return res.json({
      valid: false, reason: "maintenance",
      message: "Server in maintenance." + (db.server.broadcast ? " " + db.server.broadcast : ""),
    });
  }
  if (!code) {
    logActivity("rejected", { detail: "Verification attempted with empty key." });
    return res.json({ valid: false, reason: "not_found", message: "Invalid key." });
  }
  const k = db.keys.find((x) => x.code === code);
  if (!k) {
    logActivity("rejected", { keyCode: code, deviceId: devId || null, detail: "Key not found." });
    return res.json({ valid: false, reason: "not_found", message: "Invalid key." });
  }
  const d = DURATIONS[k.duration];
  if (k.status === "banned") {
    logActivity("rejected", { keyCode: k.code, deviceId: devId || null, detail: "Key is banned." });
    return res.json({ valid: false, reason: "banned", message: "This key has been banned." });
  }
  if (k.status === "revoked") {
    logActivity("rejected", { keyCode: k.code, deviceId: devId || null, detail: "Key is revoked." });
    return res.json({ valid: false, reason: "revoked", message: "This key has been revoked." });
  }
  if (isExpired(k)) {
    logActivity("rejected", { keyCode: k.code, deviceId: devId || null, detail: "Key expired." });
    return res.json({ valid: false, reason: "expired", message: "This key has expired." });
  }
  if (!devId) return res.json({ valid: false, reason: "device_required", message: "Device ID is required." });
  const dev = k.devices.find((x) => x.id === devId);
  if (dev && dev.blocked) {
    logActivity("rejected", { keyCode: k.code, deviceId: devId, detail: "Device is blocked." });
    return res.json({ valid: false, reason: "blocked", message: "This device is blocked." });
  }
  if (!dev && k.devices.length >= k.maxDevices) {
    logActivity("rejected", { keyCode: k.code, deviceId: devId, detail: "Device limit reached." });
    return res.json({ valid: false, reason: "device_limit", message: "Device limit reached for this key." });
  }
  const now = Date.now();
  if (dev) {
    dev.lastSeen = now;
    if (deviceName) dev.name = String(deviceName).slice(0, 120);
  } else {
    k.devices.push({ id: devId, name: deviceName ? String(deviceName).slice(0, 120) : "", blocked: false, firstSeen: now, lastSeen: now });
  }
  if (k.activatedAt == null) {
    k.activatedAt = now;
    k.expiresAt = d && d.ms ? now + d.ms : null;
  }
  const owner = k.createdBy === "master" ? null : (db.resellers.find((r) => r.id === k.createdBy) || {}).username || null;
  logActivity("activation", { keyCode: k.code, resellerName: owner, deviceId: devId, detail: "Device verified." });
  saveDb();
  res.json({
    valid: true,
    duration: k.duration,
    durationLabel: d ? d.label : k.duration,
    devicesUsed: k.devices.length,
    maxDevices: k.maxDevices,
    expiresAt: k.expiresAt,
    message: "Login successful.",
  });
});

/* durations + labels for frontend */
app.get("/api/meta", authRequired, (req, res) => {
  const meta = {};
  for (const d of DURATION_ORDER) meta[d] = { label: DURATIONS[d].label };
  res.json({ ok: true, durations: meta, order: DURATION_ORDER });
});

/* ---------------- static frontend ---------------- */
// Serve the frontend from "public" or "Public" (GitHub folder name may differ in case)
const PUBDIR = fs.existsSync(path.join(__dirname, "public")) ? "public" : "Public";
app.use(express.static(path.join(__dirname, PUBDIR)));

app.listen(PORT, () => {
  console.log("License Key Panel running on http://localhost:" + PORT);
});
