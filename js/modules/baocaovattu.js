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

    let q = sb.from("goods_receipts").select("*, materials(material_code, material_name, material_groups_l2(name, material_groups_l1(name))), suppliers(supplier_name)");
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
    const projectId = document.getElementById("bcvt-project").value;
    const supplierId = document.getElementById("bcvt-supplier").value;
    const canBill = projectId && supplierId && this.currentRows.length;

    results.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Kết quả (${this.currentRows.length}${this.currentRows.length === 500 ? "+ — chỉ hiện 500 dòng gần nhất, thu hẹp bộ lọc để xem hết" : ""})</h3>
          <div style="display:flex;align-items:center;gap:10px">
            <strong class="num">Tổng: ${fmtMoney(total)}</strong>
            ${this.currentRows.length ? `<button class="btn btn-secondary btn-sm" onclick="BaoCaoVatTu.exportExcel()">Xuất Excel</button>` : ""}
            ${canBill ? `<button class="btn btn-primary btn-sm" onclick="BaoCaoVatTu.openBillModal()">Xuất Bill</button>` : ""}
          </div>
        </div>
        ${!projectId || !supplierId ? `<div class="helper" style="margin-bottom:8px">Chọn đúng 1 Dự án + 1 NCC ở bộ lọc phía trên để bật nút "Xuất Bill".</div>` : ""}
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

  openBillModal() {
    const projectId = document.getElementById("bcvt-project").value;
    const supplierId = document.getElementById("bcvt-supplier").value;
    const fromDate = document.getElementById("bcvt-from").value;
    const toDate = document.getElementById("bcvt-to").value;
    const project = STATE.projects.find((p) => p.id === projectId);
    const supplier = STATE.suppliers.find((s) => s.id === supplierId);

    openModal({
      title: "Xuất Bill — thông tin chứng từ",
      preventBackdropClose: true,
      bodyHtml: `
        <div class="field"><label>Công trình</label><input id="bill-congtrinh" value="${escapeHtml(project.project_name)}"></div>
        <div class="field"><label>Địa chỉ công trình</label><input id="bill-diachi" placeholder="VD: Khu vực Bãi Tiên, ..."></div>
        <div class="field"><label>Tên Bên A (bên mua)</label><input id="bill-bena-ten-cty" value="CÔNG TY CỔ PHẦN KỸ THUẬT XÂY DỰNG VELA"></div>
        <div class="field"><label>Bên B (NCC)</label><input id="bill-benb-ten" value="${escapeHtml(supplier.supplier_name)}" disabled style="background:var(--gray1);color:var(--gray5)"></div>
        <div class="form-grid">
          <div class="field"><label>Đại diện Bên A — Họ tên</label><input id="bill-bena-ten"></div>
          <div class="field"><label>Đại diện Bên A — Chức vụ</label><input id="bill-bena-cv"></div>
          <div class="field"><label>Đại diện Bên B — Họ tên</label><input id="bill-benb-nguoi"></div>
          <div class="field"><label>Đại diện Bên B — Chức vụ</label><input id="bill-benb-cv"></div>
        </div>
        <div class="field"><label>Ngày lập biên bản</label><input id="bill-ngaylap" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="helper">Khoảng thời gian thanh toán lấy đúng theo bộ lọc đang áp dụng (${fromDate ? fmtDate(fromDate) : "từ đầu"} — ${toDate ? fmtDate(toDate) : "đến nay"}). Đổi lại bộ lọc trước khi xuất nếu cần khoảng khác.</div>`,
      footerHtml: `
        <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="BaoCaoVatTu.generateBill()">Tạo Bill</button>`,
    });
  },

  generateBill() {
    const congTrinh = document.getElementById("bill-congtrinh").value.trim();
    const diaChi = document.getElementById("bill-diachi").value.trim();
    const benATen = document.getElementById("bill-bena-ten-cty").value.trim();
    const benBTen = document.getElementById("bill-benb-ten").value.trim();
    const benANguoi = document.getElementById("bill-bena-ten").value.trim();
    const benACV = document.getElementById("bill-bena-cv").value.trim();
    const benBNguoi = document.getElementById("bill-benb-nguoi").value.trim();
    const benBCV = document.getElementById("bill-benb-cv").value.trim();
    const ngayLap = document.getElementById("bill-ngaylap").value;
    const fromDate = document.getElementById("bcvt-from").value;
    const toDate = document.getElementById("bcvt-to").value;

    // Nhóm theo Level 1 (Kết Cấu / Hoàn Thiện / Vật Tư Phụ / Công Tác Khác) làm các mục La Mã như mẫu
    const groups = {};
    const order = [];
    this.currentRows.forEach((r) => {
      const l1 = r.materials && r.materials.material_groups_l2 && r.materials.material_groups_l2.material_groups_l1 ? r.materials.material_groups_l2.material_groups_l1.name : "Khác";
      if (!groups[l1]) { groups[l1] = []; order.push(l1); }
      groups[l1].push(r);
    });

    const roman = ["I", "II", "III", "IV", "V", "VI", "VII"];
    let stt = 1;
    let bodyHtml = "";
    let grandTotal = 0;
    order.forEach((l1, idx) => {
      const items = groups[l1];
      const subtotal = items.reduce((s, r) => s + r.qty * r.unit_price, 0);
      grandTotal += subtotal;
      bodyHtml += `<tr class="section"><td>${roman[idx] || idx + 1}</td><td colspan="4"><strong>${escapeHtml(l1)}</strong></td><td class="num"><strong>${fmtMoney(subtotal)}</strong></td><td></td></tr>`;
      items.forEach((r) => {
        bodyHtml += `<tr>
          <td>${stt++}</td>
          <td>${escapeHtml(r.materials ? r.materials.material_name : "")}</td>
          <td>${escapeHtml(r.unit || "")}</td>
          <td class="num">${fmtNumber(r.qty)}</td>
          <td class="num">${fmtMoney(r.unit_price).replace(" đ", "")}</td>
          <td class="num">${fmtMoney(r.qty * r.unit_price).replace(" đ", "")}</td>
          <td></td>
        </tr>`;
      });
    });

    const periodText = fromDate && toDate ? `từ ngày ${fmtDate(fromDate)} đến ngày ${fmtDate(toDate)}` : fromDate ? `từ ngày ${fmtDate(fromDate)}` : toDate ? `đến ngày ${fmtDate(toDate)}` : "toàn bộ thời gian";
    const ngayLapText = ngayLap ? new Date(ngayLap) : new Date();

    const html = `<!DOCTYPE html>
<html lang="vi"><head><meta charset="UTF-8">
<title>Bill - ${escapeHtml(benBTen)}</title>
<style>
  body { font-family: 'Times New Roman', Times, serif; font-size: 13px; color:#000; max-width: 800px; margin: 24px auto; padding: 0 16px; }
  h2 { text-align:center; margin-bottom: 4px; }
  .sub { text-align:center; margin-bottom: 16px; }
  table { width:100%; border-collapse: collapse; margin: 14px 0; }
  th, td { border: 1px solid #000; padding: 5px 7px; font-size: 12.5px; }
  th { text-align:center; background:#f0f0f0; }
  tr.section td { background:#f7f7f7; }
  .num { text-align:right; }
  .sign { display:flex; justify-content:space-between; margin-top: 40px; text-align:center; }
  .sign div { width: 45%; }
  .sign .line { margin-top: 70px; font-weight:bold; }
  .total-row td { font-weight:bold; }
  .print-btn { position:fixed; top:16px; right:16px; padding:8px 16px; background:#2563EB; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:13px; }
  @media print { .print-btn { display:none; } }
</style></head>
<body>
<button class="print-btn" onclick="window.print()">In / Lưu PDF</button>
<h2>BẢNG TỔNG HỢP GIÁ TRỊ THANH TOÁN</h2>
<div class="sub">(${periodText})</div>
<p>Hôm nay, ngày ${ngayLapText.getDate()} tháng ${ngayLapText.getMonth() + 1} năm ${ngayLapText.getFullYear()}, các bên gồm có:</p>
<p><strong>Công trình:</strong> ${escapeHtml(congTrinh)}</p>
${diaChi ? `<p><strong>Địa chỉ:</strong> ${escapeHtml(diaChi)}</p>` : ""}
<p>1/ Đại diện Bên A (Bên mua): <strong>${escapeHtml(benATen)}</strong></p>
<p>Ông (Bà): ${escapeHtml(benANguoi)} &nbsp;&nbsp; Chức vụ: ${escapeHtml(benACV)}</p>
<p>2/ Đại diện Bên B (Bên bán): <strong>${escapeHtml(benBTen)}</strong></p>
<p>Ông (Bà): ${escapeHtml(benBNguoi)} &nbsp;&nbsp; Chức vụ: ${escapeHtml(benBCV)}</p>
<table>
  <thead><tr><th>Stt</th><th>Nội dung</th><th>Đvt</th><th>Khối lượng</th><th>Đơn giá</th><th>Thành tiền</th><th>Ghi chú</th></tr></thead>
  <tbody>
    ${bodyHtml}
    <tr class="total-row"><td colspan="5" class="num">Tổng cộng</td><td class="num">${fmtMoney(grandTotal).replace(" đ", "")}</td><td></td></tr>
  </tbody>
</table>
<p><strong>Bằng chữ:</strong> ${soTienBangChu(grandTotal)}./.</p>
<p>Biên bản được lập thành 04 (bốn) bản, mỗi bên giữ 02 (hai) bản có giá trị pháp lý như nhau làm cơ sở cho việc thanh lý hợp đồng.</p>
<div class="sign">
  <div>ĐẠI DIỆN BÊN A<div class="line">${escapeHtml(benANguoi)}</div></div>
  <div>ĐẠI DIỆN BÊN B<div class="line">${escapeHtml(benBNguoi)}</div></div>
</div>
</body></html>`;

    const win = window.open("", "_blank");
    if (!win) { toast("Trình duyệt chặn cửa sổ mới — cho phép popup rồi thử lại", "error"); return; }
    win.document.write(html);
    win.document.close();
    closeModal();
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
