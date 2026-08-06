/* ============================================================
   js/modules/dashboard.js
   Tổng quan — KPI + cảnh báo ngân sách + chi phí theo ngày (SVG tự vẽ,
   không dùng thư viện ngoài) + top công nợ + thiết bị + vật tư sắp vượt
   dự trù. Đọc STATE.currentProjectFilter (topbar) để lọc theo dự án —
   null = toàn công ty (chỉ admin/manager mới có lựa chọn này).
   ============================================================ */

const Dashboard = {
  async render(container) {
    container.innerHTML = `<h2>Tổng quan</h2><div id="db-body">${emptyStateHtml("Đang tải...")}</div>`;
    loading(true, "Đang tải dữ liệu tổng quan...");
    try {
      await this.load();
    } finally {
      loading(false);
    }
  },

  async load() {
    const projectId = STATE.currentProjectFilter; // null = toàn công ty
    const body = document.getElementById("db-body");

    let alertsQuery = sb.from("v_budget_alert").select("*");
    if (projectId) alertsQuery = alertsQuery.eq("project_id", projectId);

    const [{ data: alerts }, { data: debtCompany }, debtProjectRes, { data: dailyCompany }, dailyProjectRes, { data: assetValue }, { data: assetLoss }, { data: payments }] = await Promise.all([
      alertsQuery,
      sb.from("v_supplier_debt_company").select("*"),
      projectId ? sb.from("v_supplier_debt_project").select("*").eq("project_id", projectId) : Promise.resolve({ data: null }),
      sb.from("v_material_daily_cost_company").select("*").order("receipt_date", { ascending: true }).limit(60),
      projectId ? sb.from("v_material_daily_cost_project").select("*").eq("project_id", projectId).order("receipt_date", { ascending: true }).limit(60) : Promise.resolve({ data: null }),
      sb.from("v_asset_value_by_project").select("*"),
      sb.from("v_asset_loss_summary").select("*"),
      sb.from("payments").select("amount, project_id"),
    ]);

    // --- KPI: chỉ cộng dòng Level 1 để tránh đếm trùng (Level 1 đã tự cộng dồn Level 2/3 bên dưới) ---
    const level1Rows = (alerts || []).filter((a) => a.level === 1);
    const totalBudget = level1Rows.reduce((sum, a) => sum + (a.budget_amount || 0), 0);
    const totalCommitted = level1Rows.reduce((sum, a) => sum + (a.committed_amount || 0), 0);
    const totalPaid = (payments || []).filter((p) => !projectId || p.project_id === projectId).reduce((sum, p) => sum + p.amount, 0);
    const debtRows = projectId ? debtProjectRes.data || [] : debtCompany || [];
    const totalDebt = debtRows.reduce((sum, d) => sum + d.outstanding_debt, 0);

    // --- Cảnh báo ngân sách: ưu tiên mức nghiêm trọng nhất lên đầu ---
    const priority = { over_budget: 0, critical_85: 1, warning_70: 2, ok: 3 };
    const sortedAlerts = [...(alerts || [])]
      .filter((a) => a.budget_amount != null)
      .sort((a, b) => (priority[a.alert_level] ?? 9) - (priority[b.alert_level] ?? 9) || (b.pct_used || 0) - (a.pct_used || 0));

    // --- Vật tư sắp vượt dự trù (số lượng) ---
    const qtyWarnings = [...(alerts || [])].filter((a) => a.planned_qty != null && (a.pct_received || 0) >= 70).sort((a, b) => (b.pct_received || 0) - (a.pct_received || 0));

    // --- Top công nợ (5 NCC nợ nhiều nhất) ---
    const topDebt = [...debtRows].sort((a, b) => b.outstanding_debt - a.outstanding_debt).slice(0, 5);

    // --- Chi phí theo ngày (chọn nguồn theo phạm vi đang lọc) ---
    const dailyData = projectId ? dailyProjectRes.data || [] : dailyCompany || [];
    const dailyKey = "daily_cost";
    const dailyDateKey = "receipt_date";

    // --- Thiết bị ---
    const assetRows = projectId ? (assetValue || []).filter((a) => a.project_id === projectId) : assetValue || [];
    const assetTotalValue = assetRows.reduce((sum, a) => sum + a.asset_value, 0);
    const lossRows = (assetLoss || []).filter((a) => a.qty_unaccounted > 0);

    body.innerHTML = `
      <div class="kpi-row" style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px">
        ${this.kpiCard("Tổng ngân sách", fmtMoney(totalBudget), "Cấp Level 1")}
        ${this.kpiCard("Đã cam kết", fmtMoney(totalCommitted), totalBudget ? Math.round((totalCommitted / totalBudget) * 100) + "% ngân sách" : "")}
        ${this.kpiCard("Đã thanh toán", fmtMoney(totalPaid), totalCommitted ? Math.round((totalPaid / totalCommitted) * 100) + "% đã cam kết" : "")}
        ${this.kpiCard("Công nợ hiện tại", fmtMoney(totalDebt), debtRows.some((d) => d.has_overdue) ? "Có NCC quá hạn" : "")}
      </div>

      <div class="card">
        <div class="card-header"><h3>Cảnh báo ngân sách theo hạng mục</h3></div>
        ${
          sortedAlerts.length
            ? `<table><thead><tr><th>Cấp</th><th>Hạng mục</th><th>Đã dùng / Ngân sách</th><th>%</th><th>Trạng thái</th></tr></thead><tbody>
                ${sortedAlerts
                  .slice(0, 15)
                  .map(
                    (a) => `<tr>
                      <td>${a.level}</td>
                      <td>${this.pathLabel(a)}</td>
                      <td class="num">${fmtMoney(a.committed_amount)} / ${fmtMoney(a.budget_amount)}</td>
                      <td class="num">${a.pct_used || 0}%</td>
                      <td>${budgetAlertBadge(a.alert_level)}</td>
                    </tr>`
                  )
                  .join("")}
              </tbody></table>`
            : emptyStateHtml("Chưa có ngân sách nào được thiết lập.")
        }
      </div>

      <div class="card">
        <div class="card-header"><h3>Chi phí vật tư theo ngày</h3></div>
        <div id="db-chart">${dailyData.length ? "" : emptyStateHtml("Chưa có dữ liệu.")}</div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Top công nợ NCC${projectId ? " (dự án đang xem)" : " (toàn công ty)"}</h3></div>
        ${
          topDebt.length
            ? `<table><thead><tr><th>NCC</th><th>Đã xuất hóa đơn</th><th>Đã trả</th><th>Công nợ</th><th></th></tr></thead><tbody>
                ${topDebt
                  .map(
                    (d) => `<tr>
                      <td>${escapeHtml(d.supplier_name)}</td>
                      <td class="num">${fmtMoney(d.total_invoiced)}</td>
                      <td class="num">${fmtMoney(d.total_paid)}</td>
                      <td class="num" style="${d.outstanding_debt > 0 ? "color:var(--red);font-weight:600" : ""}">${fmtMoney(d.outstanding_debt)}</td>
                      <td>${d.has_overdue ? '<span class="badge badge-danger">Quá hạn</span>' : ""}</td>
                    </tr>`
                  )
                  .join("")}
              </tbody></table>`
            : emptyStateHtml("Chưa có công nợ nào.")
        }
      </div>

      ${
        assetRows.length
          ? `<div class="card">
              <div class="card-header"><h3>Giá trị tài sản thiết bị${projectId ? " tại dự án này" : " toàn công ty"}</h3></div>
              <div style="font-size:20px;font-weight:700;margin-bottom:10px" class="num">${fmtMoney(assetTotalValue)}</div>
              <table><thead><tr><th>Thiết bị</th><th class="hide-mobile">Dự án</th><th>SL</th><th>Giá trị</th></tr></thead><tbody>
                ${assetRows
                  .slice(0, 10)
                  .map((a) => `<tr><td>${escapeHtml(a.asset_name)}</td><td class="hide-mobile">${escapeHtml(a.project_name)}</td><td class="num">${fmtNumber(a.qty_on_hand)}</td><td class="num">${fmtMoney(a.asset_value)}</td></tr>`)
                  .join("")}
              </tbody></table>
            </div>`
          : ""
      }

      ${
        !projectId && lossRows.length
          ? `<div class="card">
              <div class="card-header"><h3>Hao hụt thiết bị cần rà soát</h3></div>
              <table><thead><tr><th>Thiết bị</th><th>Tổng sở hữu</th><th>Chưa rõ nguyên nhân</th></tr></thead><tbody>
                ${lossRows.map((r) => `<tr><td>${escapeHtml(r.asset_code)} — ${escapeHtml(r.asset_name)}</td><td class="num">${fmtNumber(r.total_qty_owned)}</td><td class="num" style="color:var(--red);font-weight:600">${fmtNumber(r.qty_unaccounted)}</td></tr>`).join("")}
              </tbody></table>
            </div>`
          : ""
      }

      ${
        qtyWarnings.length
          ? `<div class="card">
              <div class="card-header"><h3>Vật tư sắp/đã vượt dự trù (số lượng)</h3></div>
              <table><thead><tr><th>Hạng mục</th><th>Đã nhận / Dự trù</th><th>%</th></tr></thead><tbody>
                ${qtyWarnings
                  .slice(0, 10)
                  .map((a) => `<tr><td>${this.pathLabel(a)}</td><td class="num">${fmtNumber(a.received_qty)} / ${fmtNumber(a.planned_qty)}</td><td class="num" style="${a.pct_received >= 100 ? "color:var(--red);font-weight:600" : ""}">${a.pct_received}%</td></tr>`)
                  .join("")}
              </tbody></table>
            </div>`
          : ""
      }`;

    if (dailyData.length) this.renderLineChart("db-chart", dailyData, dailyDateKey, dailyKey);
  },

  kpiCard(label, value, sub) {
    return `<div class="card" style="margin-bottom:0">
      <div style="font-size:11.5px;color:var(--gray5);text-transform:uppercase;letter-spacing:.03em;margin-bottom:6px">${escapeHtml(label)}</div>
      <div style="font-size:20px;font-weight:700" class="num">${value}</div>
      ${sub ? `<div style="font-size:11.5px;color:var(--gray5);margin-top:4px">${escapeHtml(sub)}</div>` : ""}
    </div>`;
  },

  pathLabel(a) {
    if (a.level === 1) return `<strong>${escapeHtml(a.l1_name)}</strong>`;
    if (a.level === 2) return `${escapeHtml(a.l1_name)} › <strong>${escapeHtml(a.l2_name)}</strong>`;
    return `${escapeHtml(a.l1_name)} › ${escapeHtml(a.l2_name)} › <strong>${escapeHtml(a.material_code)}</strong>`;
  },

  // Vẽ biểu đồ đường đơn giản bằng SVG thuần — không cần thư viện ngoài
  renderLineChart(containerId, data, dateKey, valueKey) {
    const el = document.getElementById(containerId);
    if (!el || !data.length) return;

    const W = 760, H = 220, padL = 56, padR = 16, padT = 16, padB = 32;
    const values = data.map((d) => d[valueKey]);
    const maxVal = Math.max(...values, 1);
    const n = data.length;

    const x = (i) => padL + (n === 1 ? 0 : (i * (W - padL - padR)) / (n - 1));
    const y = (v) => H - padB - (v / maxVal) * (H - padT - padB);

    const points = data.map((d, i) => `${x(i)},${y(d[valueKey])}`).join(" ");
    const dots = data.map((d, i) => `<circle cx="${x(i)}" cy="${y(d[valueKey])}" r="2.5" fill="var(--blue)"></circle>`).join("");

    const labelIdx = n <= 6 ? data.map((_, i) => i) : [0, Math.floor(n / 2), n - 1];
    const xLabels = labelIdx
      .map((i) => `<text x="${x(i)}" y="${H - 8}" font-size="10" fill="var(--gray5)" text-anchor="middle">${fmtDate(data[i][dateKey])}</text>`)
      .join("");

    const yLabels = `
      <text x="${padL - 8}" y="${y(0)}" font-size="10" fill="var(--gray5)" text-anchor="end" dominant-baseline="middle">0</text>
      <text x="${padL - 8}" y="${y(maxVal)}" font-size="10" fill="var(--gray5)" text-anchor="end" dominant-baseline="middle">${fmtMoney(maxVal)}</text>`;

    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
      <line x1="${padL}" y1="${y(0)}" x2="${W - padR}" y2="${y(0)}" stroke="var(--gray2)" stroke-width="1"></line>
      <polyline points="${points}" fill="none" stroke="var(--blue)" stroke-width="2"></polyline>
      ${dots}
      ${xLabels}
      ${yLabels}
    </svg>`;
  },
};

window.MODULES.dashboard = { render: (container) => Dashboard.render(container) };
window.Dashboard = Dashboard;
