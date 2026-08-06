/* ============================================================
   js/core/utils.js
   Copy nguyên cho mọi app VELA_* — không sửa theo Design System §1.2
   ============================================================ */

// ---------- LOADING ----------
function loading(show, text) {
  let el = document.getElementById("loading-overlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "loading-overlay";
    el.innerHTML = '<div class="spinner"></div><div id="loading-text" style="font-size:13px;color:var(--gray7)"></div>';
    document.body.appendChild(el);
  }
  document.getElementById("loading-text").textContent = text || "Đang xử lý...";
  el.classList.toggle("show", !!show);
}

// ---------- TOAST ----------
function toast(msg, type) {
  type = type || "info";
  const el = document.createElement("div");
  el.className = "toast toast-" + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------- MODAL ----------
function openModal({ title, bodyHtml, footerHtml, onClose, wide, preventBackdropClose }) {
  closeModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "active-modal";
  overlay.innerHTML = `
    <div class="modal-box"${wide ? ' style="max-width:920px"' : ""}>
      <div class="modal-header">
        <span>${escapeHtml(title || "")}</span>
        <button class="modal-close" aria-label="Đóng" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">${bodyHtml || ""}</div>
      ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ""}
    </div>`;
  if (!preventBackdropClose) {
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  }
  document.body.appendChild(overlay);
  if (onClose) overlay._onClose = onClose;
}
function closeModal() {
  const el = document.getElementById("active-modal");
  if (el) { if (el._onClose) el._onClose(); el.remove(); }
}

// ---------- FORMAT ----------
function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Math.round(n).toLocaleString("vi-VN") + " đ";
}
function fmtNumber(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Math.round(n).toLocaleString("vi-VN"); // không hiện số lẻ cho đơn vị đếm được
}
function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("vi-VN");
}
function fmtDateTime(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("vi-VN") + " " + dt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}
function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- DEBOUNCE (cho ô search) ----------
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms || 300); };
}

// ---------- RESIZE ẢNH PHÍA CLIENT (bắt buộc trước khi upload — xem CFG.IMAGE_RESIZE) ----------
function resizeImage(file, maxDim, quality) {
  maxDim = maxDim || (CFG.IMAGE_RESIZE ? CFG.IMAGE_RESIZE.maxDim : 1600);
  quality = quality || (CFG.IMAGE_RESIZE ? CFG.IMAGE_RESIZE.quality : 0.7);
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
      else if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- ĐỊNH DẠNG SỐ KHI GÕ (dấu "." ngăn hàng nghìn, dấu "," cho phần lẻ) ----------
// Gắn vào 1 input để tự format lại giá trị mỗi khi người dùng gõ — dùng cho mọi ô
// số lượng/đơn giá/số tiền trong toàn app để nhìn là biết ngay bao nhiêu.
function attachNumberFormat(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.setAttribute("inputmode", "decimal");
  el.type = "text";
  el.addEventListener("input", () => {
    let v = el.value.replace(/[^\d,]/g, "");
    const parts = v.split(",");
    let intPart = parts[0].replace(/^0+(?=\d)/, "");
    intPart = intPart ? Number(intPart).toLocaleString("vi-VN") : "";
    const decPart = parts.length > 1 ? "," + parts[1].slice(0, 2) : "";
    el.value = intPart + decPart;
  });
}
// Đọc lại giá trị số thật (float) từ 1 input đã format bằng attachNumberFormat()
function parseFormattedNumber(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return NaN;
  const raw = el.value.replace(/\./g, "").replace(",", ".").trim();
  return raw ? parseFloat(raw) : NaN;
}

// ---------- Ô CHỌN CÓ TÌM KIẾM (thay <select> khi danh sách dài) ----------
// groupedOptions: [{ groupLabel, items: [{ value, label }] }] — nhóm đầu tiên nên là
// nhóm ưu tiên (vd "Đã dùng ở dự án này") nếu muốn đẩy lên trên cùng.
// Chỉ cho CHỌN trong danh sách, không cho gõ tự do tạo giá trị mới.
function searchableSelectHtml(id, placeholder) {
  return `<div class="ssel" id="${id}">
    <input type="text" class="ssel-input" placeholder="${escapeHtml(placeholder || "Gõ để tìm...")}" autocomplete="off">
    <input type="hidden" class="ssel-value">
    <div class="ssel-dropdown" style="display:none"></div>
  </div>`;
}
function initSearchableSelect(containerId, groupedOptions, opts) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const input = container.querySelector(".ssel-input");
  const hidden = container.querySelector(".ssel-value");
  const dropdown = container.querySelector(".ssel-dropdown");

  function renderList(filterText) {
    const q = (filterText || "").toLowerCase().trim();
    let html = "";
    let hasAny = false;
    groupedOptions.forEach((g) => {
      const items = g.items.filter((it) => !q || it.label.toLowerCase().includes(q));
      if (!items.length) return;
      hasAny = true;
      html += `<div class="ssel-group">${escapeHtml(g.groupLabel)}</div>`;
      items.forEach((it) => {
        html += `<div class="ssel-option" data-value="${escapeHtml(it.value)}" data-label="${escapeHtml(it.label)}">${escapeHtml(it.label)}</div>`;
      });
    });
    dropdown.innerHTML = hasAny ? html : `<div class="ssel-empty">Không tìm thấy — kiểm tra chính tả hoặc thêm mới ở Danh mục</div>`;
    dropdown.style.display = "block";
  }

  input.addEventListener("focus", () => renderList(""));
  input.addEventListener("input", () => { hidden.value = ""; renderList(input.value); });
  dropdown.addEventListener("mousedown", (e) => {
    const opt = e.target.closest(".ssel-option");
    if (!opt) return;
    hidden.value = opt.dataset.value;
    input.value = opt.dataset.label;
    dropdown.style.display = "none";
    if (opts && opts.onSelect) opts.onSelect(opt.dataset.value);
  });
  document.addEventListener("click", (e) => {
    if (!container.contains(e.target)) dropdown.style.display = "none";
  });
  // Nếu người dùng gõ xong rồi rời ô mà không chọn -> không giữ chữ mồ côi, xóa về rỗng
  input.addEventListener("blur", () => {
    setTimeout(() => { if (!hidden.value) input.value = ""; }, 200);
  });
}
function getSearchableSelectValue(containerId) {
  const el = document.getElementById(containerId);
  return el ? el.querySelector(".ssel-value").value : "";
}

