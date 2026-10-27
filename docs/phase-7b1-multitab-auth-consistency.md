# Phase 7B.1 — Multi-tab authentication consistency

Ngày triển khai/kiểm tra: 28/10/2026. Phạm vi: sửa H01 trong Phase 7A; không triển khai các mục audit khác.

## 1. Nguyên nhân gốc

Cookie session được browser chia sẻ giữa các tab cùng origin, còn React Context/state thuộc riêng mỗi tab. Trước đây tab A có thể giữ `user.id=A`, trong khi tab B đăng nhập B làm cookie hiện tại thuộc B. Request Favorite từ A chỉ mang cookie, không có precondition về tài khoản đang hiển thị; backend xác thực B và ghi vào B đúng theo cookie nhưng sai với ý định của UI A.

Chỉ thêm BroadcastChannel hoặc GET Me trước POST không đủ: tab có thể bỏ lỡ thông báo; cookie có thể đổi sau Me nhưng trước lúc browser gửi POST.

## 2. Thiết kế giải pháp

### 2.1. Backend xác minh account precondition cho chính request

Header mới:

```http
X-Cineverse-Account: <id của tài khoản UI đang thao tác>
```

Đây là **điều kiện khớp tài khoản**, không phải token đăng nhập, không phải nguồn phân quyền và không phải tên userId để backend chọn bản ghi.

Backend thực hiện:

```text
Origin/CSRF policy như cũ
→ lấy token từ HTTP-only cookie của request
→ xác thực session và lấy user thực tế từ database
→ so sánh X-Cineverse-Account với user.id vừa xác thực
→ chỉ gọi service bằng user.id từ session
```

Invariant: với mọi private request được chấp nhận, **expected UI account = authenticated cookie owner = service/query owner**. Header chỉ có thể hạn chế request, không thể cấp thêm quyền. Cookie A + header B không truy cập được B; header A mà không có session vẫn 401. Không suy luận owner từ body/query/header để query database.

Đã áp dụng cho:

| Endpoint | Mục đích |
| --- | --- |
| GET /api/favorites | Không tải dữ liệu B vào collection đang mang owner A |
| POST /api/favorites | Không thêm Favorite vào tài khoản khác với UI |
| DELETE /api/favorites/:movieId | Không xóa Favorite của B khi UI A chọn cùng movieId |
| GET /api/profile | Ràng buộc profile read với account UI |
| PATCH /api/profile | Không cập nhật tên B từ form A |
| POST /api/profile/change-password | Chặn mismatch trước password verification/hash/write |
| POST /api/auth/logout | Không revoke/clear cookie B bằng nút Logout đang hiển thị A |

Thiếu/sai header trong một session hợp lệ trả **403 SESSION_CHANGED**, không trả ID tài khoản thực tế, không chạy private service và không Set-Cookie. Guest/revoked/expired session vẫn được kiểm tra bằng cơ chế session hiện hữu. Logout khi session đã mất/hết hạn giữ tính idempotent; nếu session còn hợp lệ thì bắt buộc match account.

Login/Me/Register/Forgot/Reset không cần account header: Login xác thực thông tin riêng; Me là nguồn để xác định session hiện tại; Reset sử dụng reset token một lần. Không thêm migration, secret, session token mới hoặc thay đổi cookie flags, CSRF/Origin policy.

**Tính nguyên tử cần thiết:** cookie và expected-account được backend đọc từ cùng một HTTP request. Nếu browser chọn cookie B sau lần Me A, header A vẫn làm request bị từ chối. Nếu request đã được gửi với cookie A, nó chỉ có thể xử lý dưới A; cookie mới ở browser không làm request đang chạy chuyển sang B. Không có bước preflight Me bắt buộc trước mỗi write.

Đây là binding ở mức **account của session đã xác thực**, không phải pin vào một cookie/token cụ thể: đăng nhập lại cùng user bằng session khác vẫn khớp account. Việc hết hạn/thu hồi session tiếp tục do verifier và các write guards hiện hữu xử lý.

### 2.2. AuthProvider điều phối đồng bộ giữa tab

`authSync.ts` mở BroadcastChannel `cineverse-auth-v1`, đồng thời phát storage event cho tab không hỗ trợ BroadcastChannel. Payload do ứng dụng gửi chỉ có:

```json
{ "type": "session-change", "nonce": "<random event identifier>" }
```

Không chứa userId, tên/email, token, cookie, password, hash hay dữ liệu Profile/Favorites. Storage key `cineverse.auth-change` được xóa ngay sau setItem; không giữ token/identity trong localStorage/sessionStorage. Nonce chỉ để loại thông báo trùng, không dùng để authentication.

