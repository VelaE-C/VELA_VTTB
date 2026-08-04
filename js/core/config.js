/* ============================================================
   js/core/config.js
   CFG (Supabase URL/key), STATE global — theo VelaE&C Design System §1.3
   ============================================================ */

// TODO: điền URL + anon key từ project Supabase "vela-vttb" của ông
// Dashboard > Project Settings > API — chỉ lấy "anon public" key,
// KHÔNG bao giờ đặt service_role key vào file chạy trên trình duyệt.
const CFG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-KEY",
  APP_NAME: "VELA_VTTB",
  STORAGE_BUCKET_VEHICLE_PHOTOS: "vttb-vehicle-photos",
  STORAGE_BUCKET_ATTACHMENTS: "vttb-attachments",
  // Ngưỡng cảnh báo ngân sách — khớp với v_budget_summary.alert_level trong schema
  BUDGET_ALERT: { warning: 70, critical: 85 },
  // Resize ảnh phía client trước upload (bắt buộc — xem phân tích dung lượng đã thống nhất)
  IMAGE_RESIZE: { maxDim: 1600, quality: 0.7 },
};

// STATE — object duy nhất chứa toàn bộ trạng thái app, KHÔNG lưu vào localStorage
const STATE = {
  user: null,          // supabase auth user
  profile: null,       // { id, full_name, email, role }
  role: null,           // 'admin' | 'manager' | 'editor' | 'viewer'
  assignedProjects: [], // mảng project_id — chỉ có ý nghĩa khi role editor/viewer
  currentPage: null,
  currentProjectFilter: null, // project_id đang lọc ở top bar (null = tất cả, nếu được phép)
  // cache dữ liệu dùng chung nhiều module — mỗi module tự load khi cần, tránh load thừa lúc khởi động
  projects: [],
  materials: [],
  suppliers: [],
};

// Supabase client — khởi tạo sau khi CDN script đã load (xem thứ tự script trong index.html)
const sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

// Đăng ký module — mỗi file trong js/modules/ tự add vào đây:
// window.MODULES.dashboard = { render: async (container) => {...} }
window.MODULES = window.MODULES || {};

// Định nghĩa tab điều hướng — 1 nơi duy nhất, app-specific (main.js dùng để render sidebar/bottom nav)
// roles: role nào được thấy tab này trong sidebar (ẩn hẳn khỏi DOM nếu không đủ quyền)
const NAV_ITEMS = [
  { id: "dashboard", label: "Tổng quan", icon: "📊", group: null, roles: ["admin", "manager", "editor", "viewer"], bottomNav: true },
  { id: "danhmuc", label: "Danh mục", icon: "🗂️", group: "Dữ liệu nền", roles: ["admin", "manager", "editor", "viewer"], bottomNav: true },
  { id: "users", label: "Người dùng", icon: "👤", group: "Dữ liệu nền", roles: ["admin"], bottomNav: false },
  // Các module dưới đây sẽ bổ sung dần theo checklist build (Bước 6+) — để sẵn cấu trúc, chưa gắn module thật.
  // { id: "nhanxe", label: "Nhận xe", icon: "🚚", group: "Vật tư", roles: ["admin","manager","editor"] },
  // { id: "nhapchitiet", label: "Nhập chi tiết", icon: "📝", group: "Vật tư", roles: ["admin","manager"] },
  // { id: "nganesach", label: "Ngân sách & Dự trù", icon: "💰", group: "Vật tư", roles: ["admin","manager","editor","viewer"] },
  // { id: "hoadon", label: "Hóa đơn", icon: "🧾", group: "Kế toán", roles: ["admin","manager","editor"] },
  // { id: "thanhtoan", label: "Thanh toán", icon: "💳", group: "Kế toán", roles: ["admin","manager","editor"] },
  // { id: "congno", label: "Công nợ NCC", icon: "📇", group: "Kế toán", roles: ["admin","manager","editor","viewer"] },
  // { id: "thietbi", label: "Thiết bị", icon: "🏗️", group: "Thiết bị", roles: ["admin","manager","editor","viewer"] },
  // { id: "giavattu", label: "Báo cáo giá", icon: "📈", group: "Báo cáo", roles: ["admin","manager"] },
];
