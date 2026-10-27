# Phase 6.4C — Change Password & Account Security

Người đã đăng nhập đổi mật khẩu tại `/profile` → **Bảo mật tài khoản → Đổi mật khẩu**. Backend xác minh mật khẩu hiện tại, hash mới bằng Argon2id và thu hồi toàn bộ session của User. Frontend xóa Auth state và về Login sau HTTP 204; không tự đăng nhập lại.

Không thay đổi Prisma schema/migration, không thêm dependency, không đổi email/avatar, không commit/push. Không đổi mật khẩu tài khoản thật để kiểm thử. Những chỉnh sửa người dùng thực hiện riêng trong `.env.example` được giữ nguyên, không thuộc triển khai này.

## File tạo/sửa

| File | Thay đổi |
| --- | --- |
| `backend/auth/password-policy.mjs` **mới** | Policy thuần dùng chung, giữ nguyên độ dài/Unicode/whitespace |
| `backend/auth/validation.mjs` | Register/Login dùng helper chung; không đổi policy |
| `backend/auth/password-reset-service.mjs` | Chỉ tái sử dụng helper validation, không đổi reset transaction/email flow |
| `backend/profile/change-password-service.mjs` **mới** | Validate, verify, hash, User/Session locks, CAS và transaction thu hồi |
| `backend/profile/change-password-routes.mjs` **mới** | POST, session/CSRF/Origin, limit/concurrency/body, 204 + clear cookie |
| `backend/server.mjs` | Dispatch endpoint trước Profile handler chung |
| `backend/tests/change-password.test.mjs` **mới** | 23 backend tests |
| `backend/tests/helpers/account-database.mjs` **mới** | DB fixture RAM có transaction rollback, Session lock và password CAS |
| `frontend/src/types/passwordChange.ts` **mới** | Kiểu input/values/errors/API |
| `frontend/src/utils/passwordChangeForm.ts` **mới** | Reuse policy form hiện có, confirm và Login notice boolean |
| `frontend/src/services/passwordChange.ts` **mới** | POST qua sessionRequestInit, strict 204, safe field errors |
| `frontend/src/components/ChangePasswordSection.tsx` **mới** | Form Profile Security, show/hide, errors/pending/cancel |
| `frontend/src/contexts/AuthProvider.tsx`, `auth-context.ts` | Thêm password-change vào cùng mutex/version/abort/session state của Login/Logout |
| `frontend/src/App.tsx` | Điều hướng Login và chuyển notice; giữ cờ đến khi Router xác nhận location |
| `frontend/src/components/AuthForm.tsx` | Hiển thị notice thành công trên Login; không nhận password mới |
| `frontend/src/components/AccountMenu.tsx` | Disable Logout trong khi đổi mật khẩu |
| `frontend/src/pages/ProfilePage.tsx`, `.css` | Security card; ngăn submit tên và password chồng nhau; focus/responsive |
| `frontend/tests/passwordChange.test.ts` **mới** | 13 frontend unit/service tests |
| `frontend/tests/changePassword.browser.cjs` **mới** | 7 nhóm browser integration, real HTTP/session/Argon2 với DB mock |
| `frontend/tests/authProvider.browser.tsx` | Harness kiểm tra Me đến muộn sau đổi mật khẩu |
| `README.md`, tài liệu này | Phạm vi, chạy thử và kết quả |

## API contract

**POST `/api/profile/change-password`**, không query parameters. Chỉ nhận hai field:

```json
{
  "currentPassword": "example-current-password",
  "newPassword": "example-new-password"
}
```

Đây chỉ là minh họa request; không có mật khẩu mặc định. Không gửi `confirmPassword`, userId, email, role hoặc field khác; field dư bị 400.

Yêu cầu session còn hiệu lực và `X-Cineverse-CSRF: 1`, Content-Type JSON. Browser gọi relative URL qua Vite/reverse proxy cùng origin; cookie HttpOnly được gửi bằng credentials same-origin, không đọc cookie bằng JavaScript. Giữ nguyên exact Origin allowlist/fetch metadata/HttpOnly/SameSite/Secure policy hiện có, không bật CORS/JWT.

