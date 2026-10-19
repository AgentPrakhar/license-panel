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
  const names = { active: "activate", revoked: "revoke", banned: "ban" };
  const danger = status !== "active";
  confirmDlg("Confirm", `Are you sure you want to ${names[status]} this key?`, "Confirm",
    async () => {
      const { data } = await api(`/api/keys/${id}/status`, { method: "POST", body: { status } });
      if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
      toast("Key updated.", "ok"); loadKeys();
    }, danger);
}
function delKey(id) {
  confirmDlg("Delete key", "Are you sure you want to delete this key? An unused key bought by a reseller will be refunded.", "Delete",
    async () => {
      const { data } = await api(`/api/keys/${id}`, { method: "DELETE" });
      if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
      toast(data.refunded ? `Deleted. Refunded ₹${data.refunded}.` : "Deleted.", "ok");
      loadKeys();
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
  openModal(`<h2>Edit Key</h2>
    <div class="field"><label>Customer note</label><input class="input" id="ek-note" value="${esc(k.note || "")}"></div>
    <div class="field"><label>Device limit</label><input class="input" id="ek-md" type="number" min="1" max="9999" value="${k.maxDevices}"></div>
    <div class="btn-row">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-gold" id="ek-save">Save</button>
    </div>`);
  document.getElementById("ek-save").onclick = async () => {
    const { data } = await api(`/api/keys/${id}`, { method: "PATCH", body: { note: document.getElementById("ek-note").value, maxDevices: document.getElementById("ek-md").value } });
    if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
    closeModal(); toast("Key updated.", "ok"); loadKeys();
  };
}
async function viewDevices(id) {
  const { data } = await api(`/api/keys/${id}/devices`);
  if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
  DEV_CACHE[id] = data.devices;
  const rows = data.devices.length ? data.devices.map((d, i) => `
    <div class="dl-row">
      <span><span class="mono">${esc(d.id)}</span> <button class="link" onclick="copyDeviceId('${id}',${i})">Copy</button>${d.name ? `<br><span style="color:var(--muted);font-size:12px">${esc(d.name)}</span>` : ""}
      <br><span style="color:var(--muted);font-size:12px">First seen ${fmtDate(d.firstSeen)} · Last seen ${fmtDate(d.lastSeen)}</span></span>
      <span>${d.blocked ? '<span class="pill pill-banned">Blocked</span>' : '<span class="pill pill-active">Active</span>'}
      <div class="kbd-actions" style="margin-top:6px">
        ${d.blocked ? `<button class="icon-btn" onclick="unblockDeviceIdx('${id}',${i})">Unblock</button>` : `<button class="icon-btn" onclick="blockDeviceIdx('${id}',${i})">Block</button>`}
        <button class="icon-btn danger" onclick="removeDeviceIdx('${id}',${i})">Remove</button>
      </div></span>
    </div>`).join("") : `<div class="empty">No devices bound yet.</div>`;
  openModal(`<h2>Devices (${data.devices.length}/${data.maxDevices})</h2><div class="detail-list">${rows}</div>
    <div class="btn-row"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>`);
}
async function blockDeviceIdx(keyId, i) {
  const d = DEV_CACHE[keyId] && DEV_CACHE[keyId][i];
  if (!d) return;
  const { data } = await api(`/api/keys/${keyId}/devices/${encodeURIComponent(d.id)}/block`, { method: "POST" });
  if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
  toast("Device blocked.", "ok"); viewDevices(keyId);
}
async function unblockDeviceIdx(keyId, i) {
  const d = DEV_CACHE[keyId] && DEV_CACHE[keyId][i];
  if (!d) return;
  const { data } = await api(`/api/keys/${keyId}/devices/${encodeURIComponent(d.id)}/unblock`, { method: "POST" });
  if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
  toast("Device unblocked.", "ok"); viewDevices(keyId);
}
function removeDeviceIdx(keyId, i) {
  const d = DEV_CACHE[keyId] && DEV_CACHE[keyId][i];
  if (!d) return;
  confirmDlg("Remove device", "Remove this device? This frees one device slot.", "Remove",
    async () => {
      const { data } = await api(`/api/keys/${keyId}/devices/${encodeURIComponent(d.id)}`, { method: "DELETE" });
      if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
      toast("Device removed.", "ok"); viewDevices(keyId);
    }, true);
}
function durLabel(d) { return (S.meta && S.meta.durations[d] && S.meta.durations[d].label) || d; }
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

/* ---------- generate ---------- */
function pageGenerate(el) {
  const g = S.gen;
  g.result = null;
  el.innerHTML = `
  <div class="page-head"><h1>Generate Keys</h1><p>Create new license keys</p></div>
  <div class="card" style="max-width:720px">
    <div class="seg">
      <button class="${g.mode === "auto" ? "on" : ""}" onclick="genMode('auto')">Auto Key</button>
      <button class="${g.mode === "custom" ? "on" : ""}" onclick="genMode('custom')">Custom Key</button>
    </div>
    <h3>Duration</h3>
    <div class="dur-grid" id="g-durs">
      ${(S.meta ? S.meta.order : []).map((d) => `
        <button class="dur-chip${g.duration === d ? " on" : ""}" data-d="${d}">
          <div class="dl">${esc(durLabel(d))}</div><div class="dp">₹${esc(S.prices[d] != null ? S.prices[d] : "-")}</div>
        </button>`).join("")}
    </div>
    <div id="g-customwrap" style="display:${g.mode === "custom" ? "block" : "none"}">
      <div class="field"><label>Custom key</label><input class="input" id="g-custom"></div>
    </div>
    <div class="grid-2">
      <div class="field" id="g-countwrap" style="display:${g.mode === "custom" ? "none" : "block"}">
        <label>Count (1-50)</label><input class="input" id="g-count" type="number" min="1" max="50" value="${g.count}">
      </div>
      <div class="field"><label>Device limit</label><input class="input" id="g-md" type="number" min="1" max="9999" value="${g.maxDevices}"></div>
    </div>
    <div class="field"><label>Customer note</label><input class="input" id="g-note"></div>
    <div class="cost-line" id="g-cost"></div>
    <div class="preview-box" id="g-preview"></div>
    <div style="margin-top:16px"><button class="btn btn-gold btn-block" id="g-go">Generate</button></div>
    <div class="result-keys" id="g-result"></div>
  </div>`;
  document.querySelectorAll("#g-durs .dur-chip").forEach((c) =>
    c.addEventListener("click", () => { g.duration = c.dataset.d; pageGenerate(el); }));
  const upd = () => updateGenPreview(el);
  document.getElementById("g-count").addEventListener("input", upd);
  document.getElementById("g-md").addEventListener("input", upd);
  document.getElementById("g-go").onclick = () => doGenerate(el);
  updateGenPreview(el);
}
function genMode(m) { S.gen.mode = m; const el = document.getElementById("page"); pageGenerate(el); }
function genInputs() {
  const g = S.gen;
  const count = g.mode === "custom" ? 1 : (parseInt((document.getElementById("g-count") || {}).value, 10) || 1);
  const md = parseInt((document.getElementById("g-md") || {}).value, 10) || 1;
  const note = (document.getElementById("g-note") || {}).value || "";
  const customKey = (document.getElementById("g-custom") || {}).value || "";
  return { count, md, note, customKey };
}
function updateGenPreview(el) {
  const g = S.gen;
  const { count, md } = genInputs();
  const price = Number(S.prices[g.duration]) || 0;
  const per = price * md;
  const total = per * count;
  const costEl = document.getElementById("g-cost");
  if (costEl) {
    costEl.innerHTML = S.me.role === "reseller"
      ? `Total cost: <b>₹${total}</b> &nbsp;·&nbsp; Balance after: <b>₹${(S.me.balance || 0) - total}</b>`
      : `Master generation is free. &nbsp;·&nbsp; Reseller price would be <b>₹${total}</b>.`;
  }
  const pv = document.getElementById("g-preview");
  if (pv) pv.innerHTML = `<div style="font-size:12.5px;color:var(--muted);font-weight:700;margin-bottom:6px">PREVIEW</div>
    <div class="mono">${g.mode === "custom" ? esc(genInputs().customKey || "(enter a key)") : esc(count) + " × " + esc(durLabel(g.duration)) + " key(s)"}</div>
    <div style="font-size:13px;color:var(--muted);margin-top:4px">${esc(durLabel(g.duration))} · ${md} device(s)${g.mode === "auto" ? " · " + count + " key(s)" : ""}</div>`;
}
async function doGenerate(el) {
  const g = S.gen;
  const { count, md, note, customKey } = genInputs();
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
      data.keys.map((k, i) => `<div class="row"><span class="mono grow">${esc(k.code)}</span><button class="icon-btn" onclick="copyGenKey(${i})">Copy</button></div>`).join("");
  }
  toast("Keys generated.", "ok");
}

/* ---------- activity ---------- */
const ACT_TYPES = [["all", "All"], ["activation", "Activations"], ["rejected", "Rejected"], ["generated", "Generated"], ["deleted", "Deleted"], ["refunded", "Refunded"], ["renewed", "Renewed"], ["login", "Login"]];
function pageActivity(el) {
  const a = S.activity;
  el.innerHTML = `
  <div class="page-head"><h1>Activity</h1><p>Live feed of panel events</p></div>
  <div class="toolbar"><input class="input grow" id="a-search" value="${esc(a.search)}"></div>
  <div class="chips" id="a-chips">
    ${ACT_TYPES.map(([v, l]) => `<button class="chip${a.type === v ? " on" : ""}" data-s="${v}">${l}</button>`).join("")}
  </div>
  <div class="card" style="padding:10px 14px"><div class="table-wrap"><table class="tbl">
    <thead><tr><th>Time</th><th>Type</th><th>Key</th>${S.me.role === "master" ? "<th>Reseller</th>" : ""}<th>Detail</th></tr></thead>
    <tbody id="a-rows"><tr><td colspan="6"><div class="empty">Loading…</div></td></tr></tbody>
  </table></div></div>
  <div class="pagination" id="a-pager"></div>`;
  const si = document.getElementById("a-search");
  si.addEventListener("keydown", (e) => { if (e.key === "Enter") { a.search = si.value; a.page = 1; loadActivity(); } });
  si.addEventListener("change", () => { a.search = si.value; a.page = 1; loadActivity(); });
  document.querySelectorAll("#a-chips .chip").forEach((c) =>
    c.addEventListener("click", () => {
      a.type = c.dataset.s; a.page = 1;
      document.querySelectorAll("#a-chips .chip").forEach((x) => x.classList.remove("on"));
      c.classList.add("on"); loadActivity();
    }));
  loadActivity();
}
async function loadActivity() {
  const a = S.activity;
  const q = new URLSearchParams({ type: a.type, search: a.search, page: a.page });
  const { data } = await api("/api/activity?" + q.toString());
  const tb = document.getElementById("a-rows");
  if (!tb) return;
  const labels = { activation: "Activation", rejected: "Rejected", generated: "Generated", deleted: "Deleted", refunded: "Refunded", renewed: "Renewed", login: "Login" };
  const cols = S.me.role === "master" ? 6 : 5;
  if (!data.ok) { tb.innerHTML = `<tr><td colspan="${cols}"><div class="empty">${esc(data.error || "Failed.")}</div></td></tr>`; return; }
  a.items = data.activity; a.total = data.total;
  if (!data.activity.length) {
    tb.innerHTML = `<tr><td colspan="${cols}"><div class="empty">No activity found.</div></td></tr>`;
  } else {
    tb.innerHTML = data.activity.map((x) => `
    <tr>
      <td style="white-space:nowrap">${fmtDate(x.ts)}</td>
      <td><span class="pill ${x.type === "rejected" ? "pill-banned" : x.type === "activation" ? "pill-active" : "pill-gold"}">${esc(labels[x.type] || x.type)}</span></td>
      <td>${x.keyCode ? `<span class="mono">${esc(x.keyCode)}</span>` : "-"}</td>
      ${S.me.role === "master" ? `<td>${esc(x.resellerName || "-")}</td>` : ""}
      <td>${esc(x.detail || "")}${x.deviceId ? `<br><span class="mono" style="font-size:11.5px;color:var(--muted)">${esc(x.deviceId)}</span>` : ""}${x.amount != null ? ` <b>₹${esc(x.amount)}</b>` : ""}</td>
    </tr>`).join("");
  }
  const pages = Math.max(1, Math.ceil(data.total / data.perPage));
  document.getElementById("a-pager").innerHTML = `
    <button class="btn btn-sm btn-ghost" ${a.page <= 1 ? "disabled" : ""} onclick="actPage(-1)">← Prev</button>
    <span>Page ${a.page} of ${pages} (${data.total})</span>
    <button class="btn btn-sm btn-ghost" ${a.page >= pages ? "disabled" : ""} onclick="actPage(1)">Next →</button>`;
}
function actPage(d) { S.activity.page += d; loadActivity(); }

/* ---------- resellers (master) ---------- */
function pageResellers(el) {
  el.innerHTML = `
  <div class="page-head"><h1>Manage Reseller</h1><p>Create and manage reseller accounts</p></div>
  <div class="card" style="max-width:720px">
    <h2>Create Reseller</h2>
    <div class="grid-2">
      <div class="field"><label>Name</label><input class="input" id="r-name"></div>
      <div class="field"><label>Username</label><input class="input" id="r-username"></div>
      <div class="field"><label>Password</label><input class="input" id="r-pass" type="password"></div>
      <div class="field"><label>Contact</label><input class="input" id="r-contact"></div>
      <div class="field"><label>Balance</label><input class="input" id="r-balance" type="number"></div>
      <div class="field"><label>Referral code (optional)</label><input class="input" id="r-ref"></div>
    </div>
    <button class="btn btn-gold" id="r-go">Create Reseller</button>
  </div>
  <div class="res-grid" id="r-list"><div class="empty">Loading…</div></div>`;
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
async function loadResellers() {
  const { data } = await api("/api/resellers");
  const box = document.getElementById("r-list");
  if (!box) return;
  if (!data.ok) { box.innerHTML = `<div class="empty">${esc(data.error || "Failed.")}</div>`; return; }
  if (!data.resellers.length) { box.innerHTML = `<div class="empty">No resellers yet.</div>`; return; }
  box.innerHTML = data.resellers.map((r) => `
  <div class="res-card">
    <div class="res-top">
      <div class="avatar">${esc(initials(r.name))}</div>
      <div><div class="nm">${esc(r.name)}</div><div class="un">@${esc(r.username)}</div></div>
    </div>
    <div><span class="bal-pill">₹${esc(r.balance)}</span></div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:10px">
      ${r.contact ? esc(r.contact) + " · " : ""}${r.referralCode ? "Referral: " + esc(r.referralCode) + " · " : ""}Joined ${fmtDateOnly(r.createdAt)}
    </div>
    <div class="stat-grid">
      <div class="box"><div class="v">${r.stats.totalKeys}</div><div class="k">Keys</div></div>
      <div class="box"><div class="v">${r.stats.activeKeys}</div><div class="k">Active</div></div>
      <div class="box"><div class="v">₹${r.stats.earned}</div><div class="k">Earned</div></div>
    </div>
    <div class="bal-bar">
      <input class="input" id="bal-${r.id}" type="number">
      <button class="btn btn-gold btn-sm" onclick="addBalance('${r.id}')">Apply</button>
    </div>
    <div class="btn-row">
      <button class="btn btn-sm btn-ghost" onclick="editReseller('${r.id}')">Edit</button>
      <button class="btn btn-sm btn-danger" onclick="delReseller('${r.id}')">Remove</button>
    </div>
  </div>`).join("");
}
async function addBalance(id) {
  const v = document.getElementById("bal-" + id).value;
  if (v === "" || v == null) { toast("Enter an amount.", "err"); return; }
  const { data } = await api(`/api/resellers/${id}`, { method: "PATCH", body: { addBalance: v } });
  if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
  toast("Balance updated.", "ok"); loadResellers();
}
async function editReseller(id) {
  const { data } = await api("/api/resellers");
  if (!data.ok) return;
  const r = data.resellers.find((x) => x.id === id);
  if (!r) return;
  openModal(`<h2>Edit Reseller</h2>
    <div class="field"><label>Name</label><input class="input" id="er-name" value="${esc(r.name)}"></div>
    <div class="field"><label>Username</label><input class="input" id="er-username" value="${esc(r.username)}"></div>
    <div class="field"><label>Contact</label><input class="input" id="er-contact" value="${esc(r.contact || "")}"></div>
    <div class="field"><label>Balance (exact)</label><input class="input" id="er-balance" type="number" value="${r.balance}"></div>
    <div class="field"><label>New password (leave blank to keep)</label><input class="input" id="er-pass" type="password"></div>
    <div class="btn-row">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-gold" id="er-save">Save</button>
    </div>`);
  document.getElementById("er-save").onclick = async () => {
    const { data: d2 } = await api(`/api/resellers/${id}`, {
      method: "PATCH",
      body: {
        name: document.getElementById("er-name").value,
        username: document.getElementById("er-username").value,
        contact: document.getElementById("er-contact").value,
        balance: document.getElementById("er-balance").value,
        password: document.getElementById("er-pass").value,
      },
    });
    if (!d2.ok) { toast(d2.error || "Failed.", "err"); return; }
    closeModal(); toast("Reseller updated.", "ok"); loadResellers();
  };
}
function delReseller(id) {
  confirmDlg("Remove reseller", "Remove this reseller? All of their keys will also be deleted (no refund).", "Remove",
    async () => {
      const { data } = await api(`/api/resellers/${id}`, { method: "DELETE" });
      if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
      toast("Reseller removed.", "ok"); loadResellers();
    }, true);
}

/* ---------- prices (master) ---------- */
function pagePrices(el) {
  el.innerHTML = `
  <div class="page-head"><h1>Manage Price</h1><p>Set the price resellers pay per duration (per key, per device)</p></div>
  <div class="card" style="max-width:640px">
    <div class="detail-list" id="p-rows"><div class="empty">Loading…</div></div>
  </div>`;
  loadPrices();
}
async function loadPrices() {
  const { data } = await api("/api/prices");
  const box = document.getElementById("p-rows");
  if (!box) return;
  if (!data.ok) { box.innerHTML = `<div class="empty">${esc(data.error || "Failed.")}</div>`; return; }
  S.prices = data.prices;
  const order = S.meta ? S.meta.order : Object.keys(data.prices);
  box.innerHTML = order.map((d) => `
    <div class="dl-row">
      <span class="k" style="color:var(--text);font-weight:700">${esc(durLabel(d))}</span>
      <span style="display:flex;gap:8px;align-items:center">
        <span style="font-weight:700">₹</span>
        <input class="input" id="pr-${d}" type="number" min="0" value="${esc(data.prices[d])}" style="width:120px">
        <button class="btn btn-sm btn-gold" onclick="savePrice('${d}')">Save</button>
      </span>
    </div>`).join("");
}
async function savePrice(d) {
  const v = document.getElementById("pr-" + d).value;
  const { data } = await api("/api/prices", { method: "PUT", body: { prices: { [d]: v } } });
  if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
  S.prices = data.prices;
  toast("Price saved.", "ok");
}

/* ---------- referrals (master) ---------- */
function pageReferrals(el) {
  el.innerHTML = `
  <div class="page-head"><h1>Create Referral</h1><p>Referral codes for new resellers</p></div>
  <div class="card" style="max-width:640px">
    <h2>New Referral Code</h2>
    <div class="field"><label>Note (optional)</label><input class="input" id="rf-note"></div>
    <button class="btn btn-gold" id="rf-go">Generate Code</button>
    <div id="rf-new" style="margin-top:14px"></div>
  </div>
  <div class="card" style="max-width:640px">
    <h2>Referral Codes</h2>
    <div class="detail-list" id="rf-list"><div class="empty">Loading…</div></div>
  </div>`;
  document.getElementById("rf-go").onclick = async () => {
    const { data } = await api("/api/referrals", { method: "POST", body: { note: document.getElementById("rf-note").value } });
    if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
    document.getElementById("rf-new").innerHTML = `
      <div class="preview-box"><div class="mono" style="font-size:16px;font-weight:800">${esc(data.referral.code)}</div>
      <div style="margin-top:8px"><button class="icon-btn" onclick="copyText('${esc(data.referral.code)}')">Copy code</button></div></div>`;
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
  box.innerHTML = data.referrals.map((r) => `
    <div class="dl-row">
      <span><span class="mono" style="font-weight:800">${esc(r.code)}</span>
        ${r.note ? `<br><span style="color:var(--muted);font-size:12.5px">${esc(r.note)}</span>` : ""}
        <br><span style="color:var(--muted);font-size:12.5px">Created ${fmtDate(r.createdAt)} · Uses: ${r.uses}</span></span>
      <span>
        ${r.active ? '<span class="pill pill-active">Active</span>' : '<span class="pill pill-unused">Disabled</span>'}
        <div class="kbd-actions" style="margin-top:6px">
          <button class="icon-btn" onclick="copyText('${esc(r.code)}')">Copy</button>
          <button class="icon-btn" onclick="toggleReferral('${r.id}', ${!r.active})">${r.active ? "Disable" : "Enable"}</button>
          <button class="icon-btn danger" onclick="delReferral('${r.id}')">Delete</button>
        </div>
      </span>
    </div>`).join("");
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

/* ---------- sales report (master) ---------- */
function pageSales(el) {
  el.innerHTML = `
  <div class="page-head"><h1>Sales Report</h1><p>Keys sold and balance earned per reseller</p></div>
  <div class="card" style="max-width:640px">
    <div class="toolbar">
      <div class="field" style="margin:0"><label>From</label><input class="input" id="s-from" type="date"></div>
      <div class="field" style="margin:0"><label>To</label><input class="input" id="s-to" type="date"></div>
      <div><label>&nbsp;</label><button class="btn btn-gold" id="s-go">Apply</button></div>
    </div>
  </div>
  <div class="card" id="s-out"><div class="empty">Choose a date range and apply.</div></div>`;
  document.getElementById("s-go").onclick = async () => {
    const from = document.getElementById("s-from").value;
    const to = document.getElementById("s-to").value;
    const q = new URLSearchParams({ from, to });
    const { data } = await api("/api/sales?" + q.toString());
    const box = document.getElementById("s-out");
    if (!data.ok) { box.innerHTML = `<div class="empty">${esc(data.error || "Failed.")}</div>`; return; }
    S.sales = data;
    box.innerHTML = `
      ${data.top ? `<div class="alert-card card" style="margin-bottom:14px;padding:14px 16px"><b>Top reseller:</b> @${esc(data.top.reseller)} — ${data.top.keysSold} keys, ₹${esc(data.top.earned)} earned</div>` : ""}
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Reseller</th><th>Keys Sold</th><th>Earned</th></tr></thead>
        <tbody>${data.rows.length ? data.rows.map((r) => `
          <tr><td><b>@${esc(r.reseller)}</b></td><td>${r.keysSold}</td><td><b>₹${esc(r.earned)}</b></td></tr>`).join("")
          : `<tr><td colspan="3"><div class="empty">No sales in this range.</div></td></tr>`}
        </tbody>
        <tfoot><tr><td><b>Total</b></td><td><b>${data.totals.keysSold}</b></td><td><b>₹${esc(data.totals.earned)}</b></td></tr></tfoot>
      </table></div>`;
  };
}

/* ---------- server control (master) ---------- */
function pageServer(el) {
  el.innerHTML = `
  <div class="page-head"><h1>Server Control</h1><p>Maintenance mode and broadcast message for app users</p></div>
  <div class="card" style="max-width:640px">
    <h2>Server Status</h2>
    <div class="dl-row detail-list" style="display:flex;justify-content:space-between;align-items:center;padding:10px 0">
      <span style="font-weight:700">Server</span>
      <label class="switch"><input type="checkbox" id="sv-enabled"><span class="slider"></span></label>
    </div>
    <div class="field" style="margin-top:14px"><label>Broadcast message</label><textarea class="input" id="sv-bc"></textarea></div>
    <button class="btn btn-gold" id="sv-save">Save</button>
    <h3 style="margin-top:18px">Preview</h3>
    <div class="banner-preview" id="sv-preview"></div>
  </div>`;
  loadServer();
  document.getElementById("sv-save").onclick = async () => {
    const { data } = await api("/api/server", {
      method: "PUT",
      body: { enabled: document.getElementById("sv-enabled").checked, broadcast: document.getElementById("sv-bc").value },
    });
    if (!data.ok) { toast(data.error || "Failed.", "err"); return; }
    toast("Server settings saved.", "ok"); loadServer();
  };
}
async function loadServer() {
  const { data } = await api("/api/server");
  if (!data.ok) return;
  document.getElementById("sv-enabled").checked = !!data.server.enabled;
  document.getElementById("sv-bc").value = data.server.broadcast || "";
  document.getElementById("sv-preview").textContent = data.server.enabled
    ? (data.server.broadcast ? "Broadcast: " + data.server.broadcast : "Server is ON. App users can verify keys.")
    : "Server in maintenance." + (data.server.broadcast ? " " + data.server.broadcast : "");
}

/* ---------- settings ---------- */
let editingProfile = false;
function pageSettings(el) {
  const isMaster = S.me.role === "master";
  el.innerHTML = `
  <div class="page-head"><h1>Settings</h1><p>Account and panel preferences</p></div>
  <div class="grid-2" style="max-width:900px">
    <div class="card">
      <h2>Change Password</h2>
      <div class="field"><label>Current password</label><input class="input" id="pw-cur" type="password"></div>
      <div class="field"><label>New password</label><input class="input" id="pw-new" type="password"></div>
      <div class="field"><label>Confirm new password</label><input class="input" id="pw-new2" type="password"></div>
      <button class="btn btn-gold" id="pw-go">Update Password</button>
    </div>
    <div class="card">
      <h2>Account Info</h2>
      <div class="detail-list" id="set-profile"></div>
    </div>
    ${isMaster ? `
    <div class="card">
      <h2>Panel Logo</h2>
      <div id="logo-box" style="margin-bottom:12px"></div>
      <div class="field"><label>Upload logo (PNG/JPEG, max 2MB)</label><input class="input" id="logo-file" type="file" accept="image/png,image/jpeg"></div>
      <div class="btn-row" style="justify-content:flex-start">
        <button class="btn btn-gold btn-sm" id="logo-up">Upload</button>
        <button class="btn btn-sm btn-danger" id="logo-rm">Remove</button>
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
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f);
      });
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
function renderProfileBox() {
  const box = document.getElementById("set-profile");
  if (!box) return;
  if (!editingProfile) {
    box.innerHTML = `
      <div class="dl-row"><span class="k">Username</span><span><b>${esc(S.me.username)}</b></span></div>
      <div class="dl-row"><span class="k">Role</span><span><b>${esc(S.me.role === "master" ? S.me.displayName : "Reseller")}</b></span></div>
      <div class="btn-row" style="justify-content:flex-start;margin-top:12px">
        ${S.me.role === "master" ? `<button class="btn btn-sm btn-ghost" onclick="editingProfile=true;renderProfileBox()">Edit</button>` : ""}
      </div>`;
  } else {
    box.innerHTML = `
      <div class="field"><label>Username</label><input class="input" id="pf-user" value="${esc(S.me.username)}"></div>
      <div class="field"><label>Role</label><input class="input" id="pf-role" value="${esc(S.me.displayName)}"></div>
      <div class="btn-row" style="justify-content:flex-start">
        <button class="btn btn-ghost btn-sm" onclick="editingProfile=false;renderProfileBox()">Cancel</button>
        <button class="btn btn-gold btn-sm" id="pf-save">Save</button>
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
  box.innerHTML = r.ok ? '<img src="/logo" style="max-width:120px;max-height:90px;border-radius:10px;border:1px solid var(--line)">' : '<p style="color:var(--muted);font-size:13.5px">No logo set.</p>';
}

/* ---------- boot & render ---------- */
function render() {
  if (!S.token || !S.me) renderLogin();
  else renderShell();
}
async function boot(keepPage) {
  try {
    const [meR, metaR, prR] = await Promise.all([api("/api/me"), api("/api/meta"), api("/api/prices")]);
    if (!meR.data.ok) throw new Error("me");
    S.me = meR.data;
    if (metaR.data.ok) S.meta = metaR.data;
    if (prR.data.ok) S.prices = prR.data.prices;
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
