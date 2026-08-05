/* ============================================================
   js/modules/nhanxe.js
   A2a — BCH/thủ kho chụp xe khi nhận hàng: camera TRỰC TIẾP trong app
   (không có input file/thư viện ảnh), trình tự bắt buộc, giờ ghi nhận
   là giờ SERVER lúc insert vào DB (KHÔNG dùng giờ hiển thị trên ảnh).

   Trình tự: Phiếu giao nhận (FULL SIZE, không nén) -> Đầu xe -> Sau
   lưng xe -> Bên hông xe (3 ảnh sau nén như bình thường).

   Biển số xe nhập qua 3 ô cấu trúc xx | y | xxxxx để sau này rà soát
   xe ra/vào trong ngày chính xác — ghép lại thành 1 chuỗi định dạng
   thống nhất "72H-00397" khi lưu (không tạo cột riêng, đủ dùng cho
   truy vấn LIKE 'xxY%' sau này nếu cần lọc theo đầu biển số).

   Nhập bù CHỈ role "manager" (Phòng Vật Tư Thiết Bị) — ảnh Phiếu giao
   nhận trong luồng nhập bù cũng giữ full size để đối chiếu được.
   ============================================================ */

const PHOTO_STEPS = [
  { type: "phieu_giao_nhan", order: 1, label: "Phiếu giao nhận", fullSize: true },
  { type: "dau_xe", order: 2, label: "Đầu xe", fullSize: false },
  { type: "sau_xe", order: 3, label: "Sau lưng xe", fullSize: false },
  { type: "hong_xe", order: 4, label: "Bên hông xe", fullSize: false },
];

// Ảnh mẫu hướng dẫn cho từng bước — dán link RAW (không phải link xem trên GitHub,
// phải là raw.githubusercontent.com/... hoặc CDN khác cho phép nhúng <img>) vào đây.
// Để trống ("") thì hiện khung tròn chữ "Mẫu" thay vì ảnh.
const GUIDE_IMAGES = {
  phieu_giao_nhan: "https://raw.githubusercontent.com/VelaE-C/VELA_VTTB/refs/heads/main/BUOC%201.png",
  dau_xe: "https://raw.githubusercontent.com/VelaE-C/VELA_VTTB/refs/heads/main/BUOC%202.png",
  sau_xe: "https://raw.githubusercontent.com/VelaE-C/VELA_VTTB/refs/heads/main/BUOC%203.png",
  hong_xe: "https://raw.githubusercontent.com/VelaE-C/VELA_VTTB/refs/heads/main/BUOC%204.png",
};

