# Phase 6.2B — Backend Login, Logout & Server-side Session

Backend native Node.js tiếp tục dùng Prisma 7.10.1, PostgreSQL 17.11 và Argon2 0.45.1. Không thêm dependency, không thay frontend, không dùng JWT và không tạo tài khoản thử trong database thật.

## File và thứ tự đọc

| File tạo/sửa                                                             | Vai trò                                                                       |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| backend/prisma/schema.prisma                                             | Thêm Session và quan hệ User.sessions, giữ sáu cột User                       |
| backend/prisma/baselines/user.prisma                                     | Snapshot schema ban đầu để kiểm tra drift                                     |
| backend/prisma/migrations/20261026010000_add_session_model/migration.sql | Tạo Session, indexes và FK trong transaction; không sửa migration cũ          |
| backend/database/inspect.mjs                                             | Thêm migrationState kiểm tra prefix history, checksum và bảng được hỗ trợ     |
| backend/scripts/migrate.mjs                                              | Guard hai migration, kiểm tra schema diff trước/sau apply, đếm User trước/sau |
| backend/scripts/check-database.mjs                                       | Kiểm tra model Session thêm vào kiểm tra User, không đọc tokenHash            |
| backend/scripts/cleanup-sessions.mjs                                     | CLI một batch session hết hạn, không chạy nền vô hạn                          |
| backend/auth/config.mjs                                                  | Origin allowlist, cookie dev/prod, TTL 7 ngày và cap 5 session                |
| backend/auth/security.mjs                                                | Origin/Fetch Metadata/custom-header guard cho auth                            |
| backend/auth/cookies.mjs                                                 | Parse token nghiêm ngặt, tạo/clear cookie đúng flags                          |
| backend/auth/password.mjs                                                | Thêm argon2.verify và cache dummy hash ngẫu nhiên mỗi process                 |
| backend/auth/validation.mjs                                              | Dùng chung normalize/validate email; thêm validation Login                    |
| backend/auth/user-dto.mjs                                                | Allowlist select và response user                                             |
| backend/auth/errors.mjs                                                  | Lỗi auth/database an toàn, không trả chi tiết nội bộ                          |
| backend/auth/login-service.mjs                                           | Validate, tìm User, verify, tạo phiên và trả DTO                              |
| backend/auth/session-service.mjs                                         | Token/hash, create/read/revoke/cleanup qua Prisma                             |
| backend/auth/login-rate-limit.mjs                                        | Giới hạn IP và định danh HMAC, không giữ email thô làm key                    |
| backend/auth/session-routes.mjs                                          | Controller Login/Me/Logout và giới hạn đồng thời                              |
| backend/server.mjs                                                       | Ghép auth endpoints và guard, giữ proxy TMDB                                  |
| backend/tests/session.test.mjs                                           | 20 test auth/session/security dùng mock database                              |
| backend/tests/migration-plan.test.mjs                                    | 3 test guard history/inventory và SQL additive                                |
| backend/tests/helpers/auth-fixture.mjs                                   | Store mock, transaction mock có rollback, HTTP fixtures                       |
| backend/tests/session.browser.mjs                                        | Kiểm tra cookie/CSRF bằng Edge thực, DB mock                                  |
| backend/tests/register.test.mjs                                          | Bổ sung header CSRF, giữ 15 test Register                                     |
| package.json, backend/.env.example                                       | Script cleanup và origin config mẫu                                           |
| README.md, docs/phase-6.2a-register.md, docs/phase-6.2b-login-session.md | Hợp đồng API mới, cách chạy và kiểm thử                                       |

Các thay đổi Phase 6.1/6.2A chưa commit của bạn được giữ nguyên. Không commit/push, không in .env hoặc credentials. Generated Prisma Client được sinh lại cục bộ và tiếp tục Git ignore.

## Migration và database

Đã xác minh database cineverse_dev/public, PostgreSQL 17.11 và bảng User trước khi sửa schema. Migration mới **20261026010000_add_session_model** chỉ tạo bảng Session/index/FK, bọc BEGIN/COMMIT, giữ nguyên SQL migration Phase 6.1. Quan hệ sessions trong User chỉ là trường Prisma, không thêm/sửa cột User trong PostgreSQL.

