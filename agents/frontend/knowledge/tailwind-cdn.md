# Tailwind v4 qua CDN trong Laravel: layout mẫu, khai báo màu/font theo DESIGN.md

## Layout mẫu `resources/views/layouts/app.blade.php`
```blade
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>@yield('title', 'Tên site') — Tên site</title>
  <meta name="description" content="@yield('description', 'Mô tả ngắn 150 ký tự')">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600&family=Playfair+Display:wght@700&display=swap&subset=vietnamese" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <style type="text/tailwindcss">
    @theme {
      --color-primary: #B45309;
      --color-primary-dark: #92400E;
      --color-ink: #1C1917;
      --color-muted: #57534E;
      --color-surface: #FFFBF5;
      --font-sans: "Be Vietnam Pro", ui-sans-serif, system-ui, sans-serif;
      --font-display: "Playfair Display", ui-serif, serif;
    }
  </style>
</head>
<body class="bg-surface font-sans text-ink antialiased">
  <a href="#noi-dung" class="sr-only focus:not-sr-only focus:absolute focus:p-3 focus:bg-white">Bỏ qua tới nội dung</a>
  <x-site-header />
  <main id="noi-dung">@yield('content')</main>
  <x-site-footer />
</body>
</html>
```
Sau đó dùng class theo token: `bg-primary hover:bg-primary-dark text-ink font-display`.

## Quy ước
- Không `@vite`, không `npm run build`. Tailwind CDN tự quét class trong HTML khi chạy.
- Container: `mx-auto max-w-6xl px-4`. Section: `py-12 md:py-16`.
- Lưới thẻ: `grid gap-6 sm:grid-cols-2 lg:grid-cols-3`.
- Nút chính: `inline-flex items-center justify-center rounded-lg bg-primary px-5 py-3 font-semibold text-white
  hover:bg-primary-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`.
- Ô nhập: `w-full rounded-lg border border-stone-300 px-3 py-2.5 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30`.
- Ảnh: `<img src="..." alt="..." width="800" height="600" loading="lazy" class="aspect-[4/3] w-full rounded-xl object-cover">`.

## Menu mobile không cần JS framework
```blade
<details class="md:hidden">
  <summary class="cursor-pointer list-none p-2" aria-label="Mở menu">☰</summary>
  <nav class="flex flex-col gap-2 py-2">...</nav>
</details>
```
Hoặc nút `<button aria-expanded>` + vài dòng JS vanilla. `<details>` dùng được bằng bàn phím sẵn.
