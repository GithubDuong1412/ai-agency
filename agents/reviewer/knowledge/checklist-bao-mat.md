# Checklist rà bảo mật và chất lượng code khi kiểm duyệt (đọc code Laravel)

<!-- Chuyển thể từ agency-agents: engineering/engineering-code-reviewer.md (Review Checklist) và
     security/security-ai-generated-code-auditor.md (Evidence Over Assertion, Secrets) (MIT). -->

## Cách rà nhanh (dùng search_files)
| Tìm | Nghi vấn |
|---|---|
| `$guarded = []`, `->all()` trong create/update/fill | mass assignment → `high` |
| `{!!` | XSS nếu in dữ liệu người dùng → `high` |
| `DB::select(`, `whereRaw(`, `DB::statement(` có biến nối chuỗi | SQL injection → `high` |
| `<form` | đối chiếu có `@csrf` → thiếu là `high` |
| `api_key`, `secret`, `password =`, `sk-`, `token` | secret trong code → `high`, yêu cầu chuyển sang `.env` và đổi key |
| `dd(`, `dump(`, `var_dump(`, `Route::get('/test` | rác debug → `medium` |
| `->get()` trong vòng lặp view, quan hệ không `with()` | N+1 → `medium` |
| route `/admin` | có `auth` middleware chưa → thiếu là `high` |

## Mỗi issue phải có
- Vị trí (file + dòng), vì sao nguy hiểm (người dùng/kẻ xấu làm được gì), cách sửa cụ thể, người sửa.
- Ví dụ: "`app/Http/Controllers/ContactController.php:18` dùng `Contact::create($request->all())` — người gửi có thể ghi
  thêm cột bất kỳ. Sửa: dùng Form Request và `create($request->validated())`, model khai báo Fillable. → backend, high."

## Nguyên tắc
- Không báo lỗi khi không chắc: nghi vấn mơ hồ thì ghi là gợi ý (`low`), không chặn.
- Lỗi đã báo ở vòng trước: kiểm lại thật (đọc file, chạy test) trước khi coi là đã sửa.
- Ghi cả điểm tốt vào strengths (vd. "Form Request có thông báo tiếng Việt đầy đủ").
