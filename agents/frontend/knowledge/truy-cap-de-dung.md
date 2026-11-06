# Truy cập dễ dùng (accessibility) cho giao diện Blade: checklist WCAG 2.2 AA thực dụng

<!-- Rút gọn từ agency-agents: testing/testing-accessibility-auditor.md và
     engineering/engineering-frontend-developer.md (Accessibility and Inclusive Design) (MIT). -->

Ưu tiên HTML ngữ nghĩa trước ARIA: thẻ đúng thì gần như không cần ARIA.

| Kiểm tra | Cách làm đúng | Tiêu chí WCAG |
|---|---|---|
| Cấu trúc | 1 `<h1>`, heading không nhảy cấp; `<header> <nav> <main> <footer>` | 1.3.1 |
| Ảnh | `alt` mô tả nội dung; ảnh trang trí `alt=""` | 1.1.1 |
| Tương phản | chữ ≥ 4.5:1, chữ lớn ≥ 3:1, viền ô nhập/icon ≥ 3:1 | 1.4.3, 1.4.11 |
| Bàn phím | mọi link/nút/menu dùng được bằng Tab/Enter/Space; thứ tự Tab theo thứ tự nhìn | 2.1.1, 2.4.3 |
| Focus | không xoá outline; dùng `focus-visible:` rõ ràng; phần dính (header sticky) không che ô đang focus | 2.4.7, 2.4.11 |
| Form | `<label for>` cho mọi ô; lỗi nói rõ cách sửa, gắn `aria-describedby`; không chỉ báo lỗi bằng màu | 3.3.1, 3.3.2 |
| Liên kết | chữ link có nghĩa ("Xem menu", không "Bấm vào đây") | 2.4.4 |
| Ngôn ngữ | `<html lang="vi">` | 3.1.1 |
| Vùng bấm | ≥ 24×24px (khuyến nghị 44px trên mobile) | 2.5.8 |
| Chuyển động | animation nhẹ; tôn trọng `motion-reduce:` | 2.3.3 |
| Thu phóng | không chặn zoom (không `maximum-scale=1`) | 1.4.4 |

## Hay sai
- Nút chỉ có icon mà không có `aria-label`.
- `<div onclick>` thay vì `<button>`.
- Placeholder thay cho label.
- Thông báo thành công không có `role="status"` (trình đọc màn hình không đọc).
- Lighthouse xanh không có nghĩa là đã dễ dùng: vẫn phải thử bằng bàn phím.
