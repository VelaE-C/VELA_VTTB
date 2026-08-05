/* ============================================================
   js/modules/nhapchitiet.js
   A2b — Phòng Vật Tư xử lý hàng đợi các phiên xe đã chụp (A2a),
   nhập Vật tư + NCC + SL + đơn giá (gợi ý giá gần nhất). Hạng mục
   giờ tự suy ra từ vật tư đã chọn (Level 1/2), không nhập tay nữa.
   1 phiên xe (vehicle_receipt) có thể sinh nhiều dòng goods_receipts
   (1 xe chở nhiều loại vật tư).
   ============================================================ */

const NhapChiTiet = {
  viewMode: "queue", // queue | history
  currentSession: null,
  currentPhotos: [],
  currentLines: [], // các goods_receipts đã lưu cho phiên đang mở

  async render(container) {
    container.innerHTML = `
      <h2>Nhập chi tiết vật tư</h2>
      <div style="display:flex;gap:6px;margin-bottom:16px">
        <button class="btn btn-sm ${this.viewMode === "queue" ? "btn-primary" : "btn-secondary"}" onclick="NhapChiTiet.switchView('queue')">Hàng đợi</button>
        <button class="btn btn-sm ${this.viewMode === "history" ? "btn-primary" : "btn-secondary"}" onclick="NhapChiTiet.switchView('history')">Lịch sử đã nhập</button>
      </div>
      <div id="nct-body"></div>`;
    if (this.viewMode === "history") await this.renderHistory();
    else await this.renderQueue();
  },

  switchView(mode) {
    this.viewMode = mode;
    this.render(document.getElementById("content-area"));
  },

  async renderQueue() {
    const body = document.getElementById("nct-body");
    body.innerHTML = `<div class="card">${emptyStateHtml("Đang tải hàng đợi...")}</div>`;
    loading(true, "Đang tải danh sách phiên chờ nhập...");
    const { data, error } = await sb
      .from("vehicle_receipts")
      .select("*")
      .eq("status", "pending_detail")
      .order("created_at", { ascending: true });
    loading(false);
    if (error) { toast("Lỗi tải hàng đợi: " + error.message, "error"); return; }

    if (!data || !data.length) {
      body.innerHTML = `<div class="card">${emptyStateHtml("Không còn phiên nào chờ nhập chi tiết — đã xử lý hết.")}</div>`;
      return;
    }

    const rows = data
      .map((v) => {
        const project = STATE.projects.find((p) => p.id === v.project_id);
        const isBackfill = v.entry_method === "manual_backfill";
        return `<tr>
          <td class="mono">${escapeHtml(v.receipt_code || "—")}</td>
          <td>${escapeHtml(project ? project.project_name : "—")}</td>
          <td>${escapeHtml(v.plate_number)}</td>
          <td class="hide-mobile">${fmtDateTime(v.created_at)}</td>
          <td>${isBackfill ? '<span class="badge badge-progress">Nhập bù</span>' : '<span class="badge badge-info">Chụp trực tiếp</span>'}</td>
          <td><button class="btn btn-sm btn-primary" onclick="NhapChiTiet.openSession('${v.id}')">Nhập chi tiết</button></td>
        </tr>`;
      })
      .join("");

    body.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Hàng đợi chờ nhập (${data.length})</h3></div>
        <table><thead><tr><th>Mã phiếu</th><th>Dự án</th><th>Biển số</th><th class="hide-mobile">Thời điểm nhận</th><th>Loại</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      </div>`;
  },

  // ---------------- LỊCH SỬ ĐÃ NHẬP — filter ngày / dự án / NCC ----------------
  async renderHistory() {
    const body = document.getElementById("nct-body");
    body.innerHTML = `
      <div class="card">
        <div class="form-grid">
          <div class="field"><label>Từ ngày</label><input id="nct-hist-from" type="date"></div>
          <div class="field"><label>Đến ngày</label><input id="nct-hist-to" type="date"></div>
          <div class="field">
            <label>Dự án</label>
            <select id="nct-hist-project"><option value="">Tất cả dự án</option>${STATE.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.project_name)}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label>Nhà cung cấp</label>
            <select id="nct-hist-supplier"><option value="">Tất cả NCC</option>${STATE.suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.supplier_name)}</option>`).join("")}</select>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="NhapChiTiet.applyHistoryFilter()">Lọc</button>
      </div>
      <div id="nct-history-results"></div>`;
    this.applyHistoryFilter();
  },

  async applyHistoryFilter() {
    const results = document.getElementById("nct-history-results");
    results.innerHTML = `<div class="card">${emptyStateHtml("Đang tải...")}</div>`;
    loading(true, "Đang tải lịch sử đã nhập...");

    const fromDate = document.getElementById("nct-hist-from").value;
    const toDate = document.getElementById("nct-hist-to").value;
    const projectId = document.getElementById("nct-hist-project").value;
    const supplierId = document.getElementById("nct-hist-supplier").value;

    let q = sb
      .from("goods_receipts")
      .select("*, materials(material_code, material_name), suppliers(supplier_name), vehicle_receipts(plate_number, receipt_code)")
      .order("receipt_date", { ascending: false });
    if (fromDate) q = q.gte("receipt_date", fromDate);
    if (toDate) q = q.lte("receipt_date", toDate);
    if (projectId) q = q.eq("project_id", projectId);
    if (supplierId) q = q.eq("supplier_id", supplierId);

    const { data, error } = await q.limit(200);
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }

    const rows = (data || [])
      .map((r) => {
        const project = STATE.projects.find((p) => p.id === r.project_id);
        return `<tr class="hist-row" style="cursor:pointer" onclick="NhapChiTiet.openSession('${r.vehicle_receipt_id}')">
          <td class="mono">${escapeHtml(r.vehicle_receipts ? r.vehicle_receipts.receipt_code || "—" : "—")}</td>
          <td>${fmtDate(r.receipt_date)}</td>
          <td>${escapeHtml(project ? project.project_name : "—")}</td>
          <td class="hide-mobile">${escapeHtml(r.vehicle_receipts ? r.vehicle_receipts.plate_number : "—")}</td>
          <td>${escapeHtml(r.materials ? r.materials.material_code + " — " + r.materials.material_name : "—")}</td>
          <td>${escapeHtml(r.suppliers ? r.suppliers.supplier_name : "—")}</td>
          <td class="num">${fmtNumber(r.qty)} ${escapeHtml(r.unit || "")}</td>
          <td class="num">${fmtMoney(r.unit_price)}</td>
          <td class="num">${fmtMoney(r.qty * r.unit_price)}</td>
        </tr>`;
      })
      .join("");

    const total = (data || []).reduce((sum, r) => sum + r.qty * r.unit_price, 0);

    results.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Kết quả (${(data || []).length}${(data || []).length === 200 ? " — chỉ hiện 200 dòng gần nhất, thu hẹp bộ lọc để xem hết" : ""})</h3>
          <strong class="num">Tổng: ${fmtMoney(total)}</strong>
        </div>
        <div class="helper" style="margin-bottom:8px">Bấm vào 1 dòng để xem lại ảnh + toàn bộ vật tư của đúng xe đó.</div>
        ${
          data && data.length
            ? `<table><thead><tr><th>Mã phiếu</th><th>Ngày</th><th>Dự án</th><th class="hide-mobile">Biển số</th><th>Vật tư</th><th>NCC</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>${rows}</tbody></table>`
            : emptyStateHtml("Không có dữ liệu khớp bộ lọc.")
        }
      </div>`;
  },

  // ---------------- MỞ 1 PHIÊN ĐỂ NHẬP CHI TIẾT ----------------
  async openSession(sessionId) {
    loading(true, "Đang tải thông tin phiên...");
    const [{ data: session, error: sErr }, { data: photos }, { data: lines }] = await Promise.all([
      sb.from("vehicle_receipts").select("*").eq("id", sessionId).single(),
      sb.from("vehicle_receipt_photos").select("*").eq("vehicle_receipt_id", sessionId).order("step_order").order("page_number"),
      sb.from("goods_receipts").select("*, materials(material_code, material_name), suppliers(supplier_name)").eq("vehicle_receipt_id", sessionId),
    ]);
    if (sErr) { loading(false); toast("Lỗi: " + sErr.message, "error"); return; }

    // Ảnh lưu ở bucket private -> phải tạo signed URL mới xem được, không dùng public URL trực tiếp
    const photosWithUrl = await Promise.all(
      (photos || []).map(async (p) => {
        const { data: signed } = await sb.storage.from(CFG.STORAGE_BUCKET_VEHICLE_PHOTOS).createSignedUrl(p.file_url, 3600);
        return { ...p, signedUrl: signed ? signed.signedUrl : null };
      })
    );
    loading(false);

    this.currentSession = session;
    this.currentPhotos = photosWithUrl;
    this.currentLines = lines || [];
    this.renderSessionDetail();
  },

  async renderSessionDetail() {
    const s = this.currentSession;
    const project = STATE.projects.find((p) => p.id === s.project_id);
    const body = document.getElementById("nct-body");

    const photoLabels = { phieu_giao_nhan: "Phiếu giao nhận", dau_xe: "Đầu xe", sau_xe: "Sau lưng xe", hong_xe: "Bên hông xe" };
    const pgnCount = this.currentPhotos.filter((p) => p.photo_type === "phieu_giao_nhan").length;
    const photoGallery = this.currentPhotos.length
      ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:16px">
          ${this.currentPhotos
            .map((p) => {
              const label = photoLabels[p.photo_type] || p.photo_type;
              const pageSuffix = p.photo_type === "phieu_giao_nhan" && pgnCount > 1 ? ` (trang ${p.page_number})` : "";
              return `<div>
                <img src="${p.signedUrl || ""}" style="width:100%;border-radius:8px;border:1px solid var(--gray2);aspect-ratio:4/3;object-fit:cover" alt="${escapeHtml(label)}${pageSuffix}">
                <div style="font-size:11px;color:var(--gray5);text-align:center;margin-top:4px">${escapeHtml(label)}${pageSuffix}</div>
              </div>`;
            })
            .join("")}
        </div>`
      : emptyStateHtml("Phiên này chưa có ảnh nào.");

    const linesHtml = this.currentLines.length
      ? `<table><thead><tr><th>Vật tư</th><th>NCC</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th><th></th></tr></thead><tbody>
          ${this.currentLines
            .map(
              (l) => `<tr>
                <td>${escapeHtml(l.materials ? l.materials.material_code + " — " + l.materials.material_name : "—")}</td>
                <td>${escapeHtml(l.suppliers ? l.suppliers.supplier_name : "—")}</td>
                <td class="num">${fmtNumber(l.qty)} ${escapeHtml(l.unit || "")}</td>
                <td class="num">${fmtMoney(l.unit_price)}</td>
                <td class="num">${fmtMoney(l.qty * l.unit_price)}</td>
                <td><button class="btn btn-sm btn-secondary" onclick="NhapChiTiet.deleteLine('${l.id}')">Xóa</button></td>
              </tr>`
            )
            .join("")}
        </tbody></table>`
      : emptyStateHtml("Chưa có dòng vật tư nào — thêm ít nhất 1 dòng bên dưới.");

    body.innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="NhapChiTiet.render(document.getElementById('content-area'))">← Quay lại hàng đợi</button>
      <div class="card" style="margin-top:12px">
        <div class="card-header">
          <h3>${escapeHtml(project ? project.project_name : "")} — Biển số ${escapeHtml(s.plate_number)} <span class="mono" style="font-weight:400;color:var(--gray5)">(${escapeHtml(s.receipt_code || "—")})</span></h3>
          ${s.entry_method === "manual_backfill" ? '<span class="badge badge-progress">Nhập bù — không chụp trực tiếp</span>' : ""}
        </div>
        <div class="helper" style="margin-bottom:12px">Nhận lúc ${fmtDateTime(s.created_at)} (giờ server)</div>
        ${photoGallery}
      </div>

      <div class="card">
        <h3>Dòng vật tư đã nhập</h3>
        ${linesHtml}
      </div>

      <div class="card">
        <h3>Thêm dòng vật tư</h3>
        <div class="form-grid">
          <div class="field">
            <label>Vật tư</label>
            <select id="nct-material" onchange="NhapChiTiet.onMaterialChange()">
              <option value="">— Chọn vật tư —</option>
              ${this.materialSelectOptions()}
            </select>
          </div>
          <div class="field">
            <label>Nhà cung cấp</label>
            <select id="nct-supplier">
              <option value="">— Chọn NCC —</option>
              ${STATE.suppliers.map((sp) => `<option value="${sp.id}">${escapeHtml(sp.supplier_name)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Đơn vị</label>
            <input id="nct-unit" readonly placeholder="Tự lấy theo vật tư đã chọn" style="background:var(--gray1);color:var(--gray5)">
          </div>
          <div class="field">
            <label>Số lượng</label>
            <input id="nct-qty" placeholder="0">
          </div>
          <div class="field">
            <label>Đơn giá <span class="helper" id="nct-price-hint"></span></label>
            <input id="nct-price" placeholder="0">
          </div>
        </div>
        <button class="btn btn-primary" onclick="NhapChiTiet.addLine()">+ Thêm dòng</button>
      </div>

      <button class="btn btn-primary" style="margin-top:4px" onclick="NhapChiTiet.finishSession()">Hoàn tất xe này</button>`;

    attachNumberFormat("nct-qty");
    attachNumberFormat("nct-price");
  },

  // Khi chọn vật tư -> tự đổ đơn vị mặc định (khóa, không sửa được) + gợi ý giá gần nhất
  // Gom vật tư theo Level 1 > Level 2 dưới dạng <optgroup> — dễ tìm hơn khi danh sách dài
  materialSelectOptions() {
    const l2ById = {};
    STATE.materialGroupsL2.forEach((g) => { l2ById[g.id] = g; });
    const l1ById = {};
    STATE.materialGroupsL1.forEach((g) => { l1ById[g.id] = g; });

    const groups = {}; // key: "l1_name|||l2_name" -> [materials]
    const noGroup = [];
    STATE.materials.forEach((m) => {
      const l2 = l2ById[m.l2_id];
      const l1 = l2 ? l1ById[l2.l1_id] : null;
      if (!l2 || !l1) { noGroup.push(m); return; }
      const key = `${l1.name}|||${l2.name}`;
      groups[key] = groups[key] || [];
      groups[key].push(m);
    });

    const sortedKeys = Object.keys(groups).sort();
    let html = sortedKeys
      .map((key) => {
        const [l1name, l2name] = key.split("|||");
        const opts = groups[key]
          .sort((a, b) => a.material_code.localeCompare(b.material_code))
          .map((m) => `<option value="${m.id}">${escapeHtml(m.material_code)} — ${escapeHtml(m.material_name)}</option>`)
          .join("");
        return `<optgroup label="${escapeHtml(l1name)} › ${escapeHtml(l2name)}">${opts}</optgroup>`;
      })
      .join("");

    if (noGroup.length) {
      html += `<optgroup label="Chưa gán nhóm (vào Danh mục gán trước)">${noGroup
        .map((m) => `<option value="${m.id}">${escapeHtml(m.material_code)} — ${escapeHtml(m.material_name)}</option>`)
        .join("")}</optgroup>`;
    }
    return html;
  },

  async onMaterialChange() {
    const materialId = document.getElementById("nct-material").value;
    const material = STATE.materials.find((m) => m.id === materialId);
    const unitEl = document.getElementById("nct-unit");
    if (!material) { unitEl.value = ""; return; }
    unitEl.value = material.default_unit || "";

    const hint = document.getElementById("nct-price-hint");
    hint.textContent = "(đang tra giá gần nhất...)";
    const { data } = await sb
      .from("goods_receipts")
      .select("unit_price, receipt_date")
      .eq("material_id", material.id)
      .order("receipt_date", { ascending: false })
      .limit(1);
    if (data && data.length) {
      document.getElementById("nct-price").value = Number(data[0].unit_price).toLocaleString("vi-VN");
      hint.textContent = `(gợi ý theo giá ngày ${fmtDate(data[0].receipt_date)} — sửa lại nếu khác)`;
    } else {
      hint.textContent = "(chưa có giá tham khảo — vật tư mới)";
    }
  },

  async addLine() {
    const materialId = document.getElementById("nct-material").value;
    const material = STATE.materials.find((m) => m.id === materialId);
    const supplierId = document.getElementById("nct-supplier").value;
    const supplier = STATE.suppliers.find((s) => s.id === supplierId);
    const unit = document.getElementById("nct-unit").value.trim();
    const qty = parseFormattedNumber("nct-qty");
    const price = parseFormattedNumber("nct-price");

    if (!material) { toast("Chọn 1 vật tư trong danh mục", "error"); return; }
    if (!supplier) { toast("Chọn 1 NCC trong danh mục", "error"); return; }
    if (!qty || qty <= 0) { toast("Nhập số lượng hợp lệ", "error"); return; }
    if (isNaN(price) || price < 0) { toast("Nhập đơn giá hợp lệ", "error"); return; }

    loading(true, "Đang lưu...");
    const { data, error } = await sb
      .from("goods_receipts")
      .insert({
        vehicle_receipt_id: this.currentSession.id,
        project_id: this.currentSession.project_id,
        supplier_id: supplier.id,
        material_id: material.id,
        unit: unit || null,
        qty,
        unit_price: price,
        created_by: STATE.user.id,
      })
      .select("*, materials(material_code, material_name), suppliers(supplier_name)")
      .single();
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }

    this.currentLines.push(data);
    toast("Đã thêm dòng vật tư!", "success");
    this.renderSessionDetail();
  },

  async deleteLine(lineId) {
    if (!confirm("Xóa dòng vật tư này? Không thể khôi phục.")) return;
    loading(true, "Đang xóa...");
    const { error } = await sb.from("goods_receipts").delete().eq("id", lineId);
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    this.currentLines = this.currentLines.filter((l) => l.id !== lineId);
    toast("Đã xóa!", "success");
    this.renderSessionDetail();
  },

  async finishSession() {
    if (!this.currentLines.length) { toast("Thêm ít nhất 1 dòng vật tư trước khi hoàn tất", "error"); return; }
    loading(true, "Đang hoàn tất phiên...");
    const { error } = await sb.from("vehicle_receipts").update({ status: "detailed" }).eq("id", this.currentSession.id);
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    toast("Đã hoàn tất phiên — chuyển phiên tiếp theo trong hàng đợi.", "success");
    this.render(document.getElementById("content-area"));
  },
};

window.MODULES.nhapchitiet = { render: (container) => NhapChiTiet.render(container) };
window.NhapChiTiet = NhapChiTiet;
