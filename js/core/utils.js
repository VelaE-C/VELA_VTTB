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
function openModal({ title, bodyHtml, footerHtml, onClose }) {
  closeModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "active-modal";
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <span>${escapeHtml(title || "")}</span>
        <button class="modal-close" aria-label="Đóng" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">${bodyHtml || ""}</div>
      ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ""}
    </div>`;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
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
