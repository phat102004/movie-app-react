# Phase 6.3B — Backend Favorites API

Chỉ thêm API trên Node HTTP server hiện có. Không dùng Express, không tạo cơ chế auth khác, không đổi schema/migration, không thêm dependency và không sửa React. Không gọi TMDB trong Favorites API; không commit/push.

## File tạo/sửa

| File | Trách nhiệm |
| --- | --- |
| backend/favorites/validation.mjs **mới** | JSON movieId, URL ID, query/cursor và encode cursor |
| backend/favorites/favorite-service.mjs **mới** | Prisma queries theo User, DTO, paging, unique/retry/idempotency |
| backend/favorites/favorite-routes.mjs **mới** | HTTP methods, session, body, security/rate và response |
| backend/server.mjs | ghép route collection/item vào HTTP router hiện có |
| backend/auth/security.mjs | mở rộng cùng CSRF policy từ POST sang POST + DELETE |
| backend/tests/favorites.test.mjs **mới** | HTTP/native session + database mock, ownership/races/errors/paging |
| README.md | cập nhật phạm vi và liên kết tài liệu Phase 6.3B |
| docs/phase-6.3b-favorites-api.md **mới** | contract, cấu trúc, chạy thử và giới hạn |

Các thay đổi database foundation Phase 6.3A đang có trong working tree được giữ nguyên. Không thêm migration hoặc thay đổi các file đó trong Phase 6.3B.

## API contract

Tất cả endpoints yêu cầu session còn hiệu lực. Cookie do Login cấp và được browser/WebRequestSession gửi lại; không truyền token ở query/body hoặc Authorization tự chế. Response JSON dùng no-store/nosniff và Referrer-Policy no-referrer. Không tạo/refresh cookie khi gọi Favorites.

### GET /api/favorites

Không nhận body. Chỉ hỗ trợ một query `cursor` tùy chọn; userId, limit hoặc query lạ bị từ chối 400. Lọc trực tiếp `where: { userId, ... }` trong Prisma, không tải toàn bảng rồi lọc bằng JavaScript.

Sắp xếp `createdAt DESC, movieId DESC`. movieId là tiebreaker duy nhất trong phạm vi một User nhờ compound unique.

```json
{
  "favorites": [
    { "movieId": 550, "createdAt": "2026-10-26T10:00:00.000Z" },
    { "movieId": 27205, "createdAt": "2026-10-26T09:00:00.000Z" }
  ],
  "nextCursor": null
}
```

Danh sách rỗng: `{ "favorites": [], "nextCursor": null }`.

**Pagination:** mỗi page tối đa **100** Favorite. Service lấy tối đa 101 hàng để xác định còn trang sau hay không. Nếu nextCursor là string, gọi `GET /api/favorites?cursor=<URL-encoded nextCursor>` và nối tiếp favorites. Lặp tới nextCursor=null để đọc đầy đủ; không coi trang đầu là toàn bộ danh sách.

Cursor là base64url của timestamp + movieId cuối trang, không chứa userId hoặc session secret. Server validate độ dài/cú pháp/date/Int32 và dùng điều kiện keyset: thời gian nhỏ hơn, hoặc cùng thời gian nhưng movieId nhỏ hơn. Owner luôn được lấy từ session và AND với các điều kiện này. Sửa cursor hoặc dùng cursor của User B không thể truy cập dữ liệu B. Cursor không phải token đăng nhập và không dùng làm bằng chứng phân quyền.

Không có snapshot transaction xuyên nhiều HTTP requests: Favorite thêm mới sau khi bắt đầu đọc có thể cần tải lại từ đầu; xóa dòng cursor không làm mất khả năng đọc trang sau. Sau mutation, frontend nên refresh danh sách nếu cần thứ tự mới nhất. Không trả tổng số, metadata phim hoặc internal Favorite UUID.

### POST /api/favorites

Yêu cầu JSON và `X-Cineverse-CSRF: 1`. Chỉ nhận một field:

```json
{ "movieId": 550 }
```

movieId phải là **number**, nguyên, từ 1 tới 2147483647. Không ép kiểu từ string; từ chối 0/âm/fraction/null/boolean/array/object/NaN/Infinity/overflow. Các field userId/id/createdAt dư thừa bị từ chối. Chỉ service phía server truyền userId đã xác thực vào Prisma.

Tạo mới trả **201**:

```json
{
  "favorite": {
    "movieId": 550,
    "createdAt": "2026-10-26T10:00:00.000Z"
  }
}
```

