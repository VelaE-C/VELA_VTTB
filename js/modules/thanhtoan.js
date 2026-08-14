/* ============================================================
   js/modules/thanhtoan.js
   A4 — Kế toán nhập thanh toán, ĐỘC LẬP với hóa đơn cụ thể.
   Dự án -> NCC -> xem công nợ hiện tại (hiện sẵn để đối chiếu) ->
   nhập đợt TT, ngày, số tiền, phương thức.
   ============================================================ */

const ThanhToan = {
  async render(container) {
    container.innerHTML = `<h2>Thanh toán</h2><div id="tt-body"></div>`;
    this.renderForm();
    this.renderRecent();
  },

  renderForm() {
    const body = document.getElementById("tt-body");
    body.innerHTML = `
      <div class="card">
        <h3>Nhập thanh toán mới</h3>
        <div class="form-grid">
          <div class="field">
            <label>Dự án</label>
            <select id="tt-project" onchange="ThanhToan.onProjectSupplierChange()">${STATE.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.project_name)}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label>Nhà cung cấp</label>
            <input id="tt-supplier" list="tt-supplier-list" placeholder="Gõ tên NCC" onchange="ThanhToan.onProjectSupplierChange()">
            <datalist id="tt-supplier-list">${STATE.suppliers.map((s) => `<option value="${escapeHtml(s.supplier_name)}">`).join("")}</datalist>
          </div>
        </div>
        <div id="tt-debt-hint"></div>
        <div class="form-grid" style="margin-top:6px">
          <div class="field"><label>Đợt thanh toán</label><input id="tt-batch" placeholder="VD: TT đợt 3 - T8/2026"></div>
          <div class="field"><label>Ngày thanh toán</label>${dateInputHtml("tt-date", new Date().toISOString().slice(0, 10))}</div>
          <div class="field"><label>Số tiền</label><input id="tt-amount" type="number" step="any" placeholder="0"></div>
          <div class="field">
            <label>Phương thức</label>
            <select id="tt-method"><option>Chuyển khoản</option><option>Tiền mặt</option><option>Khác</option></select>
          </div>
          <div class="field full"><label>Ghi chú</label><textarea id="tt-note"></textarea></div>
        </div>
        <button class="btn btn-primary" onclick="ThanhToan.save()">Lưu thanh toán</button>
      </div>
      <div id="tt-recent"></div>`;
    initDateInput("tt-date");
  },

  async onProjectSupplierChange() {
    const projectId = document.getElementById("tt-project").value;
    const supplierVal = document.getElementById("tt-supplier").value.trim();
    const supplier = STATE.suppliers.find((s) => s.supplier_name === supplierVal);
    const hint = document.getElementById("tt-debt-hint");
    if (!projectId || !supplier) { hint.innerHTML = ""; return; }

    hint.innerHTML = `<div class="helper">Đang tải công nợ hiện tại...</div>`;
    const { data } = await sb.from("v_supplier_debt_project").select("*").eq("project_id", projectId).eq("supplier_id", supplier.id).maybeSingle();
    const project = STATE.projects.find((p) => p.id === projectId);
    if (!data) {
      hint.innerHTML = `<div class="callout" style="background:var(--lblue);padding:10px;border-radius:6px;font-size:12.5px;color:var(--blue)">Chưa có phát sinh hóa đơn/thanh toán nào giữa ${escapeHtml(supplier.supplier_name)} và ${escapeHtml(project ? project.project_name : "")}.</div>`;
      return;
    }
    hint.innerHTML = `<div class="callout" style="background:var(--lblue);padding:10px;border-radius:6px;font-size:12.5px;color:var(--blue)">
      Công nợ hiện tại của <strong>${escapeHtml(supplier.supplier_name)}</strong> tại <strong>${escapeHtml(project ? project.project_name : "")}</strong>:
      <strong class="num">${fmtMoney(data.outstanding_debt)}</strong>
      (đã xuất hóa đơn ${fmtMoney(data.total_invoiced)} · đã trả ${fmtMoney(data.total_paid)})
    </div>`;
  },

  async save() {
    const projectId = document.getElementById("tt-project").value;
    const supplierVal = document.getElementById("tt-supplier").value.trim();
    const supplier = STATE.suppliers.find((s) => s.supplier_name === supplierVal);
    const batch = document.getElementById("tt-batch").value.trim();
    const date = getDateInputValue("tt-date");
    const amount = parseFloat(document.getElementById("tt-amount").value);
    const method = document.getElementById("tt-method").value;
    const note = document.getElementById("tt-note").value.trim();

    if (!supplier) { toast("Chọn đúng 1 NCC từ danh sách gợi ý", "error"); return; }
    if (!date) { toast("Nhập ngày thanh toán", "error"); return; }
    if (!amount || amount <= 0) { toast("Nhập số tiền hợp lệ", "error"); return; }

    loading(true, "Đang lưu thanh toán...");
    const { error } = await sb.from("payments").insert({
      project_id: projectId,
      supplier_id: supplier.id,
      payment_batch: batch || null,
      payment_date: date,
      amount,
      payment_method: method,
      note: note || null,
      created_by: STATE.user.id,
    });
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    toast("Đã lưu thanh toán!", "success");
    document.getElementById("tt-amount").value = "";
    document.getElementById("tt-batch").value = "";
    document.getElementById("tt-note").value = "";
    this.onProjectSupplierChange(); // cập nhật lại công nợ hiện tại ngay
    this.renderRecent();
  },

  async renderRecent() {
    const el = document.getElementById("tt-recent");
    loading(true, "Đang tải lịch sử thanh toán...");
    const { data, error } = await sb.from("payments").select("*").order("payment_date", { ascending: false }).limit(20);
    loading(false);
    if (error) { el.innerHTML = ""; return; }

    const rows = (data || [])
      .map((p) => {
        const project = STATE.projects.find((pr) => pr.id === p.project_id);
        const supplier = STATE.suppliers.find((s) => s.id === p.supplier_id);
        return `<tr>
          <td>${fmtDate(p.payment_date)}</td>
          <td>${escapeHtml(project ? project.project_name : "—")}</td>
          <td>${escapeHtml(supplier ? supplier.supplier_name : "—")}</td>
          <td class="hide-mobile">${escapeHtml(p.payment_batch || "—")}</td>
          <td class="num">${fmtMoney(p.amount)}</td>
        </tr>`;
      })
      .join("");

    el.innerHTML = `
      <div class="card">
        <h3>20 thanh toán gần nhất</h3>
        ${data && data.length ? `<table><thead><tr><th>Ngày</th><th>Dự án</th><th>NCC</th><th class="hide-mobile">Đợt TT</th><th>Số tiền</th></tr></thead><tbody>${rows}</tbody></table>` : emptyStateHtml("Chưa có thanh toán nào.")}
      </div>`;
  },
};

window.MODULES.thanhtoan = { render: (container) => ThanhToan.render(container) };
window.ThanhToan = ThanhToan;
