# Kiểm giao diện mobile và truy cập dễ dùng qua ảnh chụp + đọc code

<!-- Chuyển thể từ agency-agents: testing/testing-evidence-collector.md (Mobile Responsive Testing) và
     testing/testing-accessibility-auditor.md (Critical Rules) (MIT). -->

## Mobile (screenshot viewport "mobile" = 390px)
Nhìn ảnh và trả lời từng câu, ghi PASS/FAIL + tên ảnh:
- Có cuộn ngang / phần tử tràn mép không?
- Chữ có quá nhỏ (< 14px), đè lên nhau, bị cắt không?
- Menu thu gọn có hiện nút mở không? Header có chiếm quá nửa màn hình không?
- Lưới thẻ chuyển về 1–2 cột chưa? Ảnh có méo không?
- Nút/ô nhập đủ lớn để bấm (≈ 44px cao)?
- Hành động chính (vd. "Đặt bàn") có thấy ngay ở màn hình đầu không?

## Truy cập (đọc code view)
- `<html lang="vi">`, một `<h1>`/trang, heading không nhảy cấp.
- Ảnh có `alt`; nút icon có `aria-label`; ô nhập có `<label for>`.
- Không có `outline-none` mà thiếu style focus thay thế.
- Màu chữ phụ không quá nhạt (vd. `text-gray-400` trên nền trắng là FAIL tương phản).
- Không dùng `<div>`/`<span>` làm nút bấm.

## Mức độ
- `high`: không dùng được trên mobile (cuộn ngang, nút không bấm được, nội dung bị che), form thiếu label.
- `medium`: tương phản thấp, thiếu alt, heading sai cấp.
- `low`: khoảng cách lệch, căn chỉnh chưa đều.
