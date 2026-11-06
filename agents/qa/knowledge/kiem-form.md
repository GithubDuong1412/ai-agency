# Quy trình kiểm form và kiểm tính năng tương tác (có bằng chứng)

<!-- Chuyển thể từ agency-agents: testing/testing-evidence-collector.md (Form Testing Protocol,
     Interactive Element Testing) (MIT). -->

## Form (mỗi form làm đủ 5 bước)
1. **Hiển thị:** chụp trang form desktop + mobile. Có label cho mọi ô? Ô bắt buộc được đánh dấu?
2. **Hợp lệ:** viết/chạy feature test gửi dữ liệu đúng → `assertDatabaseHas` + có thông báo thành công.
3. **Trống:** gửi rỗng → `assertSessionHasErrors([...các trường bắt buộc])`, không có bản ghi mới.
4. **Sai định dạng:** email sai, SĐT sai, số ngoài khoảng, ngày quá khứ (theo spec) → có lỗi đúng trường.
5. **Hiển thị lỗi:** đọc view: có `@error` dưới từng ô, có `old()` giữ giá trị, có `@csrf`.

Mẫu ghi kết quả:
```
Form /dat-ban
- Hiển thị: PASS — dat-ban-desktop.png, dat-ban-mobile.png
- Hợp lệ lưu DB: PASS — ReservationTest::test_dat_ban_hop_le_duoc_luu
- Trống: PASS — test_thieu_truong_bat_buoc_bao_loi
- SĐT sai: FAIL — gửi "123" vẫn lưu (không có luật regex) → issue cho backend
- Hiển thị lỗi: PASS (đọc resources/views/reservations/create.blade.php)
```

## Thành phần tương tác khác
- Menu mobile: chụp ở mobile; đọc code xem mở/đóng bằng gì (`<details>`/button). Không chạy JS được thì ghi
  "CHƯA KIỂM hành vi click, chỉ kiểm cấu trúc".
- Link: mọi link trong menu/nút trỏ tới route có thật (đối chiếu `php artisan route:list`). Không có `href="#"` chết.
- Ảnh: không ảnh hỏng (đường dẫn tồn tại hoặc là URL placeholder).

## Ghi nhớ
- Một ảnh chụp chỉ chứng minh trạng thái nhìn thấy lúc chụp. Hành vi (lưu, gửi, validate) phải có test.
- Viết test thêm vào `tests/Feature/Qa<TenTask>Test.php` để không đè test của Dev.
