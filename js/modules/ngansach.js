/* ============================================================
   js/modules/ngansach.js
   Ngân sách CHỈ nhập ở LEVEL 3 (1 vật tư cụ thể) — Level 1/2 KHÔNG
   còn nhập tay, tự cộng dồn từ các Level 3 bên dưới. Thiếu vật tư cụ
   thể nào thì tạo thêm 1 vật tư dạng "X khác" ở đúng nhóm Level 2 đó
   (qua Danh mục) để có chỗ điền số.

   CẤU TRÚC: trang chính chỉ liệt kê DỰ ÁN (kèm tóm tắt từng nhóm lớn
   Level 1 bên dưới tên) — bấm vào 1 dự án mở 1 MODAL RIÊNG (giống
   "Chi tiết phiên nhận xe") chứa cây Level 1->2->3 (thu gọn/mở rộng)
   CỦA ĐÚNG DỰ ÁN ĐÓ, kèm form "Thêm/Sửa vật tư" nằm NGAY TRONG modal
   đó (không phải modal con tách riêng) — giống cách Phiếu giao nhận
   hiện riêng cho từng xe. Modal chỉ đóng bằng nút ✕.

   Số tiền = Số lượng x Đơn giá dự toán — TÍNH TỰ ĐỘNG, không nhập tay
   2 số riêng để tránh lệch nhau. CHỈ admin/manager tạo/sửa (luôn tạo
   version mới, giữ lịch sử).
   ============================================================ */