const NhanXe = {
  mode: "capture", // capture | backfill
  session: null,
  stepIndex: 0,
  stream: null,
  uploadedTypes: new Set(),

  async render(container) {
    this.session = null;
    this.stepIndex = 0;
    this.uploadedTypes = new Set();
    this.stopCamera();

    // Chỉ role "manager" (Phòng Vật Tư Thiết Bị) được nhập bù — theo yêu cầu, không mở cho admin ở UI
    // (lưu ý: RLS phía DB vẫn cho phép admin ghi vì fn_is_global() gộp cả admin+manager;
    // đây chỉ là giới hạn ở giao diện theo đúng quy ước làm việc ông muốn).
    const canBackfill = STATE.role === "manager";
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
        <div style="display:flex;gap:6px;align-items:center">
          <input id="nx-plate-1" maxlength="2" inputmode="numeric" placeholder="72" style="width:64px;text-align:center;text-transform:uppercase">
          <span>—</span>
          <input id="nx-plate-2" maxlength="1" placeholder="H" style="width:44px;text-align:center;text-transform:uppercase">
          <span>—</span>
          <input id="nx-plate-3" maxlength="5" inputmode="numeric" placeholder="00397" style="width:90px;text-align:center">
        </div>
        <div class="helper">2 số đầu — 1 chữ cái — 4 hoặc 5 số cuối (VD: 72 — H — 00397)</div>
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
          : `<div class="helper">Camera sẽ mở ngay sau khi bấm Bắt đầu — chụp đúng theo trình tự 4 bước, không thể chọn ảnh có sẵn. Riêng ảnh Phiếu giao nhận giữ nguyên chất lượng gốc để đối chiếu số liệu sau này.</div>`
      }
      <button class="btn btn-primary" style="margin-top:8px" onclick="NhanXe.startSession()">Bắt đầu ${isBackfill ? "nhập bù" : "chụp"}</button>`;
  },

  readPlateNumber() {
    const p1 = document.getElementById("nx-plate-1").value.trim().toUpperCase();
    const p2 = document.getElementById("nx-plate-2").value.trim().toUpperCase();
    const p3 = document.getElementById("nx-plate-3").value.trim();
    if (!/^\d{2}$/.test(p1)) { toast("Ô đầu biển số phải đúng 2 chữ số (VD: 72)", "error"); return null; }
    if (!/^[A-Z]$/.test(p2)) { toast("Ô giữa biển số phải đúng 1 chữ cái (VD: H)", "error"); return null; }
    if (!/^\d{4,5}$/.test(p3)) { toast("Ô cuối biển số phải 4 hoặc 5 chữ số (VD: 00397)", "error"); return null; }
    return `${p1}${p2}-${p3}`;
  },

  async startSession() {
    const projectId = document.getElementById("nx-project").value;
    const plate = this.readPlateNumber();
    if (!plate) return;

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
      confirmed_by: STATE.user.id,
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
    const guideUrl = GUIDE_IMAGES[step.type];
    const body = document.getElementById("nhanxe-body");
    body.innerHTML = `
      <div style="display:flex;gap:6px;margin-bottom:12px">
        ${PHOTO_STEPS.map((s, i) => `<div style="flex:1;height:4px;border-radius:2px;background:${i < this.stepIndex ? "var(--green)" : i === this.stepIndex ? "var(--blue)" : "var(--gray2)"}"></div>`).join("")}
      </div>
      <h3>Bước ${this.stepIndex + 1}/4 — ${step.label}${step.fullSize ? ' <span class="badge badge-info">Giữ chất lượng gốc</span>' : ""}</h3>
      <video id="nx-video" autoplay playsinline muted style="width:100%;border-radius:8px;background:#000;max-height:360px;object-fit:cover"></video>
      <canvas id="nx-canvas" style="display:none"></canvas>

      <div style="display:flex;align-items:center;justify-content:center;gap:24px;margin-top:16px">
        <div style="text-align:center;flex:none">
          <div style="width:64px;height:64px;border-radius:50%;overflow:hidden;border:2px solid var(--gray3);background:var(--gray1);display:flex;align-items:center;justify-content:center">
            ${guideUrl ? `<img src="${guideUrl}" alt="Ảnh mẫu ${escapeHtml(step.label)}" style="width:100%;height:100%;object-fit:cover">` : `<span style="font-size:10.5px;color:var(--gray4)">Mẫu</span>`}
          </div>
          <div style="font-size:10.5px;color:var(--gray5);margin-top:4px">Tham khảo</div>
        </div>

        <button id="nx-btn-capture" onclick="NhanXe.capturePhoto()" aria-label="Chụp"
          style="width:76px;height:76px;border-radius:50%;border:4px solid var(--blue);background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;flex:none">
          <span id="nx-btn-inner" style="width:58px;height:58px;border-radius:50%;background:var(--blue);display:block"></span>
        </button>

        <div style="width:64px;flex:none"></div>
      </div>
      <div id="nx-status-text" style="text-align:center;margin-top:10px;font-size:12.5px;min-height:18px"></div>`;
    this.initCamera();
  },

  async initCamera() {
    this.stopCamera();
    const statusEl = document.getElementById("nx-status-text");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      const video = document.getElementById("nx-video");
      video.srcObject = this.stream;
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red)">Không mở được camera: ${escapeHtml(e.message)} — kiểm tra quyền truy cập camera của trình duyệt.</span>`;
    }
  },

  stopCamera() {
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
  },

  async capturePhoto() {
    const video = document.getElementById("nx-video");
    const canvas = document.getElementById("nx-canvas");
    if (!video || !video.videoWidth) { toast("Camera chưa sẵn sàng, thử lại", "error"); return; }

    const step = PHOTO_STEPS[this.stepIndex];
    let w = video.videoWidth, h = video.videoHeight;
    let quality = CFG.IMAGE_RESIZE.quality;

    if (!step.fullSize) {
      const maxDim = CFG.IMAGE_RESIZE.maxDim;
      if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
      else if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
    } else {
      quality = 1.0; // Phiếu giao nhận: giữ đúng độ phân giải camera, chất lượng JPEG cao nhất
    }

    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(video, 0, 0, w, h);
    canvas.toBlob((blob) => this.uploadPhoto(blob, step), "image/jpeg", quality);
  },

  async uploadPhoto(blob, step) {
    const btn = document.getElementById("nx-btn-capture");
    const inner = document.getElementById("nx-btn-inner");
    const statusEl = document.getElementById("nx-status-text");
    if (btn) { btn.disabled = true; btn.style.opacity = "0.5"; }
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--gray5)">Đang gửi...</span>`;

    const path = `${this.session.project_id}/${this.session.id}/${step.type}.jpg`;
    const { error: upErr } = await sb.storage.from(CFG.STORAGE_BUCKET_VEHICLE_PHOTOS).upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (upErr) { this.showUploadRetry(step, "Lỗi mạng khi tải ảnh lên: " + upErr.message); return; }
    const { error: dbErr } = await sb.from("vehicle_receipt_photos").insert({
      vehicle_receipt_id: this.session.id, photo_type: step.type, step_order: step.order, file_url: path,
    });
    if (dbErr) { this.showUploadRetry(step, "Lỗi lưu thông tin ảnh: " + dbErr.message); return; }

    this.uploadedTypes.add(step.type);
    this.stepIndex++;
    if (this.stepIndex >= PHOTO_STEPS.length) this.finishCapture();
    else this.renderCaptureStep();
  },

  showUploadRetry(step, message) {
    const btn = document.getElementById("nx-btn-capture");
    const inner = document.getElementById("nx-btn-inner");
    const statusEl = document.getElementById("nx-status-text");
    if (btn) { btn.disabled = false; btn.style.opacity = "1"; btn.style.borderColor = "var(--red)"; }
    if (inner) inner.style.background = "var(--red)";
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--red)">${escapeHtml(message)}<br>Bấm nút chụp lại để thử gửi lại.</span>`;
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

  // ---------------- LUỒNG NHẬP BÙ (chỉ role manager) ----------------
  renderBackfillUpload() {
    const body = document.getElementById("nhanxe-body");
    body.innerHTML = `
      <h3>Tải ảnh đã nhận được (${this.session.plate_number})</h3>
      <div class="helper" style="margin-bottom:10px">Bắt buộc nên có ảnh Phiếu giao nhận (giữ nguyên chất lượng gốc để đối chiếu) — các ảnh khác nếu có thì tải thêm, không bắt buộc đủ 4 như luồng chụp trực tiếp.</div>
      <div id="nx-backfill-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
        ${PHOTO_STEPS.map((s) => this.backfillRowHtml(s)).join("")}
      </div>
      <button class="btn btn-primary" onclick="NhanXe.finishCapture()">Hoàn tất phiên nhập bù</button>`;
  },

  backfillRowHtml(step) {
    const done = this.uploadedTypes.has(step.type);
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px;border:1px solid var(--gray2);border-radius:6px">
      <span style="flex:1">${escapeHtml(step.label)}${step.fullSize ? ' <span class="badge badge-info">Giữ chất lượng gốc</span>' : ""}</span>
      ${done ? '<span class="badge badge-done">Đã tải</span>' : `<input type="file" accept="image/*" style="width:auto" onchange="NhanXe.backfillFileSelected('${step.type}', this)">`}
    </div>`;
  },

  async backfillFileSelected(type, input) {
    const file = input.files[0];
    if (!file) return;
    loading(true, "Đang tải ảnh lên...");
    const step = PHOTO_STEPS.find((s) => s.type === type);
    try {
      // Phiếu giao nhận: upload nguyên file gốc, KHÔNG resize, để giữ đối chiếu được số liệu
      const blob = step.fullSize ? file : await resizeImage(file, CFG.IMAGE_RESIZE.maxDim, CFG.IMAGE_RESIZE.quality);
      const path = `${this.session.project_id}/${this.session.id}/${type}.jpg`;
      const { error: upErr } = await sb.storage.from(CFG.STORAGE_BUCKET_VEHICLE_PHOTOS).upload(path, blob, { contentType: file.type || "image/jpeg", upsert: true });
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
