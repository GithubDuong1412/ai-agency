# Mẫu feature test Laravel cho trang và form (PHPUnit, RefreshDatabase)

```php
<?php

namespace Tests\Feature;

use App\Models\Reservation;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ReservationTest extends TestCase
{
    use RefreshDatabase;

    public function test_trang_dat_ban_hien_thi(): void
    {
        $this->get(route('dat-ban.create'))
            ->assertOk()
            ->assertSee('Đặt bàn');
    }

    public function test_dat_ban_hop_le_duoc_luu(): void
    {
        $data = ['name' => 'Nguyễn Văn A', 'phone' => '0901 234 567', 'date' => now()->addDay()->toDateString(), 'guests' => 4];

        $this->post(route('dat-ban.store'), $data)
            ->assertRedirect(route('dat-ban.create'))
            ->assertSessionHas('success');

        $this->assertDatabaseHas('reservations', ['name' => 'Nguyễn Văn A', 'phone' => '0901234567']);
    }

    public function test_thieu_truong_bat_buoc_bao_loi(): void
    {
        $this->post(route('dat-ban.store'), [])
            ->assertSessionHasErrors(['name', 'phone', 'date', 'guests']);
        $this->assertDatabaseCount('reservations', 0);
    }

    public function test_sdt_sai_dinh_dang_bao_loi(): void
    {
        $this->post(route('dat-ban.store'), ['name' => 'A', 'phone' => '123', 'date' => now()->toDateString(), 'guests' => 2])
            ->assertSessionHasErrors('phone');
    }

    public function test_khong_ghi_truong_ngoai_danh_sach(): void
    {
        $this->post(route('dat-ban.store'), ['name' => 'A', 'phone' => '0901234567',
            'date' => now()->toDateString(), 'guests' => 2, 'id' => 999]);
        $this->assertDatabaseMissing('reservations', ['id' => 999]);
    }
}
```

## Ghi nhớ
- Test POST trong Laravel tự bỏ qua CSRF khi chạy test — vẫn phải có `@csrf` trong view (kiểm bằng `assertSee('_token', false)` nếu cần).
- Tên test mô tả hành vi, đọc lên hiểu ngay. Mỗi form tối thiểu: hiển thị, hợp lệ lưu DB, thiếu trường, sai định dạng.
- Chạy một file: `php artisan test --filter=ReservationTest`.
