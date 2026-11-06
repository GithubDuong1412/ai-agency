# Finish gate giao diện: tiêu chí PASS/HOLD cho giao diện trước khi báo cáo Sếp

<!-- Chuyển thể từ agency-agents: design/design-ui-finish-gate-reviewer.md (Evidence Before Opinion,
     Protect Product Specificity, Finish Gate) (MIT). -->

## Hỏi cho từng trang chính (nhìn ảnh desktop + mobile)
1. **Đọc lần đầu thấy gì?** Trong 3 giây, người xem có biết đây là site gì và nên làm gì tiếp (nút chính) không?
2. **Có riêng cho ngành không?** Nếu thay logo/tên, trang có dùng được cho bất kỳ ngành nào khác không? Nếu có → chung chung.
3. **Trang trí có lý do không?** Gradient, hiệu ứng kính, thẻ bo tròn to, animation… mà không phục vụ nội dung → nên bỏ.
4. **Khớp DESIGN.md?** Màu, font, khoảng cách, thứ tự section.
5. **Đủ trạng thái?** Lỗi form, thành công, rỗng, focus bàn phím, màn hình hẹp.

## Ghi nhận xét đúng cách
- Không viết "đẹp", "hiện đại", "chuyên nghiệp" suông. Viết điều người dùng thấy/làm được:
  "Nút 'Đặt bàn' nằm dưới màn hình đầu trên mobile → người dùng phải cuộn mới thấy hành động chính."
- Không chê chỉ vì đơn giản. Chê khi lựa chọn chung chung hoặc che mất việc chính của người dùng.
- Mỗi yêu cầu sửa kèm cách kiểm: "Sửa: đưa nút lên hero; kiểm bằng ảnh mobile màn đầu."

## Mức độ
- `high`: vỡ bố cục, không thấy hành động chính, lệch hoàn toàn DESIGN.md, thiếu trang trong spec.
- `medium`: chung chung/thiếu trạng thái, tương phản thấp ở chữ phụ.
- `low`: căn chỉnh, khoảng cách nhỏ.
