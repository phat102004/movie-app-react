# Phase 6.2A — Backend User Registration

> Cập nhật Phase 6.2B: mọi POST Register cần thêm header `X-Cineverse-CSRF: 1`. Login/Me/Logout và Session đã được triển khai; tài liệu này giữ phần Register của Phase 6.2A. Xem [hợp đồng auth mới](phase-6.2b-login-session.md).

Chỉ triển khai đăng ký tài khoản backend. Dùng HTTP server native Node.js, Prisma 7 và PostgreSQL hiện có. Không thay frontend, schema hoặc migration đã áp dụng; không tạo tài khoản thử trong database thật.

## Kiểm tra nền tảng thực tế

- Node.js 22.18.0, npm 10.9.3, Prisma/client/adapter-pg 7.10.1.
- `npm.cmd run db:check` kết nối thành công tới cineverse_dev trên PostgreSQL 17.11 và truy vấn User bằng Prisma thành công.
- Kiểm tra chỉ đọc xác nhận User có id UUID, email/name/passwordHash TEXT, createdAt/updatedAt TIMESTAMPTZ. Migration 20261026000000_init_user_model đã hoàn thành.
- `inspect.mjs` hiện có `c.relkind::text`; giữ nguyên sửa đổi này của bạn. Backend không có Express hoặc package.json riêng: dependencies backend quản lý tại root.
- Thêm duy nhất dependency `argon2@0.45.1`, có native binary chạy được trên Node/Windows hiện tại. Không thêm thư viện validation vì bộ quy tắc nhỏ, không có thư viện validation dùng chung trước đó.

## File tạo/sửa và thứ tự đọc

| File                                   | Vai trò                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| backend/server.mjs                     | Ghép đúng path Register với handler TMDB trên cùng HTTP server                            |
| backend/http.mjs                       | HttpError, response JSON an toàn, đọc JSON có giới hạn byte/thời gian/UTF-8               |
| backend/auth/register-route.mjs        | Method, rate limit, body, giới hạn đồng thời, gọi service, HTTP response                  |
| backend/auth/validation.mjs            | Kiểm tra dữ liệu, trim name và lowercase email, chỉ lấy ba trường đầu vào                 |
| backend/auth/password.mjs              | Cấu hình Argon2id, hash bằng thư viện có salt ngẫu nhiên                                  |
| backend/auth/register-service.mjs      | Validate → hash → Prisma create → DTO, ánh xạ unique/lỗi database                         |
| backend/auth/rate-limit.mjs            | Bộ giới hạn IP trong memory có giới hạn số entry, không có timer nền                      |
| backend/tests/register.test.mjs        | 15 test HTTP/service/security; database mock, có hash/verify Argon2id thật                |
| backend/proxy.mjs                      | Tách createProxyHandler để ghép server; giữ createProxyServer cho test cũ, giữ logic TMDB |
| backend/index.mjs                      | Khởi động app server mới, giữ cổng/IPC dev; đóng Prisma pool khi shutdown                 |
| backend/.env.example                   | Thêm ba tham số Argon2 không phải secret                                                  |
| package.json, package-lock.json        | Pin dependency Argon2 và khóa phiên bản                                                   |
| README.md, docs/phase-6.2a-register.md | API, vận hành, kiểm thử và tài liệu học                                                   |

Không sửa file cấu hình database, không chạy migration trong phase này và không đụng hai script thử nghiệm test-prisma.mjs/test-pg-connection.mjs của bạn. Những thay đổi Phase 6.1 chưa commit vẫn được giữ nguyên.

## Luồng request

```text
HTTP POST /api/auth/register
  → server.mjs chọn register-route
  → method + rate limit
  → đọc JSON tối đa 16 KB
  → service validate/chuẩn hóa
  → Argon2id tạo passwordHash
  → getPrisma() → User.create → PostgreSQL public.User
  → DTO allowlist → HTTP 201
```

Service khác controller: controller hiểu HTTP/body/header, service thực hiện quy tắc đăng ký và ánh xạ lỗi nghiệp vụ. Prisma module quản lý client/pool, không tự sinh HTTP response. Test truyền database mock vào service nên chạy độc lập với dữ liệu thật.