Thông báo được phát sau Login/Logout/Change Password thành công; Reset Password thành công cũng phát tín hiệu. Nhận thông báo chỉ làm kiểm tra lại Me, tuyệt đối không lấy user từ message. Broadcast/storage không khả dụng hoặc bị chặn không làm ứng dụng crash.

AuthProvider đồng thời nghe window focus và document visibility trở lại visible. Đây là đường khôi phục khi bỏ lỡ broadcast, tab ngủ hoặc cookie được thay từ một luồng không phát tín hiệu.

### 2.3. Epoch, cancellation và trạng thái chưa xác minh

- Khi có dấu hiệu session thay đổi, tăng `sessionEpoch` và request version **đồng bộ qua ref**; không phải đợi Effect chạy mới vô hiệu hóa callback cũ.
- Tạm ẩn user/private UI khi chưa xác minh, hiển thị loading; nếu Me lỗi thì giữ trạng thái chưa xác minh với Retry. Không dùng user cũ để cho phép thao tác tài khoản trong tình huống này.
- FavoritesProvider đối chiếu cả owner và epoch; cleanup hủy GET/mutations, xóa pending IDs, không phục hồi collection từ response cũ. `useFavoriteMovies` tiếp tục nhận owner từ AuthProvider và dùng cache owner-scoped hiện có.
- ProfilePage key theo userId + epoch; useProfile cũng lưu epoch trong snapshot. Form/feedback của account trước được bỏ đi; request cũ không xác nhận saved sau khi đổi owner/epoch.
- Các callback thành công kiểm tra generation/epoch/alive; AbortController chỉ là tối ưu hủy, không phải lớp bảo đảm duy nhất.
- Auth mutation hiện tại không được thay bằng một mutation khác. Nếu có external change lúc Login/Logout/Change Password đang pending, kết quả cũ không ghi state; sau khi mutation settle sẽ đọc Me lại để xác định cookie thực tế. Không replay write tự động.
- Callback Logout/Change Password giữ account + epoch của lần render tạo ra nó. Nếu callback A bị giữ lại rồi được gọi sau khi Context đã thành B, nó bị từ chối trước HTTP; không đọc “user mới nhất” để tự chuyển thao tác cũ sang B.

Thông báo toàn cục dùng AuthSessionNotice hiện có để yêu cầu kiểm tra lại và thử thao tác lại. Layout/CSS Login/Register không thay đổi.

### 2.4. Không tạo vòng lặp refresh

- Focus/visibility và channel/storage events trùng được debounce 60 ms; mỗi read đang chạy được dùng chung Promise khi phù hợp. Không polling.
- Đọc Me không broadcast ngược trở lại; không có vòng broadcast → Me → broadcast.
- 401 hoặc 403 **SESSION_CHANGED** từ private operation làm kiểm tra lại identity. 403 CSRF_REJECTED/ORIGIN_FORBIDDEN thông thường vẫn là lỗi thao tác, không tự refresh/replay.
- Nếu endpoint liên tục từ chối cùng account sau lần kiểm tra lại, dừng tự refresh, ẩn private UI và yêu cầu Retry thủ công. Không lặp Me → reload Favorites → 403 → Me vô hạn.
- DTO Profile sai owner được phân biệt bằng PROFILE_OWNER_MISMATCH; không đưa dữ liệu đó vào UI và chỉ kiểm tra lại Me, không tạo chuỗi remount/refetch vô hạn vì một response sai định dạng.

## 3. Những file được tạo/sửa

| Nhóm | File |
| --- | --- |
| Backend mới | backend/auth/account-binding.mjs; backend/tests/account-binding.test.mjs |
| Backend routes | backend/auth/session-routes.mjs; backend/favorites/favorite-routes.mjs; backend/profile/profile-routes.mjs; backend/profile/change-password-routes.mjs |
| Backend fixtures/regression | backend/tests/helpers/auth-fixture.mjs; backend/tests/favorites.test.mjs; backend/tests/profile.test.mjs; backend/tests/change-password.test.mjs; backend/tests/session.browser.mjs |
| Frontend mới | frontend/src/services/authSync.ts; frontend/tests/sessionBinding.test.ts; frontend/tests/multitabAuth.browser.cjs |
| Auth/context | frontend/src/contexts/AuthProvider.tsx; frontend/src/contexts/auth-context.ts; frontend/src/components/AuthSessionNotice.tsx |
| Private data | frontend/src/contexts/FavoritesProvider.tsx; frontend/src/hooks/useProfile.ts; frontend/src/pages/ProfilePage.tsx |
| Recovery notification | frontend/src/pages/ResetPasswordPage.tsx |
| API/types | frontend/src/services/sessionHttp.ts; frontend/src/services/auth.ts; frontend/src/services/favorites.ts; frontend/src/services/profile.ts; frontend/src/services/passwordChange.ts; frontend/src/types/auth.ts; frontend/src/types/favorites.ts; frontend/src/types/profile.ts; frontend/src/types/passwordChange.ts |
| Frontend regression | frontend/tests/favorites.browser.cjs; frontend/tests/profile.browser.cjs; frontend/tests/profileHook.browser.tsx; frontend/tests/authProvider.browser.tsx |
| Tài liệu mới | docs/phase-7b1-multitab-auth-consistency.md |

