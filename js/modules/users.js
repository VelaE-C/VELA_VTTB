/* ============================================================
   js/modules/users.js
   Phân quyền — CHỈ admin thấy tab này (kiểm tra lại 1 lần nữa dù NAV_ITEMS đã lọc,
   vì module có thể bị gọi trực tiếp qua console/lỗi logic khác)
   ============================================================ */

const UsersModule = {
  async render(container) {
    if (STATE.role !== "admin") {
      container.innerHTML = `<div class="card">${emptyStateHtml("Bạn không có quyền xem trang này.")}</div>`;
      return;
    }
    container.innerHTML = `<h2>Người dùng &amp; phân quyền</h2><div id="users-body"></div>`;
    await this.load();
  },

  async load() {
    const body = document.getElementById("users-body");
    body.innerHTML = `<div class="card">${emptyStateHtml("Đang tải...")}</div>`;
    loading(true, "Đang tải danh sách người dùng...");
    const [{ data: profiles, error }, { data: assignments }] = await Promise.all([
      sb.from("profiles").select("*").order("email"),
      sb.from("user_projects").select("user_id, project_id"),
    ]);
    loading(false);
    if (error) { toast("Lỗi tải danh sách: " + error.message, "error"); return; }

    const assignedByUser = {};
    (assignments || []).forEach((a) => {
      assignedByUser[a.user_id] = assignedByUser[a.user_id] || [];
      assignedByUser[a.user_id].push(a.project_id);
    });

    const rows = (profiles || [])
      .map((p) => {
        const myProjects = (assignedByUser[p.id] || [])
          .map((pid) => STATE.projects.find((pr) => pr.id === pid)?.project_name)
          .filter(Boolean);
        const scoped = p.role === "editor" || p.role === "viewer";
        return `<tr>
          <td>${escapeHtml(p.full_name || "—")}</td>
          <td class="hide-mobile">${escapeHtml(p.email || "—")}</td>
          <td>
            <select onchange="UsersModule.changeRole('${p.id}', this.value)" style="height:32px;font-size:12.5px">
              ${["admin", "manager", "editor", "viewer"].map((r) => `<option value="${r}" ${r === p.role ? "selected" : ""}>${roleLabel(r)}</option>`).join("")}
            </select>
          </td>
          <td class="hide-mobile">
            ${scoped ? (myProjects.length ? myProjects.map((n) => `<span class="badge badge-info">${escapeHtml(n)}</span>`).join(" ") : '<span class="badge badge-none">Chưa gán dự án</span>') : '<span class="badge badge-none">Toàn công ty</span>'}
          </td>
          <td>${scoped ? `<button class="btn btn-sm btn-secondary" onclick="UsersModule.openAssignModal('${p.id}', '${escapeHtml(p.full_name || p.email || "")}')">Gán dự án</button>` : ""}</td>
        </tr>`;
      })
      .join("");

    body.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Danh sách người dùng (${(profiles || []).length})</h3></div>
        <div class="helper" style="margin-bottom:10px">
          Tạo tài khoản mới qua Supabase Dashboard &gt; Authentication &gt; Invite user — tài khoản mới mặc định quyền "Chỉ xem", vào đây nâng quyền sau khi xác định đúng người.
        </div>
        ${
          profiles && profiles.length
            ? `<table><thead><tr><th>Họ tên</th><th class="hide-mobile">Email</th><th>Quyền</th><th class="hide-mobile">Dự án được gán</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
            : emptyStateHtml("Chưa có người dùng nào.")
        }
      </div>`;
  },

  async changeRole(userId, newRole) {
    if (userId === STATE.user.id && newRole !== "admin") {
      if (!confirm("Bạn đang tự đổi quyền của chính mình, có thể mất quyền admin ngay lập tức. Tiếp tục?")) {
        this.load();
        return;
      }
    }
    loading(true, "Đang cập nhật quyền...");
    const { error } = await sb.from("profiles").update({ role: newRole }).eq("id", userId);
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); this.load(); return; }
    toast("Đã cập nhật quyền!", "success");
    this.load();
  },

  async openAssignModal(userId, name) {
    loading(true, "Đang tải dự án được gán...");
    const { data: current } = await sb.from("user_projects").select("project_id").eq("user_id", userId);
    loading(false);
    const currentIds = new Set((current || []).map((r) => r.project_id));
    const checkboxes = STATE.projects
      .map(
        (p) => `<label style="display:flex;align-items:center;gap:8px;padding:6px 0">
          <input type="checkbox" value="${p.id}" ${currentIds.has(p.id) ? "checked" : ""} style="width:auto;height:auto">
          ${escapeHtml(p.project_name)}
        </label>`
      )
      .join("");
    openModal({
      title: `Gán dự án — ${escapeHtml(name)}`,
      bodyHtml: `<div id="assign-checkboxes">${checkboxes || emptyStateHtml("Chưa có dự án nào trong danh mục.")}</div>`,
      footerHtml: `
        <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="UsersModule.saveAssignment('${userId}')">Lưu</button>`,
    });
  },

  async saveAssignment(userId) {
    const checked = Array.from(document.querySelectorAll("#assign-checkboxes input:checked")).map((el) => el.value);
    loading(true, "Đang lưu phân công dự án...");
    // Xóa hết rồi insert lại theo danh sách mới — đơn giản, đủ dùng vì số dự án nhỏ (~15)
    const del = await sb.from("user_projects").delete().eq("user_id", userId);
    if (del.error) { loading(false); toast("Lỗi: " + del.error.message, "error"); return; }
    if (checked.length) {
      const ins = await sb.from("user_projects").insert(checked.map((pid) => ({ user_id: userId, project_id: pid })));
      if (ins.error) { loading(false); toast("Lỗi: " + ins.error.message, "error"); return; }
    }
    loading(false);
    toast("Đã lưu phân công dự án!", "success");
    closeModal();
    this.load();
  },
};

window.MODULES.users = { render: (container) => UsersModule.render(container) };
window.UsersModule = UsersModule;
