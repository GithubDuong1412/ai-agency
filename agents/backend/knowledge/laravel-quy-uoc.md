# Quy ước Laravel 13 của đội: route, controller, Form Request, model, migration, seeder

## Route (`routes/web.php`)
```php
use App\Http\Controllers\ReservationController;

Route::view('/', 'pages.home')->name('home');
Route::get('/menu', [MenuController::class, 'index'])->name('menu');
Route::get('/dat-ban', [ReservationController::class, 'create'])->name('dat-ban.create');
Route::post('/dat-ban', [ReservationController::class, 'store'])->name('dat-ban.store')->middleware('throttle:10,1');
```
- URL tiếng Việt không dấu, gạch ngang (`/lien-he`, `/dat-ban`). Tên route dạng `tai-nguyen.hanh-dong`.

## Form Request
```php
// php artisan make:request StoreReservationRequest
public function authorize(): bool { return true; }

public function rules(): array
{
    return [
        'name'   => ['required', 'string', 'max:100'],
        'phone'  => ['required', 'regex:/^(0|\+84)(3|5|7|8|9)\d{8}$/'],
        'date'   => ['required', 'date', 'after_or_equal:today'],
        'guests' => ['required', 'integer', 'between:1,20'],
        'note'   => ['nullable', 'string', 'max:500'],
    ];
}

public function messages(): array
{
    return [
        'name.required' => 'Vui lòng nhập họ tên.',
        'phone.regex'   => 'Số điện thoại chưa đúng, ví dụ: 0901234567.',
        'date.after_or_equal' => 'Ngày đặt phải từ hôm nay trở đi.',
    ];
}

protected function prepareForValidation(): void
{
    $this->merge(['phone' => preg_replace('/\s+/', '', (string) $this->phone)]);
}
```

## Controller
```php
public function store(StoreReservationRequest $request)
{
    Reservation::create($request->validated());
    return redirect()->route('dat-ban.create')->with('success', 'Đặt bàn thành công! Chúng tôi sẽ gọi xác nhận.');
}
```
- Controller mỏng: validate (Form Request) → gọi model → trả view/redirect. Không echo HTML trong controller.

## Model
```php
use Illuminate\Database\Eloquent\Attributes\Fillable;

#[Fillable(['name', 'phone', 'date', 'guests', 'note'])]
class Reservation extends Model
{
    use HasFactory;

    protected function casts(): array
    {
        return ['date' => 'date', 'guests' => 'integer'];
    }
}
```
- Laravel 13 khuyến khích attribute `#[Fillable]` (như `app/Models/User.php` của skeleton); `protected $fillable = [...]` vẫn dùng được.

## Migration
```php
Schema::create('reservations', function (Blueprint $table) {
    $table->id();
    $table->string('name', 100);
    $table->string('phone', 20)->index();
    $table->date('date')->index();
    $table->unsignedTinyInteger('guests');
    $table->text('note')->nullable();
    $table->timestamps();
});
```
- Tạo: `php artisan make:model Reservation -mf` (model + migration + factory), rồi `php artisan migrate --force`.
- Đổi cấu trúc bảng đã có → migration mới (`make:migration add_x_to_y_table`), không sửa migration cũ.

## Seeder dữ liệu mẫu
- `php artisan make:seeder MenuSeeder`, gọi trong `DatabaseSeeder`, chạy `php artisan db:seed --force`.
- Dữ liệu mẫu sát ngành, giá theo VND (số nguyên).