getPrisma chỉ chạy khi thực sự đăng ký hợp lệ; tạo HTTP server hoặc gọi TMDB chưa mở kết nối DB. DB down không ngăn khám phá phim. Hash cũng chỉ được tải/chạy khi cần, không chạy ở startup hoặc khi input không hợp lệ.

## Endpoint và dữ liệu

**POST /api/auth/register**, Content-Type: application/json, không nén body.

Request minh họa, chưa phải tài khoản đã được tạo:

```json
{
  "name": "  Nguyen Van A  ",
  "email": " Demo@Example.COM ",
  "password": "ExamplePassword123!"
}
```

Response 201 có cấu trúc:

```json
{
  "user": {
    "id": "UUID-do-Prisma-sinh",
    "name": "Nguyen Van A",
    "email": "demo@example.com",
    "createdAt": "2026-10-26T00:00:00.000Z"
  }
}
```

ID và ngày trong ví dụ chỉ minh họa; thực tế lấy từ PostgreSQL/Prisma. Không có passwordHash, password, updatedAt, role, token hoặc cookie đăng nhập. Trường bổ sung client gửi không được chuyển tới Prisma hoặc trả về response.

| HTTP | Code                     | Khi nào                                                           |
| ---- | ------------------------ | ----------------------------------------------------------------- |
| 201  | Không có error           | Tạo User thành công                                               |
| 400  | VALIDATION_ERROR         | Object/trường dữ liệu không hợp lệ, có error.fields nếu phù hợp   |
| 400  | INVALID_JSON             | JSON lỗi/rỗng hoặc byte UTF-8 không hợp lệ                        |
| 405  | METHOD_NOT_ALLOWED       | Method khác POST; có Allow: POST                                  |
| 408  | REQUEST_TIMEOUT          | Body chưa gửi xong sau 10 giây                                    |
| 409  | EMAIL_ALREADY_EXISTS     | Prisma unique constraint P2002 khi tạo User                       |
| 413  | PAYLOAD_TOO_LARGE        | Body vượt 16384 byte, kể cả chunked không có Content-Length       |
| 415  | UNSUPPORTED_MEDIA_TYPE   | Không phải application/json hoặc body nén                         |
| 429  | RATE_LIMITED             | Đã có 5 request POST từ IP trong cửa sổ 15 phút                   |
| 429  | REGISTRATION_BUSY        | Đã có 2 thao tác đăng ký đang xử lý                               |
| 503  | REGISTRATION_UNAVAILABLE | DB không khả dụng/chưa sẵn sàng hoặc cấu hình Argon2 không hợp lệ |
| 500  | INTERNAL_ERROR           | Lỗi không dự kiến; không trả chi tiết nội bộ                      |

Query string hoặc trailing slash không thuộc endpoint hiện tại; /api/auth/login vẫn 404. Errors dùng `{ "error": { "code": "...", "message": "..." } }`. Response có no-store và nosniff, không log body/hash/lỗi Prisma thô.

## Validation và password hashing

- Name bắt buộc string, trim, 1–100 Unicode code point. Bỏ ký tự điều khiển để tránh giá trị PostgreSQL không thể lưu (như NUL); dấu tiếng Việt/emoji vẫn được hỗ trợ.
- Email string, trim/lowercase trước lưu, tối đa 254 ký tự; local-part tối đa 64, domain có dấu chấm với label hợp lệ. Cho phép địa chỉ có dấu +. Đây là chính sách email ASCII thực dụng, không bao phủ mọi dạng quoted email/EAI của RFC và không kiểm tra mailbox có tồn tại. Không gửi email xác thực.
- Password bắt buộc string, 12–128 Unicode code point; giữ nguyên khoảng trắng và nội dung. Không bắt lớp ký tự hoa/thường/ký hiệu ngoài yêu cầu. Giới hạn độ dài cùng body/rate/concurrency hạn chế tài nguyên hashing.
- Không dựa vào frontend và không spread payload vào User.create.

Argon2id là hàm hash mật khẩu có chi phí CPU/RAM, không phải mã hóa giải ngược. node-argon2 tự tạo salt ngẫu nhiên mỗi lần và lưu thuật toán/tham số/salt trong chuỗi hash. Cùng password có thể cho hai hash khác nhau; verify vẫn kiểm tra được. Test sử dụng verify để chứng minh việc lưu hash, không xây thêm Login API.

