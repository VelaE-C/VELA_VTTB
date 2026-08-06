/* ============================================================
   js/modules/dashboard.js
   Tổng quan — KPI ngân sách + cảnh báo ngân sách + chi phí vật tư theo
   ngày (bảng theo dự án + biểu đồ có filter riêng: toàn công ty / theo
   1 dự án). KHÔNG còn công nợ/thanh toán — thuộc phạm vi phòng Kế toán,
   xem ở tab Công nợ NCC riêng, không cần trên Tổng quan.
   ============================================================ */

const Dashboard = {
  chartScope: null, // null = toàn công ty, hoặc project_id — độc lập với filter dự án ở topbar

  async render(container) {
    container.innerHTML = `<h2>Tổng quan</h2><div id="db-body">${emptyStateHtml("Đang tải...")}</div>`;
    this.chartScope = STATE.currentProjectFilter || null;
    loading(true, "Đang tải dữ liệu tổng quan...");
    try {
      await this.load();
    } finally {
      loading(false);
    }
  },

  async load() {
    const projectId = STATE.currentProjectFilter;
    const body = document.getElementById("db-body");

    let alertsQuery = sb.from("v_budget_alert").select("*");
    if (projectId) alertsQuery = alertsQuery.eq("project_id", projectId);

    let dailyByProjectQuery = sb.from("v_material_daily_cost_project").select("*").order("receipt_date", { ascending: false });
    if (projectId) dailyByProjectQuery = dailyByProjectQuery.eq("project_id", projectId);

    const [{ data: alerts }, { data: dailyByProject }] = await Promise.all([alertsQuery, dailyByProjectQuery.limit(200)]);

    const level1Rows = (alerts || []).filter((a) => a.level === 1);
    const totalBudget = level1Rows.reduce((sum, a) => sum + (a.budget_amount || 0), 0);
    const totalCommitted = level1Rows.reduce((sum, a) => sum + (a.committed_amount || 0), 0);

    const priority = { over_budget: 0, critical_85: 1, warning_70: 2, ok: 3 };
    const sortedAlerts = [...(alerts || [])]
      .filter((a) => a.budget_amount != null)
      .sort((a, b) => (priority[a.alert_level] ?? 9) - (priority[b.alert_level] ?? 9) || (b.pct_used || 0) - (a.pct_used || 0));

    const qtyWarnings = [...(alerts || [])].filter((a) => a.planned_qty != null && (a.pct_received || 0) >= 70).sort((a, b) => (b.pct_received || 0) - (a.pct_received || 0));

    const dailyRows = (dailyByProject || []).map((r) => {
      const project = STATE.projects.find((p) => p.id === r.project_id);
      return { ...r, projectName: project ? project.project_name : "—" };
    });

    body.innerHTML = `
      <div class="kpi-row" style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-bottom:16px;max-width:520px">
        ${this.kpiCard("Tổng ngân sách", fmtMoney(totalBudget), "Cấp Level 1")}
        ${this.kpiCard("Đã cam kết", fmtMoney(totalCommitted), totalBudget ? Math.round((totalCommitted / totalBudget) * 100) + "% ngân sách" : "")}
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
        <div class="card-header">
          <h3>Biểu đồ chi phí vật tư theo ngày</h3>
          <select id="db-chart-scope" style="height:32px;font-size:12.5px">
            <option value="">Toàn công ty</option>
            ${STATE.projects.map((p) => `<option value="${p.id}" ${this.chartScope === p.id ? "selected" : ""}>${escapeHtml(p.project_name)}</option>`).join("")}
          </select>
        </div>
        <div id="db-chart">${emptyStateHtml("Đang tải biểu đồ...")}</div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Chi phí theo dự án + ngày (${dailyRows.length}${dailyRows.length === 200 ? "+ — chỉ hiện 200 dòng gần nhất" : ""})</h3></div>
        ${
          dailyRows.length
            ? `<table><thead><tr><th>Dự án</th><th>Ngày</th><th>Chi phí</th></tr></thead><tbody>
                ${dailyRows
                  .slice(0, 60)
                  .map((r) => `<tr><td>${escapeHtml(r.projectName)}</td><td>${fmtDate(r.receipt_date)}</td><td class="num">${fmtMoney(r.daily_cost)}</td></tr>`)
                  .join("")}
              </tbody></table>`
            : emptyStateHtml("Chưa có dữ liệu chi phí ngày nào.")
        }
      </div>

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

    document.getElementById("db-chart-scope").addEventListener("change", (e) => {
      this.chartScope = e.target.value || null;
      this.loadChart();
    });
    this.loadChart();
  },

  async loadChart() {
    const el = document.getElementById("db-chart");
    el.innerHTML = emptyStateHtml("Đang tải biểu đồ...");
    let q = sb.from(this.chartScope ? "v_material_daily_cost_project" : "v_material_daily_cost_company").select("*").order("receipt_date", { ascending: true }).limit(60);
    if (this.chartScope) q = q.eq("project_id", this.chartScope);
    const { data, error } = await q;
    if (error) { el.innerHTML = emptyStateHtml("Lỗi tải biểu đồ: " + error.message); return; }
    if (!data || !data.length) { el.innerHTML = emptyStateHtml("Chưa có dữ liệu."); return; }
    el.innerHTML = "";
    this.renderLineChart("db-chart", data, "receipt_date", "daily_cost");
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
