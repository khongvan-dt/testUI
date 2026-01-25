# UI i18n Test Tool (Electron + Playwright) — Tổng hợp ý tưởng & tiến độ

## 1) Mục tiêu dự án
Tạo 1 Desktop App (chạy trên máy khách hàng) giúp:
- Dán/Paste URL website cần test
- Tool mở trình duyệt thật để truy cập URL
- Tự động quét DOM để lấy danh sách các phần tử có `id`
- Hiển thị danh sách đó dạng checkbox để người dùng chọn key muốn export
- Bên phải hiển thị JSON preview dựa trên key đã tick
- Chạy validate/test ngay bằng chính JSON đã chọn:
  - Key có tồn tại không (`id`)
  - Text/placeholder có đúng không
- Có thể export JSON ra file
- Tạo report lỗi rõ ràng

---

## 2) Rule dữ liệu chính của hệ thống
### 2.1 Quy ước UI cần tuân theo
Giao diện website cần test chỉ cần:
- Element có `id`
- `id` chính là `key` trong JSON

Ví dụ:
```html
<h1 id="login.title">Đăng nhập</h1>
<button id="login.submit">Đăng nhập</button>
<input id="login.email" placeholder="Email" />
