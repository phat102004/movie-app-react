# Phase 6.2D — Quên và đặt lại mật khẩu

Giữ giao diện Minimal Editorial, Router, TMDB, tìm kiếm/bộ lọc và AuthProvider hiện có. Chỉ thêm khôi phục mật khẩu. Không tạo Favorites/OAuth/MFA, không commit/push.

## Chạy và cấu hình email

Từ `D:\LearnReact\Cineverse`:

```powershell
npm.cmd install
npm.cmd --prefix frontend install
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run dev
```

`dev` chạy cả Node API (127.0.0.1:3001) và Vite (thường localhost:5173). PostgreSQL phải đang chạy cho auth. Không ghi đè `.env` hiện có. Chỉ thêm các biến cần thiết vào **backend/.env bằng editor**, giữ nguyên DATABASE_URL/TMDB và không chia sẻ secrets.

Mặc định `PASSWORD_RESET_EMAIL_MODE=disabled` (kể cả khi biến chưa có). Forgot trả **503 EMAIL_UNAVAILABLE**, UI báo chưa thể gửi, không giả vờ đã gửi email. Thay đổi cấu hình cần restart backend/dev. Không có token hay reset link được in terminal.

### Mail catcher local

Nếu có Docker, bạn có thể tự chạy Mailpit ở loopback:

```powershell
docker run --rm --name cineverse-mailpit -p 127.0.0.1:8025:8025 -p 127.0.0.1:1025:1025 axllent/mailpit
```

