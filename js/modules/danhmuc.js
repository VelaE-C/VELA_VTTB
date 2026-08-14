/* ============================================================
   js/modules/danhmuc.js
   Dự án / Nhóm Level 1 / Nhóm Level 2 / Vật tư / NCC — master data
   Vật tư (Level 3) bắt buộc thuộc 1 Level 2 -> 1 Level 1, dùng để
   suy ra hạng mục tự động ở mọi nơi khác (không còn category_name tự do).
   ============================================================ */

const DanhMuc = {
  activeTab: "projects", // projects | l1 | l2 | materials | suppliers

  async render(container) {
    container.innerHTML = `
      <h2>Danh mục</h2>
      <div class="subtabs" style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">
        <button class="btn btn-sm ${this.activeTab === "projects" ? "btn-primary" : "btn-secondary"}" onclick="DanhMuc.switchTab('projects')">Dự án</button>
        <button class="btn btn-sm ${this.activeTab === "l1" ? "btn-primary" : "btn-secondary"}" onclick="DanhMuc.switchTab('l1')">Nhóm Level 1</button>
        <button class="btn btn-sm ${this.activeTab === "l2" ? "btn-primary" : "btn-secondary"}" onclick="DanhMuc.switchTab('l2')">Nhóm Level 2</button>
        <button class="btn btn-sm ${this.activeTab === "materials" ? "btn-primary" : "btn-secondary"}" onclick="DanhMuc.switchTab('materials')">Vật tư (Level 3)</button>
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
    else if (this.activeTab === "l1") await this.renderL1(body);
    else if (this.activeTab === "l2") await this.renderL2(body);
    else if (this.activeTab === "materials") await this.renderMaterials(body);
    else await this.renderSuppliers(body);
  },

  canWrite() {
    return STATE.role === "admin" || STATE.role === "manager";
  },
  canWriteMasterData() {
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
          <td class="hide-mobile">${escapeHtml(p.address || "—")}</td>
          <td class="hide-mobile">${p.linked_tiendo_project_id ? '<span class="badge badge-info">Đã liên kết TIENDO</span>' : "—"}</td>
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
            ? `<table><thead><tr><th>Tên dự án</th><th class="hide-mobile">Địa chỉ</th><th class="hide-mobile">Liên kết TIENDO</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
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
        <div class="field"><label>Địa chỉ</label><input id="pj-address" value="${isEdit ? escapeHtml(project.address || "") : ""}" placeholder="VD: Khu vực Bãi Tiên, Bắc Nha Trang, Khánh Hòa"></div>
        <div class="field"><label>Ghi chú</label><textarea id="pj-note">${isEdit ? escapeHtml(project.note || "") : ""}</textarea></div>`,
      footerHtml: `
        <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="DanhMuc.saveProject(${isEdit ? `'${project.id}'` : "null"})">Lưu</button>`,
    });
  },

  async saveProject(id) {
    const name = document.getElementById("pj-name").value.trim();
    const address = document.getElementById("pj-address").value.trim();
    const note = document.getElementById("pj-note").value.trim();
    if (!name) { toast("Nhập tên dự án", "error"); return; }
    loading(true, "Đang lưu...");
    const payload = { project_name: name, address: address || null, note: note || null };
    const { error } = id ? await sb.from("projects").update(payload).eq("id", id) : await sb.from("projects").insert(payload);
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    toast("Đã lưu!", "success");
    closeModal();
    this.renderActiveTab();
  },

  // ---------------- NHÓM LEVEL 1 ----------------
  async renderL1(body) {
    loading(true, "Đang tải Nhóm Level 1...");
    const { data, error } = await sb.from("material_groups_l1").select("*").order("name");
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    STATE.materialGroupsL1 = data || [];

    const rows = (data || [])
      .map(
        (g) => `<tr>
          <td>${escapeHtml(g.name)}</td>
          <td class="table-actions">${this.canWriteMasterData() ? `<button class="btn btn-sm btn-secondary" onclick='DanhMuc.openL1Modal(${JSON.stringify(g).replace(/'/g, "&#39;")})'>Sửa</button>` : ""}</td>
        </tr>`
      )
      .join("");

    body.innerHTML = `
      <div class="card">
        <div class="helper" style="margin-bottom:10px">Nhóm lớn nhất, VD: Kết cấu / Hoàn Thiện / Vật Tư Phụ.</div>
        <div class="card-header">
          <h3>Nhóm Level 1 (${(data || []).length})</h3>
          ${this.canWriteMasterData() ? `<button class="btn btn-primary btn-sm" onclick="DanhMuc.openL1Modal()">+ Thêm nhóm Level 1</button>` : ""}
        </div>
        ${data && data.length ? `<table><thead><tr><th>Tên nhóm</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : emptyStateHtml("Chưa có nhóm Level 1 nào.")}
      </div>`;
  },

  openL1Modal(group) {
    const isEdit = !!group;
    openModal({
      title: isEdit ? "Sửa nhóm Level 1" : "Thêm nhóm Level 1",
      bodyHtml: `<div class="field"><label>Tên nhóm</label><input id="l1-name" value="${isEdit ? escapeHtml(group.name) : ""}" placeholder="VD: Hoàn Thiện"></div>`,
      footerHtml: `
        <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="DanhMuc.saveL1(${isEdit ? `'${group.id}'` : "null"})">Lưu</button>`,
    });
  },

  async saveL1(id) {
    const name = document.getElementById("l1-name").value.trim();
    if (!name) { toast("Nhập tên nhóm", "error"); return; }
    loading(true, "Đang lưu...");
    const payload = { name };
    const { error } = id ? await sb.from("material_groups_l1").update(payload).eq("id", id) : await sb.from("material_groups_l1").insert(payload);
    loading(false);
    if (error) {
      if (error.code === "23505") toast("Tên nhóm Level 1 đã tồn tại", "error");
      else toast("Lỗi: " + error.message, "error");
      return;
    }
    toast("Đã lưu!", "success");
    closeModal();
    this.renderActiveTab();
  },

  // ---------------- NHÓM LEVEL 2 ----------------
  async renderL2(body) {
    loading(true, "Đang tải Nhóm Level 2...");
    const { data, error } = await sb.from("material_groups_l2").select("*").order("name");
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    STATE.materialGroupsL2 = data || [];

    if (!STATE.materialGroupsL1.length) {
      body.innerHTML = `<div class="card">${emptyStateHtml("Chưa có nhóm Level 1 nào — tạo Level 1 trước.")}</div>`;
      return;
    }

    const rows = (data || [])
      .map((g) => {
        const l1 = STATE.materialGroupsL1.find((x) => x.id === g.l1_id);
        return `<tr>
          <td>${escapeHtml(g.name)}</td>
          <td>${escapeHtml(l1 ? l1.name : "—")}</td>
          <td class="table-actions">${this.canWriteMasterData() ? `<button class="btn btn-sm btn-secondary" onclick='DanhMuc.openL2Modal(${JSON.stringify(g).replace(/'/g, "&#39;")})'>Sửa</button>` : ""}</td>
        </tr>`;
      })
      .join("");

    body.innerHTML = `
      <div class="card">
        <div class="helper" style="margin-bottom:10px">Nhóm giữa, thuộc 1 Level 1 — VD trong "Hoàn Thiện" có: Gạch xây, Cát, Đá, Xi măng, Sơn...</div>
        <div class="card-header">
          <h3>Nhóm Level 2 (${(data || []).length})</h3>
          ${this.canWriteMasterData() ? `<button class="btn btn-primary btn-sm" onclick="DanhMuc.openL2Modal()">+ Thêm nhóm Level 2</button>` : ""}
        </div>
        ${data && data.length ? `<table><thead><tr><th>Tên nhóm</th><th>Thuộc Level 1</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : emptyStateHtml("Chưa có nhóm Level 2 nào.")}
      </div>`;
  },

  openL2Modal(group) {
    const isEdit = !!group;
    openModal({
      title: isEdit ? "Sửa nhóm Level 2" : "Thêm nhóm Level 2",
      bodyHtml: `
        <div class="field">
          <label>Thuộc Level 1</label>
          <select id="l2-l1">${STATE.materialGroupsL1.map((g) => `<option value="${g.id}" ${isEdit && group.l1_id === g.id ? "selected" : ""}>${escapeHtml(g.name)}</option>`).join("")}</select>
        </div>
        <div class="field"><label>Tên nhóm</label><input id="l2-name" value="${isEdit ? escapeHtml(group.name) : ""}" placeholder="VD: Gạch xây"></div>`,
      footerHtml: `
        <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="DanhMuc.saveL2(${isEdit ? `'${group.id}'` : "null"})">Lưu</button>`,
    });
  },

  async saveL2(id) {
    const l1Id = document.getElementById("l2-l1").value;
    const name = document.getElementById("l2-name").value.trim();
    if (!name) { toast("Nhập tên nhóm", "error"); return; }
    loading(true, "Đang lưu...");
    const payload = { l1_id: l1Id, name };
    const { error } = id ? await sb.from("material_groups_l2").update(payload).eq("id", id) : await sb.from("material_groups_l2").insert(payload);
    loading(false);
    if (error) {
      if (error.code === "23505") toast("Nhóm Level 2 này đã tồn tại trong Level 1 đã chọn", "error");
      else toast("Lỗi: " + error.message, "error");
      return;
    }
    toast("Đã lưu!", "success");
    closeModal();
    this.renderActiveTab();
  },

  // ---------------- VẬT TƯ (Level 3) ----------------
  async renderMaterials(body) {
    loading(true, "Đang tải danh sách vật tư...");
    const { data, error } = await sb.from("materials").select("*").order("material_code");
    loading(false);
    if (error) { toast("Lỗi tải vật tư: " + error.message, "error"); return; }
    STATE.materials = data || [];

    if (!STATE.materialGroupsL2.length) {
      body.innerHTML = `<div class="card">${emptyStateHtml("Chưa có nhóm Level 2 nào — tạo Level 1 và Level 2 trước khi thêm vật tư.")}</div>`;
      return;
    }

    const rows = (data || [])
      .map((m) => {
        const l2 = STATE.materialGroupsL2.find((x) => x.id === m.l2_id);
        const l1 = l2 ? STATE.materialGroupsL1.find((x) => x.id === l2.l1_id) : null;
        return `<tr>
          <td>${escapeHtml(m.material_code)}</td>
          <td>${escapeHtml(m.material_name)}</td>
          <td class="hide-mobile">${escapeHtml(m.default_unit || "—")}</td>
          <td class="hide-mobile">${l2 ? `${escapeHtml(l1 ? l1.name : "—")} / ${escapeHtml(l2.name)}` : '<span class="badge badge-danger">Chưa gán nhóm</span>'}</td>
          <td class="table-actions">${this.canWriteMasterData() ? `<button class="btn btn-sm btn-secondary" onclick='DanhMuc.openMaterialModal(${JSON.stringify(m).replace(/'/g, "&#39;")})'>Sửa</button>` : ""}</td>
        </tr>`;
      })
      .join("");

    body.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Vật tư — Level 3 (${(data || []).length})</h3>
          ${this.canWriteMasterData() ? `<button class="btn btn-primary btn-sm" onclick="DanhMuc.openMaterialModal()">+ Thêm vật tư</button>` : ""}
        </div>
        ${
          data && data.length
            ? `<table><thead><tr><th>Mã</th><th>Tên vật tư</th><th class="hide-mobile">Đơn vị mặc định</th><th class="hide-mobile">Nhóm (Level 1 / Level 2)</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
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
        <div class="field"><label>Đơn vị mặc định</label><input id="mt-unit" value="${isEdit ? escapeHtml(material.default_unit || "") : ""}" placeholder="Bao / m³ / Tấn..."></div>
        <div class="field">
          <label>Nhóm Level 2 (bắt buộc)</label>
          <select id="mt-l2">
            <option value="">— Chọn nhóm —</option>
            ${STATE.materialGroupsL2
              .map((g) => {
                const l1 = STATE.materialGroupsL1.find((x) => x.id === g.l1_id);
                return `<option value="${g.id}" ${isEdit && material.l2_id === g.id ? "selected" : ""}>${escapeHtml(l1 ? l1.name : "—")} / ${escapeHtml(g.name)}</option>`;
              })
              .join("")}
          </select>
        </div>`,
      footerHtml: `
        <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="DanhMuc.saveMaterial(${isEdit ? `'${material.id}'` : "null"})">Lưu</button>`,
    });
  },

  async saveMaterial(id) {
    const code = document.getElementById("mt-code").value.trim();
    const name = document.getElementById("mt-name").value.trim();
    const unit = document.getElementById("mt-unit").value.trim();
    const l2Id = document.getElementById("mt-l2").value;
    if (!code || !name) { toast("Nhập đủ mã và tên vật tư", "error"); return; }
    if (!l2Id) { toast("Chọn nhóm Level 2 cho vật tư này", "error"); return; }
    loading(true, "Đang lưu...");
    const payload = { material_code: code, material_name: name, default_unit: unit || null, l2_id: l2Id };
    const { error } = id ? await sb.from("materials").update(payload).eq("id", id) : await sb.from("materials").insert(payload);
    loading(false);
    if (error) {
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
          <td class="hide-mobile">${escapeHtml(s.full_name || "—")}</td>
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
            ? `<table><thead><tr><th>Tên viết tắt</th><th class="hide-mobile">Tên thực tế</th><th class="hide-mobile">Mã số thuế</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
            : emptyStateHtml("Chưa có NCC nào.")
        }
      </div>`;
  },

  openSupplierModal(supplier) {
    const isEdit = !!supplier;
    openModal({
      title: isEdit ? "Sửa NCC" : "Thêm NCC",
      bodyHtml: `
        <div class="field"><label>Tên viết tắt (dùng trong app)</label><input id="sp-name" value="${isEdit ? escapeHtml(supplier.supplier_name) : ""}" placeholder="VD: VÂN ĐAN"></div>
        <div class="field"><label>Tên thực tế / pháp lý đầy đủ (dùng cho chứng từ)</label><input id="sp-fullname" value="${isEdit ? escapeHtml(supplier.full_name || "") : ""}" placeholder="VD: CÔNG TY CỔ PHẦN VÂN ĐAN"></div>
        <div class="field"><label>Mã số thuế</label><input id="sp-tax" value="${isEdit ? escapeHtml(supplier.tax_code || "") : ""}"></div>
        <div class="field"><label>Địa chỉ</label><input id="sp-address" value="${isEdit ? escapeHtml(supplier.address || "") : ""}"></div>
        <div class="form-grid">
          <div class="field"><label>Số tài khoản ngân hàng</label><input id="sp-bank-account" value="${isEdit ? escapeHtml(supplier.bank_account || "") : ""}"></div>
          <div class="field"><label>Tên ngân hàng</label><input id="sp-bank-name" value="${isEdit ? escapeHtml(supplier.bank_name || "") : ""}" placeholder="VD: Vietcombank - CN Nha Trang"></div>
        </div>`,
      footerHtml: `
        <button class="btn btn-secondary" onclick="closeModal()">Hủy</button>
        <button class="btn btn-primary" onclick="DanhMuc.saveSupplier(${isEdit ? `'${supplier.id}'` : "null"})">Lưu</button>`,
    });
  },

  async saveSupplier(id) {
    const name = document.getElementById("sp-name").value.trim();
    const fullName = document.getElementById("sp-fullname").value.trim();
    const tax = document.getElementById("sp-tax").value.trim();
    const address = document.getElementById("sp-address").value.trim();
    const bankAccount = document.getElementById("sp-bank-account").value.trim();
    const bankName = document.getElementById("sp-bank-name").value.trim();
    if (!name) { toast("Nhập tên NCC", "error"); return; }
    loading(true, "Đang lưu...");
    const payload = {
      supplier_name: name,
      full_name: fullName || null,
      tax_code: tax || null,
      address: address || null,
      bank_account: bankAccount || null,
      bank_name: bankName || null,
    };
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
