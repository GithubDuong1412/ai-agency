# Chuẩn nội dung cho website Việt Nam (định dạng tiền, ngày, SĐT, địa chỉ, văn phong)

## Định dạng
| Loại | Hiển thị | Lưu DB | Blade |
|---|---|---|---|
| Tiền | `120.000 ₫` (hoặc `120.000đ`) | số nguyên `120000` | `{{ number_format($p->price, 0, ',', '.') }} ₫` |
| Ngày | `05/11/2026` | `date`/`datetime` | `{{ $d->format('d/m/Y') }}` |
| Giờ | `14:30` | `datetime` | `{{ $d->format('H:i') }}` |
| SĐT | `0901 234 567` | chuỗi chỉ chữ số `0901234567` | link `tel:0901234567` |
| Địa chỉ | Số nhà, đường, phường/xã, tỉnh/thành | chuỗi | |

- Validate SĐT Việt Nam: `'phone' => ['required', 'regex:/^(0|\+84)(3|5|7|8|9)\d{8}$/']` (bỏ khoảng trắng trước khi validate).
- Múi giờ: `Asia/Ho_Chi_Minh` (đặt trong `config/app.php` nếu cần hiển thị giờ đúng).
- Ngôn ngữ thông báo validate: viết `messages()` trong Form Request bằng tiếng Việt, hoặc đặt `APP_LOCALE=vi` và tạo
  `lang/vi/validation.php` khi cần nhiều thông báo.

## Văn phong
- Xưng hô thân thiện, lịch sự: "Quý khách", "bạn" — thống nhất một kiểu trên cả site.
- Nút hành động là động từ rõ: "Đặt bàn ngay", "Gọi 0901 234 567", "Gửi liên hệ" (không "Submit", "Click here").
- Thông báo thành công cụ thể: "Cảm ơn bạn! Chúng tôi sẽ gọi lại trong 30 phút." Thông báo lỗi nói cách sửa:
  "Số điện thoại chưa đúng, ví dụ: 0901 234 567."
- Nội dung mẫu phải sát ngành: tên món, giá, giờ mở cửa, địa chỉ ở Việt Nam có thật về mặt hình thức (không cần là địa chỉ thật).

## Thông tin thường có ở site doanh nghiệp nhỏ
- Giờ mở cửa, địa chỉ + bản đồ (iframe Google Maps nhúng), SĐT bấm gọi được, Zalo/Facebook (link), email.
- Footer: tên doanh nghiệp, địa chỉ, SĐT, bản quyền năm hiện tại `{{ date('Y') }}`.
