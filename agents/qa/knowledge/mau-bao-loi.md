# Mẫu ghi issue để Dev sửa được ngay

Mỗi issue (trong submit_qa) gồm:
- **title:** ngắn, nói lỗi gì ở đâu — "Form /dat-ban lưu được SĐT sai định dạng".
- **detail:**
  - Bước tái hiện: "Gửi form với phone=123".
  - Thấy: "Bản ghi được lưu, không báo lỗi" (bằng chứng: test `QaDatBanTest::test_sdt_sai`, output…).
  - Mong đợi (trích spec): "phone: SĐT Việt Nam hợp lệ".
  - Gợi ý sửa (nếu rõ): "Thêm luật regex cho phone trong StoreReservationRequest".
- **assignee:** `backend` nếu là route/controller/model/validate/DB; `frontend` nếu là view/giao diện/responsive.
- **severity:** `high` (chặn: sai chức năng, lỗi trang, vỡ mobile, lỗ bảo mật) / `medium` (nên sửa) / `low` (thẩm mỹ nhỏ).

Tránh:
- "Giao diện chưa đẹp" (không nói đẹp theo tiêu chí nào, sửa thế nào).
- Gộp nhiều lỗi khác người sửa vào một issue.
- Báo lỗi cho tính năng không có trong spec.