Fixtures được cập nhật để gửi precondition hợp lệ; tests mới chủ động gửi header thiếu/sai để kiểm tra fail-closed. Hai assertion browser cũ được điều chỉnh theo hành vi an toàn mới: private UI bị ẩn trong lúc kiểm tra lại, thay vì giữ private error/state cũ.

Các thay đổi có sẵn không thuộc Phase này được giữ nguyên: khoảng trắng trong backend/.env.example và tài liệu audit Phase 7A đang untracked. Không thay `.env`, database configuration/schema/migrations, TMDB endpoints, router hoặc CSS Login/Register.

## 4. Kết quả kiểm thử

### Automated

- **300/300 tests đạt**: backend **197**, frontend **103**, không fail/skip/cancelled. Tăng 10 backend tests và 3 frontend tests so với baseline 287.
- Backend tests mới kiểm tra 7 endpoint với cookie B/header A, không chạy private work, không clear B cookie; header thiếu/sai; header không thể authenticate; cookie A/header B không chọn owner B; CSRF/Origin vẫn bắt buộc.
- Frontend tests mới kiểm tra 7 lời gọi private API giữ credentials/CSRF/deadline và body allowlist, truyền account header; phân biệt SESSION_CHANGED với 403 thường; không hiển thị error text nội bộ.

### Browser

`multitabAuth.browser.cjs`: **22 nhóm checkpoint đạt**, Microsoft Edge headless qua Playwright. Hai tab thuộc **cùng browser context** để thực sự dùng chung cookie; contexts riêng được dùng cho các trường hợp fallback, không giả định các contexts độc lập tự chia cookie.

| Yêu cầu | Bằng chứng |
| --- | --- |
| Hai tab cùng A | Cả hai tải Profile A/count bằng session thật trong fixture |
| Tab B logout/login B | Tab A chuyển guest rồi canonical B, không còn dữ liệu A |
| Favorite sau khi B login | POST và DELETE bị 403 SESSION_CHANGED khi UI còn A; B không bị thêm/xóa dữ liệu |
| Profile đang mở/session đổi | Profile/form A được bỏ, thay bằng profile B sau Me |
| PATCH từ form A | 403 trước write; tên A/B không đổi, không saved giả |
| Change Password từ form A | 403 dù hai fixture có cùng current password; B hash/session còn nguyên |
| Logout từ UI cũ | 403, không revoke B và không clear B cookie |
| Auth response đến muộn | Me A và Login A trả muộn không ghi đè B, kể cả transport không abort |
| Stale closures | Callback Change Password/Logout được chụp khi là A không thể dùng latest B; không có HTTP write và B vẫn giữ password/session |
| Favorites response đến muộn | Các hàng A không phục hồi vào collection B |
| Focus và visibility | Khôi phục canonical session khi chủ động bỏ lỡ mọi thông báo |
| Race sau Me/trước POST | Gate network rồi thay cookie gửi đi thành B nhưng giữ header A; backend từ chối |
| Không BroadcastChannel | Storage event vẫn đồng bộ Logout/Login |
| Không channel lẫn storage | Focus fallback vẫn hoạt động, backend precondition tiếp tục bảo vệ writes |
| Broadcast không phải bằng chứng auth | Message gợi ý user B không thể thay canonical Me A |
| Me 503 | Ẩn dữ liệu cũ, khóa tài khoản, không auto loop; Retry thủ công tải B |
| 401/403 | 401 đưa về guest; CSRF 403 không refresh loop; SESSION_CHANGED dai dẳng có bounded recheck |
| Không leak/persist secret | Outgoing signals chỉ type/nonce; localStorage/sessionStorage không giữ entries; không page errors |

Các regression hiện có cũng đạt: Auth + Recovery + AuthProvider + Details/compact/cast (`auth.browser.cjs --regression`); Favorites **12** nhóm; Profile **10** nhóm; Change Password **7** nhóm; native session browser xác nhận HTTP-only cookie và cross-origin/preflight vẫn bị chặn.

### Quality/database

