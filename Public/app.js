/* License Key Panel - SPA (Muse exact-theme port) */
const S = {
  token: localStorage.getItem("lkp_token") || "",
  me: null,
  page: "dashboard",
  durations: [],
  keys: { items: [], total: 0, page: 1, perPage: 8, search: "", status: "all", sort: "newest", selected: new Set(), counts: {} },
  activity: { items: [], total: 0, page: 1, type: "all", search: "", alertsOnly: false },
  gen: { mode: "auto", duration: "30day", count: 1, maxDevices: 1, note: "", customKey: "", result: null },
  sales: { preset: "all", from: "", to: "", rows: [], totals: null, top: null },
  loginMode: "master",
};
let subTimer = null;
let actTimer = null;

function durEntry(d) { return (S.durations || []).find((x) => x.id === d); }
function durLabel(d) { const f = durEntry(d); return (f && f.label) || d; }
function durPrefix(d) { const f = durEntry(d); return (f && f.prefix) || ""; }
function durPrice(d) { const f = durEntry(d); return f ? Number(f.price) || 0 : 0; }
// Label for a key object: stamped label first (survives duration deletion).
function keyDurLabel(k) { return k.durationLabel || durLabel(k.duration); }

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(ts) {
  if (ts == null) return "-";
  return new Date(ts).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtDateOnly(ts) {
  if (ts == null) return "-";
  return new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function timeAgo(ts) {
  if (ts == null) return "-";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  if (d < 30) return d + "d ago";
  return fmtDateOnly(ts);
}
function fmtCountdown(diff) {
  const d = Math.floor(diff / 86400000), h = Math.floor(diff % 86400000 / 3600000),
    m = Math.floor(diff % 3600000 / 60000), s = Math.floor(diff % 60000 / 1000);
  return `${d}d ${h}h ${m}m ${s}s`;
}
function countdown(ts) {
  if (ts == null) return '<span class="pill pill-unused">Not activated yet</span>';
  const diff = ts - Date.now();
  if (diff <= 0) return '<span class="pill pill-expired">Expired</span>';
  const d = Math.floor(diff / 86400000), h = Math.floor(diff % 86400000 / 3600000), m = Math.floor(diff % 3600000 / 60000);
  const hot = diff < 24 * 3600000 ? " hot" : "";
  return `<span class="countdown${hot}">${d}d ${h}h ${m}m</span>`;
}
function timingLine(k) {
  if (k.expiresAt != null && k.expiresAt < Date.now()) return "Expired";
  if (k.activatedAt == null) return `${esc(keyDurLabel(k))} · Not activated yet`;
  if (k.expiresAt == null) return "Lifetime — never expires";
  return countdown(k.expiresAt);
}
function keyStatusPill(k) {
  if (k.status === "banned") return '<span class="pill pill-banned">Banned</span>';
  if (k.status === "revoked") return '<span class="pill pill-revoked">Revoked</span>';
  if (k.expiresAt != null && k.expiresAt < Date.now()) return '<span class="pill pill-expired">Expired</span>';
  if (k.activatedAt != null) return '<span class="pill pill-used">Used</span>';
  return '<span class="pill pill-active">Active</span>';
}
function copyText(t) {
  const done = () => toast("Copied.", "ok");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(done, () => fallbackCopy(t, done));
  } else fallbackCopy(t, done);
}
function fallbackCopy(t, done) {
  const ta = document.createElement("textarea");
  ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); done(); } catch (e) { toast("Copy failed.", "err"); }
  document.body.removeChild(ta);
}

/* ---------- api ---------- */
async function api(path, opts) {
  opts = opts || {};
  const headers = { "Content-Type": "application/json" };
  if (S.token) headers["Authorization"] = "Bearer " + S.token;
  const res = await fetch(path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let data = null;
  try { data = await res.json(); } catch (e) { data = { ok: false, error: "Server error." }; }
  if (res.status === 401 && S.token) {
    S.token = ""; localStorage.removeItem("lkp_token"); S.me = null;
    render(); toast("Session expired. Please sign in again.", "err");
    throw new Error("unauthorized");
  }
  return { status: res.status, data };
}

/* ---------- toast ---------- */
function toast(msg, type) {
  const box = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = "toast" + (type ? " " + type : "");
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; setTimeout(() => el.remove(), 320); }, 2600);
}

/* ---------- modal / bottom-sheet ---------- */
function openModal(html) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-back" onclick="closeModal()"></div><div class="modal">${html}</div>`;
  root.classList.add("show");
}
function closeModal() {
  const root = document.getElementById("modal-root");
  root.classList.remove("show"); root.innerHTML = "";
}
function confirmDlg(title, body, okLabel, onOk, danger) {
  openModal(`<h2>${esc(title)}</h2><p style="color:var(--dim);font-size:14px;margin-bottom:6px">${body}</p>
    <div class="btn-row">
      <button class="btn-real btn-ivory" onclick="closeModal()">Cancel</button>
      <button class="btn-real ${danger ? "btn-danger" : "btn-gold"}" id="cf-ok">${esc(okLabel || "Confirm")}</button>
    </div>`);
  document.getElementById("cf-ok").onclick = () => { closeModal(); onOk(); };
}

/* ---------- navigation ---------- */
const NAV_MASTER = [
  ["dashboard", "Dashboard", "◆"], ["keys", "Keys", "⬢"], ["generate", "Generate", "+"],
  ["prices", "Manage Price", "₹"], ["sales", "Sales Report", "▦"], ["activity", "Activity", "◎"],
  ["resellers", "Manage Reseller", "◉"], ["referrals", "Create Referral", "⎘"],
  ["server", "Server Control", "⏻"], ["settings", "Settings", "⚙"],
];
const NAV_RESELLER = [
  ["dashboard", "Dashboard", "◆"], ["keys", "Keys", "⬢"], ["generate", "Generate", "+"],
  ["activity", "Activity", "◎"], ["settings", "Settings", "⚙"],
];
function navItems() { return S.me && S.me.role === "master" ? NAV_MASTER : NAV_RESELLER; }
function stopTimers() {
  if (subTimer) { clearInterval(subTimer); subTimer = null; }
  if (actTimer) { clearInterval(actTimer); actTimer = null; }
}
function go(page) {
  stopTimers();
  S.page = page;
  S.keys.selected = new Set();
  const dr = document.querySelector(".drawer");
  if (dr) dr.classList.remove("show");
  render();
  window.scrollTo(0, 0);
}
function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/);
  return ((parts[0] || "?")[0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}
async function loadNavBadge() {
  try {
    const { data } = await api("/api/activity?type=rejected&perPage=1");
    const n = data.ok ? data.total : 0;
    document.querySelectorAll(".nav-badge-activity").forEach((el) => {
      el.style.display = n ? "" : "none";
      el.textContent = n > 99 ? "99+" : String(n);
    });
  } catch (e) {}
}

/* ---------- login ---------- */
function renderLogin() {
  const app = document.getElementById("app");
  app.innerHTML = `
  <div class="login-wrap">
    <div class="login-card">
      <div class="gold-bar"></div>
      <div class="login-mark" id="login-logo"><span class="login-emblem">K</span></div>
      <div class="login-title">Welcome back</div>
      <div class="login-sub">Sign in to the master panel to manage keys and resellers.</div>
      <div class="mode-toggle">
        <button class="${S.loginMode === "master" ? "on" : ""}" onclick="setLoginMode('master')">◆ Master</button>
        <button class="${S.loginMode === "reseller" ? "on" : ""}" onclick="setLoginMode('reseller')">◉ Reseller</button>
      </div>
      <div class="login-error" id="login-error"></div>
      <div class="field"><label>Username</label><input class="input" id="li-user" autocomplete="username"></div>
      <div class="field"><label>Password</label>
        <div class="pw-row">
          <input class="input" id="li-pass" type="password" autocomplete="current-password">
          <button class="pw-show" type="button" onclick="togglePw('li-pass', this)">👁 Show</button>
        </div>
      </div>
      <button class="btn-real btn-gold btn-block" id="li-go">→ Sign In</button>
      <div class="login-helper">Protected admin area. Sign in with the Master username and password. Activation events are logged in Activity.</div>
    </div>
    <div class="login-foot">License Key Panel · Premium Edition</div>
  </div>`;
  fetch("/logo").then((r) => {
    if (r.ok) document.getElementById("login-logo").innerHTML = '<img src="/logo" alt="logo">';
  }).catch(() => {});
  const goFn = () => doLogin();
  document.getElementById("li-go").onclick = goFn;
  document.getElementById("li-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") goFn(); });
  document.getElementById("li-user").addEventListener("keydown", (e) => { if (e.key === "Enter") goFn(); });
  document.getElementById("li-user").focus();
}
function togglePw(id, btn) {
  const inp = document.getElementById(id);
  if (!inp) return;
  const show = inp.type === "password";
  inp.type = show ? "text" : "password";
  if (btn) btn.textContent = show ? "👁 Hide" : "👁 Show";
}
function setLoginMode(m) { S.loginMode = m; renderLogin(); }
async function doLogin() {
  const username = document.getElementById("li-user").value.trim();
  const password = document.getElementById("li-pass").value;
  const err = document.getElementById("login-error");
  err.classList.remove("show");
  const { data } = await api("/api/login", { method: "POST", body: { mode: S.loginMode, username, password } });
  if (!data.ok) { err.textContent = data.error || "Login failed."; err.classList.add("show"); return; }
  S.token = data.token;
  localStorage.setItem("lkp_token", S.token);
  S.page = "dashboard";
  await boot();
  toast("Signed in.", "ok");
}
async function doLogout() {
  try { await api("/api/logout", { method: "POST" }); } catch (e) {}
  stopTimers();
  S.token = ""; localStorage.removeItem("lkp_token"); S.me = null; S.page = "dashboard";
  render();
}

/* ---------- shell ---------- */
function brandHtml() {
  const mark = S.me.logo
    ? '<img class="brand-logo" src="/logo" alt="logo">'
    : '<span class="side-kmark">K</span>';
  return `<div class="side-brand">${mark}<span class="brand-text"><span class="name">License Panel</span><span class="tag">Premium Owner</span></span></div>`;
}
function navHtml() {
  return navItems().map(([id, label, ic]) =>
    `<button class="${S.page === id ? "on" : ""}" onclick="go('${id}')"><span class="ic">${ic}</span>${esc(label)}${id === "activity" ? '<span class="nav-badge nav-badge-activity" style="display:none"></span>' : ""}</button>`).join("");
}
function footHtml() {
  const bal = S.me.role === "reseller" ? `<div class="bal">Balance: ₹${esc(S.me.balance)}</div>` : "";
  return `<div class="side-foot">
    <div class="user-card"><div class="who">${esc(S.me.displayName)}</div><div class="role">${esc(S.me.role === "master" ? S.me.displayName : "Reseller")}</div>${bal}</div>
    <button class="btn-real btn-danger btn-block" onclick="doLogout()">Logout</button>
  </div>`;
}
function renderShell() {
  stopTimers();
  const app = document.getElementById("app");
  app.innerHTML = `
  <div class="topbar">
    <div class="name">License Panel</div>
    <button class="btn-real btn-gold btn-sm" onclick="document.querySelector('.drawer').classList.add('show')">Menu</button>
  </div>
  <div class="drawer">
    <div class="modal-back" onclick="document.querySelector('.drawer').classList.remove('show')"></div>
    <div class="side">${brandHtml()}<div class="side-nav">${navHtml()}</div>${footHtml()}</div>
  </div>
  <div class="shell">
    <aside class="sidebar">${brandHtml()}<div class="side-nav">${navHtml()}</div>${footHtml()}</aside>
    <main class="main" id="page"></main>
  </div>`;
  renderPage();
  loadNavBadge();
}

