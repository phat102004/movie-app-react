# Phase 6.4B — Profile Frontend UI

Trang `/profile` đọc hồ sơ từ backend Phase 6.4A, cho phép sửa riêng tên và đồng bộ Header qua AuthProvider. Không thêm Profile Provider toàn cục: dữ liệu chỉ dùng ở trang này nên hook + component scope đủ. Không sửa backend/schema/migration/session/CSRF/Origin policy, không thêm dependency và không commit/push.

Working tree trước khi bắt đầu đã có Phase 6.4A chưa commit. Các thay đổi backend và tài liệu 6.4A được giữ nguyên; những file đó không phải thay đổi mới của phase frontend.

## File tạo mới

| File | Trách nhiệm |
| --- | --- |
| `frontend/src/types/profile.ts` | Profile DTO kế thừa AuthUser, API interface |
| `frontend/src/utils/profileForm.ts` | Quy tắc tên khớp backend: trim, Unicode 1–100, C0/DEL |
| `frontend/src/services/profile.ts` | GET/PATCH, runtime parser, safe errors, chỉ gửi name |
| `frontend/src/hooks/useProfile.ts` | Fetch/retry, save, busy lock, abort/generation/owner guards, refreshUser |
| `frontend/src/components/ProfileEditForm.tsx` | Draft name, readonly email, validation/accessibility và save/cancel |
| `frontend/src/pages/ProfilePage.tsx` | Protected route experience, Hero/stats/account panel, loading/error/success |
| `frontend/src/pages/ProfilePage.css` | Olive/ivory layout, responsive và focus states có scope |
| `frontend/tests/profile.test.ts` | 16 unit/service tests |
| `frontend/tests/profile.browser.cjs` | 10 nhóm browser integration, HTTP server/session thật, DB mock |
| `frontend/tests/profileHook.browser.tsx`, `.html` | Harness dev-only để kiểm tra API cố tình bỏ qua AbortSignal |
| `docs/phase-6.4b-profile-frontend.md` | Tài liệu này |

## File chỉnh sửa

| File | Thay đổi |
| --- | --- |
| `frontend/src/App.tsx` | Route `/profile` |
| `frontend/src/components/AccountMenu.tsx` | Link “Hồ sơ cá nhân”, đóng dropdown khi chọn |
| `frontend/src/components/Auth.css` | Chỉ thêm style `.account-profile-link`; không sửa Welcome Panel/form Auth |
| `frontend/src/services/sessionHttp.ts` | Cho phép method PATCH trong type của helper có sẵn; giữ nguyên request policy |
| `frontend/src/utils/authForm.ts` | Allowlist chính xác `/profile` cho return route sau Login |
| `frontend/tests/auth.browser.cjs` | Keyboard Tab đi qua link Profile mới rồi đến Logout |
| `README.md` | Phạm vi, mở trang và kết quả Phase 6.4B |

## Thiết kế và navigation

Hero nền **#4c5d46**, chữ ivory **#f6f3ed**, cùng màu Welcome Panel Login/Register. Avatar là chữ cái đầu, tên serif lớn, eyebrow “CINEVERSE / HỒ SƠ CÁ NHÂN”, description đúng yêu cầu. Hai thống kê dùng favoriteCount từ GET và createdAt format vi-VN theo UTC; số Favorites là Link tới `/favorites`.

Account card nền trắng có tên/email, nút Chỉnh sửa hồ sơ; form chỉ sửa name. Email dùng readOnly và không được đưa vào PATCH. Mobile Hero xếp một cột, stats nằm dưới, form rộng theo container. Tên/email dài có wrap, không ép fixed height. Các nút/input tối thiểu 44px.

Guest mở `/profile` được `<Navigate replace>` tới Login với `state.from='/profile'`; sau Login trở lại đúng trang. Return path vẫn là allowlist nội bộ, không nhận URL bên ngoài/query/fragment tùy ý. Menu Profile chỉ xuất hiện khi AuthProvider có User; giữ nguyên Logout, Favorites và các navigation khác.

## Luồng dữ liệu và HTTP