const NganSach = {
  allAlerts: [],
  currentProjectId: null,
  currentProjectName: "",
  expandedL1: new Set(),
  expandedL2: new Set(),
  editingRow: null,

  async render(container) {
    container.innerHTML = `<h2>Ngân sách &amp; Dự trù</h2><div id="ns-body"></div>`;
    await this.loadAndRenderProjects();
  },

  canWrite() {
    return STATE.role === "admin" || STATE.role === "manager";
  },

  async fetchAlerts() {
    const { data, error } = await sb.from("v_budget_alert").select("*").order("project_name").order("l1_name").order("l2_name").order("material_code");
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    this.allAlerts = data || [];
  },

  async loadAndRenderProjects() {
    const body = document.getElementById("ns-body");
    body.innerHTML = `<div class="card">${emptyStateHtml("Đang tải...")}</div>`;
    loading(true, "Đang tải ngân sách & dự trù...");
    await this.fetchAlerts();
    loading(false);
    this.renderProjectList();
  },

  renderProjectList() {
    const body = document.getElementById("ns-body");
    const byProject = {};
    this.allAlerts
      .filter((r) => r.level === 1)
      .forEach((r) => {
        byProject[r.project_id] = byProject[r.project_id] || { projectId: r.project_id, projectName: r.project_name, l1Rows: [], totalBudget: 0, totalCommitted: 0 };
        byProject[r.project_id].l1Rows.push(r);
        byProject[r.project_id].totalBudget += r.budget_amount || 0;
        byProject[r.project_id].totalCommitted += r.committed_amount || 0;
      });
    const projectRows = Object.values(byProject);

    const rows = projectRows
      .map((p) => {
        const pct = p.totalBudget ? Math.round((p.totalCommitted / p.totalBudget) * 1000) / 10 : 0;
        const level = pct >= 100 ? "over_budget" : pct >= 85 ? "critical_85" : pct >= 70 ? "warning_70" : "ok";
        const l1Summary = p.l1Rows
          .map((r) => `<span class="badge badge-none" style="margin:2px 4px 2px 0">${escapeHtml(r.l1_name)}: ${r.budget_amount != null ? r.pct_used + "%" : "chưa có"}</span>`)
          .join("");
        return `<tr style="cursor:pointer" onclick="NganSach.openProjectModal('${p.projectId}', '${escapeHtml(p.projectName).replace(/'/g, "&#39;")}')">
          <td>
            <div><strong>${escapeHtml(p.projectName)}</strong></div>
            <div style="margin-top:4px">${l1Summary}</div>
          </td>
          <td class="num">${fmtMoney(p.totalCommitted)} / ${fmtMoney(p.totalBudget)}</td>
          <td class="num">${pct}%</td>
          <td>${budgetAlertBadge(level)}</td>
          <td><button class="btn btn-sm btn-secondary">Xem chi tiết</button></td>
        </tr>`;
      })
      .join("");

    body.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Ngân sách theo dự án (${projectRows.length})</h3></div>
        <div class="helper" style="margin-bottom:10px">Bấm vào 1 dự án để xem chi tiết theo từng nhóm và thêm/sửa vật tư.</div>
        ${
          projectRows.length
            ? `<table><thead><tr><th>Dự án</th><th>Tổng (đã dùng / ngân sách)</th><th>%</th><th>Trạng thái</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
            : emptyStateHtml("Chưa có phân bổ nào.")
        }
      </div>`;
  },

  openProjectModal(projectId, projectName) {
    this.currentProjectId = projectId;
    this.currentProjectName = projectName;
    this.expandedL1 = new Set();
    this.expandedL2 = new Set();
    this.editingRow = null;
    openModal({
      titleHtml: `<span style="font-size:19px;color:var(--red);font-weight:700">Dự án ${escapeHtml(projectName)}</span>`,
      bodyHtml: this.buildProjectModalBody(),
      wide: true,
      preventBackdropClose: true,
      onClose: () => this.loadAndRenderProjects(),
    });
    this.initProjectModalWidgets();
  },

  refreshProjectModal() {
    const modalBody = document.querySelector("#active-modal .modal-body");
    if (!modalBody) return;
    modalBody.innerHTML = this.buildProjectModalBody();
    this.initProjectModalWidgets();
  },

  buildProjectModalBody() {
    const pid = this.currentProjectId;
    const level1Rows = this.allAlerts.filter((r) => r.level === 1 && r.project_id === pid);

    let treeHtml = "";
    level1Rows.forEach((r1) => {
      const open1 = this.expandedL1.has(r1.l1_name);
      treeHtml += this.rowHtml({ indent: 0, toggle: true, open: open1, onClick: `NganSach.toggleL1('${this.esc(r1.l1_name)}')`, label: `<strong>${escapeHtml(r1.l1_name)}</strong>`, r: r1 });

      if (open1) {
        const l2Rows = this.allAlerts.filter((r) => r.level === 2 && r.project_id === pid && r.l1_name === r1.l1_name);
        l2Rows.forEach((r2) => {
          const key2 = `${r2.l1_name}|${r2.l2_name}`;
          const open2 = this.expandedL2.has(key2);
          treeHtml += this.rowHtml({ indent: 1, toggle: true, open: open2, onClick: `NganSach.toggleL2('${this.esc(key2)}')`, label: `<strong>${escapeHtml(r2.l2_name)}</strong>`, r: r2 });

          if (open2) {
            const l3Rows = this.allAlerts.filter((r) => r.level === 3 && r.project_id === pid && r.l1_name === r2.l1_name && r.l2_name === r2.l2_name);
            if (!l3Rows.length) treeHtml += `<tr><td colspan="5" style="padding-left:56px;color:var(--gray5);font-size:12.5px">Chưa có vật tư nào.</td></tr>`;
            l3Rows.forEach((r3) => {
              treeHtml += this.rowHtml({ indent: 2, toggle: false, label: `${escapeHtml(r3.material_code)} — ${escapeHtml(r3.material_name)}`, r: r3, actions: true });
            });
          }
        });
        if (!l2Rows.length) treeHtml += `<tr><td colspan="5" style="padding-left:36px;color:var(--gray5);font-size:12.5px">Chưa có nhóm Level 2 nào.</td></tr>`;
      }
    });

    const treeSection = level1Rows.length
      ? `<table><thead><tr><th>Nhóm / Vật tư</th><th>Tiền (đã dùng / ngân sách)</th><th>SL (đã nhận / dự trù)</th><th>Trạng thái</th><th></th></tr></thead><tbody>${treeHtml}</tbody></table>`
      : emptyStateHtml("Dự án này chưa có ngân sách nào.");

    const canWrite = this.canWrite();
    const ed = this.editingRow;

    return `
      <div class="card">
        <h3>Chi tiết theo nhóm</h3>
        ${treeSection}
      </div>
      ${
        canWrite
          ? `<div class="card">
              <div class="card-header">
                <h3>${ed ? `Sửa — ${escapeHtml(ed.material_code)}` : "Thêm vật tư vào ngân sách"}</h3>
                ${ed ? `<button class="btn btn-sm btn-secondary" onclick="NganSach.cancelEdit()">Hủy sửa, thêm mới</button>` : ""}
              </div>
              <div class="form-grid">
                <div class="field full">
                  <label>Vật tư</label>
                  ${searchableSelectHtml("ns-material-ssel", "Gõ mã hoặc tên vật tư... (chưa có thì tạo 'X khác' ở Danh mục trước)")}
                  ${ed ? '<div class="helper">Không đổi được vật tư khi sửa — muốn đổi thì hủy sửa, thêm mới đúng vật tư.</div>' : ""}
                </div>
                <div class="field"><label>Số lượng dự trù</label><input id="ns-qty" placeholder="0" value="${ed ? fmtNumber(ed.planned_qty) : ""}"></div>
                <div class="field"><label>Đơn giá dự toán</label><input id="ns-price" placeholder="0" value="${ed && ed.budget_unit_price != null ? fmtNumber(ed.budget_unit_price) : ""}"></div>
                <div class="field">
                  <label>Thành tiền (tự tính)</label>
                  <input id="ns-amount-preview" disabled placeholder="0 đ" style="background:var(--gray1);color:var(--gray7);font-weight:600" value="${ed ? fmtMoney(ed.budget_amount) : ""}">
                </div>
                <div class="field"><label>Ngày hiệu lực</label>${dateInputHtml("ns-date", new Date().toISOString().slice(0, 10))}</div>
                <div class="field full"><label>Ghi chú (lý do điều chỉnh nếu có)</label><textarea id="ns-note">${ed ? escapeHtml(ed.note || "") : ""}</textarea></div>
              </div>
              <div class="helper" style="margin-bottom:8px">Lưu sẽ tạo 1 version MỚI cho đúng vật tư này — không ghi đè version cũ, giữ nguyên lịch sử.</div>
              <button class="btn btn-primary" onclick="NganSach.save()">Lưu</button>
            </div>`
          : ""
      }`;
  },

  initProjectModalWidgets() {
    initSearchableSelect("ns-material-ssel", this.materialGroupedOptions(), { onSelect: () => {} });
    initDateInput("ns-date");
    if (this.editingRow) {
      const material = STATE.materials.find((m) => m.material_code === this.editingRow.material_code);
      if (material) {
        const input = document.querySelector("#ns-material-ssel .ssel-input");
        const hidden = document.querySelector("#ns-material-ssel .ssel-value");
        input.value = `${material.material_code} — ${material.material_name}`;
        hidden.value = material.id;
        input.disabled = true;
      }
    }
    attachNumberFormat("ns-qty");
    attachNumberFormat("ns-price");
    const updatePreview = () => {
      const qty = parseFormattedNumber("ns-qty");
      const price = parseFormattedNumber("ns-price");
      const el = document.getElementById("ns-amount-preview");
      if (el) el.value = isNaN(qty) || isNaN(price) ? "" : fmtMoney(qty * price);
    };
    const qtyEl = document.getElementById("ns-qty");
    const priceEl = document.getElementById("ns-price");
    if (qtyEl) qtyEl.addEventListener("input", updatePreview);
    if (priceEl) priceEl.addEventListener("input", updatePreview);
  },

  rowHtml({ indent, toggle, open, onClick, label, r, actions }) {
    const pad = 16 + indent * 24;
    const arrow = toggle ? `<span style="display:inline-block;width:14px;color:var(--gray5)">${open ? "▾" : "▸"}</span>` : `<span style="display:inline-block;width:14px"></span>`;
    const qtyCell =
      r.level === 3 && r.planned_qty != null
        ? `<div>${fmtNumber(r.received_qty)} / ${fmtNumber(r.planned_qty)}</div><div style="font-size:11px;color:var(--gray5)">${r.pct_received || 0}%</div>`
        : r.level === 3
        ? '<span class="badge badge-none">—</span>'
        : "";

    const actionsCell = actions
      ? `<div class="table-actions">
          ${this.canWrite() ? `<button class="btn btn-sm btn-secondary" onclick='event.stopPropagation();NganSach.startEdit(${JSON.stringify(r).replace(/'/g, "&#39;")})'>Sửa</button>` : ""}
          ${STATE.role === "admin" ? `<button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();NganSach.deleteRow('${r.material_code}')">Xóa</button>` : ""}
        </div>`
      : "";

    return `<tr${toggle ? ` style="cursor:pointer" onclick="${onClick}"` : ""}>
      <td style="padding-left:${pad}px">${arrow}${label}</td>
      <td>${this.moneyCellHtml(r)}</td>
      <td>${qtyCell}</td>
      <td>${r.alert_level ? budgetAlertBadge(r.alert_level) : ""}</td>
      <td>${actionsCell}</td>
    </tr>`;
  },

  esc(s) {
    return s.replace(/'/g, "\\'");
  },
  toggleL1(name) {
    if (this.expandedL1.has(name)) this.expandedL1.delete(name);
    else this.expandedL1.add(name);
    this.refreshProjectModal();
  },
  toggleL2(key) {
    if (this.expandedL2.has(key)) this.expandedL2.delete(key);
    else this.expandedL2.add(key);
    this.refreshProjectModal();
  },

  moneyCellHtml(r) {
    if (r.budget_amount == null) return '<span class="badge badge-none">Chưa có vật tư nào</span>';
    return `<div>${fmtMoney(r.committed_amount)} / ${fmtMoney(r.budget_amount)}</div>
      <div class="bar-track" style="width:100%;height:6px;background:var(--gray2);border-radius:4px;overflow:hidden;margin-top:3px">
        <div style="height:100%;width:${Math.min(r.pct_used || 0, 100)}%;background:${this.alertColor(r.alert_level)}"></div>
      </div>
      <div style="font-size:11px;color:var(--gray5);margin-top:2px">${r.pct_used || 0}%</div>`;
  },
  alertColor(level) {
    return { ok: "var(--green)", warning_70: "var(--amber)", critical_85: "var(--orange)", over_budget: "var(--red)" }[level] || "var(--gray3)";
  },

  materialGroupedOptions() {
    const l2ById = {};
    STATE.materialGroupsL2.forEach((g) => { l2ById[g.id] = g; });
    const l1ById = {};
    STATE.materialGroupsL1.forEach((g) => { l1ById[g.id] = g; });
    const label = (m) => `${m.material_code} — ${m.material_name}`;
    const byGroup = {};
    const noGroup = [];
    STATE.materials.forEach((m) => {
      const l2 = l2ById[m.l2_id];
      const l1 = l2 ? l1ById[l2.l1_id] : null;
      if (!l2 || !l1) { noGroup.push(m); return; }
      const key = `${l1.name} › ${l2.name}`;
      byGroup[key] = byGroup[key] || [];
      byGroup[key].push(m);
    });
    const groups = Object.keys(byGroup)
      .sort()
      .map((key) => ({ groupLabel: key, items: byGroup[key].sort((a, b) => a.material_code.localeCompare(b.material_code)).map((m) => ({ value: m.id, label: label(m) })) }));
    if (noGroup.length) groups.push({ groupLabel: "Chưa gán nhóm (vào Danh mục gán trước)", items: noGroup.map((m) => ({ value: m.id, label: label(m) })) });
    return groups;
  },

  startEdit(row) {
    this.editingRow = row;
    this.refreshProjectModal();
  },
  cancelEdit() {
    this.editingRow = null;
    this.refreshProjectModal();
  },

  async save() {
    const materialId = getSearchableSelectValue("ns-material-ssel");
    const material = STATE.materials.find((m) => m.id === materialId);
    const qty = parseFormattedNumber("ns-qty");
    const price = parseFormattedNumber("ns-price");
    const date = getDateInputValue("ns-date");
    const note = document.getElementById("ns-note").value.trim();

    if (!material) { toast("Chọn 1 vật tư trong danh mục", "error"); return; }
    if (!material.l2_id) { toast("Vật tư này chưa được gán nhóm Level 2 — vào Danh mục gán trước", "error"); return; }
    if (!qty || qty <= 0) { toast("Nhập số lượng dự trù hợp lệ", "error"); return; }
    if (!price || price <= 0) { toast("Nhập đơn giá dự toán hợp lệ", "error"); return; }

    loading(true, "Đang tính version mới...");
    const { data: existingVersions } = await sb
      .from("budget_allocations")
      .select("version")
      .eq("project_id", this.currentProjectId)
      .eq("material_id", materialId)
      .order("version", { ascending: false })
      .limit(1);
    const nextVersion = existingVersions && existingVersions.length ? existingVersions[0].version + 1 : 1;
    const l2 = STATE.materialGroupsL2.find((g) => g.id === material.l2_id);

    const { error } = await sb.from("budget_allocations").insert({
      project_id: this.currentProjectId,
      level: 3,
      l1_id: l2 ? l2.l1_id : null,
      l2_id: material.l2_id,
      material_id: materialId,
      planned_qty: qty,
      budget_unit_price: price,
      version: nextVersion,
      effective_date: date,
      note: note || null,
      created_by: STATE.user.id,
    });
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    toast(`Đã lưu (version ${nextVersion})!`, "success");
    this.editingRow = null;
    await this.fetchAlerts();
    this.refreshProjectModal();
  },

  async deleteRow(materialCode) {
    if (!confirm(`Xóa toàn bộ ngân sách (mọi lần điều chỉnh) của vật tư "${materialCode}" trong dự án này? Không thể khôi phục.`)) return;
    const material = STATE.materials.find((m) => m.material_code === materialCode);
    if (!material) { toast("Không tìm thấy vật tư", "error"); return; }
    loading(true, "Đang xóa...");
    const { error } = await sb.from("budget_allocations").delete().eq("project_id", this.currentProjectId).eq("material_id", material.id);
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    toast("Đã xóa!", "success");
    await this.fetchAlerts();
    this.refreshProjectModal();
  },
};

window.MODULES.ngansach = { render: (container) => NganSach.render(container) };
window.NganSach = NganSach;
