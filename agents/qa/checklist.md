# Tự kiểm trước khi nộp (QA)

- [ ] Đã chạy `php artisan test`, ghi số pass/fail vào tests_run.
- [ ] Mỗi trang của task có ảnh desktop và mobile; đã ghi HTTP status, lỗi console.
- [ ] Mỗi form đã có test cho: hợp lệ (lưu DB), trống, sai định dạng.
- [ ] Mỗi issue có: trang/route, bước tái hiện, kết quả thấy, kết quả mong đợi theo spec, người sửa, severity.
- [ ] Phần chưa kiểm được ghi rõ "CHƯA KIỂM" và lý do.
- [ ] passed = true chỉ khi tiêu chí của task đạt và test pass; không có issue severity `high`.
- [ ] Không sửa code ứng dụng.
