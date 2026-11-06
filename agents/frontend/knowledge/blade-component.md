# Component Blade, form có validate và hiển thị dữ liệu an toàn

## Component ẩn danh (`resources/views/components/`)
```blade
{{-- resources/views/components/button.blade.php --}}
@props(['href' => null, 'variant' => 'primary'])
@php
  $cls = $variant === 'primary'
    ? 'bg-primary text-white hover:bg-primary-dark'
    : 'border border-primary text-primary hover:bg-primary/5';
@endphp
@if ($href)
  <a href="{{ $href }}" {{ $attributes->class(["inline-flex rounded-lg px-5 py-3 font-semibold $cls"]) }}>{{ $slot }}</a>
@else
  <button {{ $attributes->merge(['type' => 'submit'])->class(["inline-flex rounded-lg px-5 py-3 font-semibold $cls"]) }}>{{ $slot }}</button>
@endif
```
Dùng: `<x-button :href="route('dat-ban.create')">Đặt bàn</x-button>`.

## Form chuẩn
```blade
@if (session('success'))
  <div role="status" class="mb-6 rounded-lg bg-green-50 p-4 text-green-800">{{ session('success') }}</div>
@endif
<form method="POST" action="{{ route('dat-ban.store') }}" novalidate class="space-y-5">
  @csrf
  <div>
    <label for="name" class="mb-1 block font-semibold">Họ tên <span class="text-red-700" aria-hidden="true">*</span></label>
    <input id="name" name="name" value="{{ old('name') }}" required autocomplete="name"
      @error('name') aria-invalid="true" aria-describedby="name-error" @enderror class="...">
    @error('name') <p id="name-error" class="mt-1 text-sm text-red-700">{{ $message }}</p> @enderror
  </div>
  <div>
    <label for="phone" class="mb-1 block font-semibold">Số điện thoại</label>
    <input id="phone" name="phone" type="tel" inputmode="tel" value="{{ old('phone') }}" autocomplete="tel" class="...">
    @error('phone') <p class="mt-1 text-sm text-red-700">{{ $message }}</p> @enderror
  </div>
  <x-button>Gửi đặt bàn</x-button>
</form>
```
- `type` đúng (email, tel, date, number) để mobile mở đúng bàn phím. Có `autocomplete`.
- Ô bắt buộc đánh dấu `*` và nói rõ ở đầu form.

## Hiển thị dữ liệu
- `{{ $x }}` luôn an toàn. `{!! $x !!}` chỉ cho HTML tin cậy (do mình viết), không bao giờ cho dữ liệu người dùng nhập.
- Danh sách rỗng: `@forelse ($items as $item) ... @empty <p>Chưa có món nào.</p> @endforelse`.
- Trang hiện tại trên menu: `request()->routeIs('menu') ? 'font-semibold text-primary' : ''` và `aria-current="page"`.