- currentPassword: string **1–128 Unicode code points**, cùng giới hạn Login.
- newPassword: string **12–128 Unicode code points**, cùng policy Register/Reset.
- Không trim, Unicode-normalize hoặc tự đổi khoảng trắng trong password. Không thêm complexity rules khác với policy đã có.
- Body cap 16 KB; timeout đọc 10 giây; JSON/UTF-8 strict, không compression theo HTTP utility hiện có.
- Rate limit: **10 request/IP/15 phút** và **5 request/User/15 phút**, kể cả nhập sai mật khẩu. IP từ socket, không tin X-Forwarded-For. Limiter bounded Map, một process.
- Tối đa **2** request đổi mật khẩu đang verify/hash/transaction trong một process; quá mức trả 429 AUTH_BUSY, Retry-After=1. Không chạy Argon2 trong transaction.

Thành công: **204 No Content**, body rỗng; Set-Cookie xóa cookie hiện tại bằng helper đang dùng, có HttpOnly/SameSite=Lax/Max-Age=0/Expires cũ và Secure ở production. Cache-Control=no-store, nosniff và no-referrer. Không trả User/passwordHash/session token, không phát session mới.

| Status | Code | Hành vi |
| --- | --- | --- |
| 400 | VALIDATION_ERROR / INVALID_JSON / INVALID_QUERY | Body/type/length/field/query sai |
| 400 | CURRENT_PASSWORD_INCORRECT | Mật khẩu hiện tại sai; field currentPassword, giữ session hiện tại |
| 400 | PASSWORD_REUSED | Verify password mới trùng password hiện tại; field newPassword |
| 401 | UNAUTHENTICATED | Cookie/session/User không hợp lệ, đã bị thu hồi/hết hạn hoặc snapshot hash không còn đúng |
| 403 | CSRF_REJECTED / ORIGIN_FORBIDDEN | Theo security helper hiện có |
| 405 | METHOD_NOT_ALLOWED | Chỉ POST; có Allow: POST |
| 408 / 413 / 415 | REQUEST_TIMEOUT / PAYLOAD_TOO_LARGE / UNSUPPORTED_MEDIA_TYPE | Body utility |
| 429 | RATE_LIMITED / AUTH_BUSY | Có Retry-After, không auto retry |
| 500 / 503 | INTERNAL_ERROR / AUTH_UNAVAILABLE | Lỗi được sanitize, không raw SQL/stack/connection info |

Lỗi theo `{ "error": { "code", "message", "fields"? } }`. Frontend chỉ dùng safe messages do client định nghĩa, chỉ nhận field errors currentPassword/newPassword, không echo nội dung provider.

## Quy trình đổi mật khẩu

```mermaid
sequenceDiagram
  participant UI as Profile Security
  participant API as Node API
  participant DB as PostgreSQL
  UI->>API: POST currentPassword + newPassword, cookie + CSRF
  API->>API: Check Origin/rate/session/body, recheck session
  API->>DB: Select passwordHash của User hiện tại
  API->>API: Verify current, verify new khác current, hash Argon2id
  API->>DB: BEGIN; lock User rồi Session
  API->>DB: Conditional UPDATE theo id + hash đã xác minh
  API->>DB: DELETE sessions và reset tokens của User; COMMIT
  API-->>UI: 204 + clear cookie
  UI->>UI: Clear Auth/Favorites, clear form, Login + notice
```

User ID chỉ lấy từ `sessions.currentUser(readSessionToken(...))`. Handler kiểm tra lại session sau khi đọc body, để client upload chậm rồi logout/expiry không đi tiếp vào hashing. Service chọn duy nhất passwordHash của User đó, không đọc email/hash của User khác.

`verifyLoginPassword` dùng Argon2 verify cho password hiện tại; sau đó verify password mới với hash cũ để reject reuse. Salt làm hai hash của cùng password có thể khác nhau, nên không so sánh hai hash để kiểm tra reuse. `hashRegistrationPassword` giữ nguyên Argon2id/random salt/hashLength/config; mặc định memoryCost=19456 KiB, timeCost=2, parallelism=1. Không log password/hash/token/cookie.

## Session revocation, concurrency và rollback

Sau verify/hash ngoài transaction, service mở interactive transaction (maxWait=5s, timeout=10s):

