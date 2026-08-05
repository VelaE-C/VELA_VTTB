/* ============================================================
   js/modules/ngansach.js
   Ngân sách (tiền) + Dự trù (số lượng) GỘP LÀM 1 — mỗi dòng phân bổ
   (budget_allocations) gắn ĐÚNG 1 CẤP trong cây 3 cấp: Level 1
   (Kết cấu/Hoàn Thiện/Vật Tư Phụ), Level 2 (Gạch xây/Cát/Đá...),
   hoặc Level 3 (1 vật tư cụ thể). Chi phí/SL thực tế tự cộng dồn từ
   mọi vật tư nằm dưới nhánh đã chọn (qua v_budget_alert).
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
            : '<span class="badge badge-none">Không theo dõi tiền</span>';

        const qtyCell =
          r.planned_qty != null
            ? `<div>${fmtNumber(r.received_qty)} / ${fmtNumber(r.planned_qty)}</div>
               <div style="font-size:11px;color:var(--gray5)">${r.pct_received || 0}%</div>`
            : '<span class="badge badge-none">Không theo dõi SL</span>';

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
          ${this.canWrite() ? `<button class="btn btn-primary btn-sm" onclick="NganSach.openModal()">+ Thêm phân bổ</button>` : ""}
        </div>
        <div class="helper" style="margin-bottom:10px">Mỗi dòng gắn đúng 1 cấp (Level 1/2/3) — chi phí/số lượng thực tế tự cộng dồn từ mọi vật tư nằm dưới nhánh đó.</div>
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
    if (!STATE.materialGroupsL1.length) { toast("Chưa có nhóm Level 1 nào — tạo ở Danh mục trước", "error"); return; }
    openModal({
      title: "Thêm phân bổ ngân sách/dự trù",
      bodyHtml: `
        <div class="field">
          <label>Dự án</label>
          <select id="ns-project">${STATE.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.project_name)}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label>Cấp phân bổ</label>
          <select id="ns-level" onchange="NganSach.onLevelChange()">
            <option value="1">Level 1 (nhóm lớn)</option>
            <option value="2">Level 2 (nhóm giữa)</option>
            <option value="3">Level 3 (1 vật tư cụ thể)</option>
          </select>
        </div>
        <div class="field">
          <label>Level 1</label>
          <select id="ns-l1" onchange="NganSach.onL1Change()">${STATE.materialGroupsL1.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("")}</select>
        </div>
        <div class="field" id="ns-l2-wrap" style="display:none">
          <label>Level 2</label>
          <select id="ns-l2" onchange="NganSach.onL2Change()"></select>
        </div>
        <div class="field" id="ns-material-wrap" style="display:none">
          <label>Vật tư</label>
          <select id="ns-material"></select>
        </div>
        <div class="field"><label>Ngân sách (tiền) — để trống nếu không theo dõi tiền ở cấp này</label><input id="ns-amount" placeholder="0"></div>
        <div class="field"><label>Dự trù (số lượng) — để trống nếu không theo dõi số lượng ở cấp này</label><input id="ns-qty" placeholder="0"></div>
        <div class="field"><label>Ngày hiệu lực</label><input id="ns-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>Ghi chú (lý do điều chỉnh nếu có)</label><textarea id="ns-note"></textarea></div>
        <div class="helper">Lưu sẽ tạo 1 version MỚI cho đúng node đã chọn — không ghi đè version cũ, giữ nguyên lịch sử.</div>`,
      footerHtml: `
        <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="NganSach.save()">Lưu</button>`,
    });
    this.onLevelChange();
    attachNumberFormat("ns-amount");
    attachNumberFormat("ns-qty");
  },

  onLevelChange() {
    const level = document.getElementById("ns-level").value;
    document.getElementById("ns-l2-wrap").style.display = level >= 2 ? "flex" : "none";
    document.getElementById("ns-material-wrap").style.display = level >= 3 ? "flex" : "none";
    if (level >= 2) this.onL1Change();
  },

  onL1Change() {
    const l1Id = document.getElementById("ns-l1").value;
    const l2Sel = document.getElementById("ns-l2");
    const options = STATE.materialGroupsL2.filter((g) => g.l1_id === l1Id);
    l2Sel.innerHTML = options.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
    if (document.getElementById("ns-level").value >= 3) this.onL2Change();
  },

  onL2Change() {
    const l2Id = document.getElementById("ns-l2").value;
    const materialSel = document.getElementById("ns-material");
    const options = STATE.materials.filter((m) => m.l2_id === l2Id);
    materialSel.innerHTML = options.length
      ? options.map((m) => `<option value="${m.id}">${escapeHtml(m.material_code)} — ${escapeHtml(m.material_name)}</option>`).join("")
      : `<option value="">— Chưa có vật tư nào trong nhóm này —</option>`;
  },

  async save() {
    const projectId = document.getElementById("ns-project").value;
    const level = parseInt(document.getElementById("ns-level").value, 10);
    const l1Id = document.getElementById("ns-l1").value;
    const l2Id = level >= 2 ? document.getElementById("ns-l2").value : null;
    const materialId = level >= 3 ? document.getElementById("ns-material").value : null;
    const amount = parseFormattedNumber("ns-amount");
    const qty = parseFormattedNumber("ns-qty");
    const date = document.getElementById("ns-date").value;
    const note = document.getElementById("ns-note").value.trim();

    if (level >= 3 && !materialId) { toast("Nhóm Level 2 này chưa có vật tư nào — thêm vật tư ở Danh mục trước", "error"); return; }
    if (isNaN(amount) && isNaN(qty)) { toast("Nhập ít nhất 1 trong 2: ngân sách tiền hoặc dự trù số lượng", "error"); return; }

    loading(true, "Đang tính version mới...");
    let q = sb.from("budget_allocations").select("version").eq("project_id", projectId).eq("level", level).eq("l1_id", l1Id);
    q = level >= 2 ? q.eq("l2_id", l2Id) : q.is("l2_id", null);
    q = level >= 3 ? q.eq("material_id", materialId) : q.is("material_id", null);
    const { data: existing } = await q.order("version", { ascending: false }).limit(1);
    const nextVersion = existing && existing.length ? existing[0].version + 1 : 1;

    const { error } = await sb.from("budget_allocations").insert({
      project_id: projectId,
      level,
      l1_id: l1Id,
      l2_id: l2Id,
      material_id: materialId,
      budget_amount: isNaN(amount) ? null : amount,
      planned_qty: isNaN(qty) ? null : qty,
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