```text
AuthProvider → ProfilePage (loading/error/guest/authenticated)
  → ProfileContent key=user.id
     → useProfile → profileService.get → GET /api/profile
     → Hero + Statistics + Account panel
     → ProfileEditForm → validateProfileName → updateName
        → profileService.update → PATCH { name }
        → Profile DTO mới → refreshUser() → GET /api/auth/me → Header mới
```

Tái sử dụng `sessionRequestInit`: relative `/api/profile`, credentials same-origin, no-store, JSON và `X-Cineverse-CSRF: 1` cho PATCH; timeout 12 giây kết hợp AbortSignal. Browser tự gửi Origin; frontend không tạo cookie, không đọc HttpOnly token. Backend policy giữ nguyên.

Parser tái sử dụng `parseAuthUser` cho id/name/email/date, bổ sung favoriteCount là safe integer không âm và createdAt ISO canonical. Chỉ giữ **5 trường** trong DTO; passwordHash, sessions, token và các field dư bị bỏ. Không giả lập name/email/date/count khi GET lỗi. PATCH chỉ xác nhận HTTP 200 với DTO hợp lệ, đúng owner và đúng tên đã gửi; response 201/204/malformed hoặc tên khác bị coi là lỗi.

Validator dùng Array.from để đếm Unicode code points, khớp helper backend bằng parity test. Không dùng HTML maxLength=100 vì nó đếm UTF-16, có thể cắt tên 100 emoji dù backend cho phép. Trim đầu/cuối, giữ whitespace giữa tên, reject rỗng/whitespace/C0/DEL/quá 100/sai kiểu. Không thay đổi validation Login/Register hiện có.

## Save, Header sync và race condition

- Busy ref khóa ngay cả hai submit xảy ra trong cùng một tick; isSaving disable name/Save/Cancel và chờ cả PATCH + refreshUser. Không đổi tên Hero trước khi PATCH được API xác nhận.
- Sau PATCH hợp lệ, cập nhật Profile và gọi refreshUser hiện có; không sửa AuthProvider hoặc tự ghi AuthContext. Header đổi tên/initial avatar theo User DTO mới mà không reload document.
- PATCH lỗi: giữ Profile cũ, giữ draft để sửa/thử lại, không hiển thị thành công. Client chỉ dùng safe messages/field errors và Retry-After, không raw server message.
- PATCH thành công nhưng Me 503: Profile đã lưu nên vẫn báo đúng kết quả PATCH; đồng thời hiển thị notice Header chưa đồng bộ và nút chỉ gọi Me. Không tự gửi lại PATCH. AuthSessionNotice hiện có vẫn xử lý lỗi session theo convention.
- Nội dung Profile được key theo user.id; logout bắt đầu hoặc đổi owner unmount scope cũ và che dữ liệu ngay. Hook còn kiểm tra mounted/generation/signal/owner, nên response cũ không cập nhật Profile hoặc gọi refreshUser cho một save đã lỗi thời.
- DTO có id khác owner bị ẩn với SESSION_CHANGED và kiểm tra Me một lần. 401 gọi refreshUser, guest được điều hướng Login; không auto retry Profile vô hạn. Mạng/503 không bị coi là guest.
- GET chỉ chạy khi đã xác định User; StrictMode cleanup có thể hủy lượt đầu trước khi phát HTTP request. Đổi tên cùng User không remount nội dung hoặc fetch GET Profile lặp lại vì dependency là ID.

Escape/Hủy đóng form, bỏ draft và trả focus về nút Chỉnh sửa; mở form focus input tên. Labels/hints/errors gắn bằng htmlFor/id/aria-describedby; aria-invalid, aria-busy, role status/alert và focus-visible rõ ràng. Không persist Profile vào localStorage/sessionStorage hoặc log credentials.

## Kết quả kiểm thử

