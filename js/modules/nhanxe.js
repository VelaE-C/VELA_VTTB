/* ============================================================
   js/modules/nhanxe.js
   A2a — BCH/thủ kho chụp xe khi nhận hàng: camera TRỰC TIẾP trong app
   (không có input file/thư viện ảnh), trình tự bắt buộc, giờ ghi nhận
   là giờ SERVER lúc insert vào DB (KHÔNG dùng giờ hiển thị trên ảnh).

   Kèm luồng "Nhập bù" cho manager/admin khi BCH sót xe (hết pin/mạng/
   không đăng nhập được) — dùng ảnh nhận qua kênh khác (Zalo...), bắt
   buộc ghi rõ người xác nhận + lý do (fn_check_manual_backfill ở DB
   sẽ chặn nếu thiếu, đây chỉ là chặn sớm ở UI cho gọn).
   ============================================================ */

const PHOTO_STEPS = [
  { type: "bien_so", order: 1, label: "Biển số xe" },
  { type: "phieu_giao_nhan", order: 2, label: "Phiếu giao nhận" },
  { type: "dau_xe", order: 3, label: "Đầu xe" },
  { type: "than_xe", order: 4, label: "Thân xe / hàng trên xe" },
];

const NhanXe = {
  mode: "capture", // capture | backfill
  session: null, // vehicle_receipts row hiện tại
  stepIndex: 0,
  stream: null,
  uploadedTypes: new Set(),

  async render(container) {
    this.session = null;
    this.stepIndex = 0;
    this.uploadedTypes = new Set();
    this.stopCamera();

    const canBackfill = STATE.role === "admin" || STATE.role === "manager";
    const projectOptions = this.availableProjects();

    container.innerHTML = `
      <h2>Nhận xe</h2>
      <div class="card">
        <div class="card-header">
          <h3>${this.mode === "capture" ? "Chụp xe khi nhận hàng" : "Nhập bù (BCH sót xe)"}</h3>
          ${canBackfill ? `<button class="btn btn-sm btn-secondary" onclick="NhanXe.toggleMode()">${this.mode === "capture" ? "Chuyển sang Nhập bù" : "Quay lại Chụp trực tiếp"}</button>` : ""}
        </div>
        <div id="nhanxe-body"></div>
      </div>`;

    if (!projectOptions.length) {
      document.getElementById("nhanxe-body").innerHTML = emptyStateHtml("Bạn chưa được gán dự án nào — liên hệ admin.");
      return;
    }
    this.renderStartForm(projectOptions);
  },

  availableProjects() {
    if (STATE.role === "admin" || STATE.role === "manager") return STATE.projects;
    return STATE.projects.filter((p) => STATE.assignedProjects.includes(p.id));
  },

  toggleMode() {
    this.mode = this.mode === "capture" ? "backfill" : "capture";
    this.render(document.getElementById("content-area"));
  },

  renderStartForm(projects) {
    const isBackfill = this.mode === "backfill";
    document.getElementById("nhanxe-body").innerHTML = `
      <div class="field">
        <label>Dự án</label>
        <select id="nx-project">${projects.map((p) => `<option value="${p.id}">${escapeHtml(p.project_name)}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label>Biển số xe</label>
        <input id="nx-plate" placeholder="VD: 72H-00397">
      </div>
      ${
        isBackfill
          ? `
      <div class="field">
        <label>Người xác nhận thông tin là thật</label>
        <input id="nx-confirmed-by" value="${escapeHtml(STATE.profile ? STATE.profile.full_name || STATE.user.email : "")}">
      </div>
      <div class="field">
        <label>Lý do / nguồn xác nhận (bắt buộc)</label>
        <textarea id="nx-confirmed-note" placeholder="VD: Thủ kho Nam hết pin điện thoại, gửi ảnh phiếu giao nhận qua Zalo lúc 14:20, đã gọi xác nhận lại với thủ kho."></textarea>
        <div class="helper">Bắt buộc điền — hệ thống sẽ đánh dấu phiên này là "Nhập bù" trên mọi báo cáo, khác với phiên chụp trực tiếp.</div>
      </div>`
          : `<div class="helper">Camera sẽ mở ngay sau khi bấm Bắt đầu — chụp đúng theo trình tự 4 bước, không thể chọn ảnh có sẵn.</div>`
      }
      <button class="btn btn-primary" style="margin-top:8px" onclick="NhanXe.startSession()">Bắt đầu ${isBackfill ? "nhập bù" : "chụp"}</button>`;
  },

  async startSession() {
    const projectId = document.getElementById("nx-project").value;
    const plate = document.getElementById("nx-plate").value.trim();
    if (!plate) { toast("Nhập biển số xe", "error"); return; }

    const isBackfill = this.mode === "backfill";
    let confirmedBy = null, confirmedNote = null;
    if (isBackfill) {
      confirmedBy = document.getElementById("nx-confirmed-by").value.trim();
      confirmedNote = document.getElementById("nx-confirmed-note").value.trim();
      if (!confirmedNote) { toast("Bắt buộc ghi lý do/nguồn xác nhận cho phiên nhập bù", "error"); return; }
    }

    loading(true, "Đang tạo phiên nhận xe...");
    const payload = {
      project_id: projectId,
      plate_number: plate,
      status: "capturing",
      entry_method: isBackfill ? "manual_backfill" : "app_capture",
      created_by: STATE.user.id,
      confirmed_by: STATE.user.id, // ghi tài khoản đang thao tác; confirmed_note là nội dung tự do ông nhập
      confirmed_note: confirmedNote,
    };
    const { data, error } = await sb.from("vehicle_receipts").insert(payload).select().single();
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }

    this.session = data;
    this.stepIndex = 0;
    this.uploadedTypes = new Set();
    if (isBackfill) this.renderBackfillUpload();
    else this.renderCaptureStep();
  },

  // ---------------- LUỒNG CHỤP TRỰC TIẾP ----------------
  renderCaptureStep() {
    const step = PHOTO_STEPS[this.stepIndex];
    const body = document.getElementById("nhanxe-body");
    body.innerHTML = `
      <div style="display:flex;gap:6px;margin-bottom:12px">
        ${PHOTO_STEPS.map((s, i) => `<div style="flex:1;height:4px;border-radius:2px;background:${i < this.stepIndex ? "var(--green)" : i === this.stepIndex ? "var(--blue)" : "var(--gray2)"}"></div>`).join("")}
      </div>
      <h3>Bước ${this.stepIndex + 1}/4 — ${step.label}</h3>
      <video id="nx-video" autoplay playsinline muted style="width:100%;border-radius:8px;background:#000;max-height:360px;object-fit:cover"></video>
      <canvas id="nx-canvas" style="display:none"></canvas>
      <div id="nx-camera-error"></div>
      <div class="btn-row" style="margin-top:12px;display:flex;gap:10px">
        <button class="btn btn-primary" id="nx-btn-capture" onclick="NhanXe.capturePhoto()">📷 Chụp</button>
      </div>`;
    this.initCamera();
  },

  async initCamera() {
    this.stopCamera();
    const errEl = document.getElementById("nx-camera-error");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      const video = document.getElementById("nx-video");
      video.srcObject = this.stream;
    } catch (e) {
      errEl.innerHTML = `<div class="badge badge-danger" style="margin-top:8px">Không mở được camera: ${escapeHtml(e.message)} — kiểm tra quyền truy cập camera của trình duyệt.</div>`;
    }
  },

  stopCamera() {
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
  },

  async capturePhoto() {
    const video = document.getElementById("nx-video");
    const canvas = document.getElementById("nx-canvas");
    if (!video || !video.videoWidth) { toast("Camera chưa sẵn sàng, thử lại", "error"); return; }

    const maxDim = CFG.IMAGE_RESIZE.maxDim;
    let w = video.videoWidth, h = video.videoHeight;
    if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
    else if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(video, 0, 0, w, h);

    canvas.toBlob(
      (blob) => this.uploadPhoto(blob, PHOTO_STEPS[this.stepIndex]),
      "image/jpeg",
      CFG.IMAGE_RESIZE.quality
    );
  },

  async uploadPhoto(blob, step) {
    const btn = document.getElementById("nx-btn-capture");
    if (btn) { btn.disabled = true; btn.textContent = "Đang gửi..."; }
    const path = `${this.session.project_id}/${this.session.id}/${step.type}.jpg`;
    const { error: upErr } = await sb.storage.from(CFG.STORAGE_BUCKET_VEHICLE_PHOTOS).upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (upErr) {
      this.showUploadRetry(step, "Lỗi mạng khi tải ảnh lên: " + upErr.message);
      return;
    }
    const { error: dbErr } = await sb.from("vehicle_receipt_photos").insert({
      vehicle_receipt_id: this.session.id,
      photo_type: step.type,
      step_order: step.order,
      file_url: path, // lưu ĐƯỜNG DẪN storage — bucket private, hiển thị lại phải dùng createSignedUrl()
    });
    if (dbErr) {
      this.showUploadRetry(step, "Lỗi lưu thông tin ảnh: " + dbErr.message);
      return;
    }
    this.uploadedTypes.add(step.type);
    this.stepIndex++;
    if (this.stepIndex >= PHOTO_STEPS.length) this.finishCapture();
    else this.renderCaptureStep();
  },

  showUploadRetry(step, message) {
    const errEl = document.getElementById("nx-camera-error");
    errEl.innerHTML = `<div class="badge badge-danger" style="margin-top:8px;display:block;padding:8px">${escapeHtml(message)}</div>`;
    const btn = document.getElementById("nx-btn-capture");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🔁 Gửi lại";
      btn.onclick = () => this.capturePhoto(); // chụp lại frame hiện tại của camera (vẫn đang mở) và gửi lại
    }
  },

  async finishCapture() {
    this.stopCamera();
    loading(true, "Đang hoàn tất phiên...");
    const { error } = await sb.from("vehicle_receipts").update({ status: "pending_detail", completed_at: new Date().toISOString() }).eq("id", this.session.id);
    loading(false);
    if (error) { toast("Lỗi: " + error.message, "error"); return; }
    document.getElementById("nhanxe-body").innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✅</div>
        <div>Đã chụp xong xe <strong>${escapeHtml(this.session.plate_number)}</strong> — chuyển sang hàng đợi "chờ nhập chi tiết" cho Phòng Vật Tư.</div>
        <button class="btn btn-primary" style="margin-top:14px" onclick="NhanXe.render(document.getElementById('content-area'))">+ Nhận xe tiếp theo</button>
      </div>`;
  },

  // ---------------- LUỒNG NHẬP BÙ (manager/admin) ----------------
  renderBackfillUpload() {
    const body = document.getElementById("nhanxe-body");
    body.innerHTML = `
      <h3>Tải ảnh đã nhận được (${this.session.plate_number})</h3>
      <div class="helper" style="margin-bottom:10px">Tối thiểu nên có ảnh Phiếu giao nhận — các ảnh khác nếu có thì tải thêm, không bắt buộc đủ 4 như luồng chụp trực tiếp.</div>
      <div id="nx-backfill-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
        ${PHOTO_STEPS.map((s) => this.backfillRowHtml(s)).join("")}
      </div>
      <button class="btn btn-primary" onclick="NhanXe.finishCapture()">Hoàn tất phiên nhập bù</button>`;
  },

  backfillRowHtml(step) {
    const done = this.uploadedTypes.has(step.type);
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px;border:1px solid var(--gray2);border-radius:6px">
      <span style="flex:1">${escapeHtml(step.label)}</span>
      ${done ? '<span class="badge badge-done">Đã tải</span>' : `<input type="file" accept="image/*" style="width:auto" onchange="NhanXe.backfillFileSelected('${step.type}', this)">`}
    </div>`;
  },

  async backfillFileSelected(type, input) {
    const file = input.files[0];
    if (!file) return;
    loading(true, "Đang nén và tải ảnh lên...");
    const step = PHOTO_STEPS.find((s) => s.type === type);
    try {
      const blob = await resizeImage(file, CFG.IMAGE_RESIZE.maxDim, CFG.IMAGE_RESIZE.quality);
      const path = `${this.session.project_id}/${this.session.id}/${type}.jpg`;
      const { error: upErr } = await sb.storage.from(CFG.STORAGE_BUCKET_VEHICLE_PHOTOS).upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (upErr) throw upErr;
      const { error: dbErr } = await sb.from("vehicle_receipt_photos").insert({
        vehicle_receipt_id: this.session.id, photo_type: type, step_order: step.order, file_url: path,
      });
      if (dbErr) throw dbErr;
      this.uploadedTypes.add(type);
      loading(false);
      this.renderBackfillUpload();
    } catch (e) {
      loading(false);
      toast("Lỗi: " + e.message, "error");
    }
  },
};

window.MODULES.nhanxe = { render: (container) => NhanXe.render(container) };
window.NhanXe = NhanXe;