function renderPage() {
  const el = document.getElementById("page");
  if (!el) return;
  const P = {
    dashboard: pageDashboard, keys: pageKeys, generate: pageGenerate, activity: pageActivity,
    resellers: pageResellers, prices: pagePrices, referrals: pageReferrals,
    sales: pageSales, server: pageServer, settings: pageSettings,
  };
  (P[S.page] || pageDashboard)(el);
}

/* ---------- dashboard ---------- */
async function pageDashboard(el) {
  el.innerHTML = `<div class="page-head"><div><h1>Dashboard</h1><p>Overview of your license keys</p></div></div>
  <div class="stat-cards" id="dash-cards">
    <div class="stat-card"><div class="skel" style="height:30px"></div></div>
    <div class="stat-card"><div class="skel" style="height:30px"></div></div>
    <div class="stat-card"><div class="skel" style="height:30px"></div></div>
    <div class="stat-card"><div class="skel" style="height:30px"></div></div>
  </div>
  <div id="dash-alert"></div>
  <div id="dash-body"></div>`;
  const { data } = await api("/api/dashboard");
  if (!data.ok) {
    document.getElementById("dash-cards").innerHTML = `<div class="empty">${esc(data.error || "Failed to load.")}</div>`;
    return;
  }
  const isMaster = S.me.role === "master";
  const cards = isMaster
    ? [
        ["totalKeys", "Total Keys", "all"],
        ["usedKeys", "Used", "used"],
        ["unusedKeys", "Unused", "unused"],
        ["totalResellers", "Total Users", "users"],
      ]
    : [
        ["totalKeys", "Total Keys", "all"],
        ["usedKeys", "Used", "used"],
        ["unusedKeys", "Unused", "unused"],
        ["balance", "Balance", "balance"],
      ];
  document.getElementById("dash-cards").innerHTML = cards.map(([k, lbl, f]) => {
    const val = k === "balance" ? "₹" + esc(S.me.balance) : esc(data[k]);
    const act = f === "users" ? "go('resellers')" : f === "balance" ? "jumpToKeys('all')" : `jumpToKeys('${f}')`;
    return `<button class="stat-card" onclick="${act}"><div class="num">${val}</div><div class="lbl">${lbl}</div></button>`;
  }).join("");
  if (data.expiringSoon > 0) {
    document.getElementById("dash-alert").innerHTML = `
      <div class="alert-amber">⚠ ${esc(data.expiringSoon)} key(s) expiring within 3 days. <button class="link" onclick="jumpToKeys('expiring')">View expiring keys →</button></div>`;
  }
  document.getElementById("dash-body").innerHTML = `
  <div class="sub-card"><div class="gold-bar"></div>
    <h2>Subscription Expiration</h2>
    <div id="dash-sub"><div class="skel" style="height:34px;max-width:280px"></div></div>
  </div>
  <div class="grid-2">
    <div class="premium-card"><div class="gold-bar"></div>
      <h2>Keys Overview</h2><p class="card-sub">Keys created in the last 7 days</p>
      <div class="bars" id="dash-bars"><div class="skel" style="height:120px;flex:1"></div></div>
    </div>
    <div class="premium-card"><div class="gold-bar"></div>
      <h2>Keys Distribution</h2><p class="card-sub">By current status</p>
      <div class="donut-wrap" id="dash-donut"><div class="skel" style="height:148px;width:148px;border-radius:50%"></div></div>
      <div class="donut-note" id="dash-usedline"></div>
    </div>
  </div>
  <div class="grid-2">
    <div class="premium-card"><div class="gold-bar"></div>
      <h2>Recent History</h2><p class="card-sub">Latest keys</p>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>ID</th><th>Type</th><th>Code</th><th>When</th></tr></thead>
        <tbody id="dash-hist"><tr><td colspan="4"><div class="skel" style="height:60px"></div></td></tr></tbody>
      </table></div>
    </div>
    <div class="premium-card"><div class="gold-bar"></div>
      <h2>User Info</h2><p class="card-sub">Signed-in account</p>
      <div class="detail-list">
        <div class="dl-row"><span class="k">Username</span><span><b>@${esc(S.me.username)}</b></span></div>
        <div class="dl-row"><span class="k">Role</span><span><b>${esc(isMaster ? S.me.displayName : "Reseller")}</b></span></div>
        ${isMaster ? `<div class="dl-row"><span class="k">Resellers</span><span><b>${esc(data.totalResellers)}</b></span></div>` : `<div class="dl-row"><span class="k">Balance</span><span><b>₹${esc(S.me.balance)}</b></span></div>`}
        <div class="dl-row"><span class="k">Account Status</span><span class="status-green">Active</span></div>
      </div>
    </div>
  </div>
  ${isMaster ? `<div class="premium-card"><div class="gold-bar"></div>
    <h2>Recent Activity</h2><p class="card-sub">Latest panel events</p>
    <div id="dash-act"><div class="skel" style="height:80px"></div></div>
  </div>` : ""}`;
  loadDashSub(); loadDashCharts();
  if (isMaster) loadDashAct();
}
async function loadDashCharts() {
  const bars = document.getElementById("dash-bars");
  const donutBox = document.getElementById("dash-donut");
  const hist = document.getElementById("dash-hist");
  const usedLine = document.getElementById("dash-usedline");
  if (!bars && !donutBox && !hist) return;
  const { data } = await api("/api/keys?perPage=500");
  if (!data.ok) {
    const e = `<div class="empty">${esc(data.error || "Failed.")}</div>`;
    if (bars) bars.innerHTML = e;
    if (donutBox) donutBox.innerHTML = e;
    if (hist) hist.innerHTML = `<tr><td colspan="4">${e}</td></tr>`;
    return;
  }
  const keys = data.keys || [];
  const dayMs = 86400000;
  if (bars) {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const t = new Date(); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() - i);
      days.push(t.getTime());
    }
    const counts = days.map((t0) => keys.filter((k) => k.createdAt >= t0 && k.createdAt < t0 + dayMs).length);
    const mx = Math.max(1, ...counts);
    bars.innerHTML = days.map((t0, i) => {
      const c = counts[i];
      const h = c ? Math.max(12, Math.round((c / mx) * 104)) : 5;
      const lbl = new Date(t0).toLocaleDateString("en-GB", { weekday: "short" });
      return `<div class="bar-col"><span class="bar-val">${c}</span><div class="bar-track"><div class="bar-fill" style="height:${h}px"></div></div><span class="bar-lbl">${lbl}</span></div>`;
    }).join("");
  }
  if (donutBox) {
    const nowT = Date.now();
    const isExp = (k) => k.expiresAt != null && k.expiresAt < nowT;
    const nActive = keys.filter((k) => k.status === "active" && !isExp(k)).length;
    const nExpired = keys.filter((k) => isExp(k)).length;
    const nRevoked = keys.filter((k) => k.status === "revoked").length;
    const nBanned = keys.filter((k) => k.status === "banned").length;
    const segs = [
      ["Active", nActive, "#a9852e"],
      ["Expired", nExpired, "#d6c48a"],
      ["Revoked", nRevoked, "#8a8175"],
      ["Banned", nBanned, "#23201c"],
    ].filter((s) => s[1] > 0);
    const total = segs.reduce((a, s) => a + s[1], 0);
    if (!total) {
      donutBox.innerHTML = `<div class="empty">No keys yet.</div>`;
    } else {
      let acc = 0;
      const grad = segs.map((s) => {
        const p0 = (acc / total) * 100; acc += s[1];
        const p1 = (acc / total) * 100;
        return `${s[2]} ${p0.toFixed(1)}% ${p1.toFixed(1)}%`;
      }).join(", ");
      donutBox.innerHTML = `
        <div class="donut" style="background:conic-gradient(${grad})">
          <div class="donut-hole"><span class="t">${total}</span><span class="s">Keys</span></div>
        </div>
        <div class="legend">${segs.map((s) => `<div class="li"><span class="sw" style="background:${s[2]}"></span>${esc(s[0])}<span class="ct">${s[1]}</span></div>`).join("")}</div>`;
    }
    const used = keys.filter((k) => k.activatedAt != null).length;
    if (usedLine) usedLine.textContent = `Used ${used} · Unused ${keys.length - used}`;
  }
  if (hist) {
    const rows = keys.slice(0, 6);
    hist.innerHTML = rows.length ? rows.map((k) => `
      <tr>
        <td><span class="mono">${esc(k.id.slice(0, 8))}</span></td>
        <td>${esc(keyDurLabel(k))}</td>
        <td><span class="mono">${esc(k.code.length > 18 ? k.code.slice(0, 18) + "…" : k.code)}</span></td>
        <td style="white-space:nowrap">${timeAgo(k.createdAt)}</td>
      </tr>`).join("")
      : `<tr><td colspan="4"><div class="empty">No keys yet.</div></td></tr>`;
  }
}
function jumpToKeys(filter) {
  S.keys.status = filter; S.keys.page = 1; S.keys.search = "";
  go("keys");
}
function startSubCountdown() {
  if (subTimer) { clearInterval(subTimer); subTimer = null; }
  const tick = () => {
    const el = document.getElementById("sub-count");
    if (!el) { if (subTimer) { clearInterval(subTimer); subTimer = null; } return; }
    const ts = Number(el.dataset.ts);
    const diff = ts - Date.now();
    el.textContent = diff <= 0 ? "Expired" : fmtCountdown(diff);
  };
  subTimer = setInterval(tick, 1000);
  tick();
}
async function loadDashSub() {
  const { data } = await api("/api/keys?status=expiring&sort=expiry&perPage=1");
  const box = document.getElementById("dash-sub");
  if (!box) return;
  if (!data.ok || !data.keys.length) {
    box.innerHTML = `<div class="sub-count">—</div><div class="sub-key">No keys expiring soon.</div>`;
    return;
  }
  const k = data.keys[0];
  box.innerHTML = `
    <div class="sub-count" id="sub-count" data-ts="${k.expiresAt}">…</div>
    <div class="sub-key"><span class="mono">${esc(k.code)}</span> · ${esc(keyDurLabel(k))}</div>
    <div style="margin-top:12px"><button class="link" onclick="jumpToKeys('expiring')">View next-expiring keys →</button></div>`;
  startSubCountdown();
}
async function loadDashAct() {
  const { data } = await api("/api/activity?page=1");
  const box = document.getElementById("dash-act");
  if (!box) return;
  if (!data.ok || !data.activity.length) { box.innerHTML = `<div class="empty">No activity yet.</div>`; return; }
  const labels = { activation: "Activation", rejected: "Rejected", generated: "Generated", deleted: "Deleted", refunded: "Refunded", renewed: "Renewed", login: "Login" };
  box.innerHTML = `<div class="detail-list">` + data.activity.slice(0, 5).map((a) =>
    `<div class="dl-row"><span><b>${esc(labels[a.type] || a.type)}</b> ${a.keyCode ? `<span class="mono">${esc(a.keyCode.slice(0, 14))}…</span>` : ""}<br>
    <span style="color:var(--dim);font-size:12px">${esc(a.detail || "")}</span></span>
    <span style="color:var(--dim);font-size:12px;white-space:nowrap">${timeAgo(a.ts)}</span></div>`).join("") + `</div>
    <div style="margin-top:12px"><button class="link" onclick="go('activity')">View all activity →</button></div>`;
}

