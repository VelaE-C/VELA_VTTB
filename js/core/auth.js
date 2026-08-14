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
  const requested = pageFromHash();
  navigate(requested || "dashboard");
}

// Đọc #tenTrang từ URL — dùng lúc mở app/F5 để quay lại đúng trang đang xem
function pageFromHash() {
  const raw = location.hash.replace(/^#/, "");
  return NAV_ITEMS.some((n) => n.id === raw) ? raw : null;
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
  if (STATE.role === "editor" || STATE.role === "project_lead" || STATE.role === "viewer") {
    const { data: ups } = await sb.from("user_projects").select("project_id").eq("user_id", STATE.user.id);
    STATE.assignedProjects = (ups || []).map((r) => r.project_id);
  } else {
    STATE.assignedProjects = [];
  }
}

async function loadCoreLookups() {
  const [{ data: projects }, { data: materials }, { data: suppliers }, { data: l1 }, { data: l2 }] = await Promise.all([
    sb.from("projects").select("*").order("project_name"),
    sb.from("materials").select("*").order("material_code"),
    sb.from("suppliers").select("*").order("supplier_name"),
    sb.from("material_groups_l1").select("*").order("name"),
    sb.from("material_groups_l2").select("*").order("name"),
  ]);
  // RLS đã tự lọc projects theo quyền — editor/viewer chỉ nhận về dự án được gán
  STATE.projects = projects || [];
  STATE.materials = materials || [];
  STATE.suppliers = suppliers || [];
  STATE.materialGroupsL1 = l1 || [];
  STATE.materialGroupsL2 = l2 || [];
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

// ---------- ĐỔI MẬT KHẨU — mọi role tự đổi mật khẩu của chính mình ----------
// Bắt xác nhận mật khẩu hiện tại trước (đăng nhập thử lại) rồi mới cho đổi —
// dù Supabase không bắt buộc bước này (đã có session), thêm vào cho chắc,
// tránh ai đó lỡ ngồi vào máy chưa khóa màn hình rồi đổi mật khẩu người khác.
function openChangePasswordModal() {
  openModal({
    title: "Đổi mật khẩu",
    preventBackdropClose: true,
    bodyHtml: `
      <div class="field"><label>Mật khẩu hiện tại</label><input id="cp-current" type="password" autocomplete="current-password"></div>
      <div class="field"><label>Mật khẩu mới</label><input id="cp-new" type="password" autocomplete="new-password" placeholder="Tối thiểu 6 ký tự"></div>
      <div class="field"><label>Nhập lại mật khẩu mới</label><input id="cp-confirm" type="password" autocomplete="new-password"></div>`,
    footerHtml: `
      <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
      <button class="btn btn-primary" onclick="submitChangePassword()">Đổi mật khẩu</button>`,
  });
}

async function submitChangePassword() {
  const current = document.getElementById("cp-current").value;
  const newPass = document.getElementById("cp-new").value;
  const confirm = document.getElementById("cp-confirm").value;

  if (!current) { toast("Nhập mật khẩu hiện tại", "error"); return; }
  if (!newPass || newPass.length < 6) { toast("Mật khẩu mới phải từ 6 ký tự trở lên", "error"); return; }
  if (newPass !== confirm) { toast("Mật khẩu mới nhập lại không khớp", "error"); return; }

  loading(true, "Đang xác nhận mật khẩu hiện tại...");
  // Xác nhận đúng mật khẩu cũ bằng cách đăng nhập thử lại — KHÔNG làm mất session hiện tại nếu đúng
  const { error: verifyError } = await sb.auth.signInWithPassword({ email: STATE.user.email, password: current });
  if (verifyError) {
    loading(false);
    toast("Mật khẩu hiện tại không đúng", "error");
    return;
  }

  loading(true, "Đang đổi mật khẩu...");
  const { error } = await sb.auth.updateUser({ password: newPass });
  loading(false);
  if (error) { toast("Lỗi: " + error.message, "error"); return; }
  toast("Đã đổi mật khẩu thành công!", "success");
  closeModal();
}

function showLoginScreen() {
  const brandBlock = CFG.SHOW_BRANDING
    ? `<img src="https://raw.githubusercontent.com/VelaE-C/VELA_VTTB/main/Logo%20VELA%20E%26C-01.png" alt="VELA E&amp;C" style="height:84px;width:auto;display:block;margin:0 auto 14px">
       <h2>VELA_VTTB</h2>`
    : `<div style="width:64px;height:64px;border-radius:14px;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;margin:0 auto 14px">VTTB</div>
       <h2>Hệ thống Vật Tư Thiết Bị</h2>`;
  document.body.innerHTML = `
    <div id="login-screen">
      <div class="login-box">
        ${brandBlock}
        <div class="sub">Đăng nhập để tiếp tục</div>
        <div class="field">
          <label>Tài khoản</label>
          <input id="login-email" type="text" placeholder="vd: thukho.iec@vttb.local" autocapitalize="off" autocomplete="username">
        </div>
        <div class="field"><label>Mật khẩu</label><input id="login-password" type="password" placeholder="••••••••" autocomplete="current-password"></div>
        <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="handleLoginClick()">Đăng nhập</button>
        <div class="helper" style="text-align:center;margin-top:12px">Quên tài khoản/mật khẩu? Liên hệ quản trị viên để được cấp lại.</div>
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
  const brandBlock = CFG.SHOW_BRANDING
    ? `<img src="https://raw.githubusercontent.com/VelaE-C/VELA_VTTB/main/LOGO%20VELA_logo%20ngang%20.png" alt="VELA E&amp;C" style="height:32px;width:auto;display:block">
       <span class="hide-mobile" style="color:rgba(255,255,255,0.7);font-size:12.5px;margin-left:4px">VTTB</span>`
    : `<div style="width:30px;height:30px;border-radius:7px;background:rgba(255,255,255,0.15);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px">VT</div>
       <span style="font-weight:600">Hệ thống Vật Tư Thiết Bị</span>`;
  document.body.innerHTML = `
    <div id="app-shell">
      <div id="topbar">
        <button id="menu-toggle" onclick="toggleMobileMenu()">☰</button>
        <div class="brand">
          ${brandBlock}
        </div>
        <div class="spacer"></div>
        <select id="project-filter" onchange="onProjectFilterChange()"></select>
        <span class="user-email hide-mobile">${escapeHtml(STATE.user.email)} · ${roleLabel(STATE.role)}</span>
        <button class="btn btn-sm btn-secondary hide-mobile" onclick="openChangePasswordModal()">Đổi mật khẩu</button>
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
  return {
    admin: "Quản trị viên",
    manager: "Quản lý",
    company_viewer: "Xem toàn công ty",
    editor: "Biên tập",
    project_lead: "Trưởng dự án",
    viewer: "Chỉ xem",
  }[role] || role;
}

function renderProjectFilter() {
  const sel = document.getElementById("project-filter");
  const isGlobal = STATE.role === "admin" || STATE.role === "manager" || STATE.role === "company_viewer";
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
  html += `<div class="nav-item" data-page="_doi-mat-khau" onclick="openChangePasswordModal()">
    <span class="nav-icon">🔑</span><span>Đổi mật khẩu</span>
  </div>`;
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

// ---------- NAVIGATE — mỗi lần chuyển trang: render vào #content-area + cập nhật URL ----------
let _navigatingFromHash = false; // tránh vòng lặp khi hashchange tự kích hoạt lại navigate()

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

  if (!_navigatingFromHash && location.hash.replace(/^#/, "") !== page) {
    history.pushState(null, "", "#" + page);
  }
}

// Bấm nút back/forward của trình duyệt -> điều hướng đúng module tương ứng
window.addEventListener("hashchange", () => {
  const page = pageFromHash();
  if (!page || !STATE.role) return; // chưa đăng nhập xong thì bỏ qua
  _navigatingFromHash = true;
  navigate(page);
  _navigatingFromHash = false;
});

// ---------- KHỞI CHẠY ----------
document.addEventListener("DOMContentLoaded", checkAuth);
