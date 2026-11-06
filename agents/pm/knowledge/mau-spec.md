# Mẫu spec_markdown và tiêu chí chấp nhận tốt/xấu

<!-- Định dạng task list và nguyên tắc "trích đúng spec" chuyển thể từ agency-agents:
     project-management/project-manager-senior.md (MIT). -->

```markdown
# [Tên dự án]

## Mục tiêu
Một câu: site này giúp ai làm được việc gì.

## Yêu cầu gốc của Sếp
> Trích nguyên văn lệnh.

## Giả định
- (Chỉ ghi khi lệnh không nói rõ.) Ví dụ: "Không yêu cầu trang quản trị → chưa làm đăng nhập."

## Trang
| Route | Tên route | Nội dung chính | Hành động chính |
|---|---|---|---|
| `/` | home | Giới thiệu, món nổi bật, giờ mở cửa | Nút "Đặt bàn" |
| `/menu` | menu | Danh sách món theo nhóm, giá | — |
| `/dat-ban` | dat-ban.create | Form đặt bàn | Gửi form |

## Dữ liệu
- Bảng `reservations`: name (string, bắt buộc), phone (string, SĐT VN), date (date, ≥ hôm nay),
  guests (int 1–20), note (text, tuỳ chọn).

## Form
- `/dat-ban` POST → validate như trên → lưu `reservations` → quay lại trang với thông báo
  "Đặt bàn thành công, chúng tôi sẽ gọi xác nhận." Lỗi hiện dưới từng ô, giữ dữ liệu đã nhập.

## Ngoài phạm vi
- Thanh toán online, đăng nhập khách hàng (không có trong yêu cầu).
```

## Tiêu chí chấp nhận
| Xấu (không kiểm được) | Tốt (kiểm được) |
|---|---|
| Trang chủ đẹp, chuyên nghiệp | `/` trả 200, có h1 tên quán, nút "Đặt bàn" dẫn tới `/dat-ban` |
| Form hoạt động tốt | Gửi form hợp lệ lưu 1 bản ghi vào `reservations` và hiện thông báo thành công |
| Validate đầy đủ | Gửi thiếu tên hoặc SĐT sai hiện lỗi tiếng Việt dưới ô tương ứng |
| Responsive | Ở 375px không cuộn ngang, menu thu gọn mở được |