1. `SELECT User.id ... FOR UPDATE` theo đúng khóa và thứ tự đang dùng bởi Login/Reset.
2. `SELECT Session.id ... FOR UPDATE` theo userId + SHA-256 token + expiresAt>now. Logout hoàn tất trước bước này hoặc expiry khi chờ/hash khiến 401. Session row lock tuần tự hóa Logout với write.
3. `user.updateMany` WHERE id và **hash đã xác minh trước đó**; count phải bằng 1. Đây là compare-and-set chống snapshot mật khẩu cũ. Không dùng phép so sánh hash này cho reuse.
4. Xóa toàn bộ Session của User, gồm phiên hiện tại; xóa PasswordResetToken của User để recovery link đã phát hành trước đó không đổi mật khẩu lần nữa.
5. Commit; lỗi ở bất kỳ bước nào rollback cả hash và các lần xóa. Không xóa User/Favorite hoặc thay name/email/createdAt. updatedAt được Prisma cập nhật như bình thường.

Hai request cùng biết password cũ chỉ một request có thể thắng; request còn lại không còn session/hash phù hợp. Login cũ đang verify trước password change vẫn phải kiểm tra hash trong User lock khi tạo session (cơ chế đã có), nên không tạo được session từ snapshot hash cũ sau đó. Reset và phát hành recovery token tiếp tục dùng User lock hiện có.

Thiết kế tái sử dụng active session/current-password verification và session invalidation theo [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html). Verify/hash nằm ngoài transaction để giảm thời gian giữ lock, theo [Prisma 7 transactions](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions). Không đổi password policy hoặc cookie flags theo hướng yếu hơn.

## UI và Auth state

Security card dùng cùng ivory/olive/serif với Profile; form được mở chủ động. Có current/new/confirm, toggle riêng mỗi field, labels/hints/aria-invalid/aria-pressed, error role alert, loading aria-busy, touch target và focus ring cho cả cụm input/toggle. Không dùng HTML maxLength đếm UTF-16 để cắt Unicode sai policy. Confirm chỉ phục vụ UX, không gửi server.

Password chỉ nằm trong local state của form, không lấy từ state của AuthForm/Provider khác; không lưu storage/URL, không ghi logs. Hủy/xác nhận thành công xóa values/show state; rời trang/logout unmount form. JavaScript không cung cấp bảo đảm zero-memory cho immutable strings, nhưng UI/storage/URL không giữ password sau thành công.

AuthProvider thêm action password-change vào cùng mutation mutex, generation, AbortController và setState guest đang dùng cho Login/Logout. Không gọi thêm POST Logout sau 204: server đã thu hồi sessions và clear cookie; request thứ hai có thể lỗi mạng và gây báo sai. Chỉ 204 được coi là thành công; 200/malformed/network giữ trạng thái chưa được xác nhận. Wrong-password 400 giữ User; 401 chuyển guest; lỗi 429/500/503 hiển thị an toàn để thử lại.

Sau 204, User/Favorites state bị clear, App điều hướng Login với boolean notice và from=/profile. Cờ thành công chỉ được acknowledge khi Router đã thực sự ở Login với đúng state, tránh Profile guest redirect làm mất notice. Luồng này vẫn hoàn tất nếu rời Profile khi request đang chạy. Me đến muộn không khôi phục User cũ. Login hiển thị đúng **“Đổi mật khẩu thành công. Vui lòng đăng nhập lại.”**, password input trống và không tự login.

Không cho save tên và password/Logout chồng nhau từ UI. Menu/navigation còn lại giữ nguyên. Các tab/thiết bị khác bị server từ chối session cũ ở request kế tiếp; không thêm realtime broadcast trong phase này.

## Kết quả kiểm thử

| Kiểm tra | Kết quả |
| --- | --- |
| Backend tests mới | **23/23 đạt** |
| Frontend unit/service mới | **13/13 đạt** |
| Toàn bộ `npm.cmd test` | **287/287 đạt**: 187 backend + 100 frontend, không fail/skip |
| Change Password browser | **7 nhóm đạt**: form/validation/toggle, sai password/reuse, pending/errors, responsive, native 204 + all-session revoke + Login, rời trang trong request, stale Me |
| Profile browser | 10 nhóm hồi quy đạt |
| Favorites browser | 12 nhóm hồi quy đạt |
| Auth/movie/recovery regression | Đạt Register/Login/Logout/Me, AuthProvider, Forgot/Reset, Home/filters/Details/compact/cast |
| Auth layout regression | Đạt bốn trang ở 320/375/768/1024/1440/1920px |
| Lint / TypeScript / build | Đạt |
| Database validate/check + read-only drift | Đạt, không drift; giữ nguyên 4 migrations |
| PostgreSQL counts trước/sau | User 3→3, Session 1→1, PasswordResetToken 1→1, Favorite 3→3 |
| Probe Prisma thật + pg adapter + PGlite RAM | Đạt password update/revocation/owner/Favorites và rollback transaction thật |

