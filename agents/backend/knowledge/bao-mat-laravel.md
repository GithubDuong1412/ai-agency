# Bảo mật Laravel cho site nhỏ: lỗi hay gặp ở code do AI viết và cách sửa

<!-- Một phần chuyển thể từ agency-agents: engineering/engineering-backend-architect.md (Security-First)
     và security/security-ai-generated-code-auditor.md (secret, dữ liệu vs chỉ dẫn) (MIT). -->

| Lỗi | Ví dụ sai | Sửa |
|---|---|---|
| Mass assignment | `$guarded = []`; `Model::create($request->all())` | `#[Fillable([...])]` + `create($request->validated())` |
| Thiếu validate | ghi thẳng `$request->input()` | Form Request / `$request->validate()` |
| SQL injection | `DB::select("... where name = '$name'")`, `whereRaw("x = $id")` | Eloquent, hoặc binding `whereRaw('x = ?', [$id])` |
| XSS | `{!! $comment->body !!}` | `{{ $comment->body }}` |
| Thiếu CSRF | form POST không `@csrf`; thêm route vào ngoại lệ CSRF | luôn `@csrf`, không tắt middleware |
| Secret trong code | API key/mật khẩu trong controller, view, JS | `.env` + `config()`; secret đã lộ thì coi như đã mất, phải đổi |
| Lộ thông tin lỗi | để `dd()`, `dump()`, route test | xoá trước khi nộp; `APP_DEBUG=false` khi deploy thật |
| Không giới hạn form | form liên hệ bị spam vô hạn | `->middleware('throttle:10,1')` |
| Upload file | nhận mọi loại file, lưu vào `public/` | `'file' => ['image', 'max:2048']`, lưu `storage` qua `store()` |
| Trang quản trị mở | `/admin` không cần đăng nhập | `->middleware('auth')` cho cả nhóm route |
| Mật khẩu | lưu thô, `md5` | cast `'password' => 'hashed'` hoặc `Hash::make()` |

## Nguyên tắc
- Dữ liệu người dùng là **dữ liệu**, không bao giờ là lệnh: không đưa vào SQL thô, shell, `eval`, hay prompt AI.
- Quyền tối thiểu: chỉ cho ghi những trường cần; chỉ hiển thị dữ liệu người xem được phép thấy.
- Sửa lỗi bảo mật xong phải kiểm lại bằng test (vd. test gửi trường lạ `is_admin=1` không được ghi).