Defaults: **memoryCost 19456 KiB (19 MiB), timeCost 2, parallelism 1**, hashLength 32 byte. Đây là baseline theo [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Triển khai dùng [node-argon2 chính thức](https://github.com/ranisalt/node-argon2), không tự viết crypto.

Tùy chọn backend/.env, không chứa secret:

```dotenv
ARGON2_MEMORY_KIB=19456
ARGON2_TIME_COST=2
ARGON2_PARALLELISM=1
```

Không khai báo thì dùng defaults. Cấu hình bị chặn ngoài khoảng memory 19456–262144 KiB, time 2–10, parallelism 1–4; không tự giảm dưới baseline. Trước production cần benchmark CPU/RAM/latency theo tải thực rồi chọn tham số phù hợp. Giới hạn 2 thao tác đồng thời tránh queue hash không giới hạn, nhưng tăng memory vẫn tăng RAM của mỗi hash.

## Email trùng, race condition và giới hạn bảo mật

Không dùng findUnique như bảo đảm duy nhất: hai request có thể cùng kiểm tra chưa tồn tại rồi cùng tạo. Tất cả input hợp lệ được hash trước create; PostgreSQL unique index quyết định request nào thành công. Service bắt P2002 và trả 409 cho request trùng, kể cả request chạy đồng thời. Không có đường đi bỏ qua hashing khi email đã tồn tại.

HTTP 409 theo yêu cầu vẫn tiết lộ email đã tồn tại (**email enumeration**). Rate limit giảm số lần dò, không loại bỏ nguy cơ này. Các lỗi không trả metadata/database message và không echo email/password. Nếu sản phẩm cần chống enumeration mạnh hơn, phải thiết kế lại hợp đồng response ở giai đoạn phù hợp.

Rate limiter dùng IP từ socket, bỏ qua X-Forwarded-For tự gửi; tính cả POST sai dữ liệu để không né qua input lỗi. Map tối đa 10000 IP, dọn entry hết hạn khi cần; 429 có Retry-After. Các endpoint phim không chia sẻ limiter. Đăng ký từ cùng máy local cùng chịu một IP, dễ chạm giới hạn khi tự thử nhiều lỗi.

Các giới hạn cần biết:

- Limiter trong memory mất khi restart, không chia sẻ giữa nhiều process/máy và fixed window có thể burst ở ranh giới. Production cần thống nhất proxy đáng tin và shared limiter phù hợp; hiện không thêm Redis/hạ tầng mới.
- Email được chuẩn hóa ở API; unique TEXT trong DB vẫn phân biệt hoa/thường. Writer khác ngoài API phải tuân cùng quy tắc. Không tự đổi dữ liệu hoặc constraint của User hiện tại.
- HTTPS cần có khi triển khai ra mạng; cấu hình hiện tại phục vụ local. Không gửi password qua HTTP không mã hóa trên mạng công khai.
- Chưa có xác thực email, chống bot nâng cao, kiểm tra password đã lộ, session hoặc quyền người dùng. Account tạo thành công chưa đăng nhập.
- Client đóng kết nối sau khi gửi yêu cầu không bảo đảm hủy được thao tác tạo User đang xử lý. Khi thử lại có thể nhận 409 nếu lần đầu đã hoàn thành.

## Kiểm tra thực tế bằng PowerShell

Terminal 1, thư mục gốc:

```powershell
cd D:\LearnReact\Cineverse
npm.cmd install
npm.cmd run db:generate
npm.cmd run db:check
npm.cmd run dev
```

Lệnh dev chạy Node 127.0.0.1:3001 và frontend tại URL Vite thông báo. Có thể dùng `npm.cmd run dev:proxy` nếu chỉ thử backend. Nếu proxy cũ còn chạy, dừng terminal cũ rồi khởi động lại để nhận route mới. Các lệnh npm.cmd cũng chạy được trong CMD.

Terminal 2: chỉ thực hiện đoạn sau **khi bạn chủ động muốn tạo một tài khoản thật trong cineverse_dev**. Agent không chạy request hợp lệ này trong phiên triển khai. Nhập mật khẩu mới tại prompt, không dùng lại password minh họa hoặc password database. Prompt không hiện mật khẩu và tránh ghi plaintext vào lịch sử lệnh:

```powershell
$securePassword = Read-Host 'Mat khau tai khoan Cineverse (12-128 ky tu)' -AsSecureString
try {
  $body = @{
    name = 'Nguyen Van A'
    email = 'cineverse-local@example.com'
    password = [System.Net.NetworkCredential]::new('', $securePassword).Password
  } | ConvertTo-Json

  Invoke-RestMethod `
    -Method Post `
    -Uri 'http://127.0.0.1:3001/api/auth/register' `
    -ContentType 'application/json; charset=utf-8' `
    -Headers @{ 'X-Cineverse-CSRF' = '1' } `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) `
    -TimeoutSec 15
} finally {
  $body = $null
  $securePassword.Dispose()
}
```

Mong đợi response user gồm đúng bốn trường an toàn. Gửi cùng email lần nữa trả 409; input sai trả 400; sau 5 lần/IP trong 15 phút có thể nhận 429. Với PowerShell 5.1, Invoke-RestMethod ném lỗi khi HTTP không phải 2xx; đọc StatusCode/response hoặc dùng REST Client để xem status/body. Không chia sẻ request chứa password và không tạo file request có mật khẩu thật trong Git.

Trong pgAdmin chọn đúng cineverse_dev và Query Tool, tự chạy truy vấn chỉ đọc:

```sql
SELECT id, name, email, "createdAt"
FROM public."User"
WHERE email = 'cineverse-local@example.com'
ORDER BY "createdAt" DESC;
```

Không SELECT * hoặc lấy passwordHash để chia sẻ. Việc hash/không lưu plaintext đã được kiểm tra bằng automated tests với database mock; không cần in hash thật ra console. Không có hướng dẫn DELETE/TRUNCATE để dọn user thử.

Kiểm tra hồi quy TMDB bằng CMD hoặc PowerShell:

```powershell
curl.exe --max-time 15 http://127.0.0.1:3001/api/movies/popular
curl.exe --max-time 15 http://127.0.0.1:3001/api/movies/27205
```

## Kết quả xác minh

- **79 automated tests đạt:** 42 backend (15 Register mới, 27 cũ) và 37 frontend.
- Register test gửi HTTP vào server thật ở cổng tạm, database mock; kiểm tra 201, chuẩn hóa, input thiếu/sai, password ngắn/dài, 409 và race, DB/hash lỗi, DTO không chứa hash, Argon2 hash/verify/salt, JSON/UTF-8/body chunked, media type, rate/concurrency/body timeout/method/route và TMDB vẫn hoạt động sau lỗi DB.
- Lint không warning, TypeScript check và production build đạt. TypeScript check hiện thuộc frontend; backend dùng MJS và được kiểm tra bằng Node tests/lint.
- Smoke server mới với TMDB thật: popular trả 200/20 phim, Inception 27205 trả 200 kèm credits. Request Register `{}` trả 400; so sánh số User trước/sau không thay đổi. Server tạm và Prisma pool đã đóng trong finally, không có server test để chạy mãi.
- Không gửi Register hợp lệ tới PostgreSQL thật, không tạo user thử, không xóa dữ liệu, không migration/reset và không commit/push. **201 ghi User trên DB thật chưa kiểm thử end-to-end**; bạn có thể thực hiện bằng hướng dẫn trên khi muốn tạo tài khoản.
- Secret scan không thấy token TMDB hoặc DATABASE_URL đã cấu hình trong các file có thể review/commit; env và generated client tiếp tục được Git ignore. Frontend không import Argon2/Prisma hoặc nhận database credentials.
- Chưa chạy lại browser UI trong phase này vì không thay frontend; hồi quy được kiểm tra bằng tests hiện có và HTTP TMDB thật, không tuyên bố đã kiểm tra lại tương tác giao diện.

Các lệnh từ root để kiểm tra lại, không watch:

```powershell
node --test backend/tests/register.test.mjs
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
```

Dừng ở Phase 6.2A. Chưa triển khai Login/Logout, session/JWT/OAuth, React Register page, Favorites, đổi/quên mật khẩu, email xác thực hoặc admin dashboard.