Backend tests có wrong/weak/reused/type/strict fields; CSRF/Origin/rate/body/method; Argon2id và bảo toàn whitespace; old/new login; cookie clear và session A/B; expiry/logout trong upload/hash; hai request đồng thời/CAS; rollback lỗi database, safe errors/logs và Forgot/Reset links. Frontend/browser kiểm tra no false success, values/storage/URL, global logout/notice và password không xuất hiện trên Login.

Mọi positive change-password test chạy với accounts/DB mock hoặc PostgreSQL WASM RAM. Không đổi mật khẩu, xóa User/Favorite/Session/ResetToken trên PostgreSQL thật. Kết nối thật chỉ đọc metadata/counts/history/drift bằng config runtime; không mở/in `.env`. Probe/ad-hoc artifacts ở .npm-cache được ignore, không thêm dependency hoặc generated Prisma Client vào Git.

Screenshot local chỉ dùng fixture và password fields đã được xóa/trả type=password trước khi chụp: `.npm-cache/phase-6.4c-screenshots/security-{375,768,1024,1440}.png`. Đã kiểm tra không tràn ngang, labels/focus/toggle và nút cảm ứng ở bốn kích thước. Không screenshot/trace giá trị password hoặc upload artifacts này.

```powershell
node --test backend/tests/change-password.test.mjs
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run db:validate
npm.cmd run db:check
node frontend/tests/changePassword.browser.cjs <path-to-playwright>
node frontend/tests/profile.browser.cjs <path-to-playwright>
node frontend/tests/favorites.browser.cjs <path-to-playwright>
node frontend/tests/auth.browser.cjs <path-to-playwright> --regression
node frontend/tests/authLayout.browser.cjs <path-to-playwright>
```

## Tự kiểm tra với tài khoản test

Tại thư mục gốc, bật PostgreSQL theo cấu hình hiện có, Ctrl+C server cũ rồi chạy `npm.cmd run dev` (backend chưa auto reload). Không cần migration/package mới.

1. Dùng **tài khoản test riêng của bạn** Login → menu Hồ sơ cá nhân → Bảo mật tài khoản → Đổi mật khẩu.
2. Thử thiếu/không khớp confirm, show/hide và nhập sai password hiện tại; phải thấy lỗi và vẫn giữ phiên.
3. Nhập đúng password hiện tại, password mới đạt policy và confirm khớp. Sau xác nhận phải về Login với notice, không còn giá trị password từ form trước.
4. Login bằng password cũ phải thất bại, password mới thành công. Profile/Favorites phải còn nguyên. Dùng một browser context/thiết bị khác đã Login cùng tài khoản để kiểm tra Me/Favorites/Profile trả 401 sau đổi.
5. Kiểm tra User B vẫn có session và dữ liệu riêng. Không dùng token/hash từ pgAdmin để giả lập session; không chạy SQL chỉnh password hoặc xóa data để thử.

Các bước này **sẽ đổi password tài khoản test khi bạn tự thao tác**; agent không thực hiện với tài khoản thật. Không đưa password/cookie/token vào chat, URL, console hoặc screenshot. Ở production giữ HTTPS và cookie Secure theo cấu hình hiện có; chưa triển khai hosting trong phase này.

## Giới hạn

- Policy giữ nguyên 12–128 code points; không thêm MFA/breach-password checking hoặc complexity rules mới.
- Limiter và maxConcurrent áp dụng một process; chưa có distributed limiter hay realtime logout giữa tabs.
- Request mất mạng sau commit có kết quả chưa xác nhận trên UI: kiểm tra phiên và đăng nhập lại; không hứa rollback server khi client abort.
- Session revoke chặn mọi request xác thực mới sau commit. Các thao tác đã được chấp nhận/SQL đã chạy trước thời điểm thu hồi không có cơ chế hủy ngược toàn hệ thống; không thêm session locking vào mọi endpoint khác trong phase này.
- Chưa gửi email thông báo đổi password, không thêm schema/audit table hoặc password history. Không có default credentials.

Dừng tại Phase 6.4C, không commit/push.
