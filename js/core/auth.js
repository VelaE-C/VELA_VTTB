/* ============================================================
   js/core/auth.js
   Login, session, navigate(), phân quyền — theo VelaE&C Design System
   QUAN TRỌNG: script này load SAU CÙNG trong nhóm core/modules (index.html)
   ============================================================ */

// ---------- KHỞI ĐỘNG ----------
async function checkAuth() {
  loading(true, "Đang kiểm tra đăng nhập...");
  const { data: { session } } = await sb.auth.getSession();
  loading(false);
  if (!session) { showLoginScreen(); return; }
  STATE.user = session.user;
  await afterLogin();
}

async function afterLogin() {
  loading(true, "Đang tải thông tin tài khoản...");
  await loadProfile();
  await loadCoreLookups(); // projects/materials/suppliers dùng chung nhiều module
  loading(false);
  renderShell();
  navigate("dashboard");
}

async function loadProfile() {
  const { data, error } = await sb.from("profiles").select("*").eq("id", STATE.user.id).single();
  if (error || !data) {
    toast("Tài khoản chưa được admin gán quyền — liên hệ quản trị viên", "error");
    STATE.role = "viewer";
    STATE.profile = null;
    STATE.assignedProjects = [];
    return;
  }
  STATE.profile = data;
  STATE.role = data.role;
  if (STATE.role === "editor" || STATE.role === "viewer") {
    const { data: ups } = await sb.from("user_projects").select("project_id").eq("user_id", STATE.user.id);
    STATE.assignedProjects = (ups || []).map((r) => r.project_id);
  } else {
    STATE.assignedProjects = [];
  }
}

async function loadCoreLookups() {
  const [{ data: projects }, { data: materials }, { data: suppliers }] = await Promise.all([
    sb.from("projects").select("*").order("project_name"),
    sb.from("materials").select("*").order("material_code"),
    sb.from("suppliers").select("*").order("supplier_name"),
  ]);
  // RLS đã tự lọc projects theo quyền — editor/viewer chỉ nhận về dự án được gán
  STATE.projects = projects || [];
  STATE.materials = materials || [];
  STATE.suppliers = suppliers || [];
}

// ---------- LOGIN / LOGOUT ----------
async function login(email, password) {
  loading(true, "Đang đăng nhập...");
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    loading(false);
    toast("Sai email hoặc mật khẩu", "error");
    return;
  }
  STATE.user = data.user;
  await afterLogin();
}

async function logout() {
  await sb.auth.signOut();
  location.reload();
}

function showLoginScreen() {
  document.body.innerHTML = `
    <div id="login-screen">
      <div class="login-box">
        <div class="brand-mark">VT</div>
        <h2>VELA_VTTB</h2>
        <div class="sub">Đăng nhập để tiếp tục</div>
        <div class="field"><label>Email</label><input id="login-email" type="email" placeholder="ten@velaec.vn"></div>
        <div class="field"><label>Mật khẩu</label><input id="login-password" type="password" placeholder="••••••••"></div>
        <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="handleLoginClick()">Đăng nhập</button>
      </div>
    </div>`;
  document.getElementById("login-password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleLoginClick();
  });
}
function handleLoginClick() {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  if (!email || !password) { toast("Nhập đủ email và mật khẩu", "error"); return; }
  login(email, password);
}

// ---------- SHELL (topbar + sidebar + bottom nav) ----------
function renderShell() {
  document.body.innerHTML = `
    <div id="app-shell">
      <div id="topbar">
        <button id="menu-toggle" onclick="toggleMobileMenu()">☰</button>
        <div class="brand">
          <div class="brand-mark">VT</div>
          <span>VELA<span class="brand-name">_VTTB</span></span>
        </div>
        <div class="spacer"></div>
        <select id="project-filter" onchange="onProjectFilterChange()"></select>
        <span class="user-email hide-mobile">${escapeHtml(STATE.user.email)} · ${roleLabel(STATE.role)}</span>
        <button id="btn-logout" onclick="logout()">Thoát</button>
      </div>
      <div id="app-body">
        <div id="sidebar"></div>
        <div id="content-area"></div>
      </div>
      <div id="bottom-nav"></div>
    </div>`;
  renderProjectFilter();
  renderSidebar();
  renderBottomNav();
}

function roleLabel(role) {
  return { admin: "Quản trị viên", manager: "Quản lý", editor: "Biên tập", viewer: "Chỉ xem" }[role] || role;
}

function renderProjectFilter() {
  const sel = document.getElementById("project-filter");
  const isGlobal = STATE.role === "admin" || STATE.role === "manager";
  const options = isGlobal
    ? [`<option value="">Tất cả dự án</option>`, ...STATE.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.project_name)}</option>`)]
    : STATE.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.project_name)}</option>`);
  sel.innerHTML = options.join("");
  STATE.currentProjectFilter = isGlobal ? null : (STATE.projects[0] ? STATE.projects[0].id : null);
  if (!isGlobal && STATE.projects[0]) sel.value = STATE.projects[0].id;
}
function onProjectFilterChange() {
  const v = document.getElementById("project-filter").value;
  STATE.currentProjectFilter = v || null;
  if (STATE.currentPage) navigate(STATE.currentPage);
}

function renderSidebar() {
  const visible = NAV_ITEMS.filter((n) => n.roles.includes(STATE.role));
  const groups = {};
  visible.forEach((n) => { const g = n.group || ""; groups[g] = groups[g] || []; groups[g].push(n); });
  let html = "";
  Object.keys(groups).forEach((g) => {
    if (g) html += `<div class="nav-group-label">${escapeHtml(g)}</div>`;
    groups[g].forEach((n) => {
      const ready = !!window.MODULES[n.id];
      html += `<div class="nav-item${ready ? "" : " disabled"}" data-page="${n.id}" onclick="${ready ? `navigate('${n.id}')` : ""}" title="${ready ? "" : "Module đang phát triển"}">
        <span class="nav-icon">${n.icon}</span><span>${escapeHtml(n.label)}</span>
      </div>`;
    });
  });
  document.getElementById("sidebar").innerHTML = html;
}

function renderBottomNav() {
  const visible = NAV_ITEMS.filter((n) => n.roles.includes(STATE.role) && n.bottomNav);
  document.getElementById("bottom-nav").innerHTML = visible
    .map((n) => {
      const ready = !!window.MODULES[n.id];
      return `<div class="bottom-nav-item" data-page="${n.id}" onclick="${ready ? `navigate('${n.id}')` : ""}">
        <span class="nav-icon">${n.icon}</span><span>${escapeHtml(n.label)}</span>
      </div>`;
    })
    .join("");
}

function toggleMobileMenu() {
  const sb_ = document.getElementById("sidebar");
  sb_.style.display = sb_.style.display === "block" ? "none" : "block";
}

// ---------- NAVIGATE — mỗi lần chuyển trang: render vào #content-area ----------
function navigate(page) {
  const item = NAV_ITEMS.find((n) => n.id === page);
  if (!item || !item.roles.includes(STATE.role)) {
    toast("Bạn không có quyền truy cập trang này", "error");
    return;
  }
  const mod = window.MODULES[page];
  const container = document.getElementById("content-area");
  if (!mod) {
    container.innerHTML = `<div class="card">${emptyStateHtml("Module \"" + item.label + "\" đang phát triển.")}</div>`;
    return;
  }
  STATE.currentPage = page;
  document.querySelectorAll(".nav-item, .bottom-nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.page === page);
  });
  container.innerHTML = "";
  mod.render(container);
}

// ---------- KHỞI CHẠY ----------
document.addEventListener("DOMContentLoaded", checkAuth);