Đã tồn tại trả **200** với cùng DTO và createdAt cũ, không thay đổi thứ tự vì gửi lại POST. Service create trước; nếu PostgreSQL báo unique P2002 thì đọc lại bằng `userId_movieId`. Không dùng check-then-create thiếu xử lý race. Unique database vẫn bảo đảm một cặp User/phim chỉ có một hàng.

Nếu có DELETE chạy xen vào sau unique conflict khiến hàng vừa biến mất, service retry create tối đa một lần. Nếu liên tục bị thay đổi và không thể đọc lại hàng, trả 409 FAVORITE_RETRY để client gửi lại. Không trả 200 với favorite=null. Nếu User bị xóa giữa lúc xác thực và INSERT, lỗi FK được chuyển thành 401 an toàn.

### DELETE /api/favorites/:movieId

Yêu cầu `X-Cineverse-CSRF: 1`, không body, không query. ID URL phải là dạng thập phân nguyên dương chuẩn (không dấu, số 0 đầu, exponent, UUID, khoảng trắng hoặc overflow).

Prisma dùng `deleteMany({ where: { userId, movieId } })`: luôn kết hợp cả owner và phim. Không tìm/xóa bằng UUID của Favorite do client gửi. Trả **204 No Content** dù có xóa được hàng hay không. Không trả JSON, không gọi TMDB, không xóa User/Movie.

## Authentication, authorization và HTTP safety

Route tái sử dụng `readSessionToken(cookie, config)` rồi `sessions.currentUser(token)` của hệ thống hiện có. Helper kiểm tra định dạng/hash session, expiresAt và User còn tồn tại; chỉ User DTO hợp lệ mới cung cấp id cho truy vấn Favorites. Session sai/hết hạn/đã logout bị 401. GET không xóa session hết hạn hoặc thực hiện mutation.

Authentication trả lời “ai đang gọi”; authorization giới hạn dữ liệu của người đó. User A và B cùng có thể lưu phim 550, nhưng GET A không thấy hàng của B và DELETE A chỉ xóa hàng của A. Không tin userId từ query/body/cursor. `select` chỉ lấy movieId/createdAt và DTO được dựng lại, không spread toàn bộ record ra response.

Mỗi request xác thực session tại lúc xử lý. POST kiểm tra lại session sau khi đọc body vì client có thể gửi chậm; nếu logout/hết hạn trong lúc chờ thì không ghi Favorite. Không có cơ chế hủy nguyên tử một truy vấn database đã bắt đầu khi logout chạy đồng thời sau bước xác thực cuối.

Giữ exact Origin allowlist và fetch metadata policy. Cùng helper CSRF nay kiểm tra **POST và DELETE**; không nới lỏng POST auth. CLI không Origin vẫn cần custom header cho mutation. Browser có fetch metadata nhưng thiếu Origin trên mutation bị từ chối theo policy cũ. Không bật CORS; dùng URL `/api/...` cùng origin qua Vite/reverse proxy.

Body POST giữ cap 16KB, JSON/UTF-8 strict, không nhận Content-Encoding nén và timeout đọc hiện có. GET/DELETE không nhận body. Method không hỗ trợ trả 405 + Allow; unknown route trả 404. Security headers/method checks có thể trả 403/405 trước 401, ví dụ mutation thiếu CSRF. Một request có headers hợp lệ nhưng chưa có session trả 401.

Rate limit riêng cho Favorites: **300 request/IP/15 phút** (kể cả GET/unauth), **120 POST+DELETE/User/15 phút**; 429 có Retry-After. Dùng limiter bounded Map hiện có, địa chỉ socket thật, không tin X-Forwarded-For. Đây là limiter một process local, không chia sẻ giữa nhiều instance hoặc chống mọi hình thức DoS; cấu hình trusted proxy/shared limiter thuộc vận hành sau này.

Lỗi Prisma/adapter chuyển qua `publicAuthError` hiện có, không log/copy raw exception, SQL, stack, URL kết nối hoặc credentials. Database lỗi không bị coi là guest hay thành công. Service không truy cập TMDB và không đọc password/session hash để tạo Favorite DTO.

## Các mã lỗi