Session gồm id UUID, userId UUID FK, tokenHash CHAR(64) unique, createdAt và expiresAt TIMESTAMPTZ(3). Index trên userId/createdAt hỗ trợ quản lý phiên từng User; expiresAt hỗ trợ cleanup. FK onDelete Cascade bảo đảm không còn phiên mồ côi nếu User được xóa bởi một quy trình hợp lệ sau này; chưa có API xóa User.

Quy trình db:migrate:

1. Chỉ chấp nhận hai directory migration đã review và database local cineverse_dev.
2. Lịch sử phải là prefix đúng thứ tự/tên/checksum, hoàn thành và không rolled back.
3. Inventory chỉ được có bảng khớp trạng thái empty, User hoặc User+Session; chặn bảng/view/sequence lạ.
4. Với DB đã có schema, chạy migrate diff chỉ đọc từ datasource tới snapshot đúng phiên bản, exit-code phải là 0. Drift hoặc lỗi kết nối đều dừng trước apply.
5. Áp dụng SQL đã review bằng migrate deploy, sau đó xác minh history/schema và số User trước/sau. Không dùng shadow DB, reset, force-reset hoặc baseline tự động.

Đã áp dụng migration thành công và **số User không đổi**. Lần chạy lại db:migrate xác nhận schema khớp và không thay đổi DB. db:check xác nhận Prisma truy vấn được cả User và Session. Script chỉ hỗ trợ hai migration hiện tại; migration tiếp theo cần review và mở rộng guard, không bỏ kiểm tra. Giữ nguyên file SQL/checksum đã apply; tránh chỉnh schema đồng thời trong pgAdmin khi chạy migration.

Từ root:

```powershell
npm.cmd run db:validate
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run db:check
npm.cmd run dev
```

## Luồng Login → Session → Me → Logout

```text
Login(email/password)
  → Origin/CSRF → IP limit → JSON/validation → account HMAC limit → concurrency
  → Prisma User.findUnique → Argon2 verify → transaction Session.create
  ← 200 user DTO + HTTP-only cookie

Me(cookie)
  → validate cookie format → SHA-256 → Session.findUnique
  → expiry + User tồn tại → 200 user DTO

Logout(cookie)
  → Origin/CSRF + JSON → deleteMany theo duy nhất tokenHash
  ← 204 + clear cookie; token cũ không còn xác thực được
```

Login chuẩn hóa email giống Register. Password giữ nguyên, string từ 1–128 Unicode code point: password sai nhưng đúng kiểu trả 401, không áp lại quy tắc tối thiểu 12 của Register. Input sai kiểu, email sai định dạng hoặc JSON lỗi trả 400. Body có giới hạn 16 KB/10 giây giống Register.

Đường đi email không tồn tại vẫn thực hiện Argon2 verification với dummy hash. Dummy được tạo một lần khi Login đầu tiên chạy và cache mỗi process, dùng password ngẫu nhiên không thuộc User nào. Cả email sai và password sai trả đúng cùng code/message INVALID_CREDENTIALS. Không khẳng định timing tuyệt đối giống nhau: DB/cache/network và cost hash cũ vẫn có thể khác; mục tiêu là giảm chênh lệch rõ rệt và có rate/concurrency limit.

Token sinh từ crypto.randomBytes(32), encode base64url thành 43 ký tự. Mỗi Login thành công tạo token mới, bỏ qua sessionId/token do client gửi và không tái sử dụng cookie cũ. PostgreSQL lưu SHA-256 của token, không lưu raw token. SHA-256 phù hợp token ngẫu nhiên entropy cao; password tiếp tục dùng Argon2id. Token chỉ nằm tạm trong server và cookie, không đi vào JSON, URL, logs hoặc Web Storage.

Mỗi User tối đa 5 phiên. Transaction khóa hàng User bằng SELECT ... FOR UPDATE có parameter UUID, dọn phiên hết hạn của User đó, thu hồi phiên cũ nhất nếu cần, rồi tạo Session mới. Khóa ở PostgreSQL đồng bộ giữa các Node process; transaction rollback nếu tạo Session lỗi. Giới hạn này có thể làm phiên cũ nhất đăng xuất khi Login lần thứ sáu, không phải logout all devices.

