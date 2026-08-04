/* ============================================================
   js/modules/dashboard.js
   BẢN TỐI GIẢN — placeholder để app chạy được ngay từ Bước 1-5.
   Sẽ thay bằng bản đầy đủ (KPI, cảnh báo ngân sách, S-curve, top công nợ)
   ở Bước 6 theo checklist, sau khi đã có dữ liệu thật qua danhmuc.js
   ============================================================ */

window.MODULES.dashboard = {
  render(container) {
    container.innerHTML = `
      <h2>Tổng quan</h2>
      <div class="card">
        <h3>Chào ${escapeHtml(STATE.profile ? STATE.profile.full_name || STATE.user.email : STATE.user.email)}</h3>
        <p style="color:var(--gray5);font-size:13px;margin-top:6px">
          Quyền hiện tại: <strong>${roleLabel(STATE.role)}</strong>
          ${STATE.assignedProjects.length ? ` · Phụ trách ${STATE.assignedProjects.length} dự án` : ""}
        </p>
      </div>
      <div class="card">
        ${emptyStateHtml("Dashboard đầy đủ (cảnh báo ngân sách, S-curve, công nợ) sẽ hoàn thiện ở bước tiếp theo, sau khi module Nhận hàng/Hóa đơn có dữ liệu thật.")}
      </div>
      <div class="card">
        <h3>Danh mục hiện có</h3>
        <p style="font-size:13px;color:var(--gray7)">
          ${STATE.projects.length} dự án · ${STATE.materials.length} vật tư · ${STATE.suppliers.length} NCC
        </p>
      </div>`;
  },
};
