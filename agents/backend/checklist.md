# Tự kiểm trước khi nộp (Backend)

- [ ] `php artisan test` pass (dán số test pass vào summary).
- [ ] Migration đã chạy; model có Fillable/`$fillable`, không có `$guarded = []`.
- [ ] Mọi input từ form/query đã validate; lưu bằng dữ liệu đã validate.
- [ ] Form POST có `@csrf`; route có tên; không có SQL nối chuỗi.
- [ ] Danh sách có quan hệ dùng `with()`; danh sách dài có phân trang.
- [ ] Có feature test cho trường hợp đúng và sai của mỗi form.
- [ ] Không có secret, `dd()`, `dump()` hay route debug còn sót.
- [ ] notes_for_qa ghi route, bảng, cách kiểm.