- Lint **Oxlint**, TypeScript check và production build: đạt.
- `npm.cmd run db:validate`: schema hợp lệ.
- `npm.cmd run db:check`: PostgreSQL local 17.11, model/constraints/index/FK nhận diện đúng, chỉ đọc metadata/count. Không chạy migration/reset/cleanup/ghi dữ liệu thật.
- Browser regression hiện có kiểm tra responsive 375/768/1024/1440 cho Auth/Profile/Favorites/Security cùng các kích thước bổ sung của compact/cast. Suite đa tab chính chạy 1440px; không tuyên bố đã thử mọi browser/thiết bị.
- Tài khoản, password, session và write trong tests đều thuộc fixture RAM; không đổi dữ liệu người dùng thật.
- Quét source/index/lịch sử Git local bằng scanner hiện có: không phát hiện secrets; các signal/cookie fixture không được đưa vào tài liệu hoặc log credentials thật.

Lệnh chạy từ root (đường dẫn Playwright cục bộ có thể thay):

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run db:validate
npm.cmd run db:check

$playwrightPath = 'D:\LearnReact\Cineverse\.npm-cache\_npx\e41f203b7505f1fb\node_modules\playwright'
node frontend/tests/multitabAuth.browser.cjs $playwrightPath
node frontend/tests/auth.browser.cjs $playwrightPath --regression
node frontend/tests/favorites.browser.cjs $playwrightPath
node frontend/tests/profile.browser.cjs $playwrightPath
node frontend/tests/changePassword.browser.cjs $playwrightPath
node backend/tests/session.browser.mjs $playwrightPath
```

## 5. Giới hạn và triển khai tương thích

1. **Không thể biết cookie thay đổi tức thì nếu tab không nhận tín hiệu và không focus.** Trong khoảng đó Header có thể là ảnh chụp cũ; private request sai account vẫn bị server từ chối và làm Me resync. Đây là lý do lớp backend bắt buộc, không chỉ cập nhật Header.
2. **Không hủy ngược transaction đã commit.** Request đã gửi hợp lệ bằng cookie A/header A có thể hoàn thành dưới A sau khi tab khác chuyển B; nó không được đổi owner sang B. Epoch/generation chặn response cũ cập nhật UI B sau khi frontend đã nhận biết thay đổi. Semantics revoke đối với Favorite write đang bay (M03 của audit) không được thay đổi trong Phase 7B.1.
3. HTTP response Set-Cookie đã bay có thể đến muộn giữa những auth mutation cạnh tranh. Browser không cung cấp compare-and-set cookie cho React; lần Me sau settle/focus xác minh lại cookie thực tế, có thể thành guest nếu cookie cũ đã bị revoke. Không tuyên bố giải quyết mọi thứ tự Set-Cookie hoặc đảm bảo tab B luôn giữ login khi các tab cố ý thực hiện auth mutation đồng thời. Điều này không cho phép một write UI A được thực hiện dưới owner B.
4. Account precondition không phải cơ chế chống XSS: script cùng origin đã bị chiếm quyền không nằm trong trust boundary này. Origin/CSRF/session vẫn được giữ nguyên.
5. Frontend và backend cần cập nhật cùng phiên bản. Client cũ không gửi header sẽ bị fail-closed trên private APIs; tải lại frontend khi cập nhật. curl/custom client phải lấy account từ Me/Login rồi gửi header, không được dùng nó thay cookie/CSRF.
6. No-channel/no-storage fallback không polling; nếu tab ngủ lâu thì xác minh lại khi visible/focus hoặc khi một private request phát hiện mismatch. Không tự replay thao tác vừa bị chặn: người dùng kiểm tra account rồi chủ động thử lại.

Không tự commit/push. Chưa triển khai sửa rate limiting, TMDB bounds, database roles hoặc các tính năng ngoài Phase 7B.1.

## 6. Thứ tự đọc code và tài liệu tham khảo

1. `backend/auth/account-binding.mjs` và một route như `favorite-routes.mjs`: precondition khác authorization thế nào.
2. `frontend/src/services/sessionHttp.ts`, `services/favorites.ts`: account được chụp từ caller, không lấy global “user mới nhất” giữa một thao tác cũ.
3. `services/authSync.ts`, `contexts/AuthProvider.tsx`: signals → invalidation → canonical Me; epoch khác request version; cleanup/dedupe và queued read.
4. `contexts/FavoritesProvider.tsx`, `hooks/useProfile.ts`: chống response cũ, owner/epoch scope và không báo thành công sai.
5. `frontend/tests/multitabAuth.browser.cjs`, `backend/tests/account-binding.test.mjs`: tái hiện lỗi bằng nhiều tab/cookie thật trong fixture, không dựa vào mock đổi Header đơn thuần.

Nguồn chính thức: [BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel), [storage event](https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event), [React Effect cleanup](https://react.dev/reference/react/useEffect). Tín hiệu liên tab chỉ đồng bộ ứng dụng; danh tính vẫn do backend/session xác minh.