Me là thao tác chỉ đọc: không sửa lastSeen, không gia hạn expiry, không cleanup hoặc tạo session. Thời hạn tuyệt đối 7 ngày, server kiểm tra expiresAt mỗi lần. Cookie trùng tên/sai định dạng/không tồn tại, session bị thu hồi, hết hạn hoặc User không còn đều trả 401 UNAUTHENTICATED. DTO chỉ có id/name/email/createdAt, Prisma select không lấy passwordHash/tokenHash cho Me.

Logout chỉ thu hồi token của cookie hiện tại. Cookie thiếu/không hợp lệ/đã thu hồi vẫn trả 204 và clear cookie. DB lỗi khi cần thu hồi trả 503, không giả vờ thành công hay chỉ xóa cookie. Session khác của cùng User và của User khác được giữ nguyên.

## API contract

| Method/path             | Request                                        | Response                                         |
| ----------------------- | ---------------------------------------------- | ------------------------------------------------ |
| POST /api/auth/register | JSON name/email/password + X-Cineverse-CSRF: 1 | 201 user, 400, 409, 403 hoặc các lỗi bảo vệ khác |
| POST /api/auth/login    | JSON email/password + X-Cineverse-CSRF: 1      | 200 user + Set-Cookie; sai credentials 401       |
| GET /api/auth/me        | Cookie session                                 | 200 user; chưa xác thực 401                      |
| POST /api/auth/logout   | JSON {} + X-Cineverse-CSRF: 1 + cookie nếu có  | 204, body rỗng                                   |

Login/Me thành công: `{ "user": { "id": "UUID", "name": "...", "email": "...", "createdAt": "ISO-8601" } }`. Không có raw token hoặc các hash.

Sai credentials: `{ "error": { "code": "INVALID_CREDENTIALS", "message": "Email hoặc mật khẩu không chính xác." } }`. Không phân biệt email có tồn tại hay không.

Các lỗi khác giữ `{error:{code,message}}`: 400 validation/JSON, 401 unauthenticated, 403 ORIGIN_FORBIDDEN/CSRF_REJECTED, 405 method không hỗ trợ, 408 body timeout, 413 body lớn, 415 media type, 429 RATE_LIMITED/AUTH_BUSY có Retry-After, 503 AUTH_UNAVAILABLE và 500 INTERNAL_ERROR. Query string/trailing slash không thuộc route hiện tại.

## Cookie development/production

| Thuộc tính | Development HTTP local    | Production HTTPS         |
| ---------- | ------------------------- | ------------------------ |
| Name       | cineverse_session         | __Host-cineverse_session |
| HttpOnly   | Có                        | Có                       |
| SameSite   | Lax                       | Lax                      |
| Path       | /                         | /                        |
| Secure     | Không, để dùng HTTP local | Bắt buộc                 |
| Domain     | Không đặt                 | Không đặt                |
| Max-Age    | 604800 giây               | 604800 giây              |

Lax cho phép điều hướng top-level an toàn khi mở link tới Cineverse; không dựa vào Lax làm lớp CSRF duy nhất. Logout dùng cùng name/path/SameSite/Secure và Max-Age=0/Expires trong quá khứ. Production không có option tắt Secure; NODE_ENV sai như prod bị từ chối thay vì tự coi là development. TLS thực tế phải được cung cấp bởi deployment/reverse proxy HTTPS đáng tin; test unit chỉ kiểm flags production, chưa dựng HTTPS production.

Cookie host-only: dùng nhất quán localhost hoặc 127.0.0.1, đừng Login một host rồi Me ở host khác. Cookie không phân biệt port; cùng host giữa Vite/API thuận tiện local nhưng vẫn cần Origin guard để chặn website từ port khác.

## CSRF, Origin, CORS và Vite

Mọi POST Register/Login/Logout phải có **X-Cineverse-CSRF: 1**, kể cả HTTP client không gửi Origin. Đây là custom-header defense, không phải secret hoặc token đăng nhập. Browser cross-origin muốn đặt header phải qua preflight; backend không cấp CORS permission. Browser simple form không đặt được header này và cũng không đáp ứng JSON policy.

