/* ============================================================
   js/modules/thietbi.js
   B0 Danh mục thiết bị + B1 Luân chuyển + B3 Thanh lý (=hao hụt) + B4 Báo cáo.
   B2 (chi phí thuê) dùng lại module Hóa đơn có sẵn — không cần code riêng.
   ============================================================ */

const ThietBi = {
  activeTab: "list", // list | movement | stock | report
  assets: [],

  async render(container) {
    loading(true, "Đang tải danh mục thiết bị...");
    const { data } = await sb.from("assets").select("*").order("asset_code");
    loading(false);
    this.assets = data || [];

    container.innerHTML = `
      <h2>Thiết bị luân chuyển</h2>
      <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">
        <button class="btn btn-sm ${this.activeTab === "list" ? "btn-primary" : "btn-secondary"}" onclick="ThietBi.switchTab('list')">Danh mục</button>
        <button class="btn btn-sm ${this.activeTab === "movement" ? "btn-primary" : "btn-secondary"}" onclick="ThietBi.switchTab('movement')">Luân chuyển / Thanh lý</button>
        <button class="btn btn-sm ${this.activeTab === "stock" ? "btn-primary" : "btn-secondary"}" onclick="ThietBi.switchTab('stock')">Vị trí hiện tại</button>
        <button class="btn btn-sm ${this.activeTab === "report" ? "btn-primary" : "btn-secondary"}" onclick="ThietBi.switchTab('report')">Báo cáo</button>
      </div>
      <div id="tb-body"></div>`;
    await this.renderActiveTab();
  },

  switchTab(tab) {
    this.activeTab = tab;
    this.render(document.getElementById("content-area"));
  },

  canWrite() {
    return ["admin", "manager", "editor"].includes(STATE.role);
  },

  // ---------------- B0. DANH MỤC ----------------
  async renderList() {
    const body = document.getElementById("tb-body");
    const rows = this.assets
      .map(
        (a) => `<tr>
          <td>${escapeHtml(a.asset_code)}</td>
          <td>${escapeHtml(a.asset_name)}</td>
          <td class="hide-mobile">${escapeHtml(a.unit || "—")}</td>
          <td class="num">${fmtNumber(a.total_qty_owned)}</td>
          <td class="num hide-mobile">${fmtMoney(a.unit_value)}</td>
        </tr>`
      )
      .join("");
    body.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Danh mục thiết bị (${this.assets.length})</h3>
          ${this.canWrite() ? `<button class="btn btn-primary btn-sm" onclick="ThietBi.openAssetModal()">+ Thêm loại thiết bị</button>` : ""}
        </div>
        ${
          this.assets.length
            ? `<table><thead><tr><th>Mã</th><th>Tên thiết bị</th><th class="hide-mobile">Đơn vị</th><th>Tổng SL sở hữu</th><th class="hide-mobile">Đơn giá</th></tr></thead><tbody>${rows}</tbody></table>`
            : emptyStateHtml("Chưa có loại thiết bị nào.")
        }
      </div>`;
  },

  openAssetModal() {
    openModal({
      title: "Thêm loại thiết bị",
      bodyHtml: `
        <div class="field"><label>Mã thiết bị</label><input id="as-code" placeholder="VD: GG-01"></div>
        <div class="field"><label>Tên thiết bị</label><input id="as-name" placeholder="VD: Giàn giáo khung"></div>
        <div class="field"><label>Đơn vị</label><input id="as-unit" placeholder="Cây / Bộ / Tấm..."></div>
        <div class="field"><label>Tổng số lượng công ty sở hữu</label><input id="as-qty" type="number" step="any" placeholder="0"></div>
        <div class="field"><label>Đơn giá tài sản (tính giá trị đang nằm ở dự án)</label><input id="as-value" type="number" step="any" placeholder="0"></div>`,
      footerHtml: `
        <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="ThietBi.saveAsset()">Lưu</button>`,
    });
  },

  async saveAsset() {
    const code = document.getElementById("as-code").value.trim();
    const name = document.getElementById("as-name").value.trim();
    const unit = document.getElementById("as-unit").value.trim();
    const qty = parseFloat(document.getElementById("as-qty").value) || 0;
    const value = parseFloat(document.getElementById("as-value").value) || 0;
    if (!code || !name) { toast("Nhập đủ mã và tên thiết bị", "error"); return; }

    loading(true, "Đang lưu...");
    const { error } = await sb.from("assets").insert({ asset_code: code, asset_name: name, unit: unit || null, total_qty_owned: qty, unit_value: value });
    loading(false);
    if (error) {
      if (error.code === "23505") toast("Mã thiết bị đã tồn tại", "error");
      else toast("Lỗi: " + error.message, "error");
      return;
    }
    toast("Đã lưu!", "success");
    closeModal();
    this.render(document.getElementById("content-area"));
  },

  // ---------------- B1 + B3. LUÂN CHUYỂN / THANH LÝ ----------------
  async renderMovement() {
    const body = document.getElementById("tb-body");
    if (!this.assets.length) { body.innerHTML = `<div class="card">${emptyStateHtml("Chưa có thiết bị nào trong Danh mục — thêm trước.")}</div>`; return; }

    body.innerHTML = `
      <div class="card">
        <h3>Ghi nhận luân chuyển / thanh lý</h3>
        <div class="form-grid">
          <div class="field">
            <label>Thiết bị</label>
            <select id="mv-asset">${this.assets.map((a) => `<option value="${a.id}">${escapeHtml(a.asset_code)} — ${escapeHtml(a.asset_name)}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label>Loại di chuyển</label>
            <select id="mv-type" onchange="ThietBi.onMovementTypeChange()">
              <option value="xuat_du_an">Xuất kho tổng → dự án</option>
              <option value="chuyen_du_an">Chuyển thẳng dự án → dự án</option>
              <option value="thu_hoi">Thu hồi về kho tổng</option>
              <option value="thue_ncc">Thuê thêm từ NCC ngoài</option>
              <option value="tra_ncc">Trả lại NCC (hết hạn thuê)</option>
              <option value="thanh_ly">Thanh lý (hư hỏng / mất / hao mòn)</option>
            </select>
          </div>
          <div class="field">
            <label>Sở hữu</label>
            <select id="mv-ownership"><option value="cong_ty">Tài sản công ty</option><option value="thue_ngoai">Thuê ngoài</option></select>
          </div>
          <div class="field" id="mv-from-wrap" style="display:none">
            <label>Từ dự án</label>
            <select id="mv-from">${STATE.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.project_name)}</option>`).join("")}</select>
          </div>
          <div class="field" id="mv-to-wrap">
            <label>Đến dự án</label>
            <select id="mv-to">${STATE.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.project_name)}</option>`).join("")}</select>
          </div>
          <div class="field" id="mv-supplier-wrap" style="display:none">
            <label>NCC cho thuê</label>
            <input id="mv-supplier" list="mv-supplier-list" placeholder="Gõ tên NCC">
            <datalist id="mv-supplier-list">${STATE.suppliers.map((s) => `<option value="${escapeHtml(s.supplier_name)}">`).join("")}</datalist>
          </div>
          <div class="field"><label>Số lượng</label><input id="mv-qty" type="number" step="any" placeholder="0"></div>
          <div class="field"><label>Ngày</label>${dateInputHtml("mv-date", new Date().toISOString().slice(0, 10))}</div>
          <div class="field full"><label>Ghi chú / tình trạng / lý do</label><textarea id="mv-note" placeholder="Bắt buộc ghi lý do nếu là thanh lý"></textarea></div>
        </div>
        <button class="btn btn-primary" onclick="ThietBi.saveMovement()">Lưu</button>
      </div>
      <div id="tb-recent-movements"></div>`;
    this.onMovementTypeChange();
    initDateInput("mv-date");
    this.renderRecentMovements();
  },

  onMovementTypeChange() {
    const type = document.getElementById("mv-type").value;
    const fromWrap = document.getElementById("mv-from-wrap");
    const toWrap = document.getElementById("mv-to-wrap");
    const supplierWrap = document.getElementById("mv-supplier-wrap");
    const ownershipSelect = document.getElementById("mv-ownership");

    fromWrap.style.display = ["chuyen_du_an", "thu_hoi", "tra_ncc", "thanh_ly"].includes(type) ? "flex" : "none";
    toWrap.style.display = ["xuat_du_an", "chuyen_du_an", "thue_ncc"].includes(type) ? "flex" : "none";
    supplierWrap.style.display = ["thue_ncc", "tra_ncc"].includes(type) ? "flex" : "none";

    if (type === "thue_ncc" || type === "tra_ncc") ownershipSelect.value = "thue_ngoai";
    if (type === "thu_hoi") ownershipSelect.value = "cong_ty";
  },

  async saveMovement() {
    const assetId = document.getElementById("mv-asset").value;
    const type = document.getElementById("mv-type").value;
    const ownership = document.getElementById("mv-ownership").value;
    const fromWrap = document.getElementById("mv-from-wrap");
    const toWrap = document.getElementById("mv-to-wrap");
    const supplierWrap = document.getElementById("mv-supplier-wrap");
    const fromProject = fromWrap.style.display !== "none" ? document.getElementById("mv-from").value : null;
    const toProject = toWrap.style.display !== "none" ? document.getElementById("mv-to").value : null;
    const qty = parseFloat(document.getElementById("mv-qty").value);
    const date = getDateInputValue("mv-date");
    const note = document.getElementById("mv-note").value.trim();

    let supplierId = null;
    if (supplierWrap.style.display !== "none") {
      const supplierVal = document.getElementById("mv-supplier").value.trim();
      const supplier = STATE.suppliers.find((s) => s.supplier_name === supplierVal);
      if (!supplier) { toast("Chọn đúng 1 NCC từ danh sách gợi ý", "error"); return; }
      supplierId = supplier.id;
    }
    if (!qty || qty <= 0) { toast("Nhập số lượng hợp lệ", "error"); return; }
    if (type === "thanh_ly" && !note) { toast("Bắt buộc ghi lý do khi thanh lý", "error"); return; }

    loading(true, "Đang lưu...");
    const { error } = await sb.from("asset_movements").insert({
      asset_id: assetId,
      movement_type: type,
      ownership_type: ownership,
      from_project_id: fromProject,
      to_project_id: toProject,
      supplier_id: supplierId,
      qty,
      movement_date: date,
      condition_note: note || null,
      created_by: STATE.user.id,
    });
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    toast("Đã lưu luân chuyển!", "success");
    document.getElementById("mv-qty").value = "";
    document.getElementById("mv-note").value = "";
    this.renderRecentMovements();
  },

  async renderRecentMovements() {
    const el = document.getElementById("tb-recent-movements");
    if (!el) return;
    loading(true, "Đang tải lịch sử luân chuyển...");
    const { data } = await sb.from("asset_movements").select("*").order("movement_date", { ascending: false }).limit(20);
    loading(false);

    const typeLabel = {
      xuat_du_an: "Xuất kho tổng → dự án",
      chuyen_du_an: "Chuyển dự án → dự án",
      thu_hoi: "Thu hồi về kho tổng",
      thue_ncc: "Thuê thêm từ NCC",
      tra_ncc: "Trả lại NCC",
      thanh_ly: "Thanh lý",
    };
    const rows = (data || [])
      .map((m) => {
        const asset = this.assets.find((a) => a.id === m.asset_id);
        const from = STATE.projects.find((p) => p.id === m.from_project_id);
        const to = STATE.projects.find((p) => p.id === m.to_project_id);
        return `<tr>
          <td>${fmtDate(m.movement_date)}</td>
          <td>${escapeHtml(asset ? asset.asset_code : "—")}</td>
          <td>${typeLabel[m.movement_type] || m.movement_type}</td>
          <td class="hide-mobile">${escapeHtml(from ? from.project_name : "Kho tổng")} → ${escapeHtml(to ? to.project_name : m.movement_type === "thanh_ly" ? "—" : "Kho tổng")}</td>
          <td class="num">${fmtNumber(m.qty)}</td>
          <td>${m.ownership_type === "thue_ngoai" ? '<span class="badge badge-info">Thuê ngoài</span>' : '<span class="badge badge-none">Công ty</span>'}</td>
        </tr>`;
      })
      .join("");

    el.innerHTML = `
      <div class="card">
        <h3>20 lần luân chuyển gần nhất</h3>
        ${data && data.length ? `<table><thead><tr><th>Ngày</th><th>Thiết bị</th><th>Loại</th><th class="hide-mobile">Từ → Đến</th><th>SL</th><th>Sở hữu</th></tr></thead><tbody>${rows}</tbody></table>` : emptyStateHtml("Chưa có luân chuyển nào.")}
      </div>`;
  },

  // ---------------- VỊ TRÍ HIỆN TẠI ----------------
  async renderStock() {
    const body = document.getElementById("tb-body");
    loading(true, "Đang tải vị trí thiết bị...");
    const { data, error } = await sb.from("v_asset_stock").select("*");
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }

    const nonZero = (data || []).filter((r) => Math.abs(r.qty_on_hand) > 0.001);
    const rows = nonZero
      .map((r) => {
        const asset = this.assets.find((a) => a.id === r.asset_id);
        const project = STATE.projects.find((p) => p.id === r.project_id);
        return `<tr>
          <td>${escapeHtml(asset ? asset.asset_code + " — " + asset.asset_name : "—")}</td>
          <td>${escapeHtml(project ? project.project_name : "Kho tổng")}</td>
          <td>${r.ownership_type === "thue_ngoai" ? '<span class="badge badge-info">Thuê ngoài</span>' : '<span class="badge badge-none">Công ty</span>'}</td>
          <td class="num">${fmtNumber(r.qty_on_hand)}</td>
        </tr>`;
      })
      .join("");

    body.innerHTML = `
      <div class="card">
        <h3>Vị trí hiện tại (${nonZero.length})</h3>
        ${nonZero.length ? `<table><thead><tr><th>Thiết bị</th><th>Đang ở</th><th>Sở hữu</th><th>Số lượng</th></tr></thead><tbody>${rows}</tbody></table>` : emptyStateHtml("Chưa có thiết bị nào đang luân chuyển.")}
      </div>`;
  },

  // ---------------- B4. BÁO CÁO ----------------
  async renderReport() {
    const body = document.getElementById("tb-body");
    loading(true, "Đang tải báo cáo...");
    const [{ data: value }, { data: loss }] = await Promise.all([
      sb.from("v_asset_value_by_project").select("*"),
      sb.from("v_asset_loss_summary").select("*"),
    ]);
    loading(false);

    const valueRows = (value || [])
      .map((r) => `<tr><td>${escapeHtml(r.project_name)}</td><td>${escapeHtml(r.asset_name)}</td><td class="num">${fmtNumber(r.qty_on_hand)}</td><td class="num">${fmtMoney(r.asset_value)}</td></tr>`)
      .join("");
    const lossRows = (loss || [])
      .map(
        (r) => `<tr>
          <td>${escapeHtml(r.asset_code)} — ${escapeHtml(r.asset_name)}</td>
          <td class="num">${fmtNumber(r.total_qty_owned)}</td>
          <td class="num">${fmtNumber(r.qty_circulating)}</td>
          <td class="num">${fmtNumber(r.qty_disposed)}</td>
          <td class="num" style="${r.qty_unaccounted > 0 ? "color:var(--red);font-weight:600" : ""}">${fmtNumber(r.qty_unaccounted)}</td>
        </tr>`
      )
      .join("");

    body.innerHTML = `
      <div class="card">
        <h3>Giá trị tài sản công ty đang nằm ở từng dự án</h3>
        ${value && value.length ? `<table><thead><tr><th>Dự án</th><th>Thiết bị</th><th>SL</th><th>Giá trị</th></tr></thead><tbody>${valueRows}</tbody></table>` : emptyStateHtml("Chưa có dữ liệu.")}
      </div>
      <div class="card">
        <h3>Hao hụt thiết bị cấp công ty</h3>
        <div class="helper" style="margin-bottom:10px">Cột cuối (đỏ) = Tổng sở hữu − (đang lưu thông + đã thanh lý) — phần chưa rõ nguyên nhân, cần rà soát.</div>
        ${loss && loss.length ? `<table><thead><tr><th>Thiết bị</th><th>Tổng sở hữu</th><th>Đang lưu thông</th><th>Đã thanh lý</th><th>Chưa rõ nguyên nhân</th></tr></thead><tbody>${lossRows}</tbody></table>` : emptyStateHtml("Chưa có dữ liệu.")}
      </div>`;
  },

  async renderActiveTab() {
    if (this.activeTab === "list") await this.renderList();
    else if (this.activeTab === "movement") await this.renderMovement();
    else if (this.activeTab === "stock") await this.renderStock();
    else await this.renderReport();
  },
};

window.MODULES.thietbi = { render: (container) => ThietBi.render(container) };
window.ThietBi = ThietBi;
