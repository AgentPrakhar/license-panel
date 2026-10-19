/* License Key Panel - SPA */
const S = {
  token: localStorage.getItem("lkp_token") || "",
  me: null,
  page: "dashboard",
  meta: null,
  prices: {},
  keys: { items: [], total: 0, page: 1, perPage: 20, search: "", status: "all", sort: "newest", selected: new Set() },
  activity: { items: [], total: 0, page: 1, type: "all", search: "" },
  gen: { mode: "auto", duration: "30day", count: 1, maxDevices: 1, note: "", customKey: "", result: null },
  sales: { from: "", to: "", rows: [], totals: null, top: null },
  loginMode: "master",
};

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
function countdown(ts) {
  if (ts == null) return '<span class="pill pill-unused">Not activated yet</span>';
  const diff = ts - Date.now();
  if (diff <= 0) return '<span class="pill pill-expired">Expired</span>';
  const d = Math.floor(diff / 86400000), h = Math.floor(diff % 86400000 / 3600000), m = Math.floor(diff % 3600000 / 60000);
  const hot = diff < 24 * 3600000 ? " hot" : "";
  return `<span class="countdown${hot}">${d}d ${h}h ${m}m</span>`;
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

/* ---------- modal ---------- */
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
  openModal(`<h2>${esc(title)}</h2><p style="color:var(--muted);font-size:14px;margin-bottom:6px">${body}</p>
    <div class="btn-row">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn ${danger ? "btn-danger" : "btn-gold"}" id="cf-ok">${esc(okLabel || "Confirm")}</button>
    </div>`);
  document.getElementById("cf-ok").onclick = () => { closeModal(); onOk(); };
}

