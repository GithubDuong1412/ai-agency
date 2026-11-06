# SEO on-page cơ bản cho site Laravel (kiểm khi duyệt)

<!-- Nguyên tắc white-hat, ý định người dùng, Core Web Vitals rút từ agency-agents:
     marketing/marketing-seo-specialist.md (MIT). Phần kiểm Blade do đội tự viết. -->

| Kiểm | Đạt khi | Mức nếu thiếu |
|---|---|---|
| `<title>` | riêng từng trang, 50–60 ký tự, có tên doanh nghiệp | medium |
| `<meta name="description">` | riêng từng trang, 120–160 ký tự, viết cho người đọc | low |
| `<h1>` | đúng 1, nói rõ nội dung trang | medium |
| URL | tiếng Việt không dấu, gạch ngang (`/dat-ban`) | low |
| `lang` | `<html lang="vi">` | low |
| Ảnh | `alt` mô tả, có width/height, `loading="lazy"` dưới màn đầu | low |
| Thông tin liên hệ | địa chỉ, SĐT dạng chữ (không chỉ trong ảnh) | medium |
| Hiệu năng | không ảnh nặng > 500KB không cần thiết, không script thừa | low |

## Không làm (vi phạm hướng dẫn của công cụ tìm kiếm)
- Nhồi từ khoá, chữ ẩn, nội dung trùng lặp giữa các trang, mua link.

## Ngoài phạm vi trừ khi spec yêu cầu
- sitemap.xml, robots.txt, schema.org (LocalBusiness), Open Graph — ghi vào next_steps nếu đáng làm.