// ---------- XEM ẢNH TOÀN MÀN HÌNH — zoom cuộn chuột/chụm ngón, kéo để di chuyển ----------
function openImageViewer(url, altText) {
  closeImageViewer();
  const overlay = document.createElement("div");
  overlay.id = "img-viewer-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:999;display:flex;align-items:center;justify-content:center;overflow:hidden;touch-action:none";
  overlay.innerHTML = `
    <button id="iv-close" aria-label="Đóng" style="position:absolute;top:16px;right:16px;z-index:2;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.15);border:none;color:#fff;font-size:18px;cursor:pointer">✕</button>
    <div style="position:absolute;bottom:16px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.65);font-size:12px;z-index:2;text-align:center;padding:0 16px">Cuộn hoặc chụm 2 ngón để zoom · Kéo để di chuyển · Bấm đúp để phóng nhanh</div>
    <img id="iv-img" src="${url}" alt="${escapeHtml(altText || "")}" draggable="false"
      style="max-width:92%;max-height:88%;user-select:none;transform-origin:center center;cursor:grab;will-change:transform">`;
  document.body.appendChild(overlay);

  const img = overlay.querySelector("#iv-img");
  let scale = 1, posX = 0, posY = 0, dragging = false, startX = 0, startY = 0, pinchDist = null, pinchScale = 1;

  const apply = () => { img.style.transform = `translate(${posX}px, ${posY}px) scale(${scale})`; };
  const clamp = (s) => Math.min(Math.max(s, 1), 5);
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  overlay.querySelector("#iv-close").onclick = closeImageViewer;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeImageViewer(); });

  overlay.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      scale = clamp(scale + (e.deltaY < 0 ? 0.18 : -0.18));
      if (scale === 1) { posX = 0; posY = 0; }
      apply();
    },
    { passive: false }
  );

  img.addEventListener("dblclick", () => {
    scale = scale > 1 ? 1 : 2.5;
    if (scale === 1) { posX = 0; posY = 0; }
    apply();
  });

  img.addEventListener("mousedown", (e) => {
    if (scale === 1) return;
    dragging = true; startX = e.clientX - posX; startY = e.clientY - posY; img.style.cursor = "grabbing";
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    posX = e.clientX - startX; posY = e.clientY - startY; apply();
  });
  window.addEventListener("mouseup", () => { dragging = false; img.style.cursor = "grab"; });

  overlay.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 2) { pinchDist = dist(e.touches); pinchScale = scale; }
      else if (e.touches.length === 1 && scale > 1) { dragging = true; startX = e.touches[0].clientX - posX; startY = e.touches[0].clientY - posY; }
    },
    { passive: true }
  );
  overlay.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length === 2 && pinchDist) {
        e.preventDefault();
        scale = clamp(pinchScale * (dist(e.touches) / pinchDist));
        apply();
      } else if (e.touches.length === 1 && dragging) {
        e.preventDefault();
        posX = e.touches[0].clientX - startX; posY = e.touches[0].clientY - startY; apply();
      }
    },
    { passive: false }
  );
  overlay.addEventListener("touchend", (e) => {
    if (e.touches.length < 2) pinchDist = null;
    if (e.touches.length === 0) dragging = false;
  });

  overlay._escHandler = (e) => { if (e.key === "Escape") closeImageViewer(); };
  document.addEventListener("keydown", overlay._escHandler);
}
function closeImageViewer() {
  const el = document.getElementById("img-viewer-overlay");
  if (el) { if (el._escHandler) document.removeEventListener("keydown", el._escHandler); el.remove(); }
}

// ---------- EMPTY STATE ----------
function emptyStateHtml(text, actionHtml) {
  return `<div class="empty-state"><div class="empty-icon">📭</div><div>${escapeHtml(text)}</div>${actionHtml || ""}</div>`;
}

// ---------- BADGE cảnh báo ngân sách (dùng chung nhiều module) ----------
function budgetAlertBadge(alertLevel, pctUsed) {
  const map = {
    ok: ["badge-done", "Bình thường"],
    warning_70: ["badge-progress", "Cảnh báo 70%"],
    critical_85: ["badge-progress", "Cần rà soát 85%"],
    over_budget: ["badge-danger", "Vượt ngân sách"],
  };
  const [cls, label] = map[alertLevel] || ["badge-none", "—"];
  return `<span class="badge ${cls}">${label}${pctUsed !== undefined ? " · " + pctUsed + "%" : ""}</span>`;
}
