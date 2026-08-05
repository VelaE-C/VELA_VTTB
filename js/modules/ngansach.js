/* ============================================================
   js/modules/ngansach.js
   A1 (Dự trù số lượng) + A2 (Ngân sách tiền) — theo dự án + hạng mục/vật tư.
   CHỈ admin/manager tạo/sửa (tạo version mới, giữ lịch sử điều chỉnh).
   editor/viewer chỉ xem (trong phạm vi dự án được gán, RLS tự lọc).
   ============================================================ */

const NganSach = {
  activeTab: "budget", // budget | plan

  async render(container) {
    container.innerHTML = `
      <h2>Ngân sách &amp; Dự trù</h2>
      <div style="display:flex;gap:6px;margin-bottom:16px">
        <button class="btn btn-sm ${this.activeTab === "budget" ? "btn-primary" : "btn-secondary"}" onclick="NganSach.switchTab('budget')">Ngân sách (tiền)</button>
        <button class="btn btn-sm ${this.activeTab === "plan" ? "btn-primary" : "btn-secondary"}" onclick="NganSach.switchTab('plan')">Dự trù (số lượng)</button>
      </div>
      <div id="ns-body"></div>`;
    await this.renderActiveTab();
  },

  switchTab(tab) {
    this.activeTab = tab;
    this.render(document.getElementById("content-area"));
  },

  canWrite() {
    return STATE.role === "admin" || STATE.role === "manager";
  },

  async renderActiveTab() {
    const body = document.getElementById("ns-body");
    body.innerHTML = `<div class="card">${emptyStateHtml("Đang tải...")}</div>`;
    if (this.activeTab === "budget") await this.renderBudget(body);
    else await this.renderPlan(body);
  },

  // ---------------- NGÂN SÁCH (tiền) ----------------
  async renderBudget(body) {
    loading(true, "Đang tải ngân sách...");
    const { data, error } = await sb.from("v_budget_summary").select("*").order("project_name").order("category_name");
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }

    const rows = (data || [])
      .map(
        (b) => `<tr>
          <td>${escapeHtml(b.project_name)}</td>
          <td>${escapeHtml(b.category_name)}</td>
          <td class="num">${fmtMoney(b.budget_amount)}</td>
          <td class="num">${fmtMoney(b.committed_amount)}</td>
          <td style="min-width:140px">
            <div class="bar-track" style="width:100%;height:6px;background:var(--gray2);border-radius:4px;overflow:hidden">
              <div style="height:100%;width:${Math.min(b.pct_used || 0, 100)}%;background:${this.alertColor(b.alert_level)}"></div>
            </div>
            <div style="font-size:11px;color:var(--gray5);margin-top:3px">${b.pct_used || 0}%</div>
          </td>
          <td>${budgetAlertBadge(b.alert_level)}</td>
        </tr>`
      )
      .join("");

    body.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Ngân sách theo hạng mục (${(data || []).length})</h3>
          ${this.canWrite() ? `<button class="btn btn-primary btn-sm" onclick="NganSach.openBudgetModal()">+ Thêm / điều chỉnh ngân sách</button>` : ""}
        </div>
        ${
          data && data.length
            ? `<table><thead><tr><th>Dự án</th><th>Hạng mục</th><th>Ngân sách</th><th>Đã dùng</th><th>% sử dụng</th><th>Trạng thái</th></tr></thead><tbody>${rows}</tbody></table>`
            : emptyStateHtml("Chưa có ngân sách nào.")
        }
      </div>`;
  },

  alertColor(level) {
    return { ok: "var(--green)", warning_70: "var(--amber)", critical_85: "var(--orange)", over_budget: "var(--red)" }[level] || "var(--gray3)";
  },

  openBudgetModal() {
    openModal({
      title: "Thêm / điều chỉnh ngân sách",
      bodyHtml: `
        <div class="field">
          <label>Dự án</label>
          <select id="bg-project">${STATE.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.project_name)}</option>`).join("")}</select>
        </div>
        <div class="field"><label>Hạng mục</label><input id="bg-category" placeholder="VD: Vật tư thô"></div>
        <div class="field"><label>Số tiền ngân sách</label><input id="bg-amount" type="number" step="any" placeholder="0"></div>
        <div class="field"><label>Ngày hiệu lực</label><input id="bg-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>Ghi chú (lý do điều chỉnh nếu có)</label><textarea id="bg-note"></textarea></div>
        <div class="helper">Lưu sẽ tạo 1 version MỚI cho đúng cặp Dự án + Hạng mục này — không ghi đè version cũ, giữ nguyên lịch sử điều chỉnh.</div>`,
      footerHtml: `
        <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="NganSach.saveBudget()">Lưu</button>`,
    });
  },

  async saveBudget() {
    const projectId = document.getElementById("bg-project").value;
    const category = document.getElementById("bg-category").value.trim();
    const amount = parseFloat(document.getElementById("bg-amount").value);
    const date = document.getElementById("bg-date").value;
    const note = document.getElementById("bg-note").value.trim();
    if (!category) { toast("Nhập hạng mục", "error"); return; }
    if (!amount || amount <= 0) { toast("Nhập số tiền hợp lệ", "error"); return; }

    loading(true, "Đang tính version mới...");
    const { data: existing } = await sb
      .from("budgets")
      .select("version")
      .eq("project_id", projectId)
      .ilike("category_name", category)
      .order("version", { ascending: false })
      .limit(1);
    const nextVersion = existing && existing.length ? existing[0].version + 1 : 1;

    const { error } = await sb.from("budgets").insert({
      project_id: projectId,
      category_name: category,
      budget_amount: amount,
      version: nextVersion,
      effective_date: date,
      note: note || null,
      created_by: STATE.user.id,
    });
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    toast(`Đã lưu ngân sách (version ${nextVersion})!`, "success");
    closeModal();
    this.renderActiveTab();
  },

  // ---------------- DỰ TRÙ (số lượng) ----------------
  async renderPlan(body) {
    loading(true, "Đang tải dự trù...");
    const { data, error } = await sb.from("v_material_plan_vs_received").select("*");
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }

    const rows = (data || [])
      .map((r) => {
        const project = STATE.projects.find((p) => p.id === r.project_id);
        const material = STATE.materials.find((m) => m.id === r.material_id);
        const pct = r.pct_received || 0;
        const color = pct >= 100 ? "var(--red)" : pct >= 85 ? "var(--orange)" : pct >= 70 ? "var(--amber)" : "var(--green)";
        return `<tr>
          <td>${escapeHtml(project ? project.project_name : "—")}</td>
          <td>${escapeHtml(material ? material.material_code + " — " + material.material_name : "—")}</td>
          <td class="num">${fmtNumber(r.planned_qty)}</td>
          <td class="num">${fmtNumber(r.received_qty)}</td>
          <td style="min-width:140px">
            <div style="width:100%;height:6px;background:var(--gray2);border-radius:4px;overflow:hidden">
              <div style="height:100%;width:${Math.min(pct, 100)}%;background:${color}"></div>
            </div>
            <div style="font-size:11px;color:var(--gray5);margin-top:3px">${pct}%</div>
          </td>
        </tr>`;
      })
      .join("");

    body.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Dự trù số lượng vật tư (${(data || []).length})</h3>
          ${this.canWrite() ? `<button class="btn btn-primary btn-sm" onclick="NganSach.openPlanModal()">+ Thêm / điều chỉnh dự trù</button>` : ""}
        </div>
        ${
          data && data.length
            ? `<table><thead><tr><th>Dự án</th><th>Vật tư</th><th>SL dự trù</th><th>SL đã nhận</th><th>% đã dùng</th></tr></thead><tbody>${rows}</tbody></table>`
            : emptyStateHtml("Chưa có dự trù nào.")
        }
      </div>`;
  },

  openPlanModal() {
    openModal({
      title: "Thêm / điều chỉnh dự trù",
      bodyHtml: `
        <div class="field">
          <label>Dự án</label>
          <select id="pl-project">${STATE.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.project_name)}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label>Vật tư</label>
          <input id="pl-material" list="pl-material-list" placeholder="Gõ mã hoặc tên vật tư">
          <datalist id="pl-material-list">${STATE.materials.map((m) => `<option value="${escapeHtml(m.material_code)} — ${escapeHtml(m.material_name)}">`).join("")}</datalist>
        </div>
        <div class="field"><label>Số lượng dự trù</label><input id="pl-qty" type="number" step="any" placeholder="0"></div>
        <div class="field"><label>Ngày hiệu lực</label><input id="pl-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>Ghi chú</label><textarea id="pl-note"></textarea></div>
        <div class="helper">Lưu sẽ tạo 1 version MỚI cho đúng cặp Dự án + Vật tư này — giữ nguyên lịch sử.</div>`,
      footerHtml: `
        <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="NganSach.savePlan()">Lưu</button>`,
    });
  },

  async savePlan() {
    const projectId = document.getElementById("pl-project").value;
    const materialVal = document.getElementById("pl-material").value;
    const material = STATE.materials.find((m) => materialVal.startsWith(m.material_code));
    const qty = parseFloat(document.getElementById("pl-qty").value);
    const date = document.getElementById("pl-date").value;
    const note = document.getElementById("pl-note").value.trim();
    if (!material) { toast("Chọn đúng 1 vật tư từ danh sách gợi ý", "error"); return; }
    if (!qty || qty <= 0) { toast("Nhập số lượng hợp lệ", "error"); return; }

    loading(true, "Đang tính version mới...");
    const { data: existing } = await sb
      .from("material_plans")
      .select("version")
      .eq("project_id", projectId)
      .eq("material_id", material.id)
      .order("version", { ascending: false })
      .limit(1);
    const nextVersion = existing && existing.length ? existing[0].version + 1 : 1;

    const { error } = await sb.from("material_plans").insert({
      project_id: projectId,
      material_id: material.id,
      planned_qty: qty,
      version: nextVersion,
      effective_date: date,
      note: note || null,
      created_by: STATE.user.id,
    });
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    toast(`Đã lưu dự trù (version ${nextVersion})!`, "success");
    closeModal();
    this.renderActiveTab();
  },
};

window.MODULES.ngansach = { render: (container) => NganSach.render(container) };
window.NganSach = NganSach;
