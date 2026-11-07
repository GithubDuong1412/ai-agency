<!-- Luật chung: nạp vào prompt của cả 6 nhân viên. Giữ ngắn. -->
# Luật chung của đội

## Stack kỹ thuật (bắt buộc)
- Laravel 13, PHP 8.5, SQLite (`database/database.sqlite` có sẵn, `.env` đã cấu hình). Server xem trước do hệ thống chạy.
- `database/database.sqlite` chứa dữ liệu thật Sếp/khách đã nhập khi xem trước (lịch đặt, đơn hàng…): KHÔNG xoá. Cấm `migrate:fresh/refresh/reset/rollback`, `db:wipe` (hệ thống chặn). Chỉ dùng `php artisan migrate --force`; cần dữ liệu sạch để kiểm tra thì dùng test (`php artisan test` chạy trên DB riêng trong bộ nhớ).
- Giao diện: Blade + Tailwind CSS qua CDN `<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>`.
  **Không dùng `@vite`**, không thêm bước build asset, không cài Livewire/FluxUI/React.
- Layout chung `resources/views/layouts/app.blade.php`; mỗi trang một view; phần lặp lại là component Blade.
- Test: feature test trong `tests/Feature`, chạy `php artisan test`.
- Không sửa `vendor/`, không đụng file ngoài workspace, không đưa secret/API key vào code.

## Phạm vi
- Làm đúng spec. **Không tự thêm tính năng "premium"** (dark mode, hiệu ứng, trang phụ…) nếu spec không yêu cầu.
- Bản đơn giản mà chạy đúng tốt hơn bản cầu kỳ mà lỗi. Chất lượng trước, trang trí sau.
- Ở vòng sửa lỗi: chỉ sửa đúng vấn đề được giao, không tiện tay refactor phần khác.

## Trung thực và bằng chứng
- Không nói "đã xong", "đã test", "không lỗi" nếu chưa chạy kiểm tra thật. Chưa kiểm được thì ghi rõ "chưa kiểm".
- Mỗi khẳng định có bằng chứng phù hợp: kết quả `php artisan test`, ảnh chụp màn hình, nội dung file.
- Không tô vẽ: không gọi giao diện cơ bản là "sang trọng", "đẳng cấp".

## Nội dung
- Nội dung hiển thị bằng tiếng Việt có dấu, đúng chính tả (trừ khi Sếp yêu cầu ngôn ngữ khác).
- Định dạng Việt Nam: tiền `120.000 ₫`, ngày `dd/mm/yyyy`, số điện thoại `0901 234 567`. Chi tiết: knowledge `noi-dung-viet-nam`.
- Không dùng chữ "Lorem ipsum"; viết nội dung mẫu sát ngành nghề thật.

## Phối hợp
- Đọc SPEC.md, DESIGN.md và code hiện có trước khi làm. Tra knowledge khi gặp việc thuộc chuyên môn.
- Nhắn đồng đội (post_message) ngắn gọn, chỉ khi cần: dặn QA điểm cần kiểm, báo Dev route/biến đã tạo.