| Status | Code tiêu biểu | Ý nghĩa |
| --- | --- | --- |
| 400 | INVALID_MOVIE_ID, VALIDATION_ERROR | movieId/body không hợp lệ, field không được phép |
| 400 | INVALID_QUERY, INVALID_CURSOR, BODY_NOT_ALLOWED, INVALID_JSON | query/cursor/body sai contract |
| 401 | UNAUTHENTICATED | chưa login/session hết hạn/bị thu hồi hoặc User không còn |
| 403 | CSRF_REJECTED, ORIGIN_FORBIDDEN | vi phạm policy request |
| 404 / 405 | NOT_FOUND / METHOD_NOT_ALLOWED | sai route/method; 405 có Allow |
| 408 / 413 / 415 | REQUEST_TIMEOUT / PAYLOAD_TOO_LARGE / UNSUPPORTED_MEDIA_TYPE | utility HTTP hiện có |
| 409 | FAVORITE_RETRY | race với DELETE lặp lại, cần gửi lại request |
| 429 | RATE_LIMITED | đợi Retry-After |
| 500 / 503 | INTERNAL_ERROR / AUTH_UNAVAILABLE | lỗi nội bộ hoặc store tài khoản/Favorite chưa sẵn sàng |

Lỗi có format `{ "error": { "code": "...", "message": "..." } }`, có thể có fields cho validation. Không có raw Prisma detail.

## Kiểm thử PowerShell với WebRequestSession

Các lệnh POST/DELETE dưới đây **ghi vào database khi bạn tự chạy**; chỉ dùng tài khoản test riêng đã chọn. Agent không thực hiện chúng với tài khoản thật. Không hardcode password, không in cookie, không dùng -Verbose/-Debug hoặc ghi transcript của request auth.

Khởi động PostgreSQL và `npm.cmd run dev` tại thư mục gốc. Dùng đúng origin Vite được allowlist; ví dụ mặc định:

Nếu server đang chạy từ trước khi sửa code, dừng bằng Ctrl+C và chạy lại `npm.cmd run dev`: backend hiện không tự reload khi file thay đổi. Không cần chạy migration cho Phase 6.3B.

```powershell
$favBase = 'http://localhost:5173'
$favSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$favHeaders = @{ 'X-Cineverse-CSRF' = '1'; Origin = $favBase }
$favCredential = Get-Credential -Message 'Email và mật khẩu tài khoản test Cineverse'
try {
    $favLoginBody = @{
        email = $favCredential.UserName
        password = $favCredential.GetNetworkCredential().Password
    } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri "$favBase/api/auth/login" -Method Post `
        -WebSession $favSession -Headers $favHeaders `
        -ContentType 'application/json' -Body $favLoginBody | Out-Null
} finally {
    Remove-Variable favLoginBody, favCredential -ErrorAction SilentlyContinue
}
```

Gọi POST hai lần (dự kiến lần đầu 201, lần sau 200 nếu chưa tồn tại), chỉ in status:

```powershell
$favPayload = @{ movieId = 550 } | ConvertTo-Json -Compress
$favAdded = Invoke-WebRequest -UseBasicParsing -Uri "$favBase/api/favorites" `
    -Method Post -WebSession $favSession -Headers $favHeaders `
    -ContentType 'application/json' -Body $favPayload
$favAdded.StatusCode
```

GET đủ các trang:

```powershell
$favRows = @()
$favCursor = $null
do {
    $favUri = "$favBase/api/favorites"
    if ($favCursor) { $favUri += '?cursor=' + [uri]::EscapeDataString($favCursor) }
    $favPage = Invoke-RestMethod -Uri $favUri -WebSession $favSession -Headers $favHeaders
    $favRows += @($favPage.favorites)
    $favCursor = $favPage.nextCursor
} while ($favCursor)
$favRows | Select-Object movieId, createdAt
```

DELETE không body, lần đầu/lặp lại đều 204:

```powershell
$favDeleted = Invoke-WebRequest -UseBasicParsing -Uri "$favBase/api/favorites/550" `
    -Method Delete -WebSession $favSession -Headers $favHeaders
$favDeleted.StatusCode
```

Kết thúc session test:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "$favBase/api/auth/logout" -Method Post `
    -WebSession $favSession -Headers $favHeaders -ContentType 'application/json' -Body '{}' | Out-Null
Remove-Variable favSession, favAdded, favDeleted -ErrorAction SilentlyContinue
```

Để thử ownership, dùng hai WebRequestSession đăng nhập hai tài khoản test riêng. Không sao chép cookie giữa chúng. Thử bỏ CSRF/Origin sai, movieId string/âm/0 hoặc GET với userId để thấy lỗi tương ứng; không sửa password/token trong database.

## pgAdmin — SQL chỉ đọc

Refresh cineverse_dev → Schemas → public → Tables → Favorite. Chỉ đọc các trường cần thiết, không truy vấn hash trong bảng auth.

```sql
SELECT COUNT(*) FROM public."Favorite";