Nếu có Origin, bắt buộc khớp hoàn toàn allowlist; null, wildcard, hostname gần giống và origin không rõ bị từ chối. Sec-Fetch-Site cross-site bị chặn; POST có browser Fetch Metadata nhưng thiếu Origin cũng bị từ chối (trừ none). CLI không có Origin/Fetch Metadata được dùng custom header làm fallback. Các GET không thay đổi dữ liệu; Origin không hợp lệ vẫn bị chặn trên Me. Không derive trusted Origin từ Host/X-Forwarded-Host do client gửi.

Cấu hình development mặc định:

```dotenv
AUTH_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Nếu Vite chạy 5174, thêm chính xác origin đó vào backend/.env rồi restart backend. Production phải đặt NODE_ENV=production và AUTH_ALLOWED_ORIGINS thành các origin HTTPS do bạn kiểm soát; không dùng danh sách localhost mẫu khi deploy. Config thiếu/rỗng/wildcard/null/path/HTTP production làm startup fail closed với thông báo an toàn, không echo cấu hình secret.

Frontend Phase 6.2C dùng fetch('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json','X-Cineverse-CSRF':'1'}, body:...}) qua Vite proxy; cookie same-origin được browser quản lý. Me dùng GET tương tự; không đọc cookie bằng JavaScript và không lưu token localStorage/sessionStorage. Không bật Access-Control-Allow-Origin: * hoặc CORS credentials trong phase này.

Cơ chế đã được kiểm tra cả HTTP và browser: trusted origin Login thành công; cross-origin custom-header request bị chặn ở preflight; simple POST bị 403; session vẫn còn sau request tấn công mô phỏng. Nguồn: [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Rate limit và cleanup

Login giới hạn 20 request/IP/15 phút (kể cả body sai), 10 request/định danh tài khoản/15 phút và tối đa 2 thao tác đồng thời, không queue verify vô hạn. Key tài khoản là HMAC-SHA256(email đã chuẩn hóa) với key ngẫu nhiên/process, không lưu email thô làm key limiter. Không tin X-Forwarded-For tự gửi, không khóa tài khoản vĩnh viễn và không tự reset limiter khi Login thành công. Rate limiter bounded-map tái sử dụng từ Register; Register giữ limit cũ và TMDB không bị auth limiter ảnh hưởng.

Limiter trong memory reset khi restart và không chia sẻ nhiều instance; session trong PostgreSQL vẫn tồn tại. Production nhiều instance cần shared limiter và cấu hình trusted proxy rõ ràng; hiện IP là socket trực tiếp, sau reverse proxy có thể nhiều người chung limit. Account limit tạm thời cũng có thể bị dùng làm phiền tài khoản mục tiêu; không coi đây là giải pháp brute-force hoàn chỉnh.

Session hết hạn bị từ chối ngay khi xác thực dù chưa xóa. Login dọn expired của chính User. Dọn toàn cục bằng CLI một batch, không quét/xóa trên Me:

```powershell
npm.cmd run db:sessions:cleanup
```

Chỉ xóa tối đa 1000 Session đã hết hạn, giữ User và Session còn hạn; có index expiresAt và timeout 15 giây. Chưa tự lên lịch chạy nền; có thể vận hành định kỳ sau này. CLI cleanup đã được test bằng mock, chưa chủ động xóa session thật trong phiên triển khai.

## Kiểm thử thực tế bằng PowerShell

Agent không tự dùng mật khẩu thật. Các bước dưới đây dành cho bạn chạy với tài khoản đã đăng ký ở Phase 6.2A. Thao tác Login sẽ tạo Session thật và có thể thu hồi phiên cũ nhất nếu vượt 5 phiên; không tạo User mới.

Terminal 1 tại root:

```powershell
cd D:\LearnReact\Cineverse
npm.cmd run db:check
npm.cmd run dev
```

Giữ Terminal 2 mở trong suốt test để WebRequestSession/cookie jar chỉ nằm trong RAM. Không in CookieContainer/headers, export cookie ra file, bật transcript chứa request hoặc gửi cookie vào chat.

### 1. Login với mật khẩu nhập kín

```powershell
$api = 'http://127.0.0.1:3001'
$headers = @{ 'X-Cineverse-CSRF' = '1' }
$email = Read-Host 'Email tai khoan Cineverse da dang ky'
$securePassword = Read-Host 'Mat khau Cineverse (khong phai mat khau PostgreSQL)' -AsSecureString
try {
  $body = @{
    email = $email
    password = [System.Net.NetworkCredential]::new('', $securePassword).Password
  } | ConvertTo-Json
  $loginResult = Invoke-RestMethod -Method Post -Uri "$api/api/auth/login" `
    -Headers $headers -ContentType 'application/json; charset=utf-8' `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) `
    -SessionVariable cineverseSession -TimeoutSec 15
  $loginResult.user
} finally {
  $body = $null
  $securePassword.Dispose()
}
```

