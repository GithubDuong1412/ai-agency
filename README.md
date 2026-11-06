# AI Web Agency

Một agency dựng web nhỏ, trong đó mỗi nhân viên là một AI agent (Claude). Bạn giao lệnh bằng một prompt.
**Trưởng dự án** lập kế hoạch và chia việc. **Designer** thiết kế. **Frontend/Backend Dev** viết code Laravel.
**QA** chạy test và chụp màn hình. **Kiểm duyệt viên** duyệt kết quả. Cuối cùng Trưởng dự án gửi báo cáo để bạn
**Duyệt** hoặc **Yêu cầu sửa**.

```
Sếp ─lệnh─▶ Trưởng dự án ─spec─▶ Designer ─DESIGN.md─▶ Dev ⇄ QA (mỗi task, tối đa 3 vòng)
                                                         │
                                  Kiểm duyệt ◀───────────┘  (trả về sửa tối đa 2 vòng)
                                       │
                         Trưởng dự án ─báo cáo─▶ Sếp: Duyệt / Yêu cầu sửa
```

## 1. Cài đặt (một lần)

Yêu cầu: Python 3.11+, Node 20+, Laragon (PHP 8.3+ và Composer).

```bash
cd C:/laragon/www/ai-agency
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m playwright install chromium
```

```bash
cd frontend && npm install && npm run build
```

Laravel skeleton đã được tải sẵn vào `backend/templates/laravel-skeleton`. Nếu bị xoá, tải lại bằng:

```bash
cd backend/templates && composer create-project laravel/laravel laravel-skeleton
```

Đường dẫn PHP/Composer của Laragon nằm trong `config.yaml` (`php_bin`, `composer_phar`). Nếu bạn đổi phiên bản PHP thì sửa ở đó.

## 2. Tạo API key

1. Vào https://console.anthropic.com, đăng ký và nạp credit (Billing).
2. Mở **Settings → API Keys → Create Key** để tạo key.
3. Copy `.env.example` thành `.env` và dán key vào dòng `ANTHROPIC_API_KEY=`.

## 3. Chạy

```bash
.venv/Scripts/python -m uvicorn backend.main:app --port 8000
```

Lệnh tắt trên Windows: chạy `.\run` để mở server thật, hoặc `.\run demo` để mở bản demo (cổng 8001).

Mở http://127.0.0.1:8000, gõ lệnh vào ô **Chỉ huy AI** rồi bấm Ctrl+Enter.

**Chưa có API key?** Chạy chế độ demo. Agent là giả lập, không tốn tiền, dữ liệu lưu riêng trong `data/demo.db`:

```bash
AGENCY_DEMO=1 .venv/Scripts/python -m uvicorn backend.main:app --port 8001
```

(PowerShell: `$env:AGENCY_DEMO='1'; .venv/Scripts/python -m uvicorn backend.main:app --port 8001`)

Khi sửa giao diện, chạy thêm `npm run dev` trong `frontend/` rồi mở http://localhost:5173. Vite tự chuyển tiếp `/api` sang port 8000.

## 4. Giao diện

- **Toàn cảnh / Sơ đồ:** văn phòng phủ kín vùng chính, các thẻ số liệu, panel duyệt và ô Chỉ huy AI nổi phía trên.
  - **3D** (mặc định): văn phòng isometric. Kéo chuột để xoay, chuột phải để di chuyển, cuộn để zoom, nút **Căn giữa** để về góc nhìn ban đầu.
  - **2D**: bản phẳng nhẹ hơn, dùng cho máy yếu.
  - Nhân vật đang làm thì màn hình sáng, người nhấp nhô và có nhãn task. Bong bóng hiện lời agent vừa nói.
    Khi bàn giao, có vòng cung vàng nối hai bàn và một tấm thẻ chạy từ người giao sang người nhận.
  - Bấm vào nhân vật để xem lịch sử làm việc của người đó.