-- Thay placeholder bằng UUID của tài khoản test của bạn (lấy từ Me DTO).
SELECT "movieId", "createdAt"
FROM public."Favorite"
WHERE "userId" = '<USER_UUID>'::uuid
ORDER BY "createdAt" DESC, "movieId" DESC;
```

Không có thao tác INSERT/DELETE/UPDATE database thật trong automated tests của phase này. Drift check dùng Prisma migrate diff chỉ đọc, không gọi migrate deploy/reset.

## Tests và kiểm chứng

`backend/tests/favorites.test.mjs` dùng native Node HTTP router, cookie/session service thật và DB mock. Login xác thực Argon2 bằng password fixture riêng trong RAM; không đọc .env hoặc kết nối cineverse_dev. Database mock lưu state và kiểm tra Prisma owner filters/select/take/order; không thay thế các guard production. Test SQL unique/FK ở PostgreSQL WASM của Phase 6.3A vẫn nằm trong full suite.

38 tests mới bao gồm: unauthorized GET/POST/DELETE; empty list; create/DTO/owner; duplicate và concurrent POST; mọi kiểu ID sai; client userId injection; scope hai User; idempotent DELETE; invalid path ID; session expired/revoked (kể cả POST đang gửi body chậm); CSRF DELETE/POST, Origin/fetch metadata; method/body cap/media type; safe DB errors; sort/tie/pagination 205 hàng; cursor tampering/cross-user; rate limits; race POST/DELETE; FK User biến mất; no secrets response/logs và TMDB không bị gọi bởi Favorites.

```powershell
node --test backend/tests/favorites.test.mjs
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
```

Không tuyên bố đã thử ghi Favorites của tài khoản thật. Positive CRUD/concurrency/authorization được kiểm chứng qua DB mock; PostgreSQL thật chỉ kiểm tra metadata/counts/history/drift và GET không cookie trả 401. Browser regression auth/recovery/phim sử dụng fixtures và server tự mở/đóng, không tiến trình vô hạn.

### Kết quả thực tế ngày 26/10/2026

| Kiểm tra | Kết quả |
| --- | --- |
| Favorites HTTP tests | 38/38 đạt, dùng DB mock |
| `npm.cmd test` | 184/184 đạt: 134 backend + 50 frontend; không fail/skip |
| Lint | Đạt |
| TypeScript check | Đạt |
| Production build | Đạt |
| Browser regression | Đạt Auth/Register/Login/Me/Logout, recovery, AuthProvider và trang phim; dùng DB/email/TMDB fixtures |
| Responsive regression | Các suite hiện có đạt tại các kích thước tương ứng 320/390/768/1024/1440px; không thêm UI Favorites |
| Prisma migrate diff chỉ đọc | Không schema drift |
| Metadata/counts/history trước → sau | User 2→2, Session 2→2, PasswordResetToken 0→0, Favorite 0→0; giữ nguyên 4 migrations |
| HTTP smoke không cookie, cấu hình runtime thật | GET /api/favorites → 401 UNAUTHENTICATED |

Browser regression chạy bằng script `frontend/tests/auth.browser.cjs` với Playwright có sẵn và cờ `--regression`; không cần thêm dependency. Các server/connection do kiểm thử tạo đều được đóng sau khi chạy. Không chạy POST/DELETE Favorites trên PostgreSQL thật; đây là giới hạn xác minh, không phải kết quả CRUD live.

Tham khảo [Prisma Client v7](https://www.prisma.io/docs/orm/v7/reference/prisma-client-reference) và [filter/sort queries](https://docs.prisma.io/docs/orm/v6/prisma-client/queries/filtering-and-sorting). Cursor public của Cineverse dùng điều kiện where keyset + orderBy/take, không yêu cầu tồn tại một cursor record trong Prisma.

## Giới hạn và Phase 6.3C

Chưa có Favorites React service/hook, nút tim hoặc trang danh sách. Chưa gọi TMDB để kiểm tra movieId có tồn tại hay tải metadata. Database schema của Phase 6.3A vẫn không có CHECK movieId dương; API hiện đã chặn các giá trị không hợp lệ, nhưng SQL trực tiếp vẫn có thể ghi giá trị ngoài policy.

Phase 6.3C cần API service dùng credentials same-origin/no-store, CSRF cho POST/DELETE, đọc đầy đủ nextCursor, state theo User và xóa state khi Logout/đổi tài khoản. Cần xử lý 401/403/429/503, rollback UI nếu mutation lỗi và tránh dữ liệu User cũ ghi đè User mới. Metadata poster/title lấy qua TMDB proxy riêng; không coi HTTP 200 duplicate là lỗi. Đây chỉ là kế hoạch, chưa triển khai.

Dừng tại Phase 6.3B.
