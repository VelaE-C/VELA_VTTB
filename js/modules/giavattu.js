/* ============================================================
   js/modules/giavattu.js
   Báo cáo giá vật tư — tham khảo cho phòng Đấu thầu khi bỏ giá.
   Search theo vật tư -> lịch sử giá + % biến động -> xuất Excel.
   Không tạo tài khoản cho phòng Đấu thầu — chỉ export, đúng quyết định đã chốt.
   ============================================================ */

const GiaVatTu = {
  scope: "company", // company | project
  selectedMaterialId: null,
  currentData: [],

  async render(container) {
    container.innerHTML = `
      <h2>Báo cáo giá vật tư</h2>
      <div class="card">
        <div class="form-grid">
          <div class="field">
            <label>Tìm vật tư</label>
            <input id="gv-material" list="gv-material-list" placeholder="Gõ mã hoặc tên vật tư" onchange="GiaVatTu.onMaterialChange()">
            <datalist id="gv-material-list">${STATE.materials.map((m) => `<option value="${escapeHtml(m.material_code)} — ${escapeHtml(m.material_name)}">`).join("")}</datalist>
          </div>
          <div class="field">
            <label>Phạm vi</label>
            <select id="gv-scope" onchange="GiaVatTu.onScopeChange()">
              <option value="company">Toàn công ty</option>
              <option value="project">Theo 1 dự án</option>
            </select>
          </div>
          <div class="field" id="gv-project-wrap" style="display:none">
            <label>Dự án</label>
            <select id="gv-project" onchange="GiaVatTu.loadTrend()">${STATE.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.project_name)}</option>`).join("")}</select>
          </div>
        </div>
      </div>
      <div id="gv-body"></div>`;
  },

  onScopeChange() {
    this.scope = document.getElementById("gv-scope").value;
    document.getElementById("gv-project-wrap").style.display = this.scope === "project" ? "flex" : "none";
    if (this.selectedMaterialId) this.loadTrend();
  },

  onMaterialChange() {
    const val = document.getElementById("gv-material").value;
    const material = STATE.materials.find((m) => val.startsWith(m.material_code));
    if (!material) { toast("Chọn đúng 1 vật tư từ danh sách gợi ý", "error"); return; }
    this.selectedMaterialId = material.id;
    this.loadTrend();
  },

  async loadTrend() {
    if (!this.selectedMaterialId) return;
    const body = document.getElementById("gv-body");
    body.innerHTML = `<div class="card">${emptyStateHtml("Đang tải...")}</div>`;
    loading(true, "Đang tải lịch sử giá...");

    let query = sb.from("v_material_price_trend").select("*").eq("material_id", this.selectedMaterialId).order("receipt_date");
    if (this.scope === "project") {
      const projectId = document.getElementById("gv-project").value;
      query = query.eq("project_id", projectId);
    }
    const { data, error } = await query;
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }

    this.currentData = data || [];
    const material = STATE.materials.find((m) => m.id === this.selectedMaterialId);

    const rows = this.currentData
      .map((r) => {
        const pct = this.scope === "company" ? r.pct_change_any_project : this.computeProjectPct(r);
        const pctDisplay = pct === null || pct === undefined ? "—" : (pct > 0 ? "+" : "") + pct + "%";
        const pctColor = pct > 0 ? "var(--red)" : pct < 0 ? "var(--green)" : "var(--gray5)";
        return `<tr>
          <td>${fmtDate(r.receipt_date)}</td>
          <td>${escapeHtml(r.project_name)}</td>
          <td>${escapeHtml(r.supplier_name)}</td>
          <td class="num">${fmtMoney(r.effective_price)}</td>
          <td class="num" style="color:${pctColor}">${pctDisplay}</td>
        </tr>`;
      })
      .join("");

    body.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>${escapeHtml(material ? material.material_code + " — " + material.material_name : "")} (${this.currentData.length} lần mua)</h3>
          ${this.currentData.length ? `<button class="btn btn-secondary btn-sm" onclick="GiaVatTu.exportExcel()">Xuất Excel cho Đấu thầu</button>` : ""}
        </div>
        ${
          this.currentData.length
            ? `<table><thead><tr><th>Ngày</th><th>Dự án</th><th>NCC</th><th>Đơn giá</th><th>Biến động</th></tr></thead><tbody>${rows}</tbody></table>`
            : emptyStateHtml("Chưa có dữ liệu giá cho vật tư này trong phạm vi đã chọn.")
        }
      </div>`;
  },

  // Khi xem theo 1 dự án, % biến động phải tính lại so với lần mua TRƯỚC ĐÓ trong đúng dự án này
  // (view chỉ có sẵn cột so sánh toàn công ty — tự tính thêm phía client cho phạm vi hẹp hơn)
  computeProjectPct(row) {
    const idx = this.currentData.findIndex((r) => r === row);
    if (idx <= 0) return null;
    const prev = this.currentData[idx - 1].effective_price;
    if (!prev) return null;
    return Math.round(((row.effective_price - prev) / prev) * 1000) / 10;
  },

  exportExcel() {
    if (typeof XLSX === "undefined") { toast("Thư viện xuất Excel chưa tải xong, thử lại sau vài giây", "error"); return; }
    const material = STATE.materials.find((m) => m.id === this.selectedMaterialId);
    const rows = this.currentData.map((r, i) => ({
      "Ngày mua": fmtDate(r.receipt_date),
      "Dự án": r.project_name,
      "NCC": r.supplier_name,
      "Đơn giá": r.effective_price,
      "Biến động (%)": this.scope === "company" ? r.pct_change_any_project : this.computeProjectPct(r),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Lich su gia");
    const fileName = `Bao_cao_gia_${material ? material.material_code : "vattu"}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
    toast("Đã xuất file Excel!", "success");
  },
};

window.MODULES.giavattu = { render: (container) => GiaVatTu.render(container) };
window.GiaVatTu = GiaVatTu;