/* ---------- keys ---------- */
const KEY_STATUSES = [["all", "All"], ["active", "Active"], ["used", "Used"], ["unused", "Unused"], ["expiring", "Expiring soon"], ["expired", "Expired"], ["revoked", "Revoked"], ["banned", "Banned"]];
function pageKeys(el) {
  el.innerHTML = `
  <div class="page-head">
    <div><h1>Keys</h1><p>Search, filter and manage license keys</p></div>
    <div class="page-actions">
      <button class="btn-real btn-ivory btn-sm" id="k-expf">↓ Export CSV (<span id="k-expn">0</span>)</button>
      <button class="btn-real btn-ivory btn-sm" id="k-expall">↓ Export All Keys</button>
    </div>
  </div>
  <div class="toolbar">
    <input class="input grow" id="k-search" value="${esc(S.keys.search)}">
    <div class="seg-track" id="k-sort">
      <button class="${S.keys.sort === "newest" ? "on" : ""}" data-v="newest">Newest first</button>
      <button class="${S.keys.sort === "expiry" ? "on" : ""}" data-v="expiry">◷ Nearest expiry</button>
    </div>
  </div>
  <div class="chips" id="k-chips">
    ${KEY_STATUSES.map(([v, l]) => `<button class="seg-chip${S.keys.status === v ? " on" : ""}" data-s="${v}">${l}<span class="seg-count" data-c="${v}">…</span></button>`).join("")}
  </div>
  <div class="bulk-bar" id="k-bulkbar" style="display:none">
    <span class="selcount" id="k-selcount"></span>
    <button class="btn-real btn-ivory btn-sm" onclick="bulkAction('revoke')">⊘ Revoke</button>
    <button class="btn-real btn-ivory btn-sm" onclick="bulkAction('ban')">✖ Ban</button>
    <button class="btn-real btn-ivory btn-sm" onclick="bulkAction('reactivate')">↻ Reactivate</button>
    <button class="btn-real btn-ivory btn-sm" onclick="bulkAction('export')">↓ Export selected</button>
    <button class="btn-real btn-danger btn-sm" onclick="bulkAction('delete')">✕ Delete</button>
    <button class="link" onclick="clearSel()">Clear</button>
  </div>
  <div class="key-grid" id="k-grid">
    <div class="key-card"><div class="skel" style="height:120px"></div></div>
    <div class="key-card"><div class="skel" style="height:120px"></div></div>
  </div>
  <div class="pagination" id="k-pager"></div>`;
  const si = document.getElementById("k-search");
  si.addEventListener("keydown", (e) => { if (e.key === "Enter") { S.keys.search = si.value; S.keys.page = 1; loadKeys(); } });
  si.addEventListener("change", () => { S.keys.search = si.value; S.keys.page = 1; loadKeys(); });
  document.querySelectorAll("#k-sort button").forEach((b) =>
    b.addEventListener("click", () => {
      S.keys.sort = b.dataset.v; S.keys.page = 1;
      document.querySelectorAll("#k-sort button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on"); loadKeys();
    }));
  document.querySelectorAll("#k-chips .seg-chip").forEach((c) =>
    c.addEventListener("click", () => {
      S.keys.status = c.dataset.s; S.keys.page = 1; S.keys.selected = new Set();
      document.querySelectorAll("#k-chips .seg-chip").forEach((x) => x.classList.remove("on"));
      c.classList.add("on"); loadKeys();
    }));
  document.getElementById("k-expf").onclick = () => exportKeysCsv(true);
  document.getElementById("k-expall").onclick = () => exportKeysCsv(false);
  loadKeys();
  loadKeyCounts();
}
async function loadKeyCounts() {
  const results = await Promise.all(KEY_STATUSES.map(async ([v]) => {
    try {
      const { data } = await api("/api/keys?status=" + encodeURIComponent(v) + "&perPage=1");
      return [v, data.ok ? data.total : 0];
    } catch (e) { return [v, 0]; }
  }));
  S.keys.counts = Object.fromEntries(results);
  document.querySelectorAll("#k-chips .seg-count").forEach((sp) => {
    const v = sp.dataset.c;
    sp.textContent = S.keys.counts[v] != null ? S.keys.counts[v] : "0";
  });
  const expn = document.getElementById("k-expn");
  if (expn) expn.textContent = S.keys.total;
}
async function loadKeys() {
  const q = new URLSearchParams({ search: S.keys.search, status: S.keys.status, sort: S.keys.sort, page: S.keys.page, perPage: S.keys.perPage });
  const { data } = await api("/api/keys?" + q.toString());
  const grid = document.getElementById("k-grid");
  if (!grid) return;
  if (!data.ok) { grid.innerHTML = `<div class="empty">${esc(data.error || "Failed.")}</div>`; return; }
  S.keys.items = data.keys; S.keys.total = data.total;
  const expn = document.getElementById("k-expn");
  if (expn) expn.textContent = data.total;
  if (!data.keys.length) {
    grid.innerHTML = `<div class="empty">No keys found.</div>`;
  } else {
    grid.innerHTML = data.keys.map((k) => keyCardHtml(k)).join("");
  }
  updateBulkbar();
  const pages = Math.max(1, Math.ceil(data.total / data.perPage));
  document.getElementById("k-pager").innerHTML = `
    <button class="btn-real btn-ivory btn-sm" ${S.keys.page <= 1 ? "disabled" : ""} onclick="keysPage(-1)">← Prev</button>
    <span>Page ${S.keys.page} of ${pages} (${data.total} keys)</span>
    <button class="btn-real btn-ivory btn-sm" ${S.keys.page >= pages ? "disabled" : ""} onclick="keysPage(1)">Next →</button>`;
}
function keyCardHtml(k) {
  const sel = S.keys.selected.has(k.id);
  const blocked = (k.devices || []).some((d) => d.blocked);
  const isReseller = S.me.role === "reseller";
  const price = durPrice(k.duration);
  const renewLbl = isReseller && price > 0 ? `↻ Renew · ₹${price}` : "↻ Renew";
  const statusBtns = k.status === "active"
    ? `<button class="icon-btn" onclick="setKeyStatus('${k.id}','revoked')">⊘ Revoke</button>
       <button class="icon-btn" onclick="setKeyStatus('${k.id}','banned')">✖ Ban</button>`
    : `<button class="icon-btn" onclick="setKeyStatus('${k.id}','active')">↻ Reactivate</button>`;
  return `
  <div class="key-card${sel ? " selected" : ""}">
    <div class="key-top">
      <input type="checkbox" class="checkbox" ${sel ? "checked" : ""} onchange="selKey('${k.id}', this.checked, this)">
      <div class="key-code">${esc(k.code)}</div>
    </div>
    <div class="key-meta">
      ${keyStatusPill(k)}
      <span class="pill pill-gold">${esc(keyDurLabel(k))}</span>
      ${blocked ? '<span class="pill pill-banned">Blocked device</span>' : ""}
    </div>
    <div class="key-lines">Created ${fmtDate(k.createdAt)} · ${k.devices.length}/${k.maxDevices} devices<br>${timingLine(k)}</div>
    ${k.note ? `<div class="key-note">${esc(k.note)}</div>` : ""}
    <div class="key-actions">
      <button class="icon-btn" onclick="copyKeyById('${k.id}')">⧉ Copy</button>
      <button class="icon-btn" onclick="toggleDevices('${k.id}')">▣ Devices</button>
      <button class="icon-btn" onclick="editKey('${k.id}')">✎ Edit</button>
      <button class="icon-btn" onclick="renewKey('${k.id}')">${renewLbl}</button>
      ${statusBtns}
      <button class="icon-btn danger" onclick="delKey('${k.id}')">✕ Delete</button>
    </div>
    <div class="dev-panel" id="dev-${k.id}" style="display:none"></div>
  </div>`;
}
function keysPage(d) { S.keys.page += d; loadKeys(); }
function selKey(id, on, el) {
  on ? S.keys.selected.add(id) : S.keys.selected.delete(id);
  if (el && el.closest) {
    const card = el.closest(".key-card");
    if (card) card.classList.toggle("selected", on);
  }
  updateBulkbar();
}
function clearSel() { S.keys.selected = new Set(); loadKeys(); }
function toggleAllSel(on) {
  S.keys.items.forEach((k) => on ? S.keys.selected.add(k.id) : S.keys.selected.delete(k.id));
  loadKeys();
}
function updateBulkbar() {
  const bar = document.getElementById("k-bulkbar");
  if (!bar) return;
  const n = S.keys.selected.size;
  bar.style.display = n ? "flex" : "none";
  const sc = document.getElementById("k-selcount");
  if (sc) sc.textContent = n + " selected";
}
function bulkAction(action) {
  const ids = [...S.keys.selected];
  if (!ids.length) return;
  if (action === "export") { exportSelectedCsv(ids); return; }
  const labels = { revoke: "revoke", ban: "ban", reactivate: "reactivate", delete: "delete" };
  const danger = action === "delete" || action === "ban";
  confirmDlg("Confirm", `Are you sure you want to ${labels[action]} ${ids.length} key(s)?`, "Confirm",
    async () => {
      const { data } = await api("/api/keys/bulk", { method: "POST", body: { ids, action } });
      if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
      toast("Done.", "ok");
      if (data.refundedTotal) toast(`Refunded ₹${data.refundedTotal}.`, "ok");
      S.keys.selected = new Set(); loadKeys(); loadKeyCounts();
    }, danger);
}
async function setKeyStatus(id, status) {
  const names = { active: "activate", revoked: "revoke", banned: "ban" };
  const danger = status !== "active";
  confirmDlg("Confirm", `Are you sure you want to ${names[status]} this key?`, "Confirm",
    async () => {
      const { data } = await api(`/api/keys/${id}/status`, { method: "POST", body: { status } });
      if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
      toast("Key updated.", "ok"); loadKeys(); loadKeyCounts();
    }, danger);
}
function delKey(id) {
  confirmDlg("Delete key", "Are you sure you want to delete this key? An unused key bought by a reseller will be refunded.", "Delete",
    async () => {
      const { data } = await api(`/api/keys/${id}`, { method: "DELETE" });
      if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
      toast(data.refunded ? `Deleted. Refunded ₹${data.refunded}.` : "Deleted.", "ok");
      loadKeys(); loadKeyCounts();
    }, true);
}
function renewKey(id) {
  confirmDlg("Renew key", "Renewing resets the key to not activated. The full duration starts on its next activation." + (S.me.role === "reseller" ? " You will be charged the current price." : ""), "Renew",
    async () => {
      const { data } = await api(`/api/keys/${id}/renew`, { method: "POST" });
      if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
      if (data.balance !== undefined) { S.me.balance = data.balance; renderShell(); }
      toast("Key renewed.", "ok"); loadKeys();
    }, false);
}
function editKey(id) {
  const k = S.keys.items.find((x) => x.id === id);
  if (!k) return;
  const durIds = (S.durations || []).map((d) => d.id);
  let ekDur = durIds.includes(k.duration) ? k.duration : "";
  openModal(`<h2>Edit Key</h2>
    <div class="field"><label>Duration</label>
      <div class="chips" id="ek-durs">
        ${(S.durations || []).map((d) => `<button class="seg-chip${ekDur === d.id ? " on" : ""}" data-d="${d.id}">${esc(d.label)}</button>`).join("")}
      </div>
      ${ekDur ? "" : `<div style="font-size:13px;color:var(--dim);margin-top:6px">Current: <b>${esc(keyDurLabel(k))}</b> (no longer offered)</div>`}
    </div>
    <div class="field"><label>Customer note</label><input class="input" id="ek-note" value="${esc(k.note || "")}"></div>
    <div class="field"><label>Device limit</label><input class="input" id="ek-md" type="number" min="1" max="9999" value="${k.maxDevices}"></div>
    <div class="btn-row">
      <button class="btn-real btn-ivory" onclick="closeModal()">Cancel</button>
      <button class="btn-real btn-gold" id="ek-save">Save</button>
    </div>`);
  document.querySelectorAll("#ek-durs .seg-chip").forEach((c) =>
    c.addEventListener("click", () => {
      ekDur = c.dataset.d;
      document.querySelectorAll("#ek-durs .seg-chip").forEach((x) => x.classList.toggle("on", x === c));
    }));
  document.getElementById("ek-save").onclick = async () => {
    const body = { note: document.getElementById("ek-note").value, maxDevices: document.getElementById("ek-md").value };
    if (ekDur) body.duration = ekDur;
    const { data } = await api(`/api/keys/${id}`, { method: "PATCH", body });
    if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
    closeModal(); toast("Key updated.", "ok"); loadKeys();
  };
}
async function toggleDevices(id) {
  const p = document.getElementById("dev-" + id);
  if (!p) return;
  if (p.style.display !== "none") { p.style.display = "none"; return; }
  p.style.display = "block";
  p.innerHTML = '<div class="skel" style="height:60px"></div>';
  await loadDevPanel(id);
}
async function loadDevPanel(id) {
  const p = document.getElementById("dev-" + id);
  if (!p) return;
  const { data } = await api(`/api/keys/${id}/devices`);
  if (!data.ok) { p.innerHTML = `<div class="empty">${esc(data.error || "Failed.")}</div>`; return; }
  DEV_CACHE[id] = data.devices;
  const rows = data.devices.length ? data.devices.map((d, i) => `
    <div class="dev-row">
      <span><span class="mono">${esc(d.id)}</span> <button class="link" onclick="copyDeviceId('${id}',${i})">Copy</button>${d.name ? `<br><span style="color:var(--dim)">${esc(d.name)}</span>` : ""}
      <br><span style="color:var(--dim)">First seen ${fmtDate(d.firstSeen)} · Last seen ${fmtDate(d.lastSeen)}</span></span>
      <span style="text-align:right">${d.blocked ? '<span class="pill pill-banned">Blocked</span>' : '<span class="pill pill-active">Active</span>'}
      <div class="key-actions" style="margin-top:6px;justify-content:flex-end">
        ${d.blocked ? `<button class="icon-btn" onclick="unblockDeviceIdx('${id}',${i})">Unblock</button>` : `<button class="icon-btn" onclick="blockDeviceIdx('${id}',${i})">Block</button>`}
        <button class="icon-btn danger" onclick="removeDeviceIdx('${id}',${i})">Remove</button>
      </div></span>
    </div>`).join("") : `<div class="empty">No devices bound yet.</div>`;
  p.innerHTML = rows + (data.devices.length ? `<div style="margin-top:10px"><button class="icon-btn" onclick="resetAllDevices('${id}')">↺ Reset all devices</button></div>` : "");
}
async function blockDeviceIdx(keyId, i) {
  const d = DEV_CACHE[keyId] && DEV_CACHE[keyId][i];
  if (!d) return;
  const { data } = await api(`/api/keys/${keyId}/devices/${encodeURIComponent(d.id)}/block`, { method: "POST" });
  if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
  toast("Device blocked.", "ok"); loadDevPanel(keyId);
}
async function unblockDeviceIdx(keyId, i) {
  const d = DEV_CACHE[keyId] && DEV_CACHE[keyId][i];
  if (!d) return;
  const { data } = await api(`/api/keys/${keyId}/devices/${encodeURIComponent(d.id)}/unblock`, { method: "POST" });
  if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
  toast("Device unblocked.", "ok"); loadDevPanel(keyId);
}
function removeDeviceIdx(keyId, i) {
  const d = DEV_CACHE[keyId] && DEV_CACHE[keyId][i];
  if (!d) return;
  confirmDlg("Remove device", "Remove this device? This frees one device slot.", "Remove",
    async () => {
      const { data } = await api(`/api/keys/${keyId}/devices/${encodeURIComponent(d.id)}`, { method: "DELETE" });
      if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
      toast("Device removed.", "ok"); loadDevPanel(keyId); loadKeys();
    }, true);
}
function resetAllDevices(id) {
  confirmDlg("Reset all devices", "Remove ALL devices from this key? Every device will need to verify again.", "Reset all",
    async () => {
      const { data } = await api(`/api/keys/${id}/devices`);
      if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
      for (const d of data.devices) {
        await api(`/api/keys/${id}/devices/${encodeURIComponent(d.id)}`, { method: "DELETE" });
      }
      toast("All devices removed.", "ok"); loadDevPanel(id); loadKeys();
    }, true);
}
function copyKeyById(id) {
  const k = S.keys.items.find((x) => x.id === id);
  if (k) copyText(k.code);
}
function copyGenKey(i) {
  const k = S.gen.result && S.gen.result[i];
  if (k) copyText(k.code);
}
const DEV_CACHE = {};
function copyDeviceId(keyId, i) {
  const d = DEV_CACHE[keyId] && DEV_CACHE[keyId][i];
  if (d) copyText(d.id);
}
/* ---------- CSV export ---------- */
function escCsv(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function keysToCsv(keys) {
  const rows = [["Code", "Duration", "Status", "Devices", "Max Devices", "Note", "Created", "Activated", "Expires", "Cost Paid"]];
  for (const k of keys) {
    rows.push([
      k.code, keyDurLabel(k), k.status, k.devices.length, k.maxDevices, k.note || "",
      new Date(k.createdAt).toISOString(), k.activatedAt ? new Date(k.activatedAt).toISOString() : "",
      k.expiresAt ? new Date(k.expiresAt).toISOString() : "Never",
      k.costPaid != null ? k.costPaid : "",
    ]);
  }
  return rows.map((r) => r.map(escCsv).join(",")).join("\n");
}
function downloadCsv(name, csv) {
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
async function fetchAllKeys(params) {
  let page = 1, all = [], total = 0;
  for (;;) {
    const q = new URLSearchParams({ ...params, page, perPage: 100 });
    const { data } = await api("/api/keys?" + q.toString());
    if (!data.ok) throw new Error(data.error || "Failed.");
    all = all.concat(data.keys); total = data.total; page++;
    if (all.length >= total || !data.keys.length) break;
  }
  return all;
}
async function exportKeysCsv(filtered) {
  try {
    const params = filtered
      ? { search: S.keys.search, status: S.keys.status, sort: S.keys.sort }
      : { search: "", status: "all", sort: "newest" };
    const keys = await fetchAllKeys(params);
    downloadCsv(filtered ? "license-keys-filtered.csv" : "license-keys-all.csv", keysToCsv(keys));
    toast(`Exported ${keys.length} key(s).`, "ok");
  } catch (e) { toast(e.message || "Export failed.", "err"); }
}
function exportSelectedCsv(ids) {
  const keys = S.keys.items.filter((k) => ids.includes(k.id));
  if (!keys.length) { toast("Nothing selected.", "err"); return; }
  downloadCsv("license-keys-selected.csv", keysToCsv(keys));
  toast(`Exported ${keys.length} key(s).`, "ok");
}

/* ---------- generate ---------- */
function pageGenerate(el) {
  const g = S.gen;
  g.result = null;
  if (!(S.durations || []).some((d) => d.id === g.duration)) g.duration = (S.durations[0] || {}).id || g.duration;
  const isReseller = S.me.role === "reseller";
  el.innerHTML = `
  <div class="page-head"><div><h1>Generate Keys</h1><p>Create new license keys</p></div></div>
  <div class="premium-card" style="max-width:720px"><div class="gold-bar"></div>
    <div class="chips">
      <button class="seg-chip${g.mode === "auto" ? " on" : ""}" onclick="genMode('auto')">⚙ Auto Key</button>
      <button class="seg-chip${g.mode === "custom" ? " on" : ""}" onclick="genMode('custom')">★ Custom Key</button>
    </div>
    <h3>Duration</h3>
    <div class="dur-grid" id="g-durs">
      ${(S.durations || []).map((d) => `
        <button class="dur-chip${g.duration === d.id ? " on" : ""}" data-d="${d.id}">${esc(d.label)} · ₹${esc(d.price)}</button>`).join("")}
    </div>
    <div id="g-customwrap" style="display:${g.mode === "custom" ? "block" : "none"}">
      <div class="field"><label>Custom key</label><input class="input" id="g-custom"></div>
    </div>
    <div class="grid-2">
      <div class="field" id="g-countwrap" style="display:${g.mode === "custom" ? "none" : "block"}">
        <label>Number of keys (1–50)</label><input class="input" id="g-count" type="number" min="1" max="50" value="${g.count}">
      </div>
      <div class="field"><label>Device limit</label><input class="input" id="g-md" type="number" min="1" max="9999" value="${g.maxDevices}"></div>
    </div>
    <div class="field"><label>Customer note</label><input class="input" id="g-note"></div>
    <div class="preview-box" id="g-preview"></div>
    <div class="cost-line" id="g-cost"></div>
    <div id="g-balpanel"></div>
    ${isReseller ? "" : `<div class="info-panel" id="g-masterinfo"></div>`}
    <div style="margin-top:16px"><button class="btn-real btn-gold btn-block" id="g-go">Generate</button></div>
    <div class="result-keys" id="g-result"></div>
  </div>`;
  document.querySelectorAll("#g-durs .dur-chip").forEach((c) =>
    c.addEventListener("click", () => { g.duration = c.dataset.d; pageGenerate(el); }));
  const upd = () => updateGenPreview(el);
  const gc = document.getElementById("g-count");
  if (gc) gc.addEventListener("input", upd);
  document.getElementById("g-md").addEventListener("input", upd);
  const gcu = document.getElementById("g-custom");
  if (gcu) gcu.addEventListener("input", upd);
  document.getElementById("g-note").addEventListener("input", upd);
  document.getElementById("g-go").onclick = () => doGenerate(el);
  updateGenPreview(el);
}
function genMode(m) { S.gen.mode = m; const el = document.getElementById("page"); pageGenerate(el); }
function genInputs() {
  const g = S.gen;
  const countEl = document.getElementById("g-count");
  const count = g.mode === "custom" ? 1 : Math.min(50, Math.max(1, parseInt((countEl || {}).value, 10) || 1));
  const md = Math.min(9999, Math.max(1, parseInt((document.getElementById("g-md") || {}).value, 10) || 1));
  const note = (document.getElementById("g-note") || {}).value || "";
  const customKey = (document.getElementById("g-custom") || {}).value || "";
  return { count, md, note, customKey };
}
function updateGenPreview(el) {
  const g = S.gen;
  const { count, md, customKey } = genInputs();
  const price = durPrice(g.duration);
  const total = price * md * count;
  const isReseller = S.me.role === "reseller";
  const pv = document.getElementById("g-preview");
  if (pv) {
    const prev = g.mode === "custom"
      ? (customKey ? esc(customKey) : "—")
      : esc(durPrefix(g.duration) + "xxxxxxxxxxx");
    pv.innerHTML = `<div style="font-size:12px;color:var(--dim);font-weight:800;margin-bottom:6px">LIVE PREVIEW</div>
      <div class="mono" style="font-size:14px;font-weight:700">${prev}</div>
      <div style="font-size:13px;color:var(--dim);margin-top:6px">${esc(durLabel(g.duration))} · ${md} device(s)${g.mode === "auto" ? " · " + count + " key(s)" : ""}</div>`;
  }
  const costEl = document.getElementById("g-cost");
  if (costEl) costEl.innerHTML = `Price: <b>₹${price}</b> per device · Total cost: <b>₹${total}</b>`;
  const bp = document.getElementById("g-balpanel");
  if (bp) {
    if (isReseller) {
      const after = (S.me.balance || 0) - total;
      bp.innerHTML = `<div class="bal-panel">
        <div class="detail-list">
          <div class="dl-row"><span class="k">Price</span><span><b>₹${price}</b> per device</span></div>
          <div class="dl-row"><span class="k">Total</span><span><b>₹${total}</b></span></div>
          <div class="dl-row"><span class="k">Balance after</span><span><b>₹${after}</b></span></div>
        </div>
        ${after < 0 ? `<div class="warn">Insufficient balance. Add balance or reduce keys/devices.</div>` : ""}
      </div>`;
      document.getElementById("g-go").disabled = after < 0;
    } else bp.innerHTML = "";
  }
  const mi = document.getElementById("g-masterinfo");
  if (mi) mi.innerHTML = `Reseller price · ${esc(durLabel(g.duration))}: <b>₹${price}</b> per device.`;
}
async function doGenerate(el) {
  const g = S.gen;
  const { count, md, note, customKey } = genInputs();
  if (g.mode === "custom" && !customKey.trim()) { toast("Enter a custom key.", "err"); return; }
  const { data } = await api("/api/keys", {
    method: "POST",
    body: { mode: g.mode, duration: g.duration, count, maxDevices: md, note, customKey },
  });
  if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
  if (data.balance !== undefined) { S.me.balance = data.balance; renderShell(); return pageGenerate(document.getElementById("page")); }
  g.result = data.keys;
  const box = document.getElementById("g-result");
  if (box) {
    box.innerHTML = `<h3 style="margin:6px 0 8px">Generated ${data.keys.length} key(s)</h3>` +
      data.keys.map((k, i) => `<div class="row"><span class="mono grow">${esc(k.code)}</span><button class="icon-btn" onclick="copyGenKey(${i})">⧉ Copy</button></div>`).join("");
  }
  toast("Keys generated.", "ok");
}

/* ---------- prices (master) ---------- */
async function refreshDurations() {
  const { data } = await api("/api/durations");
  if (data.ok) S.durations = data.durations;
  if (!(S.durations || []).some((d) => d.id === S.gen.duration)) S.gen.duration = (S.durations[0] || {}).id;
}
function pagePrices(el) {
  el.innerHTML = `
  <div class="page-head"><div><h1>Manage Price</h1><p>Set the price resellers pay per duration, per device</p></div></div>
  <div class="premium-card" style="max-width:640px"><div class="gold-bar"></div>
    <h2>Prices</h2>
    <div id="p-rows"><div class="skel" style="height:120px"></div></div>
  </div>
  <div class="premium-card" style="max-width:640px"><div class="gold-bar"></div>
    <h2>Add New Duration</h2>
    <div class="grid-2">
      <div class="field"><label>Duration</label><input class="input" id="nd-val" type="number" min="1" max="9999"></div>
      <div class="field"><label>Unit</label>
        <div class="chips" id="nd-unit">
          <button class="seg-chip on" data-u="Hour">Hour</button>
          <button class="seg-chip" data-u="Day">Day</button>
        </div>
      </div>
    </div>
    <div class="field"><label>Price (₹ per device)</label><input class="input" id="nd-price" type="number" min="0"></div>
    <div class="preview-box" id="nd-preview" style="margin-top:10px"></div>
    <div style="margin-top:12px"><button class="btn-real btn-gold" id="nd-add">Add Duration</button></div>
  </div>
  <div class="premium-card" style="max-width:640px"><div class="gold-bar"></div>
    <h2>What resellers see</h2><p class="card-sub">Price per device for each duration</p>
    <div class="see-grid" id="p-see"><div class="skel" style="height:80px"></div></div>
    <div class="foot-note">Prices are in rupees (₹) per device.</div>
  </div>`;
  loadPrices();
  let ndUnit = "Hour";
  const updNdPreview = () => {
    const v = parseInt((document.getElementById("nd-val") || {}).value, 10);
    const pv = Number((document.getElementById("nd-price") || {}).value);
    const box = document.getElementById("nd-preview");
    if (!box) return;
    if (!Number.isFinite(v) || v < 1) {
      box.innerHTML = `<span style="color:var(--dim);font-size:13px">Enter a duration to see the preview.</span>`;
      return;
    }
    box.innerHTML = `<div style="font-size:12px;color:var(--dim);font-weight:800;margin-bottom:6px">PREVIEW</div>
      <div style="font-size:14px">New duration: <b>${v} ${ndUnit}</b> · <b>₹${Number.isFinite(pv) && pv >= 0 ? pv : 0}</b> per device · Auto Key prefix <span class="mono"><b>${v}${ndUnit}X</b></span></div>`;
  };
  document.querySelectorAll("#nd-unit .seg-chip").forEach((c) =>
    c.addEventListener("click", () => {
      ndUnit = c.dataset.u;
      document.querySelectorAll("#nd-unit .seg-chip").forEach((x) => x.classList.toggle("on", x === c));
      updNdPreview();
    }));
  ["nd-val", "nd-price"].forEach((id) => {
    const ix = document.getElementById(id);
    if (ix) ix.addEventListener("input", updNdPreview);
  });
  updNdPreview();
  document.getElementById("nd-add").onclick = addNewDuration;
}
async function addNewDuration() {
  const v = document.getElementById("nd-val").value;
  const p = document.getElementById("nd-price").value;
  const u = (document.querySelector("#nd-unit .seg-chip.on") || {}).dataset.u || "Hour";
  const { data } = await api("/api/durations", { method: "POST", body: { value: v, unit: u, price: p } });
  if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
  toast(data.restored ? "Duration restored." : "Duration added.", "ok");
  await refreshDurations();
  pagePrices(document.getElementById("page"));
}
function deleteDuration(id, label) {
  confirmDlg("Delete duration", `Delete the ${label} duration? Existing keys keep working, but no new keys can use it.`, "Delete",
    async () => {
      const { data } = await api(`/api/durations/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
      toast("Duration deleted.", "ok");
      await refreshDurations();
      pagePrices(document.getElementById("page"));
    }, true);
}
async function loadPrices() {
  const box = document.getElementById("p-rows");
  const see = document.getElementById("p-see");
  if (!box) return;
  const order = S.durations || [];
  box.innerHTML = order.map((d) => `
    <div class="price-row">
      <span class="lbl">${esc(d.label)}</span>
      <span class="price-ctl">
        <b>₹</b>
        <input class="input" id="pr-${d.id}" type="number" min="0" value="${esc(d.price)}" data-orig="${esc(d.price)}">
        <button class="btn-real btn-gold btn-sm" id="prs-${d.id}" onclick="savePrice('${d.id}')" disabled>Save</button>
        <button class="btn-real btn-danger btn-sm" title="Delete duration" onclick="deleteDuration('${d.id}','${esc(d.label)}')">✕</button>
      </span>
    </div>`).join("");
  order.forEach((d) => {
    const inp = document.getElementById("pr-" + d.id);
    const btn = document.getElementById("prs-" + d.id);
    if (inp && btn) inp.addEventListener("input", () => { btn.disabled = inp.value === inp.dataset.orig; });
  });
  if (see) {
    see.innerHTML = order.map((d) => `
      <div class="cell"><div class="d">${esc(d.label)}</div><div class="p">₹${esc(d.price)}</div></div>`).join("");
  }
}
async function savePrice(d) {
  const v = document.getElementById("pr-" + d).value;
  const { data } = await api("/api/prices", { method: "PUT", body: { prices: { [d]: v } } });
  if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
  await refreshDurations();
  const inp = document.getElementById("pr-" + d);
  const btn = document.getElementById("prs-" + d);
  if (inp && btn) { inp.dataset.orig = inp.value; btn.disabled = true; }
  toast("Price saved.", "ok");
}

/* ---------- sales report (master) ---------- */
const SALES_PRESETS = [["all", "All time"], ["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["custom", "Custom"]];
function salesRange(preset) {
  const now = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (preset === "today") return { from: iso(now), to: iso(now) };
  if (preset === "7d") { const t = new Date(now); t.setDate(t.getDate() - 6); return { from: iso(t), to: iso(now) }; }
  if (preset === "30d") { const t = new Date(now); t.setDate(t.getDate() - 29); return { from: iso(t), to: iso(now) }; }
  return { from: "", to: "" };
}
function pageSales(el) {
  el.innerHTML = `
  <div class="page-head"><div><h1>Sales Report</h1><p>Keys sold and balance earned per reseller</p></div></div>
  <div class="chips" id="s-presets">
    ${SALES_PRESETS.map(([v, l]) => `<button class="seg-chip${S.sales.preset === v ? " on" : ""}" data-p="${v}">${l}</button>`).join("")}
  </div>
  <div class="premium-card" id="s-custom" style="display:${S.sales.preset === "custom" ? "block" : "none"};max-width:640px"><div class="gold-bar"></div>
    <div class="toolbar" style="margin:0">
      <div class="field" style="margin:0"><label>From</label><input class="input" id="s-from" type="date" value="${esc(S.sales.from)}"></div>
      <div class="field" style="margin:0"><label>To</label><input class="input" id="s-to" type="date" value="${esc(S.sales.to)}"></div>
      <div><label>&nbsp;</label><button class="btn-real btn-gold" id="s-go">Apply</button></div>
    </div>
  </div>
  <div id="s-out"><div class="premium-card"><div class="skel" style="height:120px"></div></div></div>`;
  document.querySelectorAll("#s-presets .seg-chip").forEach((c) =>
    c.addEventListener("click", () => {
      S.sales.preset = c.dataset.p;
      document.querySelectorAll("#s-presets .seg-chip").forEach((x) => x.classList.remove("on"));
      c.classList.add("on");
      const cc = document.getElementById("s-custom");
      if (cc) cc.style.display = S.sales.preset === "custom" ? "block" : "none";
      if (S.sales.preset !== "custom") {
        const r = salesRange(S.sales.preset);
        S.sales.from = r.from; S.sales.to = r.to;
        loadSales();
      }
    }));
  const goBtn = document.getElementById("s-go");
  if (goBtn) goBtn.onclick = () => {
    S.sales.from = document.getElementById("s-from").value;
    S.sales.to = document.getElementById("s-to").value;
    loadSales();
  };
  const r0 = salesRange(S.sales.preset);
  if (S.sales.preset !== "custom") { S.sales.from = r0.from; S.sales.to = r0.to; }
  loadSales();
}
async function loadSales() {
  const box = document.getElementById("s-out");
  if (!box) return;
  const q = new URLSearchParams({ from: S.sales.from, to: S.sales.to });
  const { data } = await api("/api/sales?" + q.toString());
  if (!data.ok) { box.innerHTML = `<div class="empty">${esc(data.error || "Failed.")}</div>`; return; }
  S.sales.rows = data.rows; S.sales.totals = data.totals; S.sales.top = data.top;
  const nResellers = data.rows.length;
  const totalEarned = data.totals.earned || 0;
  box.innerHTML = `
    <div class="sales-stats">
      <div class="sales-stat"><div class="v">${data.totals.keysSold}</div><div class="k">Total keys sold</div></div>
      <div class="sales-stat"><div class="v">₹${esc(data.totals.earned)}</div><div class="k">Total earning</div></div>
      <div class="sales-stat"><div class="v">${nResellers}</div><div class="k">Resellers</div></div>
    </div>
    ${data.top ? `<div class="top-banner">★ Top reseller: <b>@${esc(data.top.reseller)}</b> — ${data.top.keysSold} keys, ₹${esc(data.top.earned)} earned</div>` : ""}
    <div class="premium-card"><div class="gold-bar"></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Reseller</th><th>Keys sold</th><th>Balance earned</th><th>Share</th></tr></thead>
        <tbody>${data.rows.length ? data.rows.map((r) => `
          <tr><td><b>@${esc(r.reseller)}</b></td><td>${r.keysSold}</td><td><b>₹${esc(r.earned)}</b></td>
          <td>${totalEarned ? Math.round((r.earned / totalEarned) * 100) : 0}%</td></tr>`).join("")
          : `<tr><td colspan="4"><div class="empty">No sales in this range.</div></td></tr>`}
        </tbody>
        <tfoot><tr><td><b>Total</b></td><td><b>${data.totals.keysSold}</b></td><td><b>₹${esc(data.totals.earned)}</b></td><td><b>100%</b></td></tr></tfoot>
      </table></div>
    </div>`;
}

/* ---------- activity ---------- */
const ACT_TYPES = [["all", "All"], ["activation", "Activations"], ["rejected", "Rejected"], ["generated", "Generated"], ["deleted", "Deleted"], ["refunded", "Refunded"]];
function pageActivity(el) {
  const a = S.activity;
  el.innerHTML = `
  <div class="page-head">
    <div class="act-head"><span class="act-dot"></span><div><h1>Activity</h1><p>Live feed of panel events</p></div>
    <span class="alert-badge" id="a-alertbadge" style="display:none"></span></div>
  </div>
  <div class="toolbar">
    <input class="input grow" id="a-search" value="${esc(a.search)}">
    <label class="toggle-row"><input type="checkbox" class="checkbox" id="a-alertsonly" ${a.alertsOnly ? "checked" : ""}> ⚠ Alerts only</label>
  </div>
  <div class="chips" id="a-chips">
    ${ACT_TYPES.map(([v, l]) => `<button class="seg-chip${a.type === v ? " on" : ""}" data-s="${v}">${l}</button>`).join("")}
  </div>
  <div class="premium-card"><div class="gold-bar"></div><div id="a-rows"><div class="skel" style="height:120px"></div></div></div>
  <div class="pagination" id="a-pager"></div>`;
  const si = document.getElementById("a-search");
  si.addEventListener("keydown", (e) => { if (e.key === "Enter") { a.search = si.value; a.page = 1; loadActivity(); } });
  si.addEventListener("change", () => { a.search = si.value; a.page = 1; loadActivity(); });
  document.getElementById("a-alertsonly").addEventListener("change", (e) => {
    a.alertsOnly = e.target.checked;
    a.type = a.alertsOnly ? "rejected" : "all";
    a.page = 1;
    document.querySelectorAll("#a-chips .seg-chip").forEach((x) => x.classList.toggle("on", x.dataset.s === a.type));
    loadActivity();
  });
  document.querySelectorAll("#a-chips .seg-chip").forEach((c) =>
    c.addEventListener("click", () => {
      a.type = c.dataset.s; a.page = 1;
      a.alertsOnly = (a.type === "rejected") && a.alertsOnly;
      document.getElementById("a-alertsonly").checked = a.alertsOnly;
      document.querySelectorAll("#a-chips .seg-chip").forEach((x) => x.classList.remove("on"));
      c.classList.add("on"); loadActivity();
    }));
  loadActivity();
  loadAlertBadge();
  if (actTimer) clearInterval(actTimer);
  actTimer = setInterval(() => { if (S.page === "activity") loadActivity(true); }, 4000);
}
async function loadAlertBadge() {
  try {
    const { data } = await api("/api/activity?type=rejected&perPage=1");
    const n = data.ok ? data.total : 0;
    const b = document.getElementById("a-alertbadge");
    if (b) {
      b.style.display = n ? "" : "none";
      b.textContent = "⚠ " + (n > 99 ? "99+" : n) + " alerts";
    }
  } catch (e) {}
}
function actRowHtml(x) {
  const labels = { activation: "Activation", rejected: "Rejected", generated: "Generated", deleted: "Deleted", refunded: "Refunded", renewed: "Renewed", login: "Login" };
  const parts = [];
  if (x.keyCode) parts.push(`<span class="mono">${esc(x.keyCode)}</span>`);
  if (x.resellerName) parts.push(`Reseller <b>@${esc(x.resellerName)}</b>`);
  if (x.fingerprint) parts.push(`Fingerprint <span class="mono">${esc(x.fingerprint)}</span>`);
  if (x.deviceId) parts.push(`Device <span class="mono">${esc(x.deviceId)}</span>`);
  if (x.detail) parts.push(esc(x.detail));
  parts.push(fmtDate(x.ts));
  return `
  <div class="act-row">
    <div class="body">
      <div class="title">${esc(labels[x.type] || x.type)}
        ${x.amount != null ? `<span class="amt-chip">₹${esc(x.amount)}</span>` : ""}
        ${x.suspicious ? `<span class="sus-badge">⚠ Suspicious</span>` : ""}
      </div>
      <div class="detail">${parts.join(" · ")}</div>
    </div>
    <div class="time">${timeAgo(x.ts)}</div>
  </div>`;
}
async function loadActivity(quiet) {
  const a = S.activity;
  const q = new URLSearchParams({ type: a.type, search: a.search, page: a.page });
  let data;
  try {
    const r = await api("/api/activity?" + q.toString());
    data = r.data;
  } catch (e) { if (!quiet) toast("Failed to load.", "err"); return; }
  const box = document.getElementById("a-rows");
  if (!box) return;
  if (!data.ok) { if (!quiet) box.innerHTML = `<div class="empty">${esc(data.error || "Failed.")}</div>`; return; }
  a.items = data.activity; a.total = data.total;
  box.innerHTML = data.activity.length
    ? data.activity.map(actRowHtml).join("")
    : `<div class="empty">No activity found.</div>`;
  const pages = Math.max(1, Math.ceil(data.total / data.perPage));
  const pg = document.getElementById("a-pager");
  if (pg) pg.innerHTML = `
    <button class="btn-real btn-ivory btn-sm" ${a.page <= 1 ? "disabled" : ""} onclick="actPage(-1)">← Prev</button>
    <span>Page ${a.page} of ${pages} (${data.total})</span>
    <button class="btn-real btn-ivory btn-sm" ${a.page >= pages ? "disabled" : ""} onclick="actPage(1)">Next →</button>`;
}
function actPage(d) { S.activity.page += d; loadActivity(); }

/* ---------- resellers (master) ---------- */
function pageResellers(el) {
  el.innerHTML = `
  <div class="page-head"><div><h1>Manage Reseller</h1><p>Create and manage reseller accounts</p></div></div>
  <div class="premium-card" style="max-width:720px"><div class="gold-bar"></div>
    <h2>Create Reseller</h2>
    <div class="grid-2">
      <div class="field"><label>Reseller name</label><input class="input" id="r-name"></div>
      <div class="field"><label>Username</label><input class="input" id="r-username"></div>
      <div class="field"><label>Password</label>
        <div class="pw-row">
          <input class="input" id="r-pass" type="password">
          <button class="pw-show" type="button" onclick="togglePw('r-pass', this)">👁 Show</button>
        </div>
      </div>
      <div class="field"><label>Contact</label><input class="input" id="r-contact"></div>
      <div class="field"><label>Starting balance</label><input class="input" id="r-balance" type="number" min="0"></div>
      <div class="field"><label>Referral code (optional)</label><input class="input" id="r-ref"></div>
    </div>
    <button class="btn-real btn-gold" id="r-go">+ Add reseller</button>
  </div>
  <div class="res-grid" id="r-list">
    <div class="res-card"><div class="skel" style="height:140px"></div></div>
    <div class="res-card"><div class="skel" style="height:140px"></div></div>
  </div>`;
  document.getElementById("r-go").onclick = async () => {
    const body = {
      name: document.getElementById("r-name").value,
      username: document.getElementById("r-username").value,
      password: document.getElementById("r-pass").value,
      contact: document.getElementById("r-contact").value,
      balance: document.getElementById("r-balance").value,
      referralCode: document.getElementById("r-ref").value,
    };
    const { data } = await api("/api/resellers", { method: "POST", body });
    if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
    toast("Reseller created.", "ok");
    pageResellers(document.getElementById("page"));
  };
  loadResellers();
}
function resellerCardHtml(r) {
  return `
  <div class="res-card"><div class="gold-bar"></div>
    <div class="res-top">
      <div class="avatar">${esc(initials(r.name))}</div>
      <div><div class="nm">${esc(r.name)}</div></div>
    </div>
    <div class="res-pills">
      <span class="pill pill-user">@${esc(r.username)}</span>
      <span class="pill pill-bal">Balance: ₹${esc(r.balance)}</span>
    </div>
    <div class="res-lines">
      ${r.contact ? `Contact: ${esc(r.contact)}<br>` : ""}
      ${r.referralCode ? `Referral: <span class="mono">${esc(r.referralCode)}</span><br>` : ""}
    </div>
    <div class="stat-grid">
      <div class="box"><div class="v">${r.stats.totalKeys}</div><div class="k">Total Keys</div></div>
      <div class="box"><div class="v">${r.stats.activeKeys}</div><div class="k">Active Keys</div></div>
      <div class="box"><div class="v">₹${esc(r.stats.earned)}</div><div class="k">Earned</div></div>
      <div class="box"><div class="v">${fmtDateOnly(r.createdAt)}</div><div class="k">Member Since</div></div>
    </div>
    <div class="bal-add">
      <div class="lbl">Add Balance</div>
      <div class="bal-add-row">
        <input class="input" id="bal-${r.id}" type="number">
        <button class="btn-real btn-gold" onclick="addBalance('${r.id}')">Apply</button>
      </div>
    </div>
    <div class="res-actions">
      <button class="btn-real btn-ivory" onclick="toggleResEdit('${r.id}')">✎ Edit</button>
      <button class="btn-real btn-danger" onclick="delReseller('${r.id}')">Remove</button>
    </div>
    <div class="res-edit" id="re-${r.id}" style="display:none"></div>
  </div>`;
}
async function loadResellers() {
  const { data } = await api("/api/resellers");
  const box = document.getElementById("r-list");
  if (!box) return;
  if (!data.ok) { box.innerHTML = `<div class="empty">${esc(data.error || "Failed.")}</div>`; return; }
  if (!data.resellers.length) { box.innerHTML = `<div class="empty">No resellers yet.</div>`; return; }
  box.innerHTML = data.resellers.map(resellerCardHtml).join("");
}
async function addBalance(id) {
  const v = document.getElementById("bal-" + id).value;
  if (v === "" || v == null) { toast("Enter an amount.", "err"); return; }
  const { data } = await api(`/api/resellers/${id}`, { method: "PATCH", body: { addBalance: v } });
  if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
  toast("Balance updated.", "ok"); loadResellers();
}
function toggleResEdit(id) {
  const box = document.getElementById("re-" + id);
  if (!box) return;
  if (box.style.display !== "none") { box.style.display = "none"; box.innerHTML = ""; return; }
  box.style.display = "block";
  box.innerHTML = '<div class="skel" style="height:120px"></div>';
  editReseller(id);
}
async function editReseller(id) {
  const box = document.getElementById("re-" + id);
  const { data } = await api("/api/resellers");
  if (!data.ok || !box) return;
  const r = data.resellers.find((x) => x.id === id);
  if (!r) return;
  box.innerHTML = `
    <div class="grid-2">
      <div class="field"><label>Name</label><input class="input" id="er-name-${id}" value="${esc(r.name)}"></div>
      <div class="field"><label>Username</label><input class="input" id="er-username-${id}" value="${esc(r.username)}"></div>
      <div class="field"><label>Contact</label><input class="input" id="er-contact-${id}" value="${esc(r.contact || "")}"></div>
      <div class="field"><label>Balance (exact)</label><input class="input" id="er-balance-${id}" type="number" value="${r.balance}"></div>
      <div class="field"><label>New password (min 4 chars, blank keeps current)</label>
        <div class="pw-row">
          <input class="input" id="er-pass-${id}" type="password">
          <button class="pw-show" type="button" onclick="togglePw('er-pass-${id}', this)">👁 Show</button>
        </div>
      </div>
    </div>
    <div class="btn-row">
      <button class="btn-real btn-ivory btn-sm" onclick="toggleResEdit('${id}')">Cancel</button>
      <button class="btn-real btn-gold btn-sm" onclick="saveReseller('${id}')">Save</button>
    </div>`;
}
async function saveReseller(id) {
  const pw = document.getElementById("er-pass-" + id).value;
  if (pw && pw.length < 4) { toast("Password must be at least 4 characters.", "err"); return; }
  const { data } = await api(`/api/resellers/${id}`, {
    method: "PATCH",
    body: {
      name: document.getElementById("er-name-" + id).value,
      username: document.getElementById("er-username-" + id).value,
      contact: document.getElementById("er-contact-" + id).value,
      balance: document.getElementById("er-balance-" + id).value,
      password: pw,
    },
  });
  if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
  toast("Reseller updated.", "ok"); loadResellers();
}
function delReseller(id) {
  confirmDlg("Remove reseller", "Remove this reseller? All of their keys will also be deleted (no refund).", "Remove",
    async () => {
      const { data } = await api(`/api/resellers/${id}`, { method: "DELETE" });
      if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
      toast("Reseller removed.", "ok"); loadResellers();
    }, true);
}

/* ---------- referrals (master) ---------- */
function refLink(code) {
  return location.origin + "/?ref=" + encodeURIComponent(code);
}
function pageReferrals(el) {
  el.innerHTML = `
  <div class="page-head"><div><h1>Create Referral</h1><p>Referral codes for new resellers</p></div></div>
  <div class="premium-card" style="max-width:640px"><div class="gold-bar"></div>
    <h2>New Referral Code</h2>
    <div class="field"><label>Note</label><input class="input" id="rf-note"></div>
    <button class="btn-real btn-gold" id="rf-go">✦ Generate referral code</button>
    <div id="rf-new"></div>
  </div>
  <div class="ref-grid" id="rf-list">
    <div class="ref-card"><div class="skel" style="height:120px"></div></div>
  </div>`;
  document.getElementById("rf-go").onclick = async () => {
    const { data } = await api("/api/referrals", { method: "POST", body: { note: document.getElementById("rf-note").value } });
    if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
    const link = refLink(data.referral.code);
    document.getElementById("rf-new").innerHTML = `
      <div class="ref-banner">
        <div class="code">${esc(data.referral.code)}</div>
        <div class="ref-link">${esc(link)}</div>
        <div class="btn-row">
          <button class="btn-real btn-ivory btn-sm" onclick="copyText('${esc(data.referral.code)}')">Copy code</button>
          <button class="btn-real btn-ivory btn-sm" onclick="copyText('${esc(link)}')">Copy link</button>
        </div>
      </div>`;
    document.getElementById("rf-note").value = "";
    toast("Referral code created.", "ok");
    loadReferrals();
  };
  loadReferrals();
}
async function loadReferrals() {
  const { data } = await api("/api/referrals");
  const box = document.getElementById("rf-list");
  if (!box) return;
  if (!data.ok) { box.innerHTML = `<div class="empty">${esc(data.error || "Failed.")}</div>`; return; }
  if (!data.referrals.length) { box.innerHTML = `<div class="empty">No referral codes yet.</div>`; return; }
  box.innerHTML = data.referrals.map((r) => {
    const link = refLink(r.code);
    return `
    <div class="ref-card"><div class="gold-bar"></div>
      <div class="key-meta" style="margin-bottom:12px">
        <span class="mono" style="font-size:16px;font-weight:800">${esc(r.code)}</span>
        ${r.active ? '<span class="pill pill-active">Active</span>' : '<span class="pill pill-unused">Disabled</span>'}
        <span class="uses-badge">${r.uses} use(s)</span>
      </div>
      ${r.note ? `<div class="res-lines">${esc(r.note)}</div>` : ""}
      <div class="res-lines">Created ${fmtDate(r.createdAt)}</div>
      <div class="ref-link">${esc(link)}</div>
      <div class="key-actions">
        <button class="icon-btn" onclick="copyText('${esc(r.code)}')">Copy code</button>
        <button class="icon-btn" onclick="copyText('${esc(link)}')">Copy link</button>
        <button class="icon-btn" onclick="toggleReferral('${r.id}', ${!r.active})">${r.active ? "Disable" : "Enable"}</button>
        <button class="icon-btn danger" onclick="delReferral('${r.id}')">Delete</button>
      </div>
    </div>`;
  }).join("");
}
async function toggleReferral(id, active) {
  const { data } = await api(`/api/referrals/${id}`, { method: "PATCH", body: { active } });
  if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
  toast(active ? "Referral enabled." : "Referral disabled.", "ok"); loadReferrals();
}
function delReferral(id) {
  confirmDlg("Delete referral", "Delete this referral code?", "Delete",
    async () => {
      const { data } = await api(`/api/referrals/${id}`, { method: "DELETE" });
      if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
      toast("Referral deleted.", "ok"); loadReferrals();
    }, true);
}

/* ---------- server control (master) ---------- */
function pageServer(el) {
  el.innerHTML = `
  <div class="page-head"><div><h1>Server Control</h1><p>Maintenance mode and broadcast message for app users</p></div></div>
  <div class="premium-card" style="max-width:640px"><div class="gold-bar"></div>
    <h2>Server Status</h2>
    <div class="server-status" id="sv-card"><div class="skel" style="height:40px"></div></div>
    <div class="btn-row" style="margin-bottom:18px;align-items:center">
      <label class="switch" title="Toggle server"><input type="checkbox" id="sv-sw"><span class="slider"></span></label>
      <button class="btn-real btn-danger" id="sv-off">⏻ Turn Server OFF</button>
      <button class="btn-real btn-gold" id="sv-on" style="display:none">⏻ Re-enable Server (Turn ON)</button>
    </div>
    <h3>Broadcast Message</h3>
    <div class="field">
      <textarea class="input" id="sv-bc" maxlength="500" rows="3"></textarea>
      <div class="char-count"><span id="sv-count">0</span>/500</div>
    </div>
    <div class="btn-row">
      <button class="btn-real btn-gold" id="sv-save">Save</button>
      <button class="btn-real btn-ivory" id="sv-clear">Clear</button>
    </div>
    <h3 style="margin-top:18px">📢 Currently showing</h3>
    <div class="banner-preview" id="sv-preview"></div>
  </div>
  <div class="premium-card" style="max-width:640px"><div class="gold-bar"></div>
    <h2>What happens when the server is OFF</h2>
    <div class="explainer">
      <b>Blocked:</b> key verification for app users — nobody can sign in with a key while the server is OFF. They see "Server in maintenance" plus your broadcast message.<br><br>
      <b>Still open:</b> this panel. Master and reseller logins keep working, and resellers can still generate keys. Only app-side key logins are paused.
    </div>
  </div>`;
  document.getElementById("sv-bc").addEventListener("input", (e) => {
    document.getElementById("sv-count").textContent = e.target.value.length;
  });
  document.getElementById("sv-save").onclick = () => saveServer();
  document.getElementById("sv-clear").onclick = () => {
    document.getElementById("sv-bc").value = "";
    document.getElementById("sv-count").textContent = "0";
    saveServer();
  };
  document.getElementById("sv-off").onclick = () => {
    confirmDlg("Turn server OFF", "App users will not be able to sign in with a key until you re-enable the server. Panel logins stay open.", "Turn OFF",
      async () => {
        const { data } = await api("/api/server", { method: "PUT", body: { enabled: false, broadcast: document.getElementById("sv-bc").value } });
        if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
        toast("Server turned OFF.", "ok"); loadServer();
      }, true);
  };
  document.getElementById("sv-on").onclick = async () => {
    const { data } = await api("/api/server", { method: "PUT", body: { enabled: true, broadcast: document.getElementById("sv-bc").value } });
    if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
    toast("Server re-enabled.", "ok"); loadServer();
  };
  loadServer();
}
async function saveServer() {
  const card = document.getElementById("sv-card");
  const enabled = card ? card.dataset.enabled === "1" : true;
  const { data } = await api("/api/server", {
    method: "PUT",
    body: { enabled, broadcast: document.getElementById("sv-bc").value },
  });
  if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
  toast("Server settings saved.", "ok"); loadServer();
}
async function loadServer() {
  const { data } = await api("/api/server");
  if (!data.ok) return;
  const on = !!data.server.enabled;
  const card = document.getElementById("sv-card");
  if (card) {
    card.dataset.enabled = on ? "1" : "0";
    card.className = "server-status " + (on ? "on" : "off");
    card.innerHTML = `<span class="dot"></span><span class="t">⏻ Server is ${on ? "ON" : "OFF"}</span>`;
  }
  const offB = document.getElementById("sv-off");
  const onB = document.getElementById("sv-on");
  if (offB) offB.style.display = on ? "" : "none";
  if (onB) onB.style.display = on ? "none" : "";
  const sw = document.getElementById("sv-sw");
  if (sw) {
    sw.checked = on;
    sw.onchange = () => {
      if (!sw.checked) { sw.checked = true; const b = document.getElementById("sv-off"); if (b) b.click(); }
      else { const b = document.getElementById("sv-on"); if (b) b.click(); }
    };
  }
  const bc = document.getElementById("sv-bc");
  if (bc && document.activeElement !== bc) bc.value = data.server.broadcast || "";
  const cc = document.getElementById("sv-count");
  if (cc && bc) cc.textContent = bc.value.length;
  const pv = document.getElementById("sv-preview");
  if (pv) pv.textContent = data.server.enabled
    ? (data.server.broadcast ? "Broadcast: " + data.server.broadcast : "Server is ON. App users can verify keys.")
    : "Server in maintenance." + (data.server.broadcast ? " " + data.server.broadcast : "");
}

/* ---------- settings ---------- */
let editingProfile = false;
function pageSettings(el) {
  const isMaster = S.me.role === "master";
  el.innerHTML = `
  <div class="page-head"><div><h1>Settings</h1><p>Account and panel preferences</p></div></div>
  <div class="grid-2" style="max-width:900px">
    <div class="premium-card"><div class="gold-bar"></div>
      <div class="card-head"><h2 style="margin:0">Account Info</h2>
        ${isMaster && !editingProfile ? `<button class="icon-btn" onclick="editingProfile=true;renderProfileBox()" aria-label="Edit account info">✏️ Edit</button>` : ""}
      </div>
      <div class="detail-list" id="set-profile" style="margin-top:10px"></div>
    </div>
    <div class="premium-card"><div class="gold-bar"></div>
      <h2>Change Password</h2>
      <div class="field"><label>Current password</label><input class="input" id="pw-cur" type="password"></div>
      <div class="field"><label>New password</label><input class="input" id="pw-new" type="password"></div>
      <div class="field"><label>Confirm new password</label><input class="input" id="pw-new2" type="password"></div>
      <button class="btn-real btn-gold" id="pw-go">Update Password</button>
    </div>
    ${isMaster ? `
    <div class="premium-card"><div class="gold-bar"></div>
      <h2>Panel Logo</h2>
      <p class="card-sub">Your photo at the top of the side menu.</p>
      <div id="logo-box" style="margin-bottom:12px"><div class="skel" style="height:96px;width:96px;border-radius:50%"></div></div>
      <div class="field"><label>Upload logo (JPG or PNG, max 512px)</label><input class="input" id="logo-file" type="file" accept="image/png,image/jpeg"></div>
      <div class="btn-row">
        <button class="btn-real btn-gold btn-sm" id="logo-up">Save</button>
        <button class="btn-real btn-danger btn-sm" id="logo-rm">Remove</button>
      </div>
    </div>` : ""}
  </div>`;
  document.getElementById("pw-go").onclick = async () => {
    const cur = document.getElementById("pw-cur").value;
    const nw = document.getElementById("pw-new").value;
    const nw2 = document.getElementById("pw-new2").value;
    if (nw !== nw2) { toast("New passwords do not match.", "err"); return; }
    const { data } = await api("/api/settings/password", { method: "POST", body: { currentPassword: cur, newPassword: nw } });
    if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
    document.getElementById("pw-cur").value = ""; document.getElementById("pw-new").value = ""; document.getElementById("pw-new2").value = "";
    toast("Password updated.", "ok");
  };
  renderProfileBox();
  if (isMaster) {
    loadLogoBox();
    document.getElementById("logo-up").onclick = async () => {
      const f = document.getElementById("logo-file").files[0];
      if (!f) { toast("Choose an image first.", "err"); return; }
      if (!/^image\/(png|jpeg)$/.test(f.type)) { toast("Please choose a JPG or PNG image.", "err"); return; }
      let dataUrl;
      try { dataUrl = await downsizeImage(f); }
      catch (e) { toast("Could not read the image.", "err"); return; }
      const { data } = await api("/api/settings/logo", { method: "POST", body: { dataUrl } });
      if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
      S.me.logo = true; toast("Logo updated.", "ok"); loadLogoBox(); renderShell();
    };
    document.getElementById("logo-rm").onclick = () => {
      confirmDlg("Remove logo", "Remove the panel logo?", "Remove", async () => {
        const { data } = await api("/api/settings/logo", { method: "DELETE" });
        if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
        S.me.logo = null; toast("Logo removed.", "ok"); loadLogoBox(); renderShell();
      }, true);
    };
  }
}
function downsizeImage(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const max = 512;
        let w = img.width, h = img.height;
        const sc = Math.min(1, max / Math.max(w, h));
        w = Math.max(1, Math.round(w * sc)); h = Math.max(1, Math.round(h * sc));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        res(c.toDataURL(file.type === "image/jpeg" ? "image/jpeg" : "image/png", 0.9));
      } catch (e) { URL.revokeObjectURL(url); rej(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("load")); };
    img.src = url;
  });
}
function renderProfileBox() {
  const box = document.getElementById("set-profile");
  if (!box) return;
  if (!editingProfile) {
    box.innerHTML = `
      <div class="dl-row"><span class="k">Username</span><span><b>${esc(S.me.username)}</b></span></div>
      <div class="dl-row"><span class="k">Role</span><span><b>${esc(S.me.role === "master" ? S.me.displayName : "Reseller")}</b></span></div>
      <div class="dl-row"><span class="k">Account Status</span><span class="status-green">Active</span></div>`;
  } else {
    box.innerHTML = `
      <div class="field"><label>Username</label><input class="input" id="pf-user" value="${esc(S.me.username)}"></div>
      <div class="field"><label>Role</label><input class="input" id="pf-role" value="${esc(S.me.displayName)}"></div>
      <div class="btn-row">
        <button class="btn-real btn-ivory btn-sm" onclick="editingProfile=false;pageSettings(document.getElementById('page'))">Cancel</button>
        <button class="btn-real btn-gold btn-sm" id="pf-save">Save</button>
      </div>`;
    document.getElementById("pf-save").onclick = async () => {
      const { data } = await api("/api/settings/profile", {
        method: "PUT",
        body: { username: document.getElementById("pf-user").value, role: document.getElementById("pf-role").value },
      });
      if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
      editingProfile = false;
      await boot(true);
      toast("Profile updated.", "ok");
    };
  }
}
async function loadLogoBox() {
  const box = document.getElementById("logo-box");
  if (!box) return;
  const r = await fetch("/logo");
  if (r.ok) {
    box.innerHTML = '<img class="logo-preview" src="/logo" alt="Panel logo">';
    const up = document.getElementById("logo-up");
    if (up) up.textContent = "Change";
  } else {
    box.innerHTML = '<div class="logo-empty">No logo set</div>';
    const up = document.getElementById("logo-up");
    if (up) up.textContent = "Save";
  }
}

/* ---------- boot & render ---------- */
function render() {
  if (!S.token || !S.me) renderLogin();
  else renderShell();
}
async function boot(keepPage) {
  try {
    const [meR, durR] = await Promise.all([api("/api/me"), api("/api/durations")]);
    if (!meR.data.ok) throw new Error("me");
    S.me = meR.data;
    if (durR.data.ok) S.durations = durR.data.durations;
    if (!keepPage) S.page = "dashboard";
    render();
  } catch (e) {
    S.token = ""; localStorage.removeItem("lkp_token"); S.me = null;
    render();
  }
}
window.addEventListener("DOMContentLoaded", () => {
  if (S.token) boot();
  else render();
});
