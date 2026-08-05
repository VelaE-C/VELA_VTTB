/* ============================================================
   js/modules/congno.js
   Công nợ NCC — mặc định cấp CÔNG TY (ưu tiên, RLS tự lọc đúng phạm vi
   theo role), click 1 NCC để xem chi tiết theo từng dự án.
   ============================================================ */

const CongNo = {
  async render(container) {
    container.innerHTML = `<h2>Công nợ NCC</h2><div id="cn-body"></div>`;
    await this.renderCompany();
  },

  async renderCompany() {
    const body = document.getElementById("cn-body");
    body.innerHTML = `<div class="card">${emptyStateHtml("Đang tải...")}</div>`;
    loading(true, "Đang tải công nợ toàn công ty...");
    const { data, error } = await sb.from("v_supplier_debt_company").select("*");
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }

    const rows = (data || [])
      .map(
        (r) => `<tr>
          <td>${escapeHtml(r.supplier_name)}</td>
          <td class="num">${fmtMoney(r.total_invoiced)}</td>
          <td class="num">${fmtMoney(r.total_paid)}</td>
          <td class="num" style="${r.outstanding_debt > 0 ? "color:var(--red);font-weight:600" : ""}">${fmtMoney(r.outstanding_debt)}</td>
          <td>${r.has_overdue ? '<span class="badge badge-danger">Quá hạn</span>' : ""}</td>
          <td><button class="btn btn-sm btn-secondary" onclick="CongNo.openDrilldown('${r.supplier_id}', '${escapeHtml(r.supplier_name).replace(/'/g, "&#39;")}')">Xem theo dự án</button></td>
        </tr>`
      )
      .join("");

    body.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Công nợ toàn công ty (${(data || []).length} NCC)</h3></div>
        ${
          data && data.length
            ? `<table><thead><tr><th>NCC</th><th>Đã xuất hóa đơn</th><th>Đã thanh toán</th><th>Công nợ</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table>`
            : emptyStateHtml("Chưa có công nợ nào.")
        }
      </div>`;
  },

  async openDrilldown(supplierId, supplierName) {
    const body = document.getElementById("cn-body");
    body.innerHTML = `<div class="card">${emptyStateHtml("Đang tải...")}</div>`;
    loading(true, "Đang tải chi tiết theo dự án...");
    const { data, error } = await sb.from("v_supplier_debt_project").select("*").eq("supplier_id", supplierId);
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }

    const rows = (data || [])
      .map(
        (r) => `<tr>
          <td>${escapeHtml(r.project_name)}</td>
          <td class="num">${fmtMoney(r.total_invoiced)}</td>
          <td class="num">${fmtMoney(r.total_paid)}</td>
          <td class="num" style="${r.outstanding_debt > 0 ? "color:var(--red);font-weight:600" : ""}">${fmtMoney(r.outstanding_debt)}</td>
        </tr>`
      )
      .join("");

    body.innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="CongNo.render(document.getElementById('content-area'))">← Quay lại công nợ toàn công ty</button>
      <div class="card" style="margin-top:12px">
        <div class="card-header"><h3>${escapeHtml(supplierName)} — theo từng dự án</h3></div>
        ${
          data && data.length
            ? `<table><thead><tr><th>Dự án</th><th>Đã xuất hóa đơn</th><th>Đã thanh toán</th><th>Công nợ</th></tr></thead><tbody>${rows}</tbody></table>`
            : emptyStateHtml("Không có phát sinh dự án nào.")
        }
      </div>`;
  },
};

window.MODULES.congno = { render: (container) => CongNo.render(container) };
window.CongNo = CongNo;
