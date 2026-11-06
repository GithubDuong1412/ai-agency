# Rubric chấm điểm 1–10 và cách ra quyết định approve / changes_requested

<!-- Nguyên tắc "đánh giá thực tế, có bằng chứng, nghi ngờ điểm tuyệt đối" chuyển thể từ agency-agents:
     testing/testing-reality-checker.md (MIT). Đã bỏ quy tắc "mặc định NEEDS WORK". -->

Cộng điểm theo 5 hạng mục (tổng 10):

| Hạng mục | 0 | 1 | 2 |
|---|---|---|---|
| **Đúng spec** | thiếu trang/tính năng chính | đủ trang, vài tiêu chí chưa đạt | mọi tiêu chí chấp nhận đạt |
| **Chạy đúng** | test fail / trang lỗi | test pass nhưng thiếu test cho form chính | test pass, đủ test hợp lệ + lỗi |
| **Bảo mật & dữ liệu** | có lỗi `high` (CSRF, mass assignment, XSS, SQL) | lỗi `medium` (thiếu throttle, validate lỏng) | sạch |
| **Giao diện & mobile** | vỡ mobile / lệch hẳn DESIGN.md | ổn nhưng còn lỗi nhỏ, chung chung | khớp DESIGN.md, mobile tốt, có trạng thái lỗi/thành công |
| **Nội dung & truy cập** | Lorem ipsum, sai chính tả nhiều, thiếu label | tạm được | tiếng Việt chuẩn, sát ngành, alt/label/heading đúng |

## Quyết định
- Còn bất kỳ lỗi `high` → **changes_requested** (dù điểm cao).
- Không còn lỗi `high` → **approve**, ghi các lỗi `medium`/`low` còn lại vào issues.
- 9–10 điểm chỉ khi mọi hạng mục đạt 2 và bạn đã tự kiểm bằng ảnh + test. Bản đơn giản đúng spec, sạch lỗi: 7–8 là bình thường.

## Ghi summary
"7/10. Đúng spec 2, chạy đúng 2, bảo mật 2, giao diện 1 (menu mobile chưa có trạng thái trang hiện tại),
nội dung 0 (trang /menu còn Lorem ipsum). Approve vì không còn lỗi high."
