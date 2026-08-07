/* ============================================================
   js/modules/ngansach.js
   Ngân sách CHỈ nhập ở LEVEL 3 (1 vật tư cụ thể) — Level 1/2 KHÔNG
   còn nhập tay, tự cộng dồn từ các Level 3 bên dưới. Thiếu vật tư cụ
   thể nào thì tạo thêm 1 vật tư dạng "X khác" ở đúng nhóm Level 2 đó
   (qua Danh mục) để có chỗ điền số.

   Hiển thị dạng CÂY THU GỌN/MỞ RỘNG trong 1 bảng duy nhất (accordion) —
   bấm vào dòng Level 1 để mở ra các dòng Level 2 thụt vào bên dưới,
   bấm dòng Level 2 mở tiếp Level 3 (nơi có nút Sửa/Xóa). Cuộn để xem,
   KHÔNG dùng modal lồng nhau nữa.
   ============================================================ */

const NganSach = {
  allAlerts: [],
  expandedL1: new Set(), // key: "projectId|l1Name"
  expandedL2: new Set(), // key: "projectId|l1Name|l2Name"

  async render(container) {
    container.innerHTML = `<h2>Ngân sách &amp; Dự trù</h2><div id="ns-body"></div>`;
    await this.loadAndRender();
  },

  canWrite() {
    return STATE.role === "admin" || STATE.role === "manager";
  },

  async loadAndRender() {
    const body = document.getElementById("ns-body");
    body.innerHTML = `<div class="card">${emptyStateHtml("Đang tải...")}</div>`;
    loading(true, "Đang tải ngân sách & dự trù...");
    const { data, error } = await sb.from("v_budget_alert").select("*").order("project_name").order("l1_name").order("l2_name").order("material_code");
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    this.allAlerts = data || [];
    this.renderTree();
  },

  renderTree() {
    const body = document.getElementById("ns-body");
    const level1Rows = this.allAlerts.filter((r) => r.level === 1);

    let rowsHtml = "";
    level1Rows.forEach((r1) => {
      const key1 = `${r1.project_id}|${r1.l1_name}`;
      const open1 = this.expandedL1.has(key1);
      rowsHtml += this.rowHtml({
        indent: 0,
        toggle: true,
        open: open1,
        onClick: `NganSach.toggleL1('${this.esc(key1)}')`,
        label: `<strong>${escapeHtml(r1.l1_name)}</strong>`,
        projectName: r1.project_name,
        r: r1,
      });

      if (open1) {
        const l2Rows = this.allAlerts.filter((r) => r.level === 2 && r.project_id === r1.project_id && r.l1_name === r1.l1_name);
        l2Rows.forEach((r2) => {
          const key2 = `${r2.project_id}|${r2.l1_name}|${r2.l2_name}`;
          const open2 = this.expandedL2.has(key2);
          rowsHtml += this.rowHtml({
            indent: 1,
            toggle: true,
            open: open2,
            onClick: `NganSach.toggleL2('${this.esc(key2)}')`,
            label: `<strong>${escapeHtml(r2.l2_name)}</strong>`,
            projectName: "",
            r: r2,
          });

          if (open2) {
            const l3Rows = this.allAlerts.filter((r) => r.level === 3 && r.project_id === r2.project_id && r.l1_name === r2.l1_name && r.l2_name === r2.l2_name);
            if (!l3Rows.length) {
              rowsHtml += `<tr><td colspan="5" style="padding-left:56px;color:var(--gray5);font-size:12.5px">Nhóm này chưa có vật tư nào có ngân sách.</td></tr>`;
            }
            l3Rows.forEach((r3) => {
              rowsHtml += this.rowHtml({
                indent: 2,
                toggle: false,
                label: `${escapeHtml(r3.material_code)} — ${escapeHtml(r3.material_name)}`,
                projectName: "",
                r: r3,
                actions: true,
              });
            });
          }
        });
        if (!l2Rows.length) {
          rowsHtml += `<tr><td colspan="5" style="padding-left:36px;color:var(--gray5);font-size:12.5px">Nhóm lớn này chưa có nhóm Level 2 nào có ngân sách.</td></tr>`;
        }
      }
    });

    body.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Phân bổ ngân sách/dự trù (${level1Rows.length} nhóm lớn)</h3>
          ${this.canWrite() ? `<button class="btn btn-primary btn-sm" onclick="NganSach.openEditModal()">+ Thêm vật tư vào ngân sách</button>` : ""}
        </div>
        <div class="helper" style="margin-bottom:10px">
          Bấm vào 1 dòng để mở/đóng nhánh bên dưới — cuộn để xem hết. Ngân sách chỉ nhập được ở vật tư cụ thể (dòng trong cùng) —
          các nhóm lớn hơn tự cộng dồn, không nhập tay.
        </div>
        ${
          level1Rows.length
            ? `<table><thead><tr><th>Dự án / Nhóm / Vật tư</th><th>Tiền (đã dùng / ngân sách)</th><th>SL (đã nhận / dự trù)</th><th>Trạng thái</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table>`
            : emptyStateHtml("Chưa có phân bổ nào.")
        }
      </div>`;
  },

  rowHtml({ indent, toggle, open, onClick, label, projectName, r, actions }) {
    const pad = 16 + indent * 24;
    const arrow = toggle ? `<span style="display:inline-block;width:14px;color:var(--gray5)">${open ? "▾" : "▸"}</span>` : `<span style="display:inline-block;width:14px"></span>`;
    const qtyCell =
      r.level === 3 && r.planned_qty != null
        ? `<div>${fmtNumber(r.received_qty)} / ${fmtNumber(r.planned_qty)}</div><div style="font-size:11px;color:var(--gray5)">${r.pct_received || 0}%</div>`
        : r.level === 3
        ? '<span class="badge badge-none">—</span>'
        : '<span class="badge badge-none">Khác đơn vị, không cộng SL</span>';

    const actionsCell = actions
      ? `<div class="table-actions">
          ${this.canWrite() ? `<button class="btn btn-sm btn-secondary" onclick='event.stopPropagation();NganSach.openEditModal(${JSON.stringify(r).replace(/'/g, "&#39;")})'>Sửa</button>` : ""}
          ${STATE.role === "admin" ? `<button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();NganSach.deleteRow('${r.project_id}', '${r.material_code}')">Xóa</button>` : ""}
        </div>`
      : "";

    return `<tr${toggle ? ` style="cursor:pointer" onclick="${onClick}"` : ""}>
      <td style="padding-left:${pad}px">${arrow}${projectName ? `<span style="color:var(--gray5);font-size:12px">${escapeHtml(projectName)} — </span>` : ""}${label}</td>
      <td>${this.moneyCellHtml(r)}</td>
      <td>${qtyCell}</td>
      <td>${r.alert_level ? budgetAlertBadge(r.alert_level) : ""}</td>
      <td>${actionsCell}</td>
    </tr>`;
  },

  esc(s) {
    return s.replace(/'/g, "\\'");
  },

  toggleL1(key) {
    if (this.expandedL1.has(key)) this.expandedL1.delete(key);
    else this.expandedL1.add(key);
    this.renderTree();
  },
  toggleL2(key) {
    if (this.expandedL2.has(key)) this.expandedL2.delete(key);
    else this.expandedL2.add(key);
    this.renderTree();
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

  openEditModal(existing) {
    if (!STATE.materials.length) { toast("Chưa có vật tư nào — tạo ở Danh mục trước", "error"); return; }
    const isEdit = !!existing;
    openModal({
      title: isEdit ? `Sửa — ${existing.material_code}` : "Thêm vật tư vào ngân sách",
      preventBackdropClose: true,
      bodyHtml: `
        <div class="field">
          <label>Dự án</label>
          <select id="ns-project" ${isEdit ? "disabled" : ""}>${STATE.projects.map((p) => `<option value="${p.id}" ${isEdit && p.project_name === existing.project_name ? "selected" : ""}>${escapeHtml(p.project_name)}</option>`).join("")}</select>
          ${isEdit ? '<div class="helper">Không đổi được dự án khi sửa — muốn chuyển dự án khác thì xóa dòng này, thêm mới ở dự án đúng.</div>' : ""}
        </div>
        <div class="field">
          <label>Vật tư</label>
          ${searchableSelectHtml("ns-material-ssel", "Gõ mã hoặc tên vật tư... (chưa có thì tạo 'X khác' ở Danh mục trước)")}
          ${isEdit ? '<div class="helper">Không đổi được vật tư khi sửa — muốn đổi thì xóa dòng này, thêm mới đúng vật tư.</div>' : ""}
        </div>
        <div class="field"><label>Số lượng dự trù</label><input id="ns-qty" placeholder="0" value="${isEdit ? fmtNumber(existing.planned_qty) : ""}"></div>
        <div class="field"><label>Đơn giá dự toán</label><input id="ns-price" placeholder="0" value="${isEdit && existing.budget_unit_price != null ? fmtNumber(existing.budget_unit_price) : ""}"></div>
        <div class="field">
          <label>Thành tiền (tự tính)</label>
          <input id="ns-amount-preview" disabled placeholder="0 đ" style="background:var(--gray1);color:var(--gray7);font-weight:600" value="${isEdit ? fmtMoney(existing.budget_amount) : ""}">
        </div>
        <div class="field"><label>Ngày hiệu lực</label><input id="ns-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>Ghi chú (lý do điều chỉnh nếu có)</label><textarea id="ns-note">${isEdit ? escapeHtml(existing.note || "") : ""}</textarea></div>
        <div class="helper">Lưu sẽ tạo 1 version MỚI cho đúng vật tư này trong dự án — không ghi đè version cũ, giữ nguyên lịch sử.</div>`,
      footerHtml: `
        <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="NganSach.save()">Lưu</button>`,
    });

    const groups = this.materialGroupedOptions();
    initSearchableSelect("ns-material-ssel", groups);
    if (isEdit) {
      const material = STATE.materials.find((m) => m.material_code === existing.material_code);
      if (material) {
        const input = document.querySelector("#ns-material-ssel .ssel-input");
        const hidden = document.querySelector("#ns-material-ssel .ssel-value");
        input.value = `${material.material_code} — ${material.material_name}`;
        hidden.value = material.id;
        input.disabled = true;
      }
      document.getElementById("ns-project").value = STATE.projects.find((p) => p.project_name === existing.project_name)?.id || "";
    }
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
    const { data: existingVersions } = await sb
      .from("budget_allocations")
      .select("version")
      .eq("project_id", projectId)
      .eq("material_id", materialId)
      .order("version", { ascending: false })
      .limit(1);
    const nextVersion = existingVersions && existingVersions.length ? existingVersions[0].version + 1 : 1;

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
    this.loadAndRender();
  },

  async deleteRow(projectId, materialCode) {
    if (!confirm(`Xóa toàn bộ ngân sách (mọi lần điều chỉnh) của vật tư "${materialCode}" trong dự án này? Không thể khôi phục.`)) return;
    const material = STATE.materials.find((m) => m.material_code === materialCode);
    if (!material) { toast("Không tìm thấy vật tư", "error"); return; }
    loading(true, "Đang xóa...");
    const { error } = await sb.from("budget_allocations").delete().eq("project_id", projectId).eq("material_id", material.id);
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    toast("Đã xóa!", "success");
    this.loadAndRender();
  },
};

window.MODULES.ngansach = { render: (container) => NganSach.render(container) };
window.NganSach = NganSach;
