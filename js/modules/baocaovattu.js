/* ============================================================
   js/modules/baocaovattu.js
   Thay cho 3 tab Hóa đơn/Thanh toán/Công nợ NCC (phòng kế toán dùng
   hệ thống riêng, không cần trong app này nữa — file hoadon.js/
   thanhtoan.js/congno.js vẫn giữ trong repo, chỉ ẩn khỏi sidebar).

   1 tab duy nhất: filter đa điều kiện (Dự án/NCC/Vật tư/khoảng ngày),
   bảng Ngày-NCC-Vật tư-Đơn vị-SL kèm ảnh Phiếu giao nhận, xuất Excel,
   và khối lũy kế so với dự toán khi lọc theo đúng 1 vật tư.
   ============================================================ */

const BaoCaoVatTu = {
  currentRows: [],

  async render(container) {
    container.innerHTML = `
      <h2>Báo cáo Vật Tư</h2>
      <div class="card">
        <div class="form-grid">
          <div class="field">
            <label>Dự án</label>
            <select id="bcvt-project"><option value="">Tất cả dự án</option>${STATE.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.project_name)}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label>Nhà cung cấp</label>
            <select id="bcvt-supplier"><option value="">Tất cả NCC</option>${STATE.suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.supplier_name)}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label>Vật tư</label>
            <select id="bcvt-material"><option value="">Tất cả vật tư</option>${STATE.materials.map((m) => `<option value="${m.id}">${escapeHtml(m.material_code)} — ${escapeHtml(m.material_name)}</option>`).join("")}</select>
          </div>
          <div class="field"><label>Từ ngày</label><input id="bcvt-from" type="date"></div>
          <div class="field"><label>Đến ngày</label><input id="bcvt-to" type="date"></div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="BaoCaoVatTu.applyFilter()">Lọc</button>
      </div>
      <div id="bcvt-summary"></div>
      <div id="bcvt-results"></div>`;
    this.applyFilter();
  },

  async applyFilter() {
    const results = document.getElementById("bcvt-results");
    const summary = document.getElementById("bcvt-summary");
    results.innerHTML = `<div class="card">${emptyStateHtml("Đang tải...")}</div>`;
    summary.innerHTML = "";
    loading(true, "Đang tải báo cáo...");

    const projectId = document.getElementById("bcvt-project").value;
    const supplierId = document.getElementById("bcvt-supplier").value;
    const materialId = document.getElementById("bcvt-material").value;
    const fromDate = document.getElementById("bcvt-from").value;
    const toDate = document.getElementById("bcvt-to").value;

    let q = sb.from("goods_receipts").select("*, materials(material_code, material_name), suppliers(supplier_name)");
    if (projectId) q = q.eq("project_id", projectId);
    if (supplierId) q = q.eq("supplier_id", supplierId);
    if (materialId) q = q.eq("material_id", materialId);
    if (fromDate) q = q.gte("receipt_date", fromDate);
    if (toDate) q = q.lte("receipt_date", toDate);

    // Lọc theo đúng 1 vật tư -> sắp theo Dự án rồi theo ngày (để xem tiến độ nhập từng công trình);
    // mặc định (không lọc vật tư) -> sắp theo ngày gần nhất trước
    q = materialId ? q.order("project_id").order("receipt_date", { ascending: true }) : q.order("receipt_date", { ascending: false });

    const { data, error } = await q.limit(500);
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }

    this.currentRows = data || [];
    this.renderTable();
    if (materialId) this.renderMaterialSummary(materialId, projectId);
  },

  renderTable() {
    const results = document.getElementById("bcvt-results");
    const rows = this.currentRows
      .map((r) => {
        const project = STATE.projects.find((p) => p.id === r.project_id);
        return `<tr>
          <td>${fmtDate(r.receipt_date)}</td>
          <td>${escapeHtml(project ? project.project_name : "—")}</td>
          <td>${escapeHtml(r.suppliers ? r.suppliers.supplier_name : "—")}</td>
          <td>${escapeHtml(r.materials ? r.materials.material_code + " — " + r.materials.material_name : "—")}</td>
          <td>${escapeHtml(r.unit || "—")}</td>
          <td class="num">${fmtNumber(r.qty)}</td>
          <td class="num">${fmtMoney(r.unit_price)}</td>
          <td class="num">${fmtMoney(r.qty * r.unit_price)}</td>
          <td>${r.vehicle_receipt_id ? `<button class="btn btn-sm btn-secondary" onclick="BaoCaoVatTu.viewPgn('${r.vehicle_receipt_id}')">Xem PGN</button>` : "—"}</td>
        </tr>`;
      })
      .join("");

    const total = this.currentRows.reduce((sum, r) => sum + r.qty * r.unit_price, 0);

    results.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Kết quả (${this.currentRows.length}${this.currentRows.length === 500 ? "+ — chỉ hiện 500 dòng gần nhất, thu hẹp bộ lọc để xem hết" : ""})</h3>
          <div style="display:flex;align-items:center;gap:16px">
            <strong class="num">Tổng: ${fmtMoney(total)}</strong>
            ${this.currentRows.length ? `<button class="btn btn-secondary btn-sm" onclick="BaoCaoVatTu.exportExcel()">Xuất Excel</button>` : ""}
          </div>
        </div>
        ${
          this.currentRows.length
            ? `<table><thead><tr><th>Ngày</th><th>Dự án</th><th>NCC</th><th>Vật tư</th><th>Đơn vị</th><th>Số lượng</th><th>Đơn giá</th><th>Thành tiền</th><th>Phiếu giao nhận</th></tr></thead><tbody>${rows}</tbody></table>`
            : emptyStateHtml("Không có dữ liệu khớp bộ lọc.")
        }
      </div>`;
  },

  // Khối lũy kế: chỉ hiện khi đang lọc đúng 1 vật tư — so SL đã nhập với dự trù, theo từng dự án liên quan
  async renderMaterialSummary(materialId, projectFilterId) {
    const el = document.getElementById("bcvt-summary");
    el.innerHTML = `<div class="card">${emptyStateHtml("Đang tải lũy kế...")}</div>`;
    let q = sb.from("v_budget_alert").select("*").eq("level", 3).eq("material_id", materialId);
    if (projectFilterId) q = q.eq("project_id", projectFilterId);
    const { data, error } = await q;
    if (error) { el.innerHTML = ""; return; }

    const rows = (data || []).filter((a) => a.planned_qty != null);
    if (!rows.length) { el.innerHTML = ""; return; }

    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Lũy kế so với dự toán</h3></div>
        <table><thead><tr><th>Dự án</th><th>Đã nhập / Dự trù</th><th>%</th></tr></thead><tbody>
          ${rows
            .map((a) => {
              const project = STATE.projects.find((p) => p.id === a.project_id);
              return `<tr>
                <td>${escapeHtml(project ? project.project_name : "—")}</td>
                <td class="num">${fmtNumber(a.received_qty)} / ${fmtNumber(a.planned_qty)}</td>
                <td class="num" style="${a.pct_received >= 100 ? "color:var(--red);font-weight:600" : a.pct_received >= 70 ? "color:var(--amber);font-weight:600" : ""}">${a.pct_received || 0}%</td>
              </tr>`;
            })
            .join("")}
        </tbody></table>
      </div>`;
  },

  async viewPgn(vehicleReceiptId) {
    loading(true, "Đang tải ảnh...");
    const { data: photo, error } = await sb
      .from("vehicle_receipt_photos")
      .select("*")
      .eq("vehicle_receipt_id", vehicleReceiptId)
      .eq("photo_type", "phieu_giao_nhan")
      .order("page_number")
      .limit(1)
      .maybeSingle();
    if (error || !photo) { loading(false); toast("Không tìm thấy ảnh phiếu giao nhận cho xe này", "error"); return; }
    const { data: signed } = await sb.storage.from(CFG.STORAGE_BUCKET_VEHICLE_PHOTOS).createSignedUrl(photo.file_url, 3600);
    loading(false);
    if (!signed) { toast("Lỗi tải ảnh", "error"); return; }
    openImageViewer(signed.signedUrl, "Phiếu giao nhận");
  },

  exportExcel() {
    if (typeof XLSX === "undefined") { toast("Thư viện xuất Excel chưa tải xong, thử lại sau vài giây", "error"); return; }
    const rows = this.currentRows.map((r) => {
      const project = STATE.projects.find((p) => p.id === r.project_id);
      return {
        "Ngày": fmtDate(r.receipt_date),
        "Dự án": project ? project.project_name : "",
        "NCC": r.suppliers ? r.suppliers.supplier_name : "",
        "Vật tư": r.materials ? r.materials.material_code + " — " + r.materials.material_name : "",
        "Đơn vị": r.unit || "",
        "Số lượng": r.qty,
        "Đơn giá": r.unit_price,
        "Thành tiền": r.qty * r.unit_price,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Bao cao vat tu");
    XLSX.writeFile(wb, `Bao_cao_vat_tu_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast("Đã xuất file Excel!", "success");
  },
};

window.MODULES.baocaovattu = { render: (container) => BaoCaoVatTu.render(container) };
window.BaoCaoVatTu = BaoCaoVatTu;
