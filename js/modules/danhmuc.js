/* ============================================================
   js/modules/danhmuc.js
   Dự án / Vật tư / NCC — master data, search-or-create
   Module đầu tiên build để test layout + kết nối Supabase thật (checklist Bước 5)
   ============================================================ */

const DanhMuc = {
  activeTab: "projects", // projects | materials | suppliers

  async render(container) {
    container.innerHTML = `
      <h2>Danh mục</h2>
      <div class="subtabs" style="display:flex;gap:6px;margin-bottom:16px">
        <button class="btn btn-sm ${this.activeTab === "projects" ? "btn-primary" : "btn-secondary"}" onclick="DanhMuc.switchTab('projects')">Dự án</button>
        <button class="btn btn-sm ${this.activeTab === "materials" ? "btn-primary" : "btn-secondary"}" onclick="DanhMuc.switchTab('materials')">Vật tư</button>
        <button class="btn btn-sm ${this.activeTab === "suppliers" ? "btn-primary" : "btn-secondary"}" onclick="DanhMuc.switchTab('suppliers')">Nhà cung cấp</button>
      </div>
      <div id="danhmuc-body"></div>`;
    await this.renderActiveTab();
  },

  switchTab(tab) {
    this.activeTab = tab;
    this.render(document.getElementById("content-area"));
  },

  async renderActiveTab() {
    const body = document.getElementById("danhmuc-body");
    body.innerHTML = `<div class="card">${emptyStateHtml("Đang tải...")}</div>`;
    if (this.activeTab === "projects") await this.renderProjects(body);
    else if (this.activeTab === "materials") await this.renderMaterials(body);
    else await this.renderSuppliers(body);
  },

  canWrite() {
    return STATE.role === "admin" || STATE.role === "manager";
  },
  canWriteMasterData() {
    // materials/suppliers: admin/manager/editor được quick-add (theo schema RLS)
    return ["admin", "manager", "editor"].includes(STATE.role);
  },

  // ---------------- DỰ ÁN ----------------
  async renderProjects(body) {
    loading(true, "Đang tải danh sách dự án...");
    const { data, error } = await sb.from("projects").select("*").order("project_name");
    loading(false);
    if (error) { toast("Lỗi tải dự án: " + error.message, "error"); return; }
    STATE.projects = data || [];

    const rows = (data || [])
      .map(
        (p) => `<tr>
          <td>${escapeHtml(p.project_name)}</td>
          <td class="hide-mobile">${p.linked_tiendo_project_id ? '<span class="badge badge-info">Đã liên kết TIENDO</span>' : "—"}</td>
          <td class="hide-mobile">${fmtDate(p.created_at)}</td>
          <td class="table-actions">${this.canWrite() ? `<button class="btn btn-sm btn-secondary" onclick='DanhMuc.openProjectModal(${JSON.stringify(p).replace(/'/g, "&#39;")})'>Sửa</button>` : ""}</td>
        </tr>`
      )
      .join("");

    body.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Dự án (${(data || []).length})</h3>
          ${this.canWrite() ? `<button class="btn btn-primary btn-sm" onclick="DanhMuc.openProjectModal()">+ Thêm dự án</button>` : ""}
        </div>
        ${
          data && data.length
            ? `<table><thead><tr><th>Tên dự án</th><th class="hide-mobile">Liên kết TIENDO</th><th class="hide-mobile">Ngày tạo</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
            : emptyStateHtml("Chưa có dự án nào.")
        }
      </div>`;
  },

  openProjectModal(project) {
    const isEdit = !!project;
    openModal({
      title: isEdit ? "Sửa dự án" : "Thêm dự án",
      bodyHtml: `
        <div class="field"><label>Tên dự án</label><input id="pj-name" value="${isEdit ? escapeHtml(project.project_name) : ""}" placeholder="VD: VEGACITY"></div>
        <div class="field"><label>Ghi chú</label><textarea id="pj-note">${isEdit ? escapeHtml(project.note || "") : ""}</textarea></div>`,
      footerHtml: `
        <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="DanhMuc.saveProject(${isEdit ? `'${project.id}'` : "null"})">Lưu</button>`,
    });
  },

  async saveProject(id) {
    const name = document.getElementById("pj-name").value.trim();
    const note = document.getElementById("pj-note").value.trim();
    if (!name) { toast("Nhập tên dự án", "error"); return; }
    loading(true, "Đang lưu...");
    const payload = { project_name: name, note: note || null };
    const { error } = id ? await sb.from("projects").update(payload).eq("id", id) : await sb.from("projects").insert(payload);
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    toast("Đã lưu!", "success");
    closeModal();
    this.renderActiveTab();
  },

  // ---------------- VẬT TƯ ----------------
  async renderMaterials(body) {
    loading(true, "Đang tải danh sách vật tư...");
    const { data, error } = await sb.from("materials").select("*").order("material_code");
    loading(false);
    if (error) { toast("Lỗi tải vật tư: " + error.message, "error"); return; }
    STATE.materials = data || [];

    const rows = (data || [])
      .map(
        (m) => `<tr>
          <td>${escapeHtml(m.material_code)}</td>
          <td>${escapeHtml(m.material_name)}</td>
          <td class="hide-mobile">${escapeHtml(m.default_unit || "—")}</td>
          <td class="table-actions">${this.canWriteMasterData() ? `<button class="btn btn-sm btn-secondary" onclick='DanhMuc.openMaterialModal(${JSON.stringify(m).replace(/'/g, "&#39;")})'>Sửa</button>` : ""}</td>
        </tr>`
      )
      .join("");

    body.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Vật tư (${(data || []).length})</h3>
          ${this.canWriteMasterData() ? `<button class="btn btn-primary btn-sm" onclick="DanhMuc.openMaterialModal()">+ Thêm vật tư</button>` : ""}
        </div>
        ${
          data && data.length
            ? `<table><thead><tr><th>Mã</th><th>Tên vật tư</th><th class="hide-mobile">Đơn vị mặc định</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
            : emptyStateHtml("Chưa có vật tư nào.")
        }
      </div>`;
  },

  openMaterialModal(material) {
    const isEdit = !!material;
    openModal({
      title: isEdit ? "Sửa vật tư" : "Thêm vật tư",
      bodyHtml: `
        <div class="field"><label>Mã vật tư</label><input id="mt-code" value="${isEdit ? escapeHtml(material.material_code) : ""}" placeholder="VD: XM40"></div>
        <div class="field"><label>Tên vật tư</label><input id="mt-name" value="${isEdit ? escapeHtml(material.material_name) : ""}" placeholder="VD: Xi măng PCB40"></div>
        <div class="field"><label>Đơn vị mặc định</label><input id="mt-unit" value="${isEdit ? escapeHtml(material.default_unit || "") : ""}" placeholder="Bao / m³ / Tấn..."></div>`,
      footerHtml: `
        <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="DanhMuc.saveMaterial(${isEdit ? `'${material.id}'` : "null"})">Lưu</button>`,
    });
  },

  async saveMaterial(id) {
    const code = document.getElementById("mt-code").value.trim();
    const name = document.getElementById("mt-name").value.trim();
    const unit = document.getElementById("mt-unit").value.trim();
    if (!code || !name) { toast("Nhập đủ mã và tên vật tư", "error"); return; }
    loading(true, "Đang lưu...");
    const payload = { material_code: code, material_name: name, default_unit: unit || null };
    const { error } = id ? await sb.from("materials").update(payload).eq("id", id) : await sb.from("materials").insert(payload);
    loading(false);
    if (error) {
      // Trùng mã (unique index) -> báo rõ thay vì lỗi kỹ thuật khó hiểu
      if (error.message.includes("duplicate") || error.code === "23505") toast("Mã vật tư đã tồn tại — chọn từ danh sách thay vì tạo mới", "error");
      else toast("Lỗi: " + error.message, "error");
      return;
    }
    toast("Đã lưu!", "success");
    closeModal();
    this.renderActiveTab();
  },

  // ---------------- NHÀ CUNG CẤP ----------------
  async renderSuppliers(body) {
    loading(true, "Đang tải danh sách NCC...");
    const { data, error } = await sb.from("suppliers").select("*").order("supplier_name");
    loading(false);
    if (error) { toast("Lỗi tải NCC: " + error.message, "error"); return; }
    STATE.suppliers = data || [];

    const rows = (data || [])
      .map(
        (s) => `<tr>
          <td>${escapeHtml(s.supplier_name)}</td>
          <td class="hide-mobile">${escapeHtml(s.tax_code || "—")}</td>
          <td class="table-actions">${this.canWriteMasterData() ? `<button class="btn btn-sm btn-secondary" onclick='DanhMuc.openSupplierModal(${JSON.stringify(s).replace(/'/g, "&#39;")})'>Sửa</button>` : ""}</td>
        </tr>`
      )
      .join("");

    body.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Nhà cung cấp (${(data || []).length})</h3>
          ${this.canWriteMasterData() ? `<button class="btn btn-primary btn-sm" onclick="DanhMuc.openSupplierModal()">+ Thêm NCC</button>` : ""}
        </div>
        ${
          data && data.length
            ? `<table><thead><tr><th>Tên NCC</th><th class="hide-mobile">Mã số thuế</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
            : emptyStateHtml("Chưa có NCC nào.")
        }
      </div>`;
  },

  openSupplierModal(supplier) {
    const isEdit = !!supplier;
    openModal({
      title: isEdit ? "Sửa NCC" : "Thêm NCC",
      bodyHtml: `
        <div class="field"><label>Tên NCC</label><input id="sp-name" value="${isEdit ? escapeHtml(supplier.supplier_name) : ""}" placeholder="VD: VÂN ĐAN"></div>
        <div class="field"><label>Mã số thuế</label><input id="sp-tax" value="${isEdit ? escapeHtml(supplier.tax_code || "") : ""}"></div>`,
      footerHtml: `
        <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="DanhMuc.saveSupplier(${isEdit ? `'${supplier.id}'` : "null"})">Lưu</button>`,
    });
  },

  async saveSupplier(id) {
    const name = document.getElementById("sp-name").value.trim();
    const tax = document.getElementById("sp-tax").value.trim();
    if (!name) { toast("Nhập tên NCC", "error"); return; }
    loading(true, "Đang lưu...");
    const payload = { supplier_name: name, tax_code: tax || null };
    const { error } = id ? await sb.from("suppliers").update(payload).eq("id", id) : await sb.from("suppliers").insert(payload);
    loading(false);
    if (error) {
      if (error.message.includes("duplicate") || error.code === "23505") toast("NCC này đã tồn tại — chọn từ danh sách thay vì tạo mới", "error");
      else toast("Lỗi: " + error.message, "error");
      return;
    }
    toast("Đã lưu!", "success");
    closeModal();
    this.renderActiveTab();
  },
};

window.MODULES.danhmuc = { render: (container) => DanhMuc.render(container) };
window.DanhMuc = DanhMuc; // để onclick inline gọi được