- **Hội thoại / Bàn giao / Review & duyệt:** timeline realtime (SSE).
- **Trang dự án:**
  - Hội thoại kèm từng thao tác tool.
  - Công việc.
  - Báo cáo: có ảnh chụp, nút Duyệt và Yêu cầu sửa.
  - Phiên bản: mỗi vòng chạy được lưu thành một commit git trong `workspaces/<id>/.git`. Phần sửa tay giữa các vòng
    cũng được lưu, ngay trước khi vòng sau bắt đầu. Ở đây xem được vòng nào đổi file nào (diff) và **Quay về** một
    phiên bản cũ. Thao tác quay về cũng tạo một phiên bản mới, nên không làm mất lịch sử.
  - Xem trước: trang web thật chạy bằng `php artisan serve`.
  - File: đọc code agent đã viết.
  - Spec.
- Nút **Dừng** để dừng giữa chừng. Nút **Chạy lại** cho dự án bị lỗi hoặc gián đoạn.

Code mỗi dự án nằm ở `workspaces/<id>/`. Đó là một app Laravel đầy đủ, bạn có thể mở bằng Laragon hoặc VS Code.

## 5. Tuỳ chỉnh (`config.yaml`)

- `roles.*`: tên, chức danh, phòng ban, màu, `model`, `effort` của từng agent. Ví dụ, để tiết kiệm có thể đặt
  `model: claude-sonnet-5-5` cho QA.
- `limits`: số vòng Dev⇄QA, số vòng kiểm duyệt, số lượt tool tối đa, ngân sách token cho mỗi lần chạy.
- Prompt nền của từng vai trò (nhiệm vụ, quyền tool) nằm trong `backend/agents/roles.py`.
- **Hồ sơ chuyên môn** (luật, checklist, kiến thức) nằm trong thư mục `agents/`, sửa được trên dashboard ở mục
  **Hồ sơ nhân sự**. Luật và checklist luôn vào prompt; kiến thức agent tự tra bằng tool `read_knowledge` khi cần.
  **Skill** dạng SKILL.md (vd. `ui-ux-pro-max` cho Lan và Huy) gán ở **Hồ sơ nhân sự → Thư viện skill**; skill cài vào
  agency nằm ở `skills/`. Xem `agents/README.md`. Một phần nội dung chuyển thể từ [agency-agents](https://github.com/msitarzewski/agency-agents) (MIT).

## 6. An toàn

- Agent chỉ đọc và ghi file trong `workspaces/<id>/`. Đường dẫn tuyệt đối, `..` và `vendor/` đều bị chặn.
- `run_command` chỉ cho phép `php artisan …` (trừ `tinker`/`serve`), `php -l`, `php vendor/bin/phpunit`,
  `composer install|require|remove|dump-autoload|update`, `npm install`, `npm run build`. Không cho dùng ký tự shell.
  Mỗi lệnh có timeout. API key không được truyền vào tiến trình con.
- Đây là sandbox mức ứng dụng chứ không phải container. Code PHP do agent viết vẫn chạy trên máy bạn khi test.
  Chỉ giao những việc bạn tin tưởng và xem lại code trước khi đưa lên server thật.

## 7. Cấu trúc

```
backend/
  main.py            API FastAPI + SSE, phục vụ frontend/dist
  orchestrator.py    pipeline PM → Designer → Dev⇄QA → Reviewer → Báo cáo
  agents/            base.py (vòng lặp tool-use), roles.py (prompt), profiles.py (nạp hồ sơ), schemas.py (tool nộp kết quả)
  tools/             fs_tools (sandbox file), shell_tools (lệnh), browser_tools (Playwright), registry
  preview.py         quản lý php artisan serve
  demo.py            agent giả lập cho chế độ demo
frontend/            React + Vite + Tailwind
agents/              hồ sơ chuyên môn của từng agent (Markdown) + skills.yaml
skills/              skill (SKILL.md) đã cài vào agency
tests/               pytest (không gọi API thật)
```

Chạy test:

```bash
.venv/Scripts/python -m pytest -q
```

## Lộ trình

- ~~Giai đoạn 2: văn phòng 3D isometric~~ (đã xong). Tiếp theo có thể thay khối hình bằng mô hình nhân vật CC0 và cho nhân vật đi lại.
- Thêm phòng ban: SEO, Content, DevOps (deploy).
