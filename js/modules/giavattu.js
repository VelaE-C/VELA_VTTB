/* ============================================================
   js/modules/giavattu.js
   Báo cáo giá vật tư — tham khảo cho phòng Đấu thầu khi bỏ giá.
   Search theo vật tư -> biểu đồ giá theo thời gian (1 dự án 1 màu) +
   bảng lịch sử giá + % biến động -> xuất Excel.
   Không tạo tài khoản cho phòng Đấu thầu — chỉ export, đúng quyết định đã chốt.
   ============================================================ */

const GiaVatTu = {
  scope: "company", // company | project
  selectedMaterialId: null,
  currentData: [],

  // Bảng màu cố định cho từng dự án trên biểu đồ — lặp lại nếu nhiều hơn 10 dự án
  CHART_COLORS: ["#2563EB", "#EA580C", "#16A34A", "#DC2626", "#9333EA", "#0891B2", "#DB2777", "#CA8A04", "#4F46E5", "#059669"],

  async render(container) {
    container.innerHTML = `
      <h2>Báo cáo giá vật tư</h2>
      <div class="card">
        <div class="form-grid">
          <div class="field">
            <label>Tìm vật tư</label>
            <input id="gv-material" list="gv-material-list" placeholder="Gõ mã hoặc tên vật tư" onchange="GiaVatTu.onMaterialChange()">
            <datalist id="gv-material-list">${STATE.materials.map((m) => `<option value="${escapeHtml(m.material_code)} — ${escapeHtml(m.material_name)}">`).join("")}</datalist>
          </div>
          <div class="field">
            <label>Phạm vi</label>
            <select id="gv-scope" onchange="GiaVatTu.onScopeChange()">
              <option value="company">Toàn công ty</option>
              <option value="project">Theo 1 dự án</option>
            </select>
          </div>
          <div class="field" id="gv-project-wrap" style="display:none">
            <label>Dự án</label>
            <select id="gv-project" onchange="GiaVatTu.loadTrend()">${STATE.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.project_name)}</option>`).join("")}</select>
          </div>
        </div>
      </div>
      <div id="gv-body"></div>`;
  },

  onScopeChange() {
    this.scope = document.getElementById("gv-scope").value;
    document.getElementById("gv-project-wrap").style.display = this.scope === "project" ? "flex" : "none";
    if (this.selectedMaterialId) this.loadTrend();
  },

  onMaterialChange() {
    const val = document.getElementById("gv-material").value;
    const material = STATE.materials.find((m) => val.startsWith(m.material_code));
    if (!material) { toast("Chọn đúng 1 vật tư từ danh sách gợi ý", "error"); return; }
    this.selectedMaterialId = material.id;
    this.loadTrend();
  },

  async loadTrend() {
    if (!this.selectedMaterialId) return;
    const body = document.getElementById("gv-body");
    body.innerHTML = `<div class="card">${emptyStateHtml("Đang tải...")}</div>`;
    loading(true, "Đang tải lịch sử giá...");

    let query = sb.from("v_material_price_trend").select("*").eq("material_id", this.selectedMaterialId).order("receipt_date");
    if (this.scope === "project") {
      const projectId = document.getElementById("gv-project").value;
      query = query.eq("project_id", projectId);
    }
    const { data, error } = await query;
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }

    this.currentData = data || [];
    const material = STATE.materials.find((m) => m.id === this.selectedMaterialId);

    const rows = this.currentData
      .map((r) => {
        const pct = this.scope === "company" ? r.pct_change_any_project : this.computeProjectPct(r);
        const pctDisplay = pct === null || pct === undefined ? "—" : (pct > 0 ? "+" : "") + pct + "%";
        const pctColor = pct > 0 ? "var(--red)" : pct < 0 ? "var(--green)" : "var(--gray5)";
        return `<tr>
          <td>${fmtDate(r.receipt_date)}</td>
          <td>${escapeHtml(r.project_name)}</td>
          <td>${escapeHtml(r.supplier_name)}</td>
          <td class="num">${fmtMoney(r.effective_price)}</td>
          <td class="num" style="color:${pctColor}">${pctDisplay}</td>
        </tr>`;
      })
      .join("");

    body.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Xu hướng giá theo dự án</h3></div>
        <div id="gv-chart">${this.currentData.length ? "" : emptyStateHtml("Chưa có dữ liệu.")}</div>
      </div>
      <div class="card">
        <div class="card-header">
          <h3>${escapeHtml(material ? material.material_code + " — " + material.material_name : "")} (${this.currentData.length} lần mua)</h3>
          ${this.currentData.length ? `<button class="btn btn-secondary btn-sm" onclick="GiaVatTu.exportExcel()">Xuất Excel cho Đấu thầu</button>` : ""}
        </div>
        ${
          this.currentData.length
            ? `<table><thead><tr><th>Ngày</th><th>Dự án</th><th>NCC</th><th>Đơn giá</th><th>Biến động</th></tr></thead><tbody>${rows}</tbody></table>`
            : emptyStateHtml("Chưa có dữ liệu giá cho vật tư này trong phạm vi đã chọn.")
        }
      </div>`;

    if (this.currentData.length) this.renderChart();
  },

  computeProjectPct(row) {
    const idx = this.currentData.findIndex((r) => r === row);
    if (idx <= 0) return null;
    const prev = this.currentData[idx - 1].effective_price;
    if (!prev) return null;
    return Math.round(((row.effective_price - prev) / prev) * 1000) / 10;
  },

  // Biểu đồ nhiều đường — mỗi dự án 1 màu cố định, trục X theo đúng thời gian thực
  renderChart() {
    const el = document.getElementById("gv-chart");
    if (!el) return;

    const byProject = {};
    const order = [];
    this.currentData.forEach((r) => {
      if (!byProject[r.project_id]) { byProject[r.project_id] = { name: r.project_name, points: [] }; order.push(r.project_id); }
      byProject[r.project_id].points.push({ t: new Date(r.receipt_date).getTime(), price: r.effective_price, date: r.receipt_date });
    });
    const series = order.map((id) => byProject[id]);

    const allT = this.currentData.map((r) => new Date(r.receipt_date).getTime());
    const allPrice = this.currentData.map((r) => r.effective_price);
    const minT = Math.min(...allT), maxT = Math.max(...allT);
    const minPrice = Math.min(...allPrice), maxPrice = Math.max(...allPrice);
    const priceRange = maxPrice - minPrice || maxPrice || 1;

    const W = 780, H = 280, padL = 80, padR = 16, padT = 16, padB = 34;
    const x = (t) => padL + (maxT === minT ? (W - padL - padR) / 2 : ((t - minT) / (maxT - minT)) * (W - padL - padR));
    const y = (v) => H - padB - ((v - minPrice) / priceRange) * (H - padT - padB) * 0.9 - (H - padT - padB) * 0.05;

    let linesHtml = "";
    let legendHtml = "";
    series.forEach((s, i) => {
      const color = this.CHART_COLORS[i % this.CHART_COLORS.length];
      const pts = s.points.map((p) => `${x(p.t)},${y(p.price)}`).join(" ");
      linesHtml += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.2"></polyline>`;
      linesHtml += s.points.map((p) => `<circle cx="${x(p.t)}" cy="${y(p.price)}" r="3" fill="${color}"><title>${escapeHtml(s.name)} — ${fmtDate(p.date)}: ${fmtMoney(p.price)}</title></circle>`).join("");
      legendHtml += `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:16px;font-size:12px">
        <span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block"></span>${escapeHtml(s.name)}
      </span>`;
    });

    const midPrice = (minPrice + maxPrice) / 2;
    const yLabels = `
      <text x="${padL - 8}" y="${y(minPrice)}" font-size="10" fill="var(--gray5)" text-anchor="end" dominant-baseline="middle">${fmtMoney(minPrice)}</text>
      <text x="${padL - 8}" y="${y(midPrice)}" font-size="10" fill="var(--gray5)" text-anchor="end" dominant-baseline="middle">${fmtMoney(midPrice)}</text>
      <text x="${padL - 8}" y="${y(maxPrice)}" font-size="10" fill="var(--gray5)" text-anchor="end" dominant-baseline="middle">${fmtMoney(maxPrice)}</text>`;

    const xLabels = [minT, (minT + maxT) / 2, maxT]
      .map((t) => `<text x="${x(t)}" y="${H - 8}" font-size="10" fill="var(--gray5)" text-anchor="middle">${fmtDate(new Date(t).toISOString().slice(0, 10))}</text>`)
      .join("");

    el.innerHTML = `
      <div style="margin-bottom:8px">${legendHtml}</div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
        <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="var(--gray2)" stroke-width="1"></line>
        ${linesHtml}
        ${yLabels}
        ${xLabels}
      </svg>`;
  },

  exportExcel() {
    if (typeof XLSX === "undefined") { toast("Thư viện xuất Excel chưa tải xong, thử lại sau vài giây", "error"); return; }
    const material = STATE.materials.find((m) => m.id === this.selectedMaterialId);
    const rows = this.currentData.map((r, i) => ({
      "Ngày mua": fmtDate(r.receipt_date),
      "Dự án": r.project_name,
      "NCC": r.supplier_name,
      "Đơn giá": r.effective_price,
      "Biến động (%)": this.scope === "company" ? r.pct_change_any_project : this.computeProjectPct(r),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Lich su gia");
    const fileName = `Bao_cao_gia_${material ? material.material_code : "vattu"}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
    toast("Đã xuất file Excel!", "success");
  },
};

window.MODULES.giavattu = { render: (container) => GiaVatTu.render(container) };
window.GiaVatTu = GiaVatTu;
