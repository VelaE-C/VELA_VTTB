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

  isProjectScoped() {
    return ["editor", "project_lead", "viewer"].includes(STATE.role);
  },
  canEditBill() {
    return ["admin", "manager", "project_lead"].includes(STATE.role);
  },

  async render(container) {
    container.innerHTML = `
      <h2>Báo cáo Vật Tư</h2>
      <div class="card">
        <div class="form-grid">
          <div class="field">
            <label>Dự án</label>
            <select id="bcvt-project" onchange="BaoCaoVatTu.onProjectChange()">${this.isProjectScoped() ? "" : `<option value="">Tất cả dự án</option>`}${STATE.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.project_name)}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label>Nhà cung cấp</label>
            <select id="bcvt-supplier" onchange="BaoCaoVatTu.onSupplierChange()"><option value="">Tất cả NCC</option>${STATE.suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.supplier_name)}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label>Vật tư</label>
            <select id="bcvt-material"><option value="">Tất cả vật tư</option>${STATE.materials.map((m) => `<option value="${m.id}">${escapeHtml(m.material_code)} — ${escapeHtml(m.material_name)}</option>`).join("")}</select>
          </div>
          <div class="field"><label>Từ ngày</label>${dateInputHtml("bcvt-from")}</div>
          <div class="field"><label>Đến ngày</label>${dateInputHtml("bcvt-to")}</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="BaoCaoVatTu.applyFilter()">Lọc</button>
      </div>
      <div id="bcvt-summary"></div>
      <div id="bcvt-results"></div>`;
    initDateInput("bcvt-from");
    initDateInput("bcvt-to");
    this.applyFilter();
  },

  // Dự án đổi -> thu hẹp NCC + Vật tư chỉ còn cái thực sự phát sinh ở đúng dự án đó
  async onProjectChange() {
    const projectId = document.getElementById("bcvt-project").value;
    await this.reloadSupplierOptions(projectId);
    await this.reloadMaterialOptions(projectId, document.getElementById("bcvt-supplier").value);
  },

  // NCC đổi -> thu hẹp tiếp Vật tư chỉ còn cái NCC đó từng cấp (trong đúng dự án đang chọn nếu có)
  async onSupplierChange() {
    const projectId = document.getElementById("bcvt-project").value;
    const supplierId = document.getElementById("bcvt-supplier").value;
    await this.reloadMaterialOptions(projectId, supplierId);
  },

  async reloadSupplierOptions(projectId) {
    const select = document.getElementById("bcvt-supplier");
    const current = select.value;
    if (!projectId) {
      select.innerHTML = `<option value="">Tất cả NCC</option>${STATE.suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.supplier_name)}</option>`).join("")}`;
      select.value = STATE.suppliers.some((s) => s.id === current) ? current : "";
      return;
    }
    const { data } = await sb.from("goods_receipts").select("supplier_id").eq("project_id", projectId).limit(3000);
    const ids = new Set((data || []).map((r) => r.supplier_id));
    const options = STATE.suppliers.filter((s) => ids.has(s.id));
    select.innerHTML = `<option value="">Tất cả NCC (${options.length})</option>${options.map((s) => `<option value="${s.id}">${escapeHtml(s.supplier_name)}</option>`).join("")}`;
    select.value = options.some((s) => s.id === current) ? current : "";
  },

  async reloadMaterialOptions(projectId, supplierId) {
    const select = document.getElementById("bcvt-material");
    const current = select.value;
    if (!projectId && !supplierId) {
      select.innerHTML = `<option value="">Tất cả vật tư</option>${STATE.materials.map((m) => `<option value="${m.id}">${escapeHtml(m.material_code)} — ${escapeHtml(m.material_name)}</option>`).join("")}`;
      select.value = STATE.materials.some((m) => m.id === current) ? current : "";
      return;
    }
    let q = sb.from("goods_receipts").select("material_id").limit(3000);
    if (projectId) q = q.eq("project_id", projectId);
    if (supplierId) q = q.eq("supplier_id", supplierId);
    const { data } = await q;
    const ids = new Set((data || []).map((r) => r.material_id));
    const options = STATE.materials.filter((m) => ids.has(m.id));
    select.innerHTML = `<option value="">Tất cả vật tư (${options.length})</option>${options.map((m) => `<option value="${m.id}">${escapeHtml(m.material_code)} — ${escapeHtml(m.material_name)}</option>`).join("")}`;
    select.value = options.some((m) => m.id === current) ? current : "";
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
    const fromDate = getDateInputValue("bcvt-from");
    const toDate = getDateInputValue("bcvt-to");

    let q = sb.from("goods_receipts").select("*, materials(material_code, material_name, material_groups_l2(name, material_groups_l1(name))), suppliers(supplier_name), vehicle_receipts(receipt_code)");
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
          <td class="mono">${escapeHtml(r.vehicle_receipts ? r.vehicle_receipts.receipt_code || "—" : "—")}</td>
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
            ? `<table><thead><tr><th>Ngày</th><th>Mã phiếu</th><th>Dự án</th><th>NCC</th><th>Vật tư</th><th>Đơn vị</th><th>Số lượng</th><th>Đơn giá</th><th>Thành tiền</th><th>Phiếu giao nhận</th></tr></thead><tbody>${rows}</tbody></table>`
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
    const fromDate = getDateInputValue("bcvt-from");
    const toDate = getDateInputValue("bcvt-to");
    const project = STATE.projects.find((p) => p.id === projectId);
    const supplier = STATE.suppliers.find((s) => s.id === supplierId);

    // Lưu lại phạm vi của bill này — dùng để tải lại đúng danh sách sau mỗi lần Sửa/Xóa/Thêm
    this.billProjectId = projectId;
    this.billSupplierId = supplierId;
    this.billFromDate = fromDate;
    this.billToDate = toDate;
    this.billEditingLine = null;

    openModal({
      title: "Xuất Bill — đối chiếu & tạo chứng từ",
      preventBackdropClose: true,
      wide: true,
      bodyHtml: `
        <div class="card">
          <h3>1. Xem trước &amp; điều chỉnh (nếu đối chiếu NCC thấy sai)</h3>
          <div class="helper" style="margin-bottom:10px">Sửa/xóa/thêm dòng ở đây sẽ <strong>cập nhật thẳng vào dữ liệu gốc</strong> — áp dụng luôn cho Dashboard, Ngân sách, mọi báo cáo khác, không phải chỉ riêng bill này.</div>
          <div id="bill-lineitems"></div>
        </div>
        <div class="card">
          <h3>2. Thông tin chứng từ</h3>
          <div class="field"><label>Công trình</label><input id="bill-congtrinh" value="${escapeHtml(project.project_name)}"></div>
          <div class="field"><label>Địa chỉ công trình</label><input id="bill-diachi" value="${escapeHtml(project.address || "")}" placeholder="${project.address ? "" : "Chưa khai báo địa chỉ ở Danh mục — vào Danh mục > Dự án để điền sẵn cho lần sau"}"></div>
          <div class="field"><label>Tên Bên A (bên mua)</label><input id="bill-bena-ten-cty" value="CÔNG TY CỔ PHẦN KỸ THUẬT XÂY DỰNG VELA"></div>
          <div class="field">
            <label>Bên B (NCC)</label>
            <input id="bill-benb-ten" value="${escapeHtml(supplier.full_name || supplier.supplier_name)}" disabled style="background:var(--gray1);color:var(--gray5)">
            ${!supplier.full_name ? `<div class="helper">Chưa có tên pháp lý đầy đủ — đang dùng tạm tên viết tắt "${escapeHtml(supplier.supplier_name)}". Vào Danh mục &gt; NCC điền "Tên thực tế" để bill chuẩn hơn.</div>` : ""}
          </div>
          <div class="form-grid">
            <div class="field"><label>Đại diện Bên A — Họ tên</label><input id="bill-bena-ten"></div>
            <div class="field"><label>Đại diện Bên A — Chức vụ</label><input id="bill-bena-cv"></div>
            <div class="field"><label>Đại diện Bên B — Họ tên</label><input id="bill-benb-nguoi"></div>
            <div class="field"><label>Đại diện Bên B — Chức vụ</label><input id="bill-benb-cv"></div>
          </div>
          <div class="field"><label>Ngày lập biên bản</label>${dateInputHtml("bill-ngaylap", new Date().toISOString().slice(0, 10))}</div>
          <div class="helper">Khoảng thời gian thanh toán lấy đúng theo bộ lọc đang áp dụng (${fromDate ? fmtDate(fromDate) : "từ đầu"} — ${toDate ? fmtDate(toDate) : "đến nay"}). Đổi lại bộ lọc trước khi mở lại "Xuất Bill" nếu cần khoảng khác.</div>
        </div>`,
      footerHtml: `
        <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="BaoCaoVatTu.generateBill()">Tạo Bill</button>`,
    });
    initDateInput("bill-ngaylap");
    this.renderBillLineItems();
  },

  // Vẽ lại đúng khối "Xem trước & điều chỉnh" — không đụng tới phần thông tin chứng từ bên dưới
  // (giữ nguyên giá trị người dùng đã gõ vào tên đại diện/ngày lập... khi họ vừa sửa 1 dòng)
  renderBillLineItems() {
    const el = document.getElementById("bill-lineitems");
    if (!el) return;
    const canEdit = this.canEditBill();

    const rows = this.currentRows
      .map(
        (r) => `<tr>
          <td>${fmtDate(r.receipt_date)}</td>
          <td>${escapeHtml(r.materials ? r.materials.material_code + " — " + r.materials.material_name : "—")}</td>
          <td>${escapeHtml(r.unit || "—")}</td>
          <td class="num">${fmtNumber(r.qty)}</td>
          <td class="num">${fmtMoney(r.unit_price)}</td>
          <td class="num">${fmtMoney(r.qty * r.unit_price)}</td>
          <td>${escapeHtml(r.note || "")}</td>
          ${
            canEdit
              ? `<td class="table-actions">
                  <button class="btn btn-sm btn-secondary" onclick='BaoCaoVatTu.startBillLineEdit(${JSON.stringify(r).replace(/'/g, "&#39;")})'>Sửa</button>
                  <button class="btn btn-sm btn-secondary" onclick="BaoCaoVatTu.deleteBillLine('${r.id}')">Xóa</button>
                </td>`
              : ""
          }
        </tr>`
      )
      .join("");

    const total = this.currentRows.reduce((s, r) => s + r.qty * r.unit_price, 0);
    const ed = this.billEditingLine;
    const colCount = canEdit ? 8 : 7;

    el.innerHTML = `
      <table><thead><tr><th>Ngày</th><th>Vật tư</th><th>ĐV</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th><th>Lý do sửa gần nhất</th>${canEdit ? "<th></th>" : ""}</tr></thead><tbody>
        ${rows || `<tr><td colspan="${colCount}">${emptyStateHtml("Chưa có dòng nào.")}</td></tr>`}
      </tbody></table>
      <div style="text-align:right;margin-top:6px"><strong class="num">Tổng: ${fmtMoney(total)}</strong></div>

      ${
        canEdit
          ? `<div class="card" style="background:var(--gray1);margin-top:12px">
              <h3>${ed ? `Sửa dòng — ${escapeHtml(ed.materials ? ed.materials.material_code : "")}` : "Thêm dòng phát sinh"}</h3>
              ${ed ? `<button class="btn btn-sm btn-secondary" onclick="BaoCaoVatTu.cancelBillLineEdit()" style="margin-bottom:8px">Hủy sửa, thêm mới</button>` : ""}
              <div class="form-grid">
                <div class="field full">
                  <label>Vật tư</label>
                  ${searchableSelectHtml("bill-line-material-ssel", "Gõ mã hoặc tên vật tư...")}
                </div>
                <div class="field"><label>Đơn vị</label><input id="bill-line-unit" value="${ed ? escapeHtml(ed.unit || "") : ""}"></div>
                <div class="field"><label>Số lượng</label><input id="bill-line-qty" value="${ed ? fmtNumber(ed.qty) : ""}"></div>
                <div class="field"><label>Đơn giá</label><input id="bill-line-price" value="${ed ? fmtNumber(ed.unit_price) : ""}"></div>
                <div class="field"><label>Ngày nhận</label>${dateInputHtml("bill-line-date", ed ? ed.receipt_date : new Date().toISOString().slice(0, 10))}</div>
                <div class="field full"><label>Lý do điều chỉnh (bắt buộc)</label><textarea id="bill-line-reason" placeholder="VD: Đối chiếu với NCC ngày .../.../..., điều chỉnh SL từ X xuống Y do đo lại thực tế"></textarea></div>
              </div>
              <button class="btn btn-primary" onclick="BaoCaoVatTu.saveBillLine()">${ed ? "Lưu điều chỉnh" : "+ Thêm dòng"}</button>
            </div>`
          : `<div class="helper" style="margin-top:8px">Bạn chỉ có quyền xem — không sửa/xóa/thêm được ở đây.</div>`
      }`;

    if (!canEdit) return;
    initSearchableSelect("bill-line-material-ssel", this.materialGroupedOptions());
    if (ed) {
      const material = STATE.materials.find((m) => m.id === ed.material_id);
      if (material) {
        const input = document.querySelector("#bill-line-material-ssel .ssel-input");
        const hidden = document.querySelector("#bill-line-material-ssel .ssel-value");
        input.value = `${material.material_code} — ${material.material_name}`;
        hidden.value = material.id;
      }
    }
    attachNumberFormat("bill-line-qty");
    attachNumberFormat("bill-line-price");
    initDateInput("bill-line-date");
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
    if (noGroup.length) groups.push({ groupLabel: "Chưa gán nhóm", items: noGroup.map((m) => ({ value: m.id, label: label(m) })) });
    return groups;
  },

  startBillLineEdit(row) {
    this.billEditingLine = row;
    this.renderBillLineItems();
  },
  cancelBillLineEdit() {
    this.billEditingLine = null;
    this.renderBillLineItems();
  },

  async saveBillLine() {
    const materialId = getSearchableSelectValue("bill-line-material-ssel");
    const material = STATE.materials.find((m) => m.id === materialId);
    const unit = document.getElementById("bill-line-unit").value.trim();
    const qty = parseFormattedNumber("bill-line-qty");
    const price = parseFormattedNumber("bill-line-price");
    const date = getDateInputValue("bill-line-date");
    const reason = document.getElementById("bill-line-reason").value.trim();

    if (!material) { toast("Chọn 1 vật tư trong danh mục", "error"); return; }
    if (!qty || qty <= 0) { toast("Nhập số lượng hợp lệ", "error"); return; }
    if (isNaN(price) || price < 0) { toast("Nhập đơn giá hợp lệ", "error"); return; }
    if (!date) { toast("Nhập ngày nhận hợp lệ", "error"); return; }
    if (!reason) { toast("Bắt buộc ghi lý do điều chỉnh", "error"); return; }

    loading(true, "Đang lưu...");
    const payload = {
      project_id: this.billProjectId,
      supplier_id: this.billSupplierId,
      material_id: materialId,
      unit: unit || null,
      qty,
      unit_price: price,
      receipt_date: date,
      note: reason,
    };
    const { error } = this.billEditingLine
      ? await sb.from("goods_receipts").update(payload).eq("id", this.billEditingLine.id)
      : await sb.from("goods_receipts").insert({ ...payload, created_by: STATE.user.id });
    loading(false);
    if (error) {
      if (error.code === "42501" || /policy/i.test(error.message)) {
        toast(this.billEditingLine ? "Phiếu này đã quá 24h — chỉ Admin mới sửa được, liên hệ Admin để điều chỉnh" : "Bạn không có quyền thêm phiếu cho dự án này", "error");
      } else {
        toast("Lỗi: " + error.message, "error");
      }
      return;
    }
    toast(this.billEditingLine ? "Đã lưu điều chỉnh!" : "Đã thêm dòng!", "success");
    this.billEditingLine = null;
    await this.reloadBillRows();
  },

  async deleteBillLine(id) {
    if (!confirm("Xóa dòng này khỏi dữ liệu? Không thể khôi phục.")) return;
    loading(true, "Đang xóa...");
    const { error } = await sb.from("goods_receipts").delete().eq("id", id);
    loading(false);
    if (error) {
      if (error.code === "42501" || /policy/i.test(error.message)) toast("Chỉ Admin mới xóa được phiếu nhận hàng — liên hệ Admin để điều chỉnh", "error");
      else toast("Lỗi: " + error.message, "error");
      return;
    }
    toast("Đã xóa!", "success");
    await this.reloadBillRows();
  },

  // Tải lại đúng danh sách theo phạm vi của bill đang mở (Dự án + NCC + khoảng ngày lúc mở modal)
  async reloadBillRows() {
    loading(true, "Đang tải lại...");
    let q = sb
      .from("goods_receipts")
      .select("*, materials(material_code, material_name, material_groups_l2(name, material_groups_l1(name))), suppliers(supplier_name), vehicle_receipts(receipt_code)")
      .eq("project_id", this.billProjectId)
      .eq("supplier_id", this.billSupplierId);
    if (this.billFromDate) q = q.gte("receipt_date", this.billFromDate);
    if (this.billToDate) q = q.lte("receipt_date", this.billToDate);
    const { data, error } = await q.order("receipt_date", { ascending: true }).limit(500);
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    this.currentRows = data || [];
    this.renderBillLineItems();
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
    const ngayLap = getDateInputValue("bill-ngaylap");
    const fromDate = getDateInputValue("bcvt-from");
    const toDate = getDateInputValue("bcvt-to");
    const supplierId = document.getElementById("bcvt-supplier").value;
    const supplier = STATE.suppliers.find((s) => s.id === supplierId) || {};

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
      bodyHtml += `<tr class="section"><td>${roman[idx] || idx + 1}</td><td colspan="4"><strong>${escapeHtml(l1)}</strong></td><td class="num"><strong>${fmtMoney(subtotal)}</strong></td><td></td><td></td></tr>`;
      items.forEach((r) => {
        const receiptCode = r.vehicle_receipts ? r.vehicle_receipts.receipt_code : null;
        bodyHtml += `<tr>
          <td>${stt++}</td>
          <td>${escapeHtml(r.materials ? r.materials.material_name : "")}</td>
          <td>${escapeHtml(r.unit || "")}</td>
          <td class="num">${fmtNumber(r.qty)}</td>
          <td class="num">${fmtMoney(r.unit_price).replace(" đ", "")}</td>
          <td class="num">${fmtMoney(r.qty * r.unit_price).replace(" đ", "")}</td>
          <td>${escapeHtml(receiptCode || "—")}</td>
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
${supplier.tax_code ? `<p>Mã số thuế: ${escapeHtml(supplier.tax_code)}</p>` : ""}
${supplier.address ? `<p>Địa chỉ: ${escapeHtml(supplier.address)}</p>` : ""}
${supplier.bank_account ? `<p>Số tài khoản: ${escapeHtml(supplier.bank_account)}${supplier.bank_name ? " tại " + escapeHtml(supplier.bank_name) : ""}</p>` : ""}
<table>
  <thead><tr><th>Stt</th><th>Nội dung</th><th>Đvt</th><th>Khối lượng</th><th>Đơn giá</th><th>Thành tiền</th><th>Số phiếu</th><th>Ghi chú</th></tr></thead>
  <tbody>
    ${bodyHtml}
    <tr class="total-row"><td colspan="5" class="num">Tổng cộng</td><td class="num">${fmtMoney(grandTotal).replace(" đ", "")}</td><td></td><td></td></tr>
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
        "Mã phiếu": r.vehicle_receipts ? r.vehicle_receipts.receipt_code || "" : "",
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
