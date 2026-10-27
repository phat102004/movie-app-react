# Phase 6.4A — User Profile Backend API

Chỉ triển khai backend `GET /api/profile` và `PATCH /api/profile`. Không thêm trang React, đổi email/mật khẩu, dependency, Prisma schema hoặc migration. Không commit/push. Source ban đầu sạch tại commit Favorites `04ef54b`.

## Schema thực tế và file thay đổi

User đã có `id`, `name`, `email`, `passwordHash`, `createdAt`, `updatedAt` và quan hệ `favorites`, `sessions`, `passwordResetTokens`. Vì vậy không cần migration. API dùng `name`, giữ nguyên email/id/createdAt; Prisma tự cập nhật `updatedAt` khi đổi tên. Không trả passwordHash hoặc updatedAt trong DTO.

| File | Trách nhiệm |
| --- | --- |
| `backend/profile/profile-routes.mjs` **mới** | HTTP GET/PATCH, session, CSRF/Origin, query/body và rate limits |
| `backend/profile/profile-service.mjs` **mới** | Prisma theo User ID, relation count, conditional UPDATE và DTO an toàn |
| `backend/profile/validation.mjs` **mới** | Strict body chỉ có name |
| `backend/auth/name-validation.mjs` **mới** | Trim + quy tắc tên dùng chung Register/Profile |
| `backend/auth/validation.mjs` | Register dùng helper chung, giữ nguyên validation/email/password policy |
| `backend/auth/security.mjs` | Bổ sung PATCH vào cùng CSRF policy POST/DELETE, không nới lỏng policy |
| `backend/server.mjs` | Ghép handler Profile vào native Node HTTP router hiện có |
| `backend/tests/profile.test.mjs` **mới** | 30 tests HTTP/Prisma mock, session thật, ownership/errors/races/regression |
| `README.md` | Cập nhật phạm vi và liên kết Phase 6.4A |
| `docs/phase-6.4a-profile-backend.md` **mới** | API, chạy thử, kết quả và giới hạn |

Không dùng Express hoặc repository layer mới. Session service, cookie, user DTO, lỗi HTTP và limiter đều tái sử dụng cơ chế hiện có.

## API contract

Cả hai endpoint yêu cầu session hợp lệ qua HttpOnly cookie. Không nhận query parameters, User ID từ client hoặc path `/api/profile/:userId`. Unknown child path trả 404. GET không nhận body. Unsupported methods trả 405 với `Allow: GET, PATCH`.

### GET /api/profile

```json
{
  "profile": {
    "id": "00000000-0000-4000-8000-000000000001",
    "name": "Example User",
    "email": "user@example.com",
    "createdAt": "2026-10-27T10:00:00.000Z",
    "favoriteCount": 12
  }
}
```

Ví dụ trên chỉ minh họa contract, không phải thông tin tài khoản thật. Chưa có Favorite trả favoriteCount=0. GET không ghi database hoặc refresh cookie.

Service gọi `user.findUnique({ where: { id: userId }, select: ... })`; select gồm `safeUserSelect` hiện có và `_count: { select: { favorites: true } }`. Đây là Prisma relation count thực thi aggregate tại PostgreSQL theo quan hệ của đúng User, không gọi findMany Favorites hoặc tải từng phim lên Node để đếm. Không gọi TMDB.

### PATCH /api/profile

```http
Content-Type: application/json
X-Cineverse-CSRF: 1
```

```json
{ "name": "  Nguyễn Phát 🎬  " }
```

Trả HTTP **200**, cùng cấu trúc `{ profile: ... }` như GET; name đã trim thành `Nguyễn Phát 🎬`, favoriteCount vẫn tính ở database. Gửi lại cùng tên vẫn 200. Endpoint không tự sửa Favorites/Session/ResetToken và không phát cookie mới. `GET /api/auth/me` đọc User hiện tại nên phản ánh tên mới, không có cache tên riêng phía backend.

Validation:

- Chỉ nhận JSON object với trường `name`; thiếu tên hoặc dư field đều 400. Reject cả id/userId/email/role/password/passwordHash/createdAt/updatedAt/sessions/favorites và các key khác.
- Name phải là string, trim hai đầu, có **1–100 Unicode code points**; không phải số/boolean/null/object/array.
- Reject tên rỗng, chỉ whitespace hoặc chứa ký tự điều khiển C0/DEL sau trim. Giữ nguyên khoảng trắng giữa tên và không normalize Unicode ngoài policy Register hiện có.
- Body giữ cap **16 KB**, timeout đọc **10 giây**, strict UTF-8/JSON và không nhận compression theo utility HTTP chung.
- Service dựng `data: { name }`, không spread request body vào Prisma; chống mass assignment bằng cả strict validator và allowlist data.

Lỗi theo contract hiện có:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Vui lòng kiểm tra tên hiển thị.",
    "fields": { "name": "Tên phải có từ 1 đến 100 ký tự, không chứa ký tự điều khiển." }
  }
}
```

| Status | Code | Ý nghĩa |
| --- | --- | --- |
| 400 | VALIDATION_ERROR / INVALID_JSON / INVALID_QUERY / BODY_NOT_ALLOWED | Tên/body/query sai |
| 401 | UNAUTHENTICATED | Không có session, hết hạn/thu hồi, User đã mất hoặc conditional write không còn hợp lệ |
| 403 | CSRF_REJECTED / ORIGIN_FORBIDDEN | Sai custom header, Origin hoặc fetch metadata |
| 404 / 405 | NOT_FOUND / METHOD_NOT_ALLOWED | Sai route/method |
| 408 / 413 / 415 | REQUEST_TIMEOUT / PAYLOAD_TOO_LARGE / UNSUPPORTED_MEDIA_TYPE | Utility body hiện có |
| 429 | RATE_LIMITED | Có Retry-After |
| 500 / 503 | INTERNAL_ERROR / AUTH_UNAVAILABLE | Lỗi nội bộ/database, không trả raw exception |

Headers response: no-store, nosniff, no-referrer. Không log cookie/token/SQL exception/connection string. Security/method checks có thể trả 403/405 trước 401; request có security headers đúng nhưng không có session trả 401.

## Authentication, ownership và session bị thu hồi

Route đọc cookie bằng `readSessionToken`, xác thực bằng `sessions.currentUser(token)`. Verifier hiện có kiểm tra token hash, expiry và User còn tồn tại; User ID lấy từ DTO đã xác thực. A không chọn B qua body/query/path. DTO được dựng lại bằng `toUserDto` cùng favoriteCount, không spread record Prisma ra response.

PATCH kiểm tra lại session sau khi body đã đọc xong. Vì thế logout/expiry khi client đang upload chậm trả 401 trước khi gọi update.

Giữa verifier lần cuối và DB write vẫn có thể xảy ra logout: `user.update()` bổ sung `sessions.some({ tokenHash: hashSessionToken(token), expiresAt: { gt: now() } })` bên cạnh unique `id`. Đây là điều kiện **ngay trong UPDATE**, không chỉ check-then-update bằng id. User không còn hoặc session không còn thỏa điều kiện khiến Prisma P2025, chuyển thành 401 an toàn. Không thêm cơ chế login thứ hai hoặc lưu plaintext token trong DB.

Đã kiểm chứng SQL do Prisma 7 sinh bằng pg adapter nối vào PostgreSQL WASM RAM: UPDATE có `WHERE User.id = ... AND EXISTS(SELECT ... FROM Session WHERE tokenHash = ... AND expiresAt > ... AND User.id = Session.userId)`. Tham số hóa toàn bộ values, không ghép name/token vào SQL string.

Giới hạn đồng thời: điều kiện tuân theo snapshot/isolation PostgreSQL và timestamp lấy lúc dựng lệnh. Logout hoàn tất trước snapshot của write sẽ chặn; logout sau khi write đã bắt đầu/commit không đảo ngược một đổi tên đã được chấp nhận. Không hứa hủy nguyên tử mọi write đang chạy hoặc xử lý last-writer-wins thành version conflict. Hai PATCH hợp lệ đồng thời có thể ghi đè tên theo thứ tự database xử lý.

Rate limit: **300 Profile requests/IP/15 phút** và **30 PATCH/User/15 phút**; dùng socket IP, không tin X-Forwarded-For. Limiter bounded Map hiện có chỉ dùng cho một process, không chia sẻ giữa nhiều instance. PATCH yêu cầu CSRF kể cả CLI không có Origin; browser phải theo exact Origin/fetch metadata policy hiện tại. Không bật CORS.

## Kết quả kiểm thử ngày 27/10/2026

| Kiểm tra | Kết quả |
| --- | --- |
| Profile HTTP/unit tests mới | **30/30 đạt**, native HTTP + real session/login/Argon2, database mock |
| `npm.cmd test` | **235/235 đạt**: 164 backend + 71 frontend; không fail/skip |
| Lint (Oxlint theo scripts thực tế) | Đạt, không warning |
| TypeScript check | Đạt |
| Production build | Đạt |
| `db:validate`, `db:check` | Đạt, không chạy migration |
| Prisma migrate diff chỉ đọc | Không schema drift; bốn migrations giữ nguyên |
| Counts PostgreSQL trước/sau | User 2→2, Session 1→1, PasswordResetToken 0→0, Favorite 4→4 |
| Prisma query probe biệt lập | Prisma Client 7 + adapter pg thực thi GET/_count/conditional UPDATE trên PGlite RAM; revoked session bị 401 |
| Browser regression | Đạt Auth/Register/Login/Me/Logout, AuthProvider, recovery, Home/Search/Filters/Details/compact/cast với fixtures |

30 tests bao gồm: guest GET/PATCH; safe DTO/headers; count A/B đúng và không fetch danh sách; trim/Unicode/boundary/control/invalid types; strict keys/mass assignment; query/path injection; CSRF/Origin/fetch metadata; invalid/expired/revoked session và missing User; upload chậm rồi logout/expiry; thu hồi/expiry ngay trước write; P2025/DB errors an toàn; body cap/JSON/media type; 405/GET body; rate limits; Me tên mới và bảo toàn Favorites/Session/ResetToken; Register/Login/Logout/TMDB hồi quy.

Database thật chỉ được đọc metadata/counts/history/drift bằng công cụ cấu hình runtime hiện có; không mở/in nội dung `.env` hoặc đọc secrets để kiểm thử. Không PATCH tài khoản thật, không gọi seed/reset/deploy migration, không sửa schema/migration và không sinh client lại. PostgreSQL WASM chỉ ở RAM, không dùng dataDir hoặc socket database thật.

```powershell
node --test backend/tests/profile.test.mjs
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run db:validate
npm.cmd run db:check
```

## PowerShell an toàn

Khởi động PostgreSQL và chạy `npm.cmd run dev` tại thư mục gốc. Backend chưa auto reload: Ctrl+C server cũ rồi chạy lại. Không cần migration/package mới. Dùng đúng origin Vite được allowlist (ví dụ mặc định dưới đây).

Chỉ dùng tài khoản test của bạn. PATCH khi **bạn tự chạy** sẽ đổi tên tài khoản đó; agent không chạy PATCH trên PostgreSQL thật. Không dùng -Verbose/-Debug, không in cookie hoặc ghi transcript chứa request auth.

```powershell
$profileBase = 'http://localhost:5173'
$profileSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$profileHeaders = @{ 'X-Cineverse-CSRF' = '1'; Origin = $profileBase }
$profileCredential = Get-Credential -Message 'Email và mật khẩu tài khoản test Cineverse'
try {
    $profileLoginBody = @{
        email = $profileCredential.UserName
        password = $profileCredential.GetNetworkCredential().Password
    } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri "$profileBase/api/auth/login" -Method Post `
        -WebSession $profileSession -Headers $profileHeaders `
        -ContentType 'application/json; charset=utf-8' `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($profileLoginBody)) | Out-Null
} finally {
    Remove-Variable profileLoginBody, profileCredential -ErrorAction SilentlyContinue
}

$profileBefore = Invoke-RestMethod -Uri "$profileBase/api/profile" `
    -WebSession $profileSession -Headers $profileHeaders
$profileBefore.profile | Select-Object name, createdAt, favoriteCount

$profilePayload = @{ name = 'Tên tài khoản test mới' } | ConvertTo-Json -Compress
$profileAfter = Invoke-RestMethod -Uri "$profileBase/api/profile" -Method Patch `
    -WebSession $profileSession -Headers $profileHeaders `
    -ContentType 'application/json; charset=utf-8' `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($profilePayload))
$profileAfter.profile | Select-Object name, createdAt, favoriteCount

$profileMe = Invoke-RestMethod -Uri "$profileBase/api/auth/me" `
    -WebSession $profileSession -Headers $profileHeaders
$profileMe.user.name # Tên mới phải khớp Profile

Invoke-WebRequest -UseBasicParsing -Uri "$profileBase/api/auth/logout" -Method Post `
    -WebSession $profileSession -Headers $profileHeaders `
    -ContentType 'application/json' -Body '{}' | Out-Null
Remove-Variable profileSession, profileBefore, profileAfter, profileMe, profilePayload -ErrorAction SilentlyContinue
```

Có thể tự gửi name rỗng/số/dư email hoặc bỏ CSRF để kiểm tra lỗi. Không dùng User ID/token/hash từ database để giả lập đăng nhập; không sửa Session/Favorite thật bằng SQL.

## Giải thích ngắn và chuẩn bị Phase 6.4B

- **GET** đọc hồ sơ, không thay đổi tên. **PATCH** thay đổi một phần resource: phase này chỉ name, không thay toàn bộ User.
- **User ID từ session** là danh tính server đã xác minh. Tin userId của client sẽ cho phép A sửa/đọc B dù A vẫn đã login hợp lệ.
- **Không trả passwordHash** vì đó là thông tin xác thực nội bộ, không phục vụ UI và có thể bị khai thác để dò mật khẩu offline nếu lộ.
- **Prisma `_count`** đưa phép đếm xuống database, chỉ trả một con số thay vì truyền toàn bộ Favorite về Node; tiết kiệm bộ nhớ/băng thông và giữ owner scope trong truy vấn.

Thứ tự đọc: `profile/validation.mjs` → `profile/profile-routes.mjs` → `profile/profile-service.mjs` → `auth/user-dto.mjs` → `tests/profile.test.mjs`. Đọc thêm helper `auth/name-validation.mjs` để thấy cùng policy Register/Profile và `server.mjs` để theo dõi dispatch.

Phase 6.4B có thể thêm Profile API service/types và React page, protected/loading/error/retry, form name và gọi `AuthProvider.refreshUser()` sau PATCH để Header đổi tên. API Me đã cập nhật ngay; React state đang có chưa tự refresh trong phase backend này. Không dùng authService hiện tại để đọc `{ profile }` như `{ user }` nếu chưa viết parser phù hợp.

Chưa hỗ trợ avatar, email verification, đổi mật khẩu, xóa tài khoản hoặc Profile UI. Không có optimistic concurrency version/ETag. favoriteCount có thể thay đổi khi request Favorites khác chạy đồng thời. Probe Prisma/PGlite local nằm trong artifact ignored `.npm-cache/phase-6.4a-prisma-probe.mjs`, không phải dependency mới hoặc test bắt buộc của clone sạch.

Tham khảo chính thức đã đối chiếu với generated types/Prisma 7 đang cài: [Prisma Client API — WhereUniqueInput](https://www.prisma.io/docs/orm/v7/reference/prisma-client-reference) và [relation queries/count](https://www.prisma.io/docs/orm/v7/prisma-client/queries/relation-queries).

Dừng tại Phase 6.4A.
