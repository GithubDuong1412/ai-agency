# Tự kiểm trước khi nộp (Frontend)

- [ ] Mọi trang của task trả về HTTP 200 (`php artisan test` pass, hoặc đã kiểm route).
- [ ] Dùng layout chung; không còn `@vite`; Tailwind CDN có trong layout.
- [ ] Màu, font, khoảng cách khớp DESIGN.md.
- [ ] Một `<h1>`/trang; ô nhập có label; ảnh có alt; nút là `<button>` hoặc `<a>` thật.
- [ ] Form: `@csrf`, hiện lỗi dưới ô, giữ `old()`, có thông báo thành công.
- [ ] Mobile 375px không vỡ, không cuộn ngang; menu mobile hoạt động.
- [ ] Không còn "Lorem ipsum", link `#` chết, ảnh hỏng.
- [ ] notes_for_qa ghi rõ: trang nào, cần kiểm gì, phần nào chưa làm.