Mong đợi 200 và chỉ bốn trường User. Dùng mật khẩu tài khoản Cineverse đã tạo, không dùng DATABASE_URL password và không hardcode password mẫu. Không copy giá trị cookie/hash từ database để bỏ qua Login.

### 2. Me và restart backend

```powershell
Invoke-RestMethod -Uri "$api/api/auth/me" -WebSession $cineverseSession -TimeoutSec 15
```

Mong đợi user. Sau đó tại Terminal 1 dừng backend/dev bằng Ctrl+C và chạy lại npm.cmd run dev. Giữ nguyên Terminal 2 và gọi Me lần nữa: phiên phải còn hợp lệ nếu chưa hết hạn/bị thu hồi vì store nằm trong PostgreSQL. Không restart PostgreSQL để làm bước này.

### 3. Sao chép cookie jar trong RAM để kiểm tra token cũ sau Logout

```powershell
$replaySession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
foreach ($cookie in $cineverseSession.Cookies.GetCookies([Uri]$api)) {
  $copy = [System.Net.Cookie]::new($cookie.Name, $cookie.Value, $cookie.Path, $cookie.Domain)
  $copy.HttpOnly = $cookie.HttpOnly
  $copy.Secure = $cookie.Secure
  $copy.Expires = $cookie.Expires
  $replaySession.Cookies.Add($copy)
}
```

Đừng in `$copy`, `$cookie`, cookie values hoặc `$replaySession.Cookies`. Bản sao chỉ dùng local để xác nhận server đã thu hồi phiên, không lưu trên đĩa.

### 4. Logout và Me phải trả 401

```powershell
Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$api/api/auth/logout" `
  -Headers $headers -ContentType 'application/json' -Body '{}' `
  -WebSession $cineverseSession -TimeoutSec 15 | Select-Object StatusCode
```

Mong đợi 204, response body rỗng. Kiểm tra cả cookie jar đã clear và jar cũ, chỉ in status:

```powershell
foreach ($jar in @($cineverseSession, $replaySession)) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$api/api/auth/me" `
      -WebSession $jar -TimeoutSec 15 -ErrorAction Stop
    [int]$response.StatusCode
  } catch {
    if ($null -ne $_.Exception.Response) {
      [int]$_.Exception.Response.StatusCode
    } else {
      throw 'Khong ket noi duoc backend; kiem tra server local.'
    }
  }
}
$replaySession = $null
$cineverseSession = $null
```

Cả hai phải 401. Với cookie cũ, 401 chứng minh phiên bị thu hồi phía server, không chỉ xóa cookie browser.

### CMD, Windows PowerShell 5.1 và PowerShell 7

- npm.cmd chạy được trong cả CMD và PowerShell. Các biến `$...`, backtick xuống dòng và WebRequestSession trong ví dụ là PowerShell, không dán nguyên khối vào CMD; từ CMD chạy powershell.exe -NoProfile hoặc pwsh trước.
- PowerShell 5.1 có thể ánh xạ curl thành Invoke-WebRequest; dùng curl.exe khi cần curl thật. Không đặt password trong tham số curl vì lộ trong history/command line; dùng prompt kín ở trên.
- PowerShell 5.1 ném exception khi 401/403/429; block try/catch ở trên dùng được cả 5.1 và 7. UseBasicParsing tránh phụ thuộc IE của 5.1 và được chấp nhận ở 7.
- PowerShell 7 hỗ trợ SkipHttpErrorCheck/StatusCodeVariable, PowerShell 5.1 không hỗ trợ; hướng dẫn dùng cách chung. SessionVariable/WebSession giữ cookie trong RAM ở cả hai.

### Xem Session trong pgAdmin

Chọn đúng cineverse_dev → Schemas → public → Tables → Refresh → Session. Dùng Query Tool với danh sách cột cụ thể, không SELECT * hoặc View All Rows làm lộ tokenHash:

```sql
SELECT id, "userId", "createdAt", "expiresAt",
       "expiresAt" > CURRENT_TIMESTAMP AS active
