/* ============================================================
   js/modules/ngansach.js
   Ngân sách CHỈ nhập ở LEVEL 3 (1 vật tư cụ thể) — Level 1/2 KHÔNG
   còn nhập tay, tự cộng dồn từ các Level 3 bên dưới (tính trong view
   v_budget_summary, không phải cộng ở đây). Thiếu vật tư cụ thể nào
   thì tạo thêm 1 vật tư dạng "X khác" ở đúng nhóm Level 2 đó (qua
   Danh mục) để có chỗ điền số.

   Số tiền = Số lượng x Đơn giá dự toán — TÍNH TỰ ĐỘNG (cột generated
   trong DB), không nhập tay 2 số riêng để tránh lệch nhau.
   CHỈ admin/manager tạo/sửa (luôn tạo version mới, giữ lịch sử).
   ============================================================ */

const NganSach = {
  async render(container) {
    container.innerHTML = `<h2>Ngân sách &amp; Dự trù</h2><div id="ns-body"></div>`;
    await this.renderList();
  },

  canWrite() {
    return STATE.role === "admin" || STATE.role === "manager";
  },

  async renderList() {
    const body = document.getElementById("ns-body");
    body.innerHTML = `<div class="card">${emptyStateHtml("Đang tải...")}</div>`;
    loading(true, "Đang tải ngân sách & dự trù...");
    const { data, error } = await sb.from("v_budget_alert").select("*").order("project_name").order("l1_name").order("l2_name").order("material_code");
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }

    const rows = (data || [])
      .map((r) => {
        const path =
          r.level === 1
            ? `<strong>${escapeHtml(r.l1_name)}</strong>`
            : r.level === 2
            ? `${escapeHtml(r.l1_name)} &rsaquo; <strong>${escapeHtml(r.l2_name)}</strong>`
            : `${escapeHtml(r.l1_name)} &rsaquo; ${escapeHtml(r.l2_name)} &rsaquo; <strong>${escapeHtml(r.material_code)} — ${escapeHtml(r.material_name)}</strong>`;

        const moneyCell =
          r.budget_amount != null
            ? `<div>${fmtMoney(r.committed_amount)} / ${fmtMoney(r.budget_amount)}</div>
               <div class="bar-track" style="width:100%;height:6px;background:var(--gray2);border-radius:4px;overflow:hidden;margin-top:3px">
                 <div style="height:100%;width:${Math.min(r.pct_used || 0, 100)}%;background:${this.alertColor(r.alert_level)}"></div>
               </div>
               <div style="font-size:11px;color:var(--gray5);margin-top:2px">${r.pct_used || 0}%</div>`
            : '<span class="badge badge-none">Chưa có Level 3 nào</span>';

        const qtyCell =
          r.planned_qty != null
            ? `<div>${fmtNumber(r.received_qty)} / ${fmtNumber(r.planned_qty)}</div>
               <div style="font-size:11px;color:var(--gray5)">${r.pct_received || 0}%</div>`
            : r.level === 3
            ? '<span class="badge badge-none">—</span>'
            : '<span class="badge badge-none">Khác đơn vị, không cộng SL</span>';

        return `<tr>
          <td>${escapeHtml(r.project_name)}</td>
          <td>${path}</td>
          <td>${moneyCell}</td>
          <td>${qtyCell}</td>
          <td>${r.alert_level ? budgetAlertBadge(r.alert_level) : ""}</td>
        </tr>`;
      })
      .join("");

    body.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Phân bổ ngân sách/dự trù (${(data || []).length})</h3>
          ${this.canWrite() ? `<button class="btn btn-primary btn-sm" onclick="NganSach.openModal()">+ Thêm vật tư vào ngân sách</button>` : ""}
        </div>
        <div class="helper" style="margin-bottom:10px">
          Chỉ nhập ở cấp vật tư cụ thể (Level 3) — Level 1/Level 2 hiện ở đây là <strong>tự cộng dồn</strong> từ các vật tư bên dưới,
          không nhập tay. Thiếu vật tư nào thì tạo 1 vật tư dạng "X khác" ở Danh mục trong đúng nhóm để có chỗ điền số.
        </div>
        ${
          data && data.length
            ? `<table><thead><tr><th>Dự án</th><th>Nhóm / Vật tư</th><th>Tiền (đã dùng / ngân sách)</th><th>SL (đã nhận / dự trù)</th><th>Trạng thái</th></tr></thead><tbody>${rows}</tbody></table>`
            : emptyStateHtml("Chưa có phân bổ nào.")
        }
      </div>`;
  },

  alertColor(level) {
    return { ok: "var(--green)", warning_70: "var(--amber)", critical_85: "var(--orange)", over_budget: "var(--red)" }[level] || "var(--gray3)";
  },

  openModal() {
    if (!STATE.materials.length) { toast("Chưa có vật tư nào — tạo ở Danh mục trước", "error"); return; }
    openModal({
      title: "Thêm vật tư vào ngân sách",
      bodyHtml: `
        <div class="field">
          <label>Dự án</label>
          <select id="ns-project">${STATE.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.project_name)}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label>Vật tư</label>
          ${searchableSelectHtml("ns-material-ssel", "Gõ mã hoặc tên vật tư... (chưa có thì tạo 'X khác' ở Danh mục trước)")}
        </div>
        <div class="field"><label>Số lượng dự trù</label><input id="ns-qty" placeholder="0"></div>
        <div class="field"><label>Đơn giá dự toán</label><input id="ns-price" placeholder="0"></div>
        <div class="field">
          <label>Thành tiền (tự tính)</label>
          <input id="ns-amount-preview" disabled placeholder="0 đ" style="background:var(--gray1);color:var(--gray7);font-weight:600">
        </div>
        <div class="field"><label>Ngày hiệu lực</label><input id="ns-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>Ghi chú (lý do điều chỉnh nếu có)</label><textarea id="ns-note"></textarea></div>
        <div class="helper">Lưu sẽ tạo 1 version MỚI cho đúng vật tư này trong dự án — không ghi đè version cũ, giữ nguyên lịch sử. Ngân sách Level 1/2 phía trên sẽ tự cộng thêm dòng này ngay.</div>`,
      footerHtml: `
        <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="NganSach.save()">Lưu</button>`,
    });
    initSearchableSelect("ns-material-ssel", this.materialGroupedOptions());
    attachNumberFormat("ns-qty");
    attachNumberFormat("ns-price");
    const updatePreview = () => {
      const qty = parseFormattedNumber("ns-qty");
      const price = parseFormattedNumber("ns-price");
      document.getElementById("ns-amount-preview").value = isNaN(qty) || isNaN(price) ? "" : fmtMoney(qty * price);
    };
    document.getElementById("ns-qty").addEventListener("input", updatePreview);
    document.getElementById("ns-price").addEventListener("input", updatePreview);
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

  async save() {
    const projectId = document.getElementById("ns-project").value;
    const materialId = getSearchableSelectValue("ns-material-ssel");
    const material = STATE.materials.find((m) => m.id === materialId);
    const qty = parseFormattedNumber("ns-qty");
    const price = parseFormattedNumber("ns-price");
    const date = document.getElementById("ns-date").value;
    const note = document.getElementById("ns-note").value.trim();

    if (!material) { toast("Chọn 1 vật tư trong danh mục", "error"); return; }
    if (!material.l2_id) { toast("Vật tư này chưa được gán nhóm Level 2 — vào Danh mục gán trước", "error"); return; }
    if (!qty || qty <= 0) { toast("Nhập số lượng dự trù hợp lệ", "error"); return; }
    if (!price || price <= 0) { toast("Nhập đơn giá dự toán hợp lệ", "error"); return; }

    loading(true, "Đang tính version mới...");
    const { data: existing } = await sb
      .from("budget_allocations")
      .select("version")
      .eq("project_id", projectId)
      .eq("material_id", materialId)
      .order("version", { ascending: false })
      .limit(1);
    const nextVersion = existing && existing.length ? existing[0].version + 1 : 1;

    const l2 = STATE.materialGroupsL2.find((g) => g.id === material.l2_id);

    const { error } = await sb.from("budget_allocations").insert({
      project_id: projectId,
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
    closeModal();
    this.renderList();
  },
};

window.MODULES.ngansach = { render: (container) => NganSach.render(container) };
window.NganSach = NganSach;