| Kiểm tra | Kết quả |
| --- | --- |
| `npm.cmd test` | **251/251 đạt**: 164 backend + 87 frontend, không fail/skip |
| Frontend Profile mới | **16 tests**: DTO, name parity, return URL, methods/body/cookie/CSRF, status/errors/abort, không false success |
| Profile browser integration | **10 nhóm đạt**: guest/Login return, loading/GET/stats/date, validation/PATCH/Header, refresh persistence, errors/retry, owner/races/session và responsive |
| Favorites browser | **12 nhóm đạt**, gồm A→B, late responses, cursor/metadata và UI cũ |
| Auth/movie browser regression | Đạt Register/Login/Me/Logout, AuthProvider, recovery, home/search/filters, MovieDetails/compact/cast |
| Auth layout | Đạt cả bốn trang tại 320/375/768/1024/1440/1920px; keyboard/validation/footer và không tràn |
| Lint (Oxlint) | Đạt, không warning |
| TypeScript check | Đạt |
| Production build | Đạt |

Browser test dùng native Node HTTP router và session/login/Argon2 thật, User/Session/Favorite chỉ ở RAM. Kiểm thử race inject API cố tình bỏ qua cancellation để xác nhận guard vẫn ngăn dữ liệu A ghi đè B. Không sửa tài khoản PostgreSQL thật hoặc đọc `.env`. Không tuyên bố đã PATCH tài khoản thật trong phase này.

Đã kiểm tra view và edit form ở **375/768/1024/1440px**: không cuộn ngang, đúng olive, input/touch target/focus, email readonly, không cắt 100 emoji. Screenshot là artifact **fixture local**, không phải dữ liệu tài khoản thật:

- `.npm-cache/phase-6.4b-screenshots/profile-375.png`
- `.npm-cache/phase-6.4b-screenshots/profile-768.png`
- `.npm-cache/phase-6.4b-screenshots/profile-1024.png`
- `.npm-cache/phase-6.4b-screenshots/profile-1440.png`

Các server/browser do test tạo đều đóng trong finally. Không thêm ảnh/cache vào Git; thư mục .npm-cache đã được ignore.

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
node frontend/tests/profile.browser.cjs <path-to-playwright>
node frontend/tests/favorites.browser.cjs <path-to-playwright>
node frontend/tests/auth.browser.cjs <path-to-playwright> --regression
node frontend/tests/authLayout.browser.cjs <path-to-playwright>
```

## Cách mở và tự kiểm tra

Tại `D:\LearnReact\Cineverse`, bật PostgreSQL và backend cấu hình hiện có rồi chạy:

```powershell
npm.cmd run dev
```

Nếu server cũ còn chạy, Ctrl+C rồi chạy lại để nhận backend Phase 6.4A. Mở URL Vite thông báo (thường http://localhost:5173), Login → menu tài khoản → Hồ sơ cá nhân; hoặc mở `/profile` trực tiếp. Không cần migration/package mới.

Với tài khoản test riêng của bạn: chỉnh tên → Lưu thay đổi → kiểm tra Header và reload để xác nhận persistence; thử tên rỗng/quá dài, Hủy/Escape và thao tác keyboard. Logout/Login tài khoản B để kiểm tra tách dữ liệu. Các thao tác PATCH khi **bạn tự chạy** sẽ lưu tên trong PostgreSQL qua API; agent không thực hiện với tài khoản thật.

## Giới hạn hiện tại

Chỉ xem hồ sơ và cập nhật tên. Không đổi email/mật khẩu/avatar, không có Profile public của User khác. favoriteCount là snapshot GET/PATCH, chưa đồng bộ realtime giữa tabs/thiết bị. Dữ liệu chỉ giữ RAM trong vòng đời trang; mở lại/refresh sẽ đọc backend.

Nếu mất mạng sau khi server đã ghi nhưng trước khi nhận response, client có thể chưa biết kết quả: tải lại trang để kiểm tra. Cleanup hủy/bỏ qua kết quả UI, không bảo đảm đảo ngược một write server đã commit. Không dùng optimistic concurrency/ETag; hai phiên sửa tên đồng thời vẫn theo hành vi backend.

Thứ tự đọc: `types/profile.ts` → `utils/profileForm.ts` → `services/profile.ts` → `hooks/useProfile.ts` → `pages/ProfilePage.tsx` → `components/ProfileEditForm.tsx` → các tests. Những kiến thức mới tập trung ở protected routing, runtime DTO validation, scope theo owner và quản lý I/O; không thêm thư viện state/UI mới.

Dừng tại Phase 6.4B, không commit/push hoặc phát triển tính năng khác.