Lệnh foreground; giữ terminal riêng. Không bật SMTP forwarding/relay. Dừng bằng Ctrl+C. Có thể dùng binary Windows theo [tài liệu cài Mailpit](https://mailpit.axllent.org/docs/install/) nếu không có Docker. Port mặc định SMTP là 1025, inbox web là 8025. [Docker chính thức](https://mailpit.axllent.org/docs/install/docker/).

Thêm/sửa trong backend/.env:

```dotenv
PASSWORD_RESET_EMAIL_MODE=local
PUBLIC_APP_ORIGIN=http://localhost:5173
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_FROM=cineverse@localhost.test
SMTP_USER=
SMTP_PASSWORD=
```

`PUBLIC_APP_ORIGIN` phải là origin chính xác bạn dùng mở Cineverse, và thuộc `AUTH_ALLOWED_ORIGINS`. Nếu Vite dùng cổng khác, cập nhật cả hai. `local` chỉ nhận SMTP loopback, không auth, không TLS và bị chặn trong production. Mailpit chỉ giữ thư local, không chuyển tới hộp thư Internet.

1. Khởi động Mailpit, restart Cineverse.
2. Với **tài khoản thử nghiệm của bạn**, mở Login → **Quên mật khẩu?**, nhập email và gửi.
3. Mở inbox `http://127.0.0.1:8025`, chọn thư và mở link Reset. Đừng sao chép link vào chat, ảnh chụp hay bug report.
4. URL Cineverse sẽ thành `/reset-password` sau khi trang mở. Nhập hai mật khẩu mới giống nhau (12–128 ký tự), cập nhật rồi quay lại Login.
5. Đăng nhập bằng mật khẩu mới; mật khẩu cũ và các session cũ không còn hợp lệ. Mở lại cùng link sẽ bị từ chối khi gửi form.
6. Thử email chưa đăng ký: API/UI vẫn cùng thông báo chung. Thư hướng dẫn kiểm tra địa chỉ sẽ chỉ xuất hiện trong inbox đó, không chứa link reset giả.

Refresh trang Reset sau khi token đã bị xóa khỏi URL sẽ mất token trong RAM; hãy mở lại link trong email, nếu đã dùng thì xin link mới. Back về trang Reset sau khi rời trang cũng không khôi phục token. Token hết hạn sau 20 phút; request mới vô hiệu hóa link cũ.

### SMTP thật

Đặt `PASSWORD_RESET_EMAIL_MODE=smtp`, SMTP_HOST/PORT/USER/PASSWORD/FROM do nhà cung cấp cấp. Không dùng các giá trị ví dụ làm credentials. `SMTP_SECURE=true` cho TLS trực tiếp (thường 465), `false` cho STARTTLS (thường 587); chế độ smtp luôn yêu cầu TLS và không tắt kiểm tra chứng chỉ. Production còn cần NODE_ENV=production, PUBLIC_APP_ORIGIN là HTTPS nằm trong AUTH_ALLOWED_ORIGINS và cookie Secure hiện có.

Nodemailer 10.2.1 gửi text email, tắt debug/logger, không đọc file/URL từ message, không pool socket, có timeout kết nối. Chỉ trả thành công khi SMTP **chấp nhận người nhận**, không khẳng định thư đã tới inbox; provider vẫn có thể bounce/chặn spam sau đó. Recipient bị từ chối, timeout hay cấu hình sai trả 503 an toàn; hash của link gửi lỗi bị xóa nếu database khả dụng.

**Lựa chọn tránh email enumeration:** cả địa chỉ đã/chưa đăng ký đều đi qua SMTP, cùng subject, cùng response HTTP và thời gian tối thiểu 500ms. Với email chưa đăng ký, chỉ gửi thư hướng dẫn kiểm tra địa chỉ, không tạo User/token hoặc reset link giả. Như vậy lỗi SMTP không chỉ xuất hiện cho tài khoản tồn tại. Chỉ người đọc hộp thư biết hướng dẫn riêng. Rate limit áp dụng cả hai trường hợp; đây không phải công cụ gửi email tùy ý. Thời gian mạng/SMTP không được bảo đảm constant-time tuyệt đối.

## API và vòng đời token

| Endpoint                         | Body                  | Thành công                          | Lỗi chính                                      |
| -------------------------------- | --------------------- | ----------------------------------- | ---------------------------------------------- |
| POST `/api/auth/forgot-password` | `{ email }`           | 200 `{ message }` chung             | 400 validation, 429 limit, 503 email/DB        |
| POST `/api/auth/reset-password`  | `{ token, password }` | 200 `{ message }`, không Set-Cookie | 400 link/policy, 429 limit, 500/503 lỗi server |

Mọi POST yêu cầu JSON và `X-Cineverse-CSRF: 1`, đúng Origin allowlist. Reuse body cap 16KB, UTF-8 strict và safe errors; GET trả 405, không đổi dữ liệu. API response no-store/nosniff và no-referrer. Không có API trả token/URL/passwordHash.

Forgot: normalize email trim/lowercase, cùng validator Register → randomBytes(32), base64url 43 ký tự → SHA-256 64 hex → khóa User trong transaction → thay token cũ → lưu hash/createdAt/expiresAt → gửi email. TTL cố định 20 phút. Một token/User; index unique userId/hash và index expiresAt. Token hết hạn không dùng được dù chưa bị xóa vật lý. Request mới thay token; reset thành công xóa hết token của User. Chưa có job nền dọn token hết hạn của tài khoản không yêu cầu lại.

Reset: validate token/password → tra bằng hash → kiểm tra hạn → Argon2id → transaction khóa User, kiểm tra lại hạn và **deleteMany có điều kiện** → bắt buộc xóa đúng 1 token → update passwordHash → xóa session và token của đúng User → commit. Nếu bất kỳ bước nào lỗi, rollback toàn bộ. Hai request cùng token chỉ một request được commit. Login dùng cùng khóa User và kiểm tra lại hash đã verify để chặn session mới từ password cũ đang chạy đồng thời với reset.

Forgot giới hạn 10 request/IP + 3/định danh email HMAC trong 15 phút; reset 20/IP/15 phút; tổng tối đa 2 thao tác recovery đồng thời trong process. Rate limit RAM hiện tại không chia sẻ giữa nhiều instance/restart; cần thiết kế shared limiter khi triển khai quy mô lớn, không thêm Redis trong phase này.

## Luồng React và bảo vệ URL

```text
Login Link → ForgotPasswordPage → authService.forgotPassword → Node service → SMTP
Email /reset-password#token=… → main.captureResetToken → history.replaceState
→ ResetPasswordPage (RAM) → authService.resetPassword → transaction → refreshUser
→ thông báo thành công → Link Login (không auto-login)
```

Fragment `#token` không đi lên HTTP hoặc Referer. `main.tsx` xóa fragment trước BrowserRouter/AuthProvider mount; helper giữ token trong RAM, không history.state/Web Storage. React StrictMode đọc lại vẫn lấy đúng token. Rời route/success/invalid-token sẽ xóa vault. Chỉ hỗ trợ link fragment do backend tạo; query-token không được chấp nhận và được xóa khỏi địa chỉ. Không đặt token/password vào Router state, analytics hoặc tài nguyên ngoài.

`useState` quản lý input/trạng thái/error; `useRef` khóa submit ngay lập tức và giữ AbortController; cleanup effect hủy request khi unmount. Form dùng service hiện có để thêm CSRF, timeout và validate JSON. Reset thành công gọi refreshUser để Header nhận session đã bị thu hồi, không login tự động. Password/confirm được xóa khỏi form khi thành công. Lỗi mạng khi kiểm tra session vẫn theo chính sách AuthProvider hiện có.

index.html có meta no-referrer; Vite dev/preview đặt `Referrer-Policy: no-referrer` và `Cache-Control: no-store`. Trang recovery không gọi TMDB/load poster/trailer; TMDB attribution dùng SVG local. **Khi hosting build dist**, phải cấu hình SPA fallback và hai HTTP header tương ứng cho `/forgot-password`, `/reset-password` (và HTML auth). Meta không thay thế Cache-Control. Không thêm analytics/session replay trên recovery và không ghi request body auth ở reverse proxy/APM. Email provider/mail catcher tất nhiên giữ nội dung thư có link; giới hạn quyền truy cập và retention.

Thiết kế token dùng một lần, referrer và session invalidation tham khảo [OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html). Tùy chọn SMTP/access restrictions theo [Nodemailer SMTP](https://nodemailer.com/smtp), [message security](https://nodemailer.com/message).

## Migration đã áp dụng

`20261026020000_add_password_reset_token/migration.sql`: chỉ CREATE PasswordResetToken + indexes/FK trong BEGIN/COMMIT; không ALTER cột User/Session, không ghi đè hai migration trước. Đã áp dụng trên cineverse_dev/PostgreSQL 17.11 sau kiểm tra inventory, thứ tự/checksum, drift. Số User/Session trước/sau không đổi; không đọc bản ghi/email/hash khi audit database. Chạy lại db:migrate xác nhận đủ ba migration/schema khớp và không ghi DB. db:check truy vấn được cả ba model.

Snapshot `baselines/session.prisma` giữ schema trước phase để kiểm tra drift trước apply. `db:migrate:create` hiện in diff **User+Session → schema hiện tại**, không thực thi. Guard vẫn chặn bảng/view/sequence/lịch sử không mong đợi, không baseline/reset.

## File tạo và sửa trong phase này

| File                                                                                    | Thay đổi/trách nhiệm                                       |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| backend/auth/password-reset-service.mjs **mới**                                         | validation, token/hash/TTL, transaction và thu hồi session |
| backend/auth/password-reset-routes.mjs **mới**                                          | body/rate/concurrency cho hai POST                         |
| backend/auth/reset-email.mjs **mới**                                                    | config + abstraction SMTP/local/disabled                   |
| backend/server.mjs                                                                      | gắn endpoint, no-referrer                                  |
| backend/auth/login-service.mjs, session-service.mjs                                     | bảo vệ login chạy đồng thời với reset                      |
| backend/prisma/schema.prisma                                                            | relation và model PasswordResetToken                       |
| backend/prisma/baselines/session.prisma **mới**                                         | snapshot trước migration mới                               |
| backend/prisma/migrations/20261026020000_add_password_reset_token/migration.sql **mới** | SQL thêm bảng, index/FK                                    |
| backend/database/inspect.mjs                                                            | guard prefix migration thứ ba                              |
| backend/scripts/migrate.mjs, check-database.mjs                                         | kiểm tra drift/bảo toàn số User+Session/model mới          |
| backend/.env.example                                                                    | placeholder SMTP, mặc định disabled                        |
| package.json, package-lock.json                                                         | Nodemailer 10.2.1, diff baseline hiện hành                 |
| frontend/src/pages/ForgotPasswordPage.tsx **mới**                                       | form email, submit/status/error                            |
| frontend/src/pages/ResetPasswordPage.tsx **mới**                                        | password/confirm, token RAM, success/invalid/retry         |
| frontend/src/components/PasswordRecoveryLayout.tsx **mới**                              | shell editorial dùng chung                                 |
| frontend/src/components/AuthForm.tsx, Auth.css                                          | link Forgot ở hàng label, style/focus recovery             |
| frontend/src/utils/resetToken.ts **mới**                                                | capture/scrub/clear token                                  |
| frontend/src/utils/authForm.ts                                                          | tái sử dụng validator email/new password                   |
| frontend/src/services/auth.ts                                                           | hai API, kiểm tra response/message an toàn                 |
| frontend/src/main.tsx, App.tsx                                                          | capture trước mount, routes và clear vault khi rời         |
| frontend/index.html, vite.config.ts                                                     | Referrer-Policy và no-store                                |
| backend/tests/password-reset.test.mjs **mới**                                           | service/HTTP/races/Argon2/SMTP giả lập                     |
| backend/tests/helpers/auth-fixture.mjs                                                  | mock User update/token/transaction rollback                |
| backend/tests/migration-plan.test.mjs                                                   | guard ba migration, SQL không phá dữ liệu                  |
| frontend/tests/passwordRecovery.test.ts **mới**                                         | service/validation/token history/StrictMode                |
| frontend/tests/auth.browser.cjs                                                         | tích hợp recovery vào browser suite hiện có                |
| README.md, docs/phase-6.2d-password-recovery.md **mới**                                 | cấu hình, kiến trúc, kết quả và giới hạn                   |

Prisma Client sinh lại trong backend/generated (ignore); ảnh kiểm thử trong .npm-cache (ignore). Không chỉnh sửa `.env` thực tế.

## Kiểm thử

Kết quả chạy trong phiên triển khai ngày 26/10/2026:

| Kiểm tra | Kết quả thực tế |
| --- | --- |
| npm test | **131 test đạt**: 83 backend + 48 frontend, không skip |
| Lint / TypeScript / production build | Đạt |
| Prisma validate / generate / migrate / db:check | Đạt; migration chạy lại chỉ kiểm tra, không ghi DB |
| Edge browser auth + recovery | Đạt, gồm loading/chặn submit lặp/429/network retry |
| Browser regression details / compact / cast | Đạt, giữ search/filter/sort/lastUpdated/navigation |
| Live TMDB + PostgreSQL smoke | Home và Inception tải thật; Forgot chưa cấu hình báo 503 đúng; link sai được scrub; số User/Session/PasswordResetToken không đổi |
| SMTP loopback giả lập + Nodemailer thật | Đạt; không gửi Internet |
| Scan secrets | Không phát hiện giá trị secrets đã cấu hình trong file có thể commit hoặc dist; frontend không import config/Prisma/secrets server |
| Kiểm tra ảnh desktop/mobile | Đã xem ảnh Reset 1440px và 320px; giữ style ivory/olive, không tràn ngang |

Ảnh kiểm thử local: `.npm-cache/phase-6.2d-forgot-mobile.png`, `phase-6.2d-reset-mobile.png`, `phase-6.2d-reset-desktop.png`. Các server/browser/pool do script kiểm thử mở đã được đóng.

Commands:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run db:validate
npm.cmd run db:check
node frontend/tests/auth.browser.cjs <duong-dan-package-playwright> --regression
```

Playwright dùng bản cache có sẵn và Edge cài trên máy; không thêm dependency UI hay test framework. Browser suite tự mở/đóng API + Vite ở cổng tạm; database/email chỉ mock, Argon2/native HTTP/cookie là thật. SMTP integration dùng Nodemailer thật với SMTP server giả lập chỉ loopback trong test, không gửi Internet.

Các ca kiểm tra: known/unknown response giống nhau, email sai, limits, email disabled/provider failure, random/token hash/TTL/new invalidates old, wrong/expired/reused token, Argon2 old/new password, đúng User/session revocation/rollback, concurrent single-use, token hết hạn trong lúc hash và token mới thay token lúc request cũ đang chạy, login/reset race, CSRF/Origin/media/body/method, no secrets trong response/logs. Browser kiểm tra navigation, form validation/show-hide/focus, loading/chặn double submit/429/network retry, URL/history/storage/referrer, no third-party, responsive 1440/1024/768/390/320.

Hồi quy browser: Register/Login/Me/Logout, Header/return path/AuthProvider stale responses, trang chủ/search/filter/sort/lastUpdated, details/Back/Forward/refresh/404/loading/Retry/trailer/recommendations, compact layout và cast. Không dùng email/password người dùng thật để kiểm thử đổi mật khẩu.

Chưa xác minh SMTP provider Internet/inbox delivery, Mailpit Docker thực tế, hoặc race trên PostgreSQL bằng tài khoản thật. Automated auth positive tests dùng DB mock; không khẳng định đã reset tài khoản thật. Mailpit/provider cần người dùng cấu hình và thử với tài khoản thử nghiệm.

## Thứ tự đọc và bài tập

Đọc `AuthForm.tsx` (link) → `App.tsx` (routes) → `ForgotPasswordPage.tsx` → `services/auth.ts` → `password-reset-routes.mjs` → `password-reset-service.mjs` → `reset-email.mjs` → `resetToken.ts` + `main.tsx` → `ResetPasswordPage.tsx` → các test recovery.

1. Trong `PasswordRecoveryLayout.tsx` và `Auth.css`, đổi nội dung editorial và khoảng cách mobile, giữ focus ring và kiểm tra 320px không tràn ngang.
2. Trong hai page recovery, thêm mô tả trợ giúp phù hợp trạng thái (đang gửi/thành công/lỗi) bằng aria-describedby/role=status; không hiển thị token hoặc xác nhận email tồn tại.
3. Trong `passwordRecovery.test.ts` và `password-reset.test.mjs`, thêm ca Unicode password có đúng 128 ký tự và email trộn hoa/thường; giữ nguyên policy/TTL/khóa transaction.

Dừng tại Phase 6.2D.
