# Hồ sơ chuyên môn của đội agent

Mỗi nhân viên có một thư mục riêng. Hệ thống đọc các file này mỗi lần agent bắt đầu làm việc, nên bạn sửa
xong là lần chạy sau có hiệu lực ngay (không cần khởi động lại server). Sửa được ngay trên dashboard:
mục **Hồ sơ nhân sự** ở thanh bên (hoặc nút **Hồ sơ** khi bấm vào một nhân vật). Tab **Prompt đầy đủ**
cho xem đúng system prompt agent sẽ nhận.

```
agents/
  _team/
    rules.md            luật chung cho cả đội (luôn nạp vào prompt của mọi người)
    knowledge/*.md      kiến thức chung, ai cũng tra được
  <vai trò>/            pm, designer, frontend, backend, qa, reviewer
    rules.md            luật riêng (luôn nạp vào prompt)
    checklist.md        tự kiểm trước khi nộp (luôn nạp vào prompt)
    knowledge/*.md      kiến thức chuyên môn, agent tự đọc khi cần bằng tool read_knowledge
  skills.yaml           skill gán cho từng nhân viên
```

## Skill
Ngoài luật và kiến thức, mỗi nhân viên có thể được giao **skill** dạng `SKILL.md` (giống Claude Code), vd.
`ui-ux-pro-max` cho Lan và Huy. Quản lý ở **Hồ sơ nhân sự → Thư viện skill**, hoặc khối "Skill được giao" trong hồ sơ
từng người.
- Nguồn skill: `skills/<tên>/` trong dự án (đã cài vào agency) và `~/.claude/skills/<tên>/` (skill Claude Code trên máy).
  Trùng tên thì bản trong agency được dùng. Nên **Cài vào agency** để dự án giữ bản cố định.
- Gán skill lưu ở `agents/skills.yaml`.
- Agent thấy tên + mô tả skill trong prompt, đọc `SKILL.md` bằng tool `use_skill`, chạy script của skill
  (Python/Node) bằng `run_skill_script` với thư mục làm việc là workspace dự án. Tham số chứa đường dẫn tuyệt đối
  hoặc `..` bị chặn. Tool skill chỉ xuất hiện với người được giao skill.
- Luật của đội ưu tiên hơn skill (vd. skill gợi ý React/shadcn thì vẫn dùng Blade + Tailwind CDN).
- Skill trên GitHub: clone về máy, rồi dùng **Cài từ thư mục**. Chỉ cài skill bạn tin tưởng — agent chạy được script của nó.

## Viết luật thế nào cho hiệu quả
- **Ngắn, cụ thể, kiểm tra được.** "Mọi form có `@csrf`" tốt hơn "code phải an toàn".
- `rules.md` nên dưới ~30 dòng. Chi tiết, ví dụ, code mẫu → đưa vào `knowledge/`.
- Không để luật của hai người mâu thuẫn nhau hoặc mâu thuẫn với `_team/rules.md`.
- Dòng đầu tiên của mỗi file knowledge là tiêu đề `# ...`: agent nhìn tiêu đề để biết có nên đọc không.
- Tên file knowledge chỉ dùng chữ thường không dấu, số và gạch ngang (vd. `bao-mat-laravel.md`).
- Chú thích HTML `<!-- ... -->` không được đưa vào prompt (dùng để ghi nguồn, ghi chú cho người).

## Nguồn
Một phần nội dung được rút gọn, dịch và chỉnh cho stack Laravel từ dự án
[agency-agents](https://github.com/msitarzewski/agency-agents) (MIT License). Xem `NOTICE.md`.
Phần kiến thức Laravel, Blade + Tailwind CDN và chuẩn nội dung Việt Nam do đội tự viết.
