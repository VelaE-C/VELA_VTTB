/* ============================================================
   js/modules/hoadon.js
   A3 — Kế toán đối chiếu hóa đơn NCC với các phiếu nhận hàng.
   Luồng: nhập số tiền hóa đơn (stated_amount, cố định) -> tick các
   phiếu nhận hàng khớp -> chênh lệch hiện real-time -> xử lý bằng
   tick thêm / sửa giá / thêm dòng phát sinh -> lưu tạm được dù
   chưa khớp (không chặn cứng).
   ============================================================ */

const HoaDon = {
  currentInvoice: null,
  pendingReceipts: [], // phiếu nhận hàng chưa vào hóa đơn nào, đúng cặp dự án+NCC
  invoiceItems: [], // dòng đã lưu trong hóa đơn đang mở

  async render(container) {
    container.innerHTML = `<h2>Hóa đơn</h2><div id="hd-body"></div>`;
    await this.renderList();
  },

  async renderList() {
    const body = document.getElementById("hd-body");
    body.innerHTML = `<div class="card">${emptyStateHtml("Đang tải...")}</div>`;
    loading(true, "Đang tải danh sách hóa đơn...");
    const [{ data: invoices, error }, { data: reco }] = await Promise.all([
      sb.from("invoices").select("*").order("invoice_date", { ascending: false }),
      sb.from("v_invoice_reconciliation").select("*"),
    ]);
    loading(false);
    if (error) { toast("Lỗi tải hóa đơn: " + error.message, "error"); return; }

    const recoMap = {};
    (reco || []).forEach((r) => { recoMap[r.invoice_id] = r; });

    const rows = (invoices || [])
      .map((inv) => {
        const project = STATE.projects.find((p) => p.id === inv.project_id);
        const supplier = STATE.suppliers.find((s) => s.id === inv.supplier_id);
        const r = recoMap[inv.id];
        const matched = r && r.is_matched;
        return `<tr>
          <td>${escapeHtml(project ? project.project_name : "—")}</td>
          <td>${escapeHtml(supplier ? supplier.supplier_name : "—")}</td>
          <td class="hide-mobile">${escapeHtml(inv.invoice_no || "—")}</td>
          <td class="hide-mobile">${fmtDate(inv.invoice_date)}</td>
          <td class="num">${fmtMoney(inv.stated_amount)}</td>
          <td>${matched ? '<span class="badge badge-done">Đã khớp</span>' : `<span class="badge badge-danger">Chưa khớp${r ? " (" + fmtMoney(r.delta) + ")" : ""}</span>`}</td>
          <td><button class="btn btn-sm btn-secondary" onclick="HoaDon.openInvoice('${inv.id}')">Mở</button></td>
        </tr>`;
      })
      .join("");

    body.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Danh sách hóa đơn (${(invoices || []).length})</h3>
          <button class="btn btn-primary btn-sm" onclick="HoaDon.openCreateForm()">+ Tạo hóa đơn</button>
        </div>
        ${
          invoices && invoices.length
            ? `<table><thead><tr><th>Dự án</th><th>NCC</th><th class="hide-mobile">Số HĐ</th><th class="hide-mobile">Ngày HĐ</th><th>Tiền HĐ</th><th>Trạng thái</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
            : emptyStateHtml("Chưa có hóa đơn nào.")
        }
      </div>`;
  },

  // ---------------- TẠO HÓA ĐƠN (header trước) ----------------
  openCreateForm() {
    const body = document.getElementById("hd-body");
    body.innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="HoaDon.render(document.getElementById('content-area'))">← Quay lại danh sách</button>
      <div class="card" style="margin-top:12px">
        <h3>Tạo hóa đơn mới</h3>
        <div class="form-grid">
          <div class="field">
            <label>Dự án</label>
            <select id="hd-project">${STATE.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.project_name)}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label>Nhà cung cấp</label>
            <input id="hd-supplier" list="hd-supplier-list" placeholder="Gõ tên NCC">
            <datalist id="hd-supplier-list">${STATE.suppliers.map((s) => `<option value="${escapeHtml(s.supplier_name)}">`).join("")}</datalist>
          </div>
          <div class="field"><label>Số hóa đơn</label><input id="hd-invoice-no" placeholder="VD: 00003580"></div>
          <div class="field"><label>Ngày hóa đơn</label>${dateInputHtml("hd-invoice-date", new Date().toISOString().slice(0, 10))}</div>
          <div class="field"><label>Hạn thanh toán</label>${dateInputHtml("hd-due-date")}</div>
          <div class="field"><label>% Thuế GTGT</label><input id="hd-vat" type="number" step="any" value="8"></div>
          <div class="field">
            <label>Số tiền NCC ghi trên hóa đơn (bắt buộc)</label>
            <input id="hd-stated" type="number" step="any" placeholder="0">
            <div class="helper">Đây là mục tiêu cần khớp — nhập đúng số NCC ghi, không tự tính.</div>
          </div>
        </div>
        <button class="btn btn-primary" onclick="HoaDon.saveHeader()">Tạo và đối chiếu</button>
      </div>`;
    initDateInput("hd-invoice-date");
    initDateInput("hd-due-date");
  },

  async saveHeader() {
    const projectId = document.getElementById("hd-project").value;
    const supplierVal = document.getElementById("hd-supplier").value.trim();
    const supplier = STATE.suppliers.find((s) => s.supplier_name === supplierVal);
    const invoiceNo = document.getElementById("hd-invoice-no").value.trim();
    const invoiceDate = getDateInputValue("hd-invoice-date");
    const dueDate = getDateInputValue("hd-due-date");
    const vat = parseFloat(document.getElementById("hd-vat").value) || 0;
    const stated = parseFloat(document.getElementById("hd-stated").value);

    if (!supplier) { toast("Chọn đúng 1 NCC từ danh sách gợi ý", "error"); return; }
    if (!invoiceDate) { toast("Nhập ngày hóa đơn", "error"); return; }
    if (isNaN(stated) || stated <= 0) { toast("Nhập số tiền hóa đơn hợp lệ", "error"); return; }

    loading(true, "Đang tạo hóa đơn...");
    const { data, error } = await sb
      .from("invoices")
      .insert({
        project_id: projectId,
        supplier_id: supplier.id,
        invoice_no: invoiceNo || null,
        invoice_date: invoiceDate,
        due_date: dueDate || null,
        vat_rate: vat,
        stated_amount: stated,
        created_by: STATE.user.id,
      })
      .select()
      .single();
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    toast("Đã tạo hóa đơn — bắt đầu đối chiếu.", "success");
    this.openInvoice(data.id);
  },

  // ---------------- MỞ HÓA ĐƠN ĐỂ ĐỐI CHIẾU ----------------
  async openInvoice(invoiceId) {
    loading(true, "Đang tải dữ liệu đối chiếu...");
    const { data: invoice, error } = await sb.from("invoices").select("*").eq("id", invoiceId).single();
    if (error) { loading(false); toast("Lỗi: " + error.message, "error"); return; }

    const [{ data: pending }, { data: items }] = await Promise.all([
      sb.from("v_goods_receipts_pending").select("*, materials(material_code, material_name)").eq("project_id", invoice.project_id).eq("supplier_id", invoice.supplier_id),
      sb.from("invoice_items").select("*, materials(material_code, material_name), goods_receipts(receipt_date)").eq("invoice_id", invoiceId),
    ]);
    loading(false);

    this.currentInvoice = invoice;
    this.pendingReceipts = pending || [];
    this.invoiceItems = items || [];
    this.renderInvoiceDetail();
  },

  async renderInvoiceDetail() {
    const inv = this.currentInvoice;
    const project = STATE.projects.find((p) => p.id === inv.project_id);
    const supplier = STATE.suppliers.find((s) => s.id === inv.supplier_id);

    const tickedTotal = this.invoiceItems.reduce((sum, l) => sum + l.qty * l.unit_price, 0);
    const delta = inv.stated_amount - tickedTotal;
    const isMatched = Math.abs(delta) < 1;

    const pendingRows = this.pendingReceipts
      .map(
        (r) => `<tr>
          <td><input type="checkbox" class="hd-pending-check" value="${r.id}" style="width:auto;height:auto"></td>
          <td>${escapeHtml(r.materials ? r.materials.material_code + " — " + r.materials.material_name : "—")}</td>
          <td class="hide-mobile">${fmtDate(r.receipt_date)}</td>
          <td class="num">${fmtNumber(r.qty)} ${escapeHtml(r.unit || "")}</td>
          <td><input type="number" step="any" class="hd-pending-price" data-receipt="${r.id}" value="${r.unit_price}" style="height:32px"></td>
        </tr>`
      )
      .join("");

    const itemRows = this.invoiceItems
      .map(
        (l) => `<tr>
          <td>${l.material_id ? escapeHtml(l.materials.material_code + " — " + l.materials.material_name) : `<em>${escapeHtml(l.description || "Phát sinh")}</em>`}</td>
          <td>${l.receipt_id ? '<span class="badge badge-info">Từ phiếu nhận</span>' : '<span class="badge badge-none">Tự thêm</span>'}</td>
          <td class="num">${fmtNumber(l.qty)}</td>
          <td class="num">${fmtMoney(l.unit_price)}</td>
          <td class="num">${fmtMoney(l.qty * l.unit_price)}</td>
          <td><button class="btn btn-sm btn-secondary" onclick="HoaDon.deleteItem('${l.id}')">Xóa</button></td>
        </tr>`
      )
      .join("");

    document.getElementById("hd-body").innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="HoaDon.render(document.getElementById('content-area'))">← Quay lại danh sách</button>

      <div class="card" style="margin-top:12px">
        <div class="card-header">
          <h3>${escapeHtml(project ? project.project_name : "")} — ${escapeHtml(supplier ? supplier.supplier_name : "")}${inv.invoice_no ? " · HĐ " + escapeHtml(inv.invoice_no) : ""}</h3>
          ${isMatched ? '<span class="badge badge-done">Đã khớp</span>' : '<span class="badge badge-danger">Chưa khớp</span>'}
        </div>
        <div style="display:flex;gap:24px;flex-wrap:wrap;font-size:13.5px">
          <div>Số tiền hóa đơn: <strong class="num">${fmtMoney(inv.stated_amount)}</strong></div>
          <div>Đã đối chiếu: <strong class="num">${fmtMoney(tickedTotal)}</strong></div>
          <div>Chênh lệch: <strong class="num" style="color:${isMatched ? "var(--green)" : "var(--red)"}">${fmtMoney(delta)}</strong></div>
        </div>
      </div>

      <div class="card">
        <h3>Phiếu nhận hàng chưa đối chiếu (${this.pendingReceipts.length})</h3>
        ${
          this.pendingReceipts.length
            ? `<table><thead><tr><th></th><th>Vật tư</th><th class="hide-mobile">Ngày nhận</th><th>SL</th><th>Đơn giá (sửa được)</th></tr></thead><tbody>${pendingRows}</tbody></table>
               <button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="HoaDon.addTickedLines()">Thêm các dòng đã tick</button>`
            : emptyStateHtml("Không còn phiếu nhận hàng nào chưa đối chiếu cho đúng cặp Dự án–NCC này.")
        }
      </div>

      <div class="card">
        <h3>Dòng đã đưa vào hóa đơn (${this.invoiceItems.length})</h3>
        ${this.invoiceItems.length ? `<table><thead><tr><th>Vật tư / Mô tả</th><th>Nguồn</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th><th></th></tr></thead><tbody>${itemRows}</tbody></table>` : emptyStateHtml("Chưa có dòng nào.")}
      </div>

      <div class="card">
        <h3>Thêm dòng phát sinh (phí vận chuyển, chiết khấu...)</h3>
        <div class="form-grid">
          <div class="field full"><label>Mô tả</label><input id="hd-free-desc" placeholder="VD: Phí vận chuyển đợt giao hàng"></div>
          <div class="field"><label>Số lượng</label><input id="hd-free-qty" type="number" step="any" value="1"></div>
          <div class="field"><label>Đơn giá</label><input id="hd-free-price" type="number" step="any" placeholder="Số dương = cộng thêm, số âm = chiết khấu"></div>
        </div>
        <button class="btn btn-secondary" onclick="HoaDon.addFreeLine()">+ Thêm dòng phát sinh</button>
      </div>`;
  },

  async addTickedLines() {
    const checked = Array.from(document.querySelectorAll(".hd-pending-check:checked")).map((el) => el.value);
    if (!checked.length) { toast("Tick ít nhất 1 dòng", "error"); return; }

    const payload = checked.map((receiptId) => {
      const receipt = this.pendingReceipts.find((r) => r.id === receiptId);
      const priceInput = document.querySelector(`.hd-pending-price[data-receipt="${receiptId}"]`);
      const price = parseFloat(priceInput.value);
      return {
        invoice_id: this.currentInvoice.id,
        receipt_id: receiptId,
        material_id: receipt.material_id,
        qty: receipt.qty,
        unit_price: isNaN(price) ? receipt.unit_price : price,
      };
    });

    loading(true, "Đang thêm dòng vào hóa đơn...");
    const { error } = await sb.from("invoice_items").insert(payload);
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    toast("Đã thêm " + payload.length + " dòng!", "success");
    this.openInvoice(this.currentInvoice.id); // tải lại toàn bộ để đồng bộ danh sách chờ + chênh lệch
  },

  async addFreeLine() {
    const desc = document.getElementById("hd-free-desc").value.trim();
    const qty = parseFloat(document.getElementById("hd-free-qty").value);
    const price = parseFloat(document.getElementById("hd-free-price").value);
    if (!desc) { toast("Nhập mô tả dòng phát sinh", "error"); return; }
    if (!qty || isNaN(price)) { toast("Nhập số lượng và đơn giá hợp lệ", "error"); return; }

    loading(true, "Đang lưu...");
    const { error } = await sb.from("invoice_items").insert({
      invoice_id: this.currentInvoice.id,
      description: desc,
      qty,
      unit_price: price,
    });
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    toast("Đã thêm dòng phát sinh!", "success");
    this.openInvoice(this.currentInvoice.id);
  },

  async deleteItem(itemId) {
    if (!confirm("Xóa dòng này khỏi hóa đơn? Nếu là dòng từ phiếu nhận hàng, phiếu đó sẽ quay lại danh sách chờ đối chiếu.")) return;
    loading(true, "Đang xóa...");
    const { error } = await sb.from("invoice_items").delete().eq("id", itemId);
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    toast("Đã xóa!", "success");
    this.openInvoice(this.currentInvoice.id);
  },
};

window.MODULES.hoadon = { render: (container) => HoaDon.render(container) };
window.HoaDon = HoaDon;
