<!-- Chuyển thể một phần từ agency-agents: engineering/engineering-backend-architect.md (Security-First,
     Performance-Conscious, Migration Safety — đã lược bỏ phần microservices/OpenAPI) và
     engineering/engineering-minimal-change-engineer.md (MIT). Phần Laravel do đội tự viết. -->
# Luật của Backend Dev

## Laravel chuẩn
- Route đặt tên (`->name('lien-he.store')`), nhóm theo controller. Logic trong controller/model, không trong route closure
  (trừ `Route::view` cho trang tĩnh).
- Validate mọi dữ liệu từ ngoài vào: Form Request (`php artisan make:request`) hoặc `$request->validate()`; thông báo lỗi
  tiếng Việt. Chỉ ghi các trường đã validate (`$request->validated()`).
- Model khai báo trường được ghi: `#[Fillable([...])]` (Laravel 13) hoặc `$fillable`. **Không bao giờ** `$guarded = []`.
- Ép kiểu bằng `casts()`; tiền lưu số nguyên (đồng), thời gian kiểu `datetime`.
- Chi tiết + ví dụ: knowledge `laravel-quy-uoc`.

## Bảo mật
- Form POST có `@csrf`; không tắt CSRF. Không nối chuỗi vào SQL (dùng Eloquent/Query Builder, binding).
- Mật khẩu dùng cast `hashed`; không log dữ liệu nhạy cảm; không đưa secret vào code hay view.
- Trang quản trị (nếu spec có) phải yêu cầu đăng nhập (`auth` middleware). Giới hạn spam form bằng `throttle` khi hợp lý.
- Chi tiết: knowledge `bao-mat-laravel`.

## Dữ liệu và hiệu năng
- Mỗi thay đổi bảng là một migration mới; không sửa migration đã chạy. Sau khi tạo: `php artisan migrate --force`.
- Cột hay lọc/tìm có index; khoá ngoại dùng `foreignId()->constrained()`.
- Tránh N+1: dùng `with()` khi hiển thị quan hệ trong vòng lặp; phân trang danh sách dài (`paginate()`).
- Seeder cho dữ liệu mẫu sát ngành (`php artisan db:seed --force`), phải chạy lại nhiều lần được: dùng `updateOrCreate`/`firstOrCreate` theo khoá cố định (slug, mã), không `truncate()`/`delete()` bảng, không đụng bản ghi khách tạo.
- Sửa cấu trúc bảng bằng migration mới (thêm cột nullable/có default), không xoá rồi tạo lại DB.

## Kiểm thử
- Mỗi route/form quan trọng có feature test: trang trả 200, gửi hợp lệ thì lưu DB, gửi sai thì có lỗi validate.
- Dùng `RefreshDatabase`. Chạy `php artisan test` tới khi pass rồi mới nộp. Mẫu: knowledge `feature-test`.

## Vòng sửa lỗi
- Chỉ sửa đúng lỗi được giao; không tiện tay đổi tên, refactor hay thêm "phòng thủ" cho trường hợp không thể xảy ra.
