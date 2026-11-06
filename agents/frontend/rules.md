<!-- Chuyển thể từ agency-agents: engineering/engineering-frontend-developer.md (mục Critical Rules),
     engineering/engineering-minimal-change-engineer.md (MIT). Phần Blade/Tailwind CDN do đội tự viết. -->
# Luật của Frontend Dev

## Làm theo thiết kế
- Làm đúng DESIGN.md (màu, font, khoảng cách, bố cục) và SPEC.md. Thiết kế thiếu chỗ nào thì chọn cách đơn giản,
  nhất quán với phần đã có, và ghi lại trong notes_for_qa.
- Màu/font của thiết kế khai báo một lần trong layout (Tailwind `@theme` trong `<style type="text/tailwindcss">`),
  không lặp mã hex rải rác. Xem knowledge `tailwind-cdn`.

## Cấu trúc Blade
- Mọi trang `@extends('layouts.app')` hoặc dùng component layout; header/footer/nút/thẻ lặp lại → `resources/views/components/`.
- Không viết logic truy vấn trong view; dữ liệu do controller truyền vào. Không dùng inline `style=""` khi có class Tailwind.
- In dữ liệu bằng `{{ }}` (tự escape). Chỉ dùng `{!! !!}` với nội dung tin cậy và phải ghi lý do.
- Link dùng `route('ten')` hoặc `url()`, không hard-code domain. Ảnh/asset tĩnh để trong `public/`, gọi bằng `asset()`.

## Dễ dùng cho mọi người
- HTML ngữ nghĩa: một `<h1>` mỗi trang, heading không nhảy cấp, `<nav>`, `<main>`, `<footer>`, `<button>` cho hành động.
- Mọi ô nhập có `<label for>`; lỗi hiện ngay dưới ô (`@error`), giữ lại giá trị cũ (`old()`).
- Ảnh có `alt` mô tả (ảnh trang trí `alt=""`). Focus nhìn thấy được khi dùng bàn phím. Menu mobile mở/đóng được bằng bàn phím.
- Chi tiết: knowledge `truy-cap-de-dung`.

## Hiệu năng và chất lượng
- `<meta name="viewport">`, responsive từ 375px; không cuộn ngang. Ảnh có `width`/`height` và `loading="lazy"` (trừ ảnh đầu trang).
- Không lỗi console; JS nhỏ viết thẳng (vanilla hoặc Alpine qua CDN nếu thật cần), không thêm framework.
- Chạy `php artisan test` (hoặc `php artisan route:list`) sau khi sửa để chắc không vỡ gì.

## Vòng sửa lỗi
- Chỉ sửa đúng lỗi QA/Kiểm duyệt nêu. Mỗi dòng thay đổi phải trả lời được "lỗi này cần dòng này không?".
