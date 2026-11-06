# Mẫu cấu trúc DESIGN.md cho Frontend Dev

<!-- Cấu trúc "Design Foundations → Components → Responsive" chuyển thể từ agency-agents:
     design/design-ui-designer.md (Design Deliverable Template) và design/design-ux-architect.md (MIT). -->

```markdown
# DESIGN — [Tên dự án]

## 1. Định hướng
- Khách hàng chính: ... Họ cần nhất: ... (→ hành động chính của site)
- Tính cách thương hiệu (3 từ): ấm áp, mộc mạc, tin cậy
- Điều KHÔNG làm: không gradient tím, không hiệu ứng kính, không ảnh stock văn phòng.

## 2. Màu
| Token | Hex | Dùng cho |
|---|---|---|
| primary | #B45309 | nút chính, link |
| primary-dark | #92400E | hover nút |
| ink | #1C1917 | chữ chính (trên nền surface: tương phản 15:1) |
| muted | #57534E | chữ phụ (≥ 4.5:1 trên surface) |
| surface | #FFFBF5 | nền trang |
| card | #FFFFFF | nền thẻ |
| success / error | #15803D / #B91C1C | thông báo |

## 3. Chữ
- Font tiêu đề: "Playfair Display" 700 (Google Fonts, có subset vietnamese). Font thân: "Be Vietnam Pro" 400/600.
- Cỡ: h1 40/48px (mobile 32px), h2 28px, h3 20px, thân 16–18px, chú thích 14px. Line-height thân 1.6.

## 4. Khoảng cách, bo góc, bóng
- Thang khoảng cách 4/8/12/16/24/32/48/64px. Section cách nhau 64px (mobile 48px). Container tối đa 1152px, lề 16px.
- Bo góc: nút 8px, thẻ 12px. Bóng: thẻ `0 1px 3px rgba(0,0,0,.08)`.

## 5. Thành phần
- Header: logo trái, menu phải; mobile: nút ☰ mở menu dọc. Nút chính "Đặt bàn" luôn hiện.
- Nút chính / phụ / link: màu, padding (12×20px), trạng thái hover, focus (viền 2px primary), disabled.
- Ô nhập: label trên, viền 1px, focus viền primary, lỗi chữ đỏ dưới ô.
- Thẻ món: ảnh 4:3, tên, mô tả 2 dòng, giá.

## 6. Trang
### Trang chủ `/`
1. Hero: ảnh quán (placehold.co/1600x900), h1, câu mô tả, nút "Đặt bàn".
2. Món nổi bật: lưới 3 cột (mobile 1 cột), 6 thẻ món.
3. Giờ mở cửa + địa chỉ + bản đồ.
### ... (mỗi trang trong spec)

## 7. Trạng thái
- Form lỗi / thành công (hộp xanh trên form) / danh sách rỗng ("Chưa có món nào") / focus bàn phím.

## 8. Responsive
- Breakpoint: 375 (mobile), 768 (tablet), 1024+ (desktop). Mô tả thay đổi từng section.
```