/* ---------- navigation ---------- */
const NAV_MASTER = [
  ["dashboard", "Dashboard", "▦"], ["keys", "Keys", "🔑"], ["generate", "Generate", "＋"],
  ["activity", "Activity", "◷"], ["resellers", "Manage Reseller", "👥"],
  ["prices", "Manage Price", "₹"], ["referrals", "Create Referral", "🎟"],
  ["sales", "Sales Report", "📊"], ["server", "Server Control", "🖥"], ["settings", "Settings", "⚙"],
];
const NAV_RESELLER = [
  ["dashboard", "Dashboard", "▦"], ["keys", "Keys", "🔑"], ["generate", "Generate", "＋"],
  ["activity", "Activity", "◷"], ["settings", "Settings", "⚙"],
];
function navItems() { return S.me && S.me.role === "master" ? NAV_MASTER : NAV_RESELLER; }
function go(page) {
  S.page = page;
  S.keys.selected = new Set();
  document.querySelector(".drawer") && document.querySelector(".drawer").classList.remove("show");
  render();
  window.scrollTo(0, 0);
}
function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/);
  return ((parts[0] || "?")[0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}

/* ---------- login ---------- */
function renderLogin() {
  const app = document.getElementById("app");
  app.innerHTML = `
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-logo" id="login-logo"></div>
      <div class="login-title">License Key Panel</div>
      <div class="login-sub">Sign in to manage your license keys</div>
      <div class="mode-toggle">
        <button class="${S.loginMode === "master" ? "on" : ""}" onclick="setLoginMode('master')">Master</button>
        <button class="${S.loginMode === "reseller" ? "on" : ""}" onclick="setLoginMode('reseller')">Reseller</button>
      </div>
      <div class="login-error" id="login-error"></div>
      <div class="field"><label>Username</label><input class="input" id="li-user" autocomplete="username"></div>
      <div class="field"><label>Password</label><input class="input" id="li-pass" type="password" autocomplete="current-password"></div>
      <button class="btn btn-gold btn-block" id="li-go">Sign In</button>
    </div>
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
  S.token = ""; localStorage.removeItem("lkp_token"); S.me = null; S.page = "dashboard";
  render();
}

/* ---------- shell ---------- */
function renderShell() {
  const app = document.getElementById("app");
  const items = navItems();
  const navHtml = items.map(([id, label, ic]) =>
    `<button class="${S.page === id ? "on" : ""}" onclick="go('${id}')"><span class="ic">${ic}</span>${esc(label)}</button>`).join("");
  const balLine = S.me.role === "reseller"
    ? `<div class="bal">Balance: ₹${esc(S.me.balance)}</div>` : "";
  const logoHtml = S.me.logo ? '<img src="/logo" alt="logo">' : "";
  app.innerHTML = `
  <div class="topbar">
    <div class="name">License Key Panel</div>
    <button class="btn btn-sm btn-gold" onclick="document.querySelector('.drawer').classList.add('show')">Menu</button>
  </div>
  <div class="drawer">
    <div class="modal-back" onclick="document.querySelector('.drawer').classList.remove('show')"></div>
    <div class="side">
      <div class="side-brand">${logoHtml}<div class="name">License Key Panel</div><div class="tag">Premium Owner</div></div>
      <div class="side-user"><div class="who">${esc(S.me.displayName)}</div><div>@${esc(S.me.username)}</div>${balLine}</div>
      <div class="side-nav">${navHtml}</div>
      <div class="side-foot"><button class="btn btn-ghost btn-block" onclick="doLogout()">Logout</button></div>
    </div>
  </div>
  <div class="shell">
    <aside class="sidebar">
      <div class="side-brand">${logoHtml}<div class="name">License Key Panel</div><div class="tag">Premium Owner</div></div>
      <div class="side-user"><div class="who">${esc(S.me.displayName)}</div><div>@${esc(S.me.username)}</div>${balLine}</div>
      <div class="side-nav">${navHtml}</div>
      <div class="side-foot"><button class="btn btn-ghost btn-block" onclick="doLogout()">Logout</button></div>
    </aside>
    <main class="main" id="page"></main>
  </div>`;
  renderPage();
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
  el.innerHTML = `<div class="page-head"><h1>Dashboard</h1><p>Overview of your license keys</p></div><div class="empty">Loading…</div>`;
  const { data } = await api("/api/dashboard");
  if (!data.ok) { el.innerHTML = `<div class="empty">${esc(data.error || "Failed to load.")}</div>`; return; }
  const cards = [
    ["totalKeys", "Total Keys", "all"], ["usedKeys", "Used", "used"], ["unusedKeys", "Unused", "unused"],
  ];
  if (S.me.role === "master") cards.push(["totalResellers", "Total Resellers", null]);
  else cards.push(["expiringSoon", "Expiring Soon", "expiring"]);
  if (S.me.role === "master") cards.push(["expiringSoon", "Expiring Soon", "expiring"]);
  el.innerHTML = `
  <div class="page-head"><h1>Dashboard</h1><p>Overview of your license keys</p></div>
  <div class="cards">
    ${cards.map(([k, lbl, f]) => f
      ? `<button class="stat-card" onclick="jumpToKeys('${f}')"><div class="num">${esc(data[k])}</div><div class="lbl">${lbl}</div></button>`
      : `<div class="stat-card"><div class="num">${esc(data[k])}</div><div class="lbl">${lbl}</div></div>`).join("")}
  </div>
  <div class="grid-2">
    <div class="card"><h2>Subscription Status</h2><div id="dash-sub"><div class="empty">Loading…</div></div></div>
    <div class="card"><h2>Recent Activity</h2><div id="dash-act"><div class="empty">Loading…</div></div></div>
  </div>`;
  loadDashSub(); loadDashAct();
}
function jumpToKeys(filter) {
  S.keys.status = filter; S.keys.page = 1; S.keys.search = "";
  go("keys");
}
async function loadDashSub() {
  const { data } = await api("/api/keys?status=expiring&perPage=5");
  const box = document.getElementById("dash-sub");
  if (!box) return;
  if (!data.ok || !data.keys.length) {
    box.innerHTML = `<p style="color:var(--muted);font-size:14px">No keys expiring in the next 3 days.</p>`;
    return;
  }
  box.innerHTML = `<div class="detail-list">` + data.keys.map((k) =>
    `<div class="dl-row"><span class="mono">${esc(k.code)}</span><span>${countdown(k.expiresAt)}</span></div>`).join("") + `</div>
    <div style="margin-top:12px"><button class="link" onclick="jumpToKeys('expiring')">View all expiring keys →</button></div>`;
}
async function loadDashAct() {
  const { data } = await api("/api/activity?page=1");
  const box = document.getElementById("dash-act");
  if (!box) return;
  if (!data.ok || !data.activity.length) { box.innerHTML = `<p style="color:var(--muted);font-size:14px">No activity yet.</p>`; return; }
  const labels = { activation: "Activation", rejected: "Rejected", generated: "Generated", deleted: "Deleted", refunded: "Refunded", renewed: "Renewed", login: "Login" };
  box.innerHTML = `<div class="detail-list">` + data.activity.slice(0, 6).map((a) =>
    `<div class="dl-row"><span><b>${esc(labels[a.type] || a.type)}</b> ${a.keyCode ? `<span class="mono">${esc(a.keyCode.slice(0, 14))}…</span>` : ""}<br>
    <span style="color:var(--muted);font-size:12px">${esc(a.detail || "")}</span></span>
    <span style="color:var(--muted);font-size:12px;white-space:nowrap">${fmtDate(a.ts)}</span></div>`).join("") + `</div>
    <div style="margin-top:12px"><button class="link" onclick="go('activity')">View all activity →</button></div>`;
}

/* ---------- keys ---------- */
const KEY_STATUSES = [["all", "All"], ["active", "Active"], ["used", "Used"], ["unused", "Unused"], ["expired", "Expired"], ["revoked", "Revoked"], ["banned", "Banned"], ["expiring", "Expiring soon"]];
async function pageKeys(el) {
  el.innerHTML = `
  <div class="page-head"><h1>Keys</h1><p>Search, filter and manage license keys</p></div>
  <div class="toolbar">
    <input class="input grow" id="k-search" value="${esc(S.keys.search)}">
    <select class="input" id="k-sort">
      <option value="newest"${S.keys.sort === "newest" ? " selected" : ""}>Sort: Newest first</option>
      <option value="expiry"${S.keys.sort === "expiry" ? " selected" : ""}>Sort: Nearest expiry</option>
    </select>
  </div>
  <div class="chips" id="k-chips">
    ${KEY_STATUSES.map(([v, l]) => `<button class="chip${S.keys.status === v ? " on" : ""}" data-s="${v}">${l}</button>`).join("")}
  </div>
  <div class="toolbar" id="k-bulkbar" style="display:none">
    <span id="k-selcount" style="font-weight:700;font-size:13.5px"></span>
    <button class="btn btn-sm btn-ghost" onclick="bulkAction('revoke')">Revoke</button>
    <button class="btn btn-sm btn-ghost" onclick="bulkAction('ban')">Ban</button>
    <button class="btn btn-sm btn-ghost" onclick="bulkAction('reactivate')">Reactivate</button>
    <button class="btn btn-sm btn-danger" onclick="bulkAction('delete')">Delete</button>
    <button class="link" onclick="clearSel()">Clear</button>
  </div>
  <div class="card" style="padding:10px 14px"><div class="table-wrap"><table class="tbl">
    <thead><tr>
      <th><input type="checkbox" class="checkbox" id="k-all" onclick="toggleAllSel(this.checked)"></th>
      <th>Key</th><th>Duration</th><th>Status</th><th>Devices</th><th>Expiry</th><th>Note</th><th>Actions</th>
    </tr></thead>
    <tbody id="k-rows"><tr><td colspan="8"><div class="empty">Loading…</div></td></tr></tbody>
  </table></div></div>
  <div class="pagination" id="k-pager"></div>`;
  const si = document.getElementById("k-search");
  si.addEventListener("keydown", (e) => { if (e.key === "Enter") { S.keys.search = si.value; S.keys.page = 1; loadKeys(); } });
  si.addEventListener("change", () => { S.keys.search = si.value; S.keys.page = 1; loadKeys(); });
  document.getElementById("k-sort").addEventListener("change", (e) => { S.keys.sort = e.target.value; S.keys.page = 1; loadKeys(); });
  document.querySelectorAll("#k-chips .chip").forEach((c) =>
    c.addEventListener("click", () => {
      S.keys.status = c.dataset.s; S.keys.page = 1; S.keys.selected = new Set();
      document.querySelectorAll("#k-chips .chip").forEach((x) => x.classList.remove("on"));
      c.classList.add("on"); loadKeys();
    }));
  loadKeys();
}
async function loadKeys() {
  const q = new URLSearchParams({ search: S.keys.search, status: S.keys.status, sort: S.keys.sort, page: S.keys.page, perPage: S.keys.perPage });
  const { data } = await api("/api/keys?" + q.toString());
  const tb = document.getElementById("k-rows");
  if (!tb) return;
  if (!data.ok) { tb.innerHTML = `<tr><td colspan="8"><div class="empty">${esc(data.error || "Failed.")}</div></td></tr>`; return; }
  S.keys.items = data.keys; S.keys.total = data.total;
  if (!data.keys.length) {
    tb.innerHTML = `<tr><td colspan="8"><div class="empty">No keys found.</div></td></tr>`;
  } else {
    tb.innerHTML = data.keys.map((k) => `
    <tr>
      <td><input type="checkbox" class="checkbox" ${S.keys.selected.has(k.id) ? "checked" : ""} onchange="selKey('${k.id}', this.checked)"></td>
      <td><span class="mono">${esc(k.code)}</span><br><button class="link" onclick="copyKeyById('${k.id}')">Copy</button></td>
      <td>${esc(durLabel(k.duration))}</td>
      <td>${keyStatusPill(k)}</td>
      <td>${k.devices.length}/${k.maxDevices}</td>
      <td>${countdown(k.expiresAt)}</td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(k.note || "")}">${esc(k.note || "-")}</td>
      <td><div class="kbd-actions">
        <button class="icon-btn" onclick="viewDevices('${k.id}')">Devices</button>
        <button class="icon-btn" onclick="editKey('${k.id}')">Edit</button>
        <button class="icon-btn" onclick="renewKey('${k.id}')">Renew</button>
        ${k.status === "active" ? `<button class="icon-btn" onclick="setKeyStatus('${k.id}','revoked')">Revoke</button>` : `<button class="icon-btn" onclick="setKeyStatus('${k.id}','active')">Activate</button>`}
        <button class="icon-btn" onclick="setKeyStatus('${k.id}','banned')">Ban</button>
        <button class="icon-btn danger" onclick="delKey('${k.id}')">Delete</button>
      </div></td>
    </tr>`).join("");
  }
  updateBulkbar();
  const pages = Math.max(1, Math.ceil(data.total / data.perPage));
  document.getElementById("k-pager").innerHTML = `
    <button class="btn btn-sm btn-ghost" ${S.keys.page <= 1 ? "disabled" : ""} onclick="keysPage(-1)">← Prev</button>
    <span>Page ${S.keys.page} of ${pages} (${data.total} keys)</span>
    <button class="btn btn-sm btn-ghost" ${S.keys.page >= pages ? "disabled" : ""} onclick="keysPage(1)">Next →</button>`;
}
function keysPage(d) { S.keys.page += d; loadKeys(); }
function selKey(id, on) { on ? S.keys.selected.add(id) : S.keys.selected.delete(id); updateBulkbar(); }
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
  document.getElementById("k-selcount").textContent = n + " selected";
}
function bulkAction(action) {
  const ids = [...S.keys.selected];
  if (!ids.length) return;
  const labels = { revoke: "revoke", ban: "ban", reactivate: "reactivate", delete: "delete" };
  const danger = action === "delete" || action === "ban";
  confirmDlg("Confirm", `Are you sure you want to ${labels[action]} ${ids.length} key(s)?`, "Confirm",
    async () => {
      const { data } = await api("/api/keys/bulk", { method: "POST", body: { ids, action } });
      if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
      toast(danger || action === "revoke" ? "Done." : "Done.", "ok");
      if (data.refundedTotal) toast(`Refunded ₹${data.refundedTotal}.`, "ok");
      S.keys.selected = new Set(); loadKeys();
    }, danger);
}
async function setKeyStatus(id, status) {
  const names = 
