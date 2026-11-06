# Cách chia task cho Dev (kích thước, thứ tự, ví dụ) và viết báo cáo cho Sếp

<!-- Nguyên tắc "30–60 phút/task, có tiêu chí, trích spec" chuyển thể từ agency-agents:
     project-management/project-manager-senior.md (MIT). -->

## Nguyên tắc
- Một task = một phần trọn vẹn kiểm tra được (QA test riêng được). Cỡ 30–60 phút làm.
- Task backend làm trước khi frontend cần dữ liệu/route của nó. Trang tĩnh thì frontend làm luôn bằng `Route::view`.
- Tránh task chung chung ("Làm giao diện"). Tránh task quá vụn ("Thêm nút").
- Mô tả task gồm: việc cần làm, file/route liên quan, tiêu chí xong (trích từ spec).

## Ví dụ: landing page tiệm bánh có form đặt bàn
1. **backend** — Bảng và form đặt bàn: migration `reservations`, model (Fillable), Form Request (luật + thông báo tiếng
   Việt), controller `create/store`, route `dat-ban.create`/`dat-ban.store`, feature test (hợp lệ lưu DB, thiếu
   trường báo lỗi). *Xong khi:* test pass.
2. **frontend** — Layout chung + trang chủ: `layouts/app.blade.php` (header, menu mobile, footer theo DESIGN.md), trang `/`.
   *Xong khi:* `/` trả 200, đúng bố cục DESIGN.md, mobile không vỡ.
3. **frontend** — Trang menu `/menu` với dữ liệu mẫu (mảng trong controller hoặc seeder nếu spec có quản lý món).
4. **frontend** — Giao diện form `/dat-ban`: dùng route backend đã có, hiện lỗi dưới ô, thông báo thành công.

## Báo cáo cho Sếp (submit_report)
- headline: một câu nói đúng tình trạng ("Xong landing page tiệm bánh, còn 1 lỗi nhỏ ở menu mobile").
- summary_markdown: đã làm gì (theo trang), kết quả test (số pass), kết luận kiểm duyệt + điểm.
- how_to_check: bước cụ thể trên trang xem trước.
- known_issues: lỗi còn tồn (lấy từ QA/Kiểm duyệt), không giấu.
- next_steps: việc nên làm tiếp, chỉ khi có lý do.