FROM public."Session"
ORDER BY "createdAt" DESC
LIMIT 20;
```

Trước Login có thể chưa có row, sau Login có row mới; restart Node không xóa row, Logout xóa đúng row tương ứng. id/userId không phải raw session token. Không cần đọc hoặc chia sẻ tokenHash.

## Kết quả kiểm thử trong phiên triển khai

- **102 automated tests đạt:** 65 backend (20 Session mới, 3 migration guard mới, 42 cũ) + 37 frontend; không watch.
- Unit/HTTP test dùng database mock, Argon2 hash/verify thật; kiểm tra các ca Login/Me/Logout/expiry/fixation/DTO/cookie production, duplicate cookie, generic 401/dummy verify, CSRF/Origin/no-Origin/preflight, IP/account limit/concurrency, cap 5 và rollback, cleanup batch, lỗi DB, Register/TMDB regression.
- Edge headless thực với DB mock: HttpOnly cookie không đọc qua document.cookie; same-origin Login/Me; cross-origin custom-header request bị preflight chặn, simple POST bị 403; Logout xóa cookie và server record, Me sau đó 401.
- PostgreSQL thật: schema validation/generate/migration/db:check thành công, migration re-run không ghi DB; số User trước/sau apply không đổi. Live HTTP trả 401 cho Login email ngẫu nhiên không tồn tại và Me cookie giả, 204 Logout không cookie, 400 Register rỗng, 403 Origin lạ. Không dùng mật khẩu thực tế.
- TMDB thật qua server mới: popular 200/20 phim; Inception 27205 trả 200 có credits. User/Session row counts trước/sau smoke không đổi; server test/pool được đóng.
- Lint, TypeScript check frontend và build đạt. Backend MJS được kiểm tra bằng lint/Node tests. Không thay frontend.
- Secret scan kiểm tra file review/commit và frontend source/dist, không in secrets. Env/generated client tiếp tục ignore, không commit/push.
- **Chưa thực hiện Login thành công với tài khoản PostgreSQL thật hoặc restart Node với phiên thật** vì cần bạn nhập mật khẩu kín ở máy. Persistence đã test bằng hai app-server instance dùng cùng store mock; không coi đó là integration PostgreSQL/process restart. Hướng dẫn trên là phần kiểm thử thực tế còn cần bạn chạy. Production HTTPS/TLS và nhiều instance chưa được dựng/kiểm thử.

Chạy lại từ root:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
```

Browser security test là tùy chọn, cần Playwright + Edge có sẵn. Trong phiên này dùng module Playwright đã cache, không thêm dependency:

```powershell
node backend/tests/session.browser.mjs 'D:\LearnReact\Cineverse\.npm-cache\_npx\e41f203b7505f1fb\node_modules\playwright'
```

Nếu cache không còn, truyền đường dẫn Playwright cục bộ của bạn; npm.cmd test không phụ thuộc browser test này.

## Giới hạn và Phase 6.2C

Chưa có Login/Register UI, Auth Context/hook, protected pages hoặc hiển thị trạng thái tài khoản. Phase 6.2C có thể tích hợp frontend với API/cookie hiện tại và thêm kiểm thử người dùng; chưa tự triển khai.

Chưa có OAuth/JWT, email verification, reset password/MFA, Favorites hoặc logout all devices. Session có thời hạn tuyệt đối, không sliding expiry/idle timeout. Khi triển khai thực cần HTTPS và trusted deployment/proxy, vận hành cleanup, cấu hình Origin chính xác và đánh giá shared rate limit. HttpOnly giúp hạn chế đọc token bằng JavaScript, không ngăn XSS thực hiện request trong origin đã tin cậy.
