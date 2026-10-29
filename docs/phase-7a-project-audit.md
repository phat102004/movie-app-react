# Phase 7A — Full Project Audit

Ngày kiểm tra: **28/10/2026**. Source baseline: `c1beb6a` trên `main`.

## 1. Executive summary

Cineverse có nền tảng tốt để tiếp tục hoàn thiện: tách UI/hook/service/mapper rõ ràng, session phía server, DTO allowlist, Argon2id, bảo vệ Origin/CSRF, migration có guard và nhiều bài kiểm thử âm tính. Kiểm tra lại hiện tại đạt **287 automated tests**, lint, TypeScript, build và các bộ browser regression được nêu bên dưới.

**Chưa nên mở production công khai với nguyên cấu hình hiện tại.** Audit ghi nhận **0 Critical, 4 High, 4 Medium, 2 Low**. Trong đó có lỗi hành vi đã tái hiện, thiếu biện pháp giới hạn tài nguyên đã kiểm chứng và rủi ro cấu hình deployment có điều kiện; không đồng nhất tất cả thành lỗ hổng đã bị khai thác.

Ưu tiên xử lý: tài khoản giữa nhiều tab không đồng bộ; rate limit bị gộp theo IP proxy; TMDB proxy chưa có giới hạn tổng; không mang quyền superuser database local sang production. Không phát hiện truy cập chéo dữ liệu bằng cách giả `userId` trong các luồng một session được kiểm thử.

Phase này **không sửa application code, API contract, UI, credentials hay database**. Chỉ thêm tài liệu này; các probe kiểm chứng nằm trong `.npm-cache/` đã được ignore. Không commit/push.

## 2. Phạm vi và phương pháp

- Đọc router, các pages/components liên quan Auth/Profile/Favorites/Details; `AuthProvider`, `FavoritesProvider`, `useMovies`, `useMovieDetails`, `useFavoriteMovies`, `useProfile`; API services, validators, mappers và timeout/cleanup.
- Đọc toàn bộ các nhóm route/service backend: Register, Login/Me/Logout, Forgot/Reset, Change Password, Profile, Favorites, TMDB; utilities HTTP, cookie, rate limit và cấu hình mail/database.
- Đối chiếu Prisma schema, bốn migration, migration guards, lifecycle client/pool; chạy metadata/checksum/drift checks **chỉ đọc** trên PostgreSQL local.
- Chạy suites hiện có và probe bổ sung với tài khoản, HTTP server, mail, upstream và database giả/RAM. Không gửi email thật, không đổi mật khẩu thật, không ghi vào database local để tái hiện lỗi.
- Quét source/docs/tests/templates, index và lịch sử Git local khả dụng. Không in giá trị `.env`, mật khẩu, cookie hoặc token.
- Đối chiếu tài liệu chính thức ở mục 12. Mức độ nghiêm trọng là đánh giá theo khả năng production; bằng chứng và điều kiện ảnh hưởng ghi riêng.

Giới hạn: đây không phải pentest từ Internet, kiểm thử tải production, audit hạ tầng hosting hoặc bằng chứng không còn lỗi. Không gọi TMDB API live trong đợt audit. Chưa xác minh TLS, SMTP thật, backup/restore, CDN/reverse proxy production hoặc mọi commit không có trong Git local. Không đo phần trăm statement/branch coverage.

## 3. Kiến trúc hiện tại

```text
BrowserRouter
  AuthProvider                 session/user; tuần tự hóa auth mutation
    FavoritesProvider          collection theo owner; pending theo movieId
      App                      giữ catalog + search/filter ngoài Routes
        /                      HomePage → MovieList → MovieCard
        /movies/:movieId       MovieDetailsPage → useMovieDetails
        /favorites             FavoritesPage → useFavoriteMovies
        /profile               ProfilePage → useProfile + ChangePasswordSection
        /login, /register      AuthForm
        /forgot-password, /reset-password
        *                      NotFoundPage

Page/Provider → API service → /api cùng origin → Node HTTP server
  Auth/Profile/Favorites → Prisma → PostgreSQL
  TMDB allowlist proxy → api.themoviedb.org
```

`sessionHttp.ts` dùng chung credentials/CSRF/no-store và deadline 12 giây cho API tài khoản. TMDB có service/parser/mapper riêng. Token TMDB nằm ở backend. Vite dev/preview proxy chuyển `/api` đến loopback backend; đây chưa phải cấu hình reverse proxy production.

## 4. Những điểm làm tốt

| Nhóm | Bằng chứng trong source và kiểm thử |
| --- | --- |
| Race condition trong một cây React | `AuthProvider.tsx:52–114` dùng version + abort; Favorites dùng generation/owner; `useMovieDetails.ts:67–74` che dữ liệu ID cũ ngay lúc render. Browser tests bỏ qua AbortSignal vẫn không phục hồi dữ liệu cũ sau thay đổi owner/ID trong cùng tab. |
| Cleanup | Các hook hủy request trong cleanup; `useMovieColumns` gỡ listener `matchMedia`. Không thấy lỗi cleanup trong các tình huống đã chạy; chưa thực hiện heap profiling dài hạn nên không kết luận tuyệt đối không có memory leak. |
| Dữ liệu dẫn xuất | `filterMovies.ts` tính trực tiếp từ input, copy trước sort; không dùng Effect để đồng bộ kết quả lọc. App giữ catalog khi chuyển route và giữ `lastUpdated`. Không bổ sung useMemo/useCallback tùy tiện trong audit. |
| Authentication | Password dùng Argon2id với salt; login có dummy hash; session token 32 byte ngẫu nhiên, database giữ SHA-256 hash, không gửi token trong JSON DTO. |
| Cookie/CSRF | `auth/config.mjs` yêu cầu HTTPS origins khi production; `cookies.mjs` thêm Secure, HttpOnly, SameSite=Lax, Path=/ và tên `__Host-`. Origin allowlist + custom CSRF header; không mở CORS. |
| Change Password | Hash ngoài transaction; khóa User → Session, kiểm tra session và CAS password hash; update và xóa session/reset token trong cùng transaction. Tests kiểm tra concurrent requests, logout khi hash, rollback và user B không bị tác động. |
| Reset Password | Token một lần có TTL, hash phía DB, link lấy từ cấu hình server, không lấy Host request; generic forgot response; SMTP yêu cầu TLS ngoài local mode và không log credentials. |
| Authorization | Favorites query/write scope theo user từ session; strict input không nhận userId. Profile PATCH kiểm tra session trong điều kiện write, DTO chỉ có trường công khai. |
| HTTP/API | Body JSON tối đa 16 KB, giới hạn thời gian đọc, không nhận encoding tùy ý. Error công khai ẩn lỗi nội bộ; private responses no-store. TMDB URL/endpoint allowlist, timeout upstream 8 giây, cancel khi client ngắt; map 404/429/5xx và Retry-After phù hợp. |
| Trải nghiệm | Loading/error/retry/empty, ảnh fallback, trailer tải iframe khi chủ động mở. Favorites metadata có 4 workers, cache theo owner và partial error từng phim. Responsive/keyboard được browser suites kiểm tra. |

Giới hạn sản phẩm hiện hữu: catalog lấy trang 1 của ba danh sách TMDB; tìm kiếm/lọc diễn ra trên catalog đã tải. Không phải tìm kiếm toàn bộ kho TMDB và không được báo là lỗi mới của Phase 7A.

## 5. Danh sách vấn đề

### Tổng hợp

| ID | Mức độ | Vấn đề | Loại bằng chứng | Trước deploy |
| --- | --- | --- | --- | --- |
| H01 | High | Tab cũ vẫn mang owner A nhưng mutation dùng cookie B | Lỗi tái hiện bằng browser + native HTTP | Cần sửa |
| H02 | High | IP rate limit gộp tất cả client sau proxy | Lỗi cấu hình khi có proxy; probe tái hiện quota chung | Cần sửa nếu đi qua proxy, bao gồm mô hình production dự kiến |
| H03 | High | TMDB proxy không giới hạn tổng request/upstream concurrency | Thiếu control đã kiểm chứng; chưa gây DoS thật | Cần giới hạn trước khi public |
| H04 | High | Database role runtime local có quyền superuser/createdb/createrole | Cấu hình local xác nhận; chưa có bằng chứng production dùng role này | Production bắt buộc dùng role riêng ít quyền |
| M01 | Medium | TMDB frontend không có deadline riêng | Source + fetch spy | Nên sửa |
| M02 | Medium | Một phần TMDB lỗi làm mất toàn bộ catalog/details | Hook browser + parser probe | Nên sửa hoặc chấp nhận rõ chính sách fail toàn bộ |
| M03 | Medium | Favorite write đang chạy vẫn hoàn tất sau logout | Probe điều khiển thứ tự thực thi | Chốt semantics; sửa nếu yêu cầu thu hồi chặn cả write đang bay |
| M04 | Medium | Browser/Prisma service probes chưa được đưa thành quality gate lặp lại | Scripts/test runner và fixture inspection | Nên bổ sung trước public release |
| L01 | Low | Validator tên chưa chặn nhóm C1 control characters | Validation probe | Không blocker; nên thống nhất policy/thông báo |
| L02 | Low | Script test-prisma báo exit 0 khi cấu hình DB bị từ chối | Child process với URL fixture không hợp lệ | Sửa trước khi dùng script làm deployment gate |

### H01 — Cookie giữa các tab khác với owner trong React

- **Vị trí:** `frontend/src/contexts/AuthProvider.tsx:101–114, 133–148`; `frontend/src/contexts/FavoritesProvider.tsx:19–21, 104–131`; `frontend/src/services/sessionHttp.ts:9`.
- **Nguyên nhân:** AuthProvider kiểm tra Me lúc mount hoặc khi gọi refresh, không có đồng bộ auth giữa tab/focus. Browser chia sẻ cookie, còn React state độc lập. `storedOwner === owner` chỉ so hai state trong tab, không xác minh cookie hiện tại vẫn thuộc owner đó.
- **Tái hiện:** cùng browser context, tab A login A, tab B login B; quay lại tab A, Header vẫn A. Click Favorite tại A trả 201 nhưng record thuộc B. Probe assert A không có record, B có record, Header A chưa đổi.
- **Ảnh hưởng:** người dùng thao tác vào tài khoản khác với danh tính đang hiển thị. Backend vẫn scope đúng theo cookie B; **không phải** server bỏ qua authorization hoặc A giả ID để truy cập B.
- **Đề xuất 7B:** đồng bộ auth event giữa tab bằng BroadcastChannel hoặc cơ chế tương đương, không truyền token; revalidate khi focus/visibility và khóa mutation trong lúc xác minh. Với yêu cầu bảo đảm chặt, thiết kế precondition owner/session generation được backend kiểm tra trước mutation; event/focus đơn thuần không loại bỏ mọi khoảng đua. Header dự kiến chỉ là precondition, không thay thế xác thực session. Cần review API contract riêng trước triển khai.
- **Trước deploy:** có. Thêm test hai tab thật, login/logout/change-password và request gửi ngay sát thời điểm đổi cookie.

### H02 — Rate limit theo socket IP không phù hợp reverse proxy

- **Vị trí:** `backend/auth/session-routes.mjs:33–35`; `backend/auth/register-route.mjs:23`; `backend/auth/rate-limit.mjs:1–9`; `backend/profile/change-password-routes.mjs:31`; các route Favorites/Profile có cách đọc IP tương tự.
- **Nguyên nhân:** `request.socket.remoteAddress` là IP kết nối TCP trực tiếp. Sau Vite/reverse proxy, đó là IP proxy. Map chỉ thuộc process, không chia sẻ giữa các instance.
- **Bằng chứng:** 21 HTTP login request với 21 địa chỉ X-Forwarded-For fixture khác nhau và email khác nhau; request thứ 21 nhận **429, Retry-After=900** từ quota IP chung. Không thử brute-force tài khoản thật.
- **Ảnh hưởng:** một nhóm nhỏ request có thể làm người dùng khác cùng proxy bị chặn đăng nhập 15 phút; scale nhiều instance còn làm quota không nhất quán. Không chấp nhận XFF tùy ý hiện tại là lựa chọn an toàn cho local, nhưng cần cấu hình mô hình proxy trước public.
- **Đề xuất 7B:** xác định trusted proxy/hop cụ thể; edge phải xóa/ghi đè forwarding header, backend chỉ tin peer đã xác minh. Có thể áp rate limit theo client tại edge và dùng store chung nếu nhiều instance; giữ account/user limit và hash concurrency cap.
- **Trước deploy:** có với mô hình reverse proxy. Không sửa bằng cách tin mọi X-Forwarded-For.

### H03 — TMDB public proxy chưa có giới hạn tài nguyên tổng

- **Vị trí:** `backend/server.mjs:47, 142`; `backend/proxy.mjs:11–16, 73–109, 163`; `frontend/src/services/favoriteMovies.ts:43` chỉ giới hạn trong một browser.
- **Nguyên nhân:** mỗi request được allowlist đều fetch upstream mới. Không có global semaphore, bounded queue, limiter, cache TTL hoặc gộp request cùng URL; response mặc định no-store.
- **Bằng chứng:** 24 request đồng thời cùng `/api/movies/popular` tạo **24 upstream calls, peak concurrency 24** với upstream fixture bị giữ chờ. Không gọi TMDB thật để thử tải và không khẳng định một con số này đã làm cạn tài nguyên.
- **Ảnh hưởng:** khi endpoint public, client có thể vượt qua giới hạn 4 workers phía UI, gây fan-out và tăng khả năng 429 cho toàn ứng dụng dùng chung token. Khả năng cạn tài nguyên là rủi ro suy ra từ control còn thiếu, chưa phải sự cố production quan sát được.
- **Đề xuất 7B:** bounded concurrency/queue và backpressure; quota tại edge/backend; cache public metadata TTL ngắn và coalesce cùng URL; tôn trọng Retry-After. Không cache Auth/Profile/Favorites hoặc cookie response chung người dùng.
- **Trước deploy:** có trước khi mở public; chạy load test có kiểm soát trên fixture/staging.

### H04 — Không tái sử dụng quyền database local cho runtime production

- **Vị trí:** `backend/database/client.mjs:12–19`; `backend/database/config.mjs:54–64`; `backend/.env.example:7` chỉ là template, không chứa mật khẩu thật.
- **Bằng chứng chỉ đọc:** `pg_catalog.pg_roles` của role kết nối thực tế trả `superuser=true, createDatabase=true, createRole=true`. Không đọc/in username, password hoặc URL.
- **Ảnh hưởng:** nếu mang nguyên quyền này sang public production, một sự cố application có phạm vi ảnh hưởng database lớn hơn mức cần thiết. Đây là **rủi ro cấu hình local có điều kiện**, không phải bằng chứng production đã dùng superuser, SQL injection hoặc mất dữ liệu.
- **Đề xuất 7B/deployment:** tách role runtime tối thiểu quyền cần cho queries và role migration/owner. Bổ sung read-only deployment check quyền; credentials qua môi trường/secret manager. Phải thử đủ login/transaction/raw SELECT FOR UPDATE với role ít quyền. Audit không tạo role hay thay đổi grants.
- **Trước deploy:** có; không public với role hiện tại.

### M01 — Thiếu timeout ở TMDB frontend

- **Vị trí:** `frontend/src/services/tmdb.ts:227–235`; `frontend/src/hooks/useMovies.ts:20–32`; `frontend/src/hooks/useMovieDetails.ts:26–35`.
- **Bằng chứng:** fetch spy khi gọi getGenres không thấy signal deadline; hook chỉ truyền AbortController để hủy khi dependency/unmount, không có timer. Khác `sessionHttp.ts:11–13` có deadline 12 giây.
- **Ảnh hưởng:** nếu kết nối browser → proxy/reverse proxy treo trước khi backend xử lý, loading có thể kéo dài đến timeout của hạ tầng/browser. Timeout 8 giây upstream không bảo vệ đoạn này. Chưa tái hiện treo Internet vô hạn.
- **Giải pháp:** ghép caller signal với AbortSignal.timeout, phân biệt timeout/abort chủ động trong message; test chờ headers/body không phản hồi bằng fake clock/fixture.
- **Trước deploy:** nên sửa; không coi timeout upstream hiện hữu là vô tác dụng.

### M02 — Chưa cô lập partial failure TMDB

- **Vị trí:** `frontend/src/hooks/useMovies.ts:27–45`; `frontend/src/pages/HomePage.tsx:39–45`; `frontend/src/services/tmdb.ts:188–222`; `backend/proxy.mjs:145–153`.
- **Bằng chứng:** browser hook probe cho now_playing trả 503, ba sibling request thành công nhưng toàn hook báo error; HomePage chọn nhánh lỗi thay vì các section thành công. Parser probe chỉ một video `{}` trong details làm parseMovieDetails throw dù thông tin chính còn đọc được. Backend cũng yêu cầu array videos/recommendations trong payload append.
- **Ảnh hưởng:** lỗi một section/metadata phụ làm giảm availability của nội dung chính. Đây là chính sách fail toàn bộ đang tồn tại, không phải dữ liệu người dùng bị hỏng. Credits và genres phụ ở Details đã có fallback; Favorites metadata đã xử lý partial failure tốt.
- **Giải pháp:** xác định field bắt buộc và metadata tùy chọn; lọc bỏ record video sai, degrade phần gợi ý; cân nhắc allSettled/section error + retry cho catalog. Không âm thầm giả dữ liệu hoặc che lỗi dữ liệu chính.
- **Trước deploy:** nên cải thiện hoặc ghi nhận rõ tradeoff fail toàn bộ; cần test sibling success/partial retry.

### M03 — Khoảng đua thu hồi session với Favorite write

- **Vị trí:** `backend/favorites/favorite-routes.mjs:69–77`; `backend/favorites/favorite-service.mjs:49–57, 85–88`; so sánh `backend/profile/change-password-service.mjs:83–100` có khóa/recheck trong transaction.
- **Tái hiện:** POST được xác thực và recheck, giữ thao tác DB create chờ bằng fixture, thực hiện Logout nhận 204, sau đó thả create. POST nhận 201 và có record. Không ghi database thật.
- **Nguyên nhân:** Favorite service nhận userId/movieId, không nhận token và không xác minh session trong write. Recheck trước service bảo vệ slow-body nhưng không loại bỏ khoảng giữa check và write.
- **Ảnh hưởng/điều kiện:** một request **đã được xác thực trước logout** có thể hoàn tất sau logout. Không chứng minh request mới với session revoked được chấp nhận, không có truy cập user B. Đây có thể là semantics in-flight được chấp nhận; không tự gán thành bypass authentication.
- **Giải pháp:** chốt policy sản phẩm. Nếu logout/change-password phải chặn cả write còn treo, dùng transaction/session predicate hoặc lock cùng thứ tự đã review; thêm concurrent revoke/write test. Nếu chấp nhận in-flight completion thì document và kiểm thử ranh giới này.
- **Trước deploy:** cần quyết định/document; chỉ bắt buộc sửa khi yêu cầu semantics thu hồi chặt.

### M04 — Quality gate chưa bao trùm các lớp regression quan trọng

- **Vị trí:** `package.json:8–22`; `frontend/package.json:6–14`; `frontend/tests/*.browser.cjs`; `backend/tests/helpers/auth-fixture.mjs:46–75`; repo chưa có `.github/workflows`.
- **Bằng chứng:** npm test chạy backend `*.test.mjs` và frontend `*.test.ts`, không chạy browser scripts. Browser suite cần truyền Playwright path từ cache cục bộ. Prisma service probe của Phase 6.4C hiện ở `.npm-cache`, không nằm trong checkout được commit. Mock transaction dùng một Promise queue, không mô phỏng MVCC/locking của PostgreSQL nhiều kết nối.
- **Ảnh hưởng:** tests xanh không đảm bảo owner giữa tab, ordering commit/logout thật hoặc deploy từ clean checkout vẫn chạy đầy đủ. PGlite RAM/Prisma probe kiểm tra SQL/rollback tốt nhưng không thay thế concurrency test nhiều connection PostgreSQL thật.
- **Giải pháp 7B:** runner browser có dependency/setup được khai báo; CI unit/lint/typecheck/build/schema/browser; promote regression phù hợp; PostgreSQL test riêng có safety guard bắt buộc, role/database test riêng và không dùng cineverse_dev/production. Không chạy test ghi dữ liệu vào DB thật trong audit này.
- **Trước deploy:** nên có quality gate tái lập; không có % coverage để đưa ra cam kết bao phủ định lượng.

### L01 — Thông báo validation tên rộng hơn policy C0/DEL thực tế

- **Vị trí:** `backend/auth/name-validation.mjs:10–12`; `frontend/src/utils/profileForm.ts:8–16`.
- **Bằng chứng:** validateProfileInput nhận tên chứa U+009F ở giữa mà không throw. Source chú thích chỉ chặn C0/DEL, trong khi thông báo người dùng nói không chứa ký tự điều khiển nói chung.
- **Ảnh hưởng:** có thể lưu tên chứa C1 khó hiển thị; không chứng minh XSS, React vẫn escape text. Đây là độ nhất quán policy/chất lượng dữ liệu.
- **Giải pháp:** chốt policy và dùng cùng quy tắc Unicode control thích hợp ở frontend/backend, hoặc làm rõ thông báo. Không chặn bừa mọi ký tự format vì có thể ảnh hưởng tên Unicode hợp lệ.
- **Trước deploy:** không blocker.

### L02 — Diagnostic Prisma có thể báo thành công qua exit code

- **Vị trí:** `backend/scripts/test-prisma.mjs:18–26`.
- **Bằng chứng:** chạy child process với URL fixture cố ý sai database (bị guard từ chối trước khi kết nối). Script log nhánh lỗi nhưng process vẫn exit 0 vì catch không đặt process.exitCode. Không dùng URL/mật khẩu thật.
- **Ảnh hưởng:** nếu dùng script này làm CI/deploy gate sẽ có false green. Scripts chính `db:check` và `db:validate` đang trả trạng thái phù hợp; không nói chúng mắc cùng lỗi.
- **Giải pháp:** đặt process.exitCode=1 cho failure và cleanup failure, thêm child-process regression test. Không tự đổi trong audit để giữ nguyên baseline và phạm vi report.
- **Trước deploy:** sửa trước khi dùng diagnostic này làm gate; không blocker nếu dùng db:check.

## 6. Test coverage và kết quả chạy thực tế

| Kiểm tra đã chạy | Kết quả | Phạm vi/giới hạn |
| --- | --- | --- |
| npm.cmd test | **287/287 pass**: backend 187, frontend 100; 0 fail/skip/cancelled | Native Node tests; frontend unit/parser/service tests. Không tính browser checkpoints là unit tests. |
| npm.cmd run lint | Pass | **Oxlint** theo script thật, không phải ESLint. |
| npm.cmd run typecheck | Pass | tsc -b --force. |
| npm.cmd run build | Pass | Vite 8.3.4, 93 modules; JS 351.36 kB / gzip 106.90 kB. Chưa đo Lighthouse/Web Vitals/hiệu năng production. |
| npm.cmd run db:validate | Pass | Prisma schema hợp lệ. |
| npm.cmd run db:check | Pass | PostgreSQL **17.11**, bảng User/Session/PasswordResetToken/Favorite truy vấn được; Favorite constraints/index/FK đúng. Chỉ đọc metadata/count. |
| Metadata/checksum/drift probe | Pass | 4 migration đúng checksum/thứ tự/finished, không rollback; Prisma migrate diff --exit-code xác nhận **không drift**. Không migrate/deploy/reset. |
| npm.cmd audit, root + frontend | **0 advisory được báo ở cả hai lockfiles** | Đã gọi npm registry thành công; không phải bằng chứng không có lỗ hổng chưa được công bố. Không npm audit fix/cài/nâng cấp dependency. |
| auth.browser.cjs --regression | Pass | Register/Login/Me/Logout, error/retry; Recovery; AuthProvider stale requests; Details router/refresh/404; compact layout/cast/filter/sort. Chạy tự mở server fixture. |
| favorites.browser.cjs | **12 nhóm checkpoint pass** | Native HTTP/session/Argon2, DB RAM; owner isolation, 205 IDs/3 pages, 4 metadata workers, concurrent mutation guards, 401 cleanup. |
| profile.browser.cjs | **10 nhóm checkpoint pass** | GET/PATCH/validation, Header Me refresh, error/retry, owner mismatch/late response và responsive. |
| changePassword.browser.cjs | **7 nhóm checkpoint pass** | Policy, pending lock, 204 logout, all-session revoke, người B không ảnh hưởng, điều hướng khi request pending, stale Me. |
| Prisma + pg adapter + PGlite probe | Pass | Service Change Password chạy Prisma thật với pg transport đến RAM; update/rollback/session/reset revoke/Favorites preservation. Không chứng minh PostgreSQL nhiều kết nối. |
| Audit useMovies browser probe | Pass cho guards; xác nhận M02 | Response cũ sau Retry bị bỏ qua dù transport không abort; unmount; section 503 làm toàn hook lỗi. |
| Audit multi-tab browser probe | **Tái hiện H01** | Hai tab cùng browser context; cookie thật trong fixture. Không phải regression suite hiện hữu thất bại. |
| Audit HTTP/validation probes | Xác nhận H02/H03/M01/M02/M03/L01/L02 | Thứ tự request được điều khiển; upstream/DB giả; không gây tải TMDB thật. |

Browser sử dụng **Microsoft Edge headless qua Playwright** có sẵn cục bộ. Auth/Profile/Favorites/Security kiểm tra **375/768/1024/1440 px**; recovery/compact/cast còn có 320/390 px ở các case tương ứng. Không tuyên bố đã kiểm tra mọi trang ở 1920 px, Firefox, Safari/iOS hay thiết bị vật lý trong đợt này.

Các kịch bản đã có bằng chứng: session expired/revoked; user B cùng movieId; malicious input/userId; CSRF/Origin; body/JSON/media limit; safe 503; concurrent login/reset/password-change theo fixture; rollback SQL RAM. Kịch bản cần bổ sung: nhiều tab, trusted proxy nhiều client, bounds upstream, multi-connection PostgreSQL, deadlock/lock timeout thật, clean install và staging HTTPS/cookie/SMTP.

Lệnh browser trong đợt audit, từ project root (điền đường dẫn Playwright đã cài):

```powershell
$playwrightPath = 'D:\LearnReact\Cineverse\.npm-cache\_npx\e41f203b7505f1fb\node_modules\playwright'
node frontend/tests/auth.browser.cjs $playwrightPath --regression
node frontend/tests/favorites.browser.cjs $playwrightPath
node frontend/tests/profile.browser.cjs $playwrightPath
node frontend/tests/changePassword.browser.cjs $playwrightPath
```

Evidence audit cục bộ, **không phải file cần commit**: `.npm-cache/phase-7a-tests.log`, `phase-7a-browser-*.log`, `phase-7a-audit-root.json`, `phase-7a-audit-frontend.json`, `phase-7a-probes.mjs`, `phase-7a-multitab.browser.cjs`, `phase-7a-hooks.browser.cjs`, `phase-7a-db-readonly.mjs`. Các probe dùng kết quả assert để xác nhận hành vi hiện tại; **exit 0 của probe không có nghĩa lỗi đã được sửa**. Bước tái hiện trong từng finding là phần bền vững trong tài liệu; cache không đi theo clean checkout.

## 7. Security và secrets review

- `.gitignore` đã chặn env thật, node_modules, dist/build, cache, generated Prisma, logs, Mailpit, mail/HAR, database/backup và key files. `backend/.env.example` chỉ có placeholders/config mẫu; thay đổi khoảng trắng có sẵn của người dùng được giữ nguyên.
- Quét working/index/history bằng scanner đã review, so khớp secrets đang cấu hình nội bộ và patterns credential/token/key/URL. Kết quả lần cuối, bao gồm report: **228 working files, 227 index files, 6 commits, 291 historical blobs, 0 finding**. Không có staged file chuẩn bị commit. Không in giá trị cấu hình.
- Không phát hiện token TMDB/DB/SMTP thật trong source/docs/tests/index/lịch sử Git local được quét. Các fixtures/password synthetic được phân biệt với credentials thật. Scanner theo pattern/known values có giới hạn, không bảo đảm phát hiện mọi secret không biết trước.
- **Token TMDB đã từng được gửi trong hội thoại trước đó.** Đây là thông tin lộ ngoài repository, không phải kết luận scanner tìm thấy token trong Git. Nên thu hồi/cấp token mới qua TMDB, cập nhật riêng `.env`/secret store, restart rồi xác minh token cũ không còn hiệu lực. Không chép token vào report và không tự đổi credentials trong Phase 7A.
- Production cookie đúng khi `NODE_ENV=production` được đặt thực tế. Nếu bỏ biến này, code mặc định development; build frontend không tự đổi môi trường backend. Phải kiểm chứng Secure/__Host- qua HTTPS staging.
- CORS không mở; thiết kế same-origin phù hợp với session helper. Cần deploy `/api` dưới cùng public origin; không giải quyết lỗi CORS bằng wildcard hoặc tắt Origin/CSRF.
- SMTP code có TLS requirement, timeout, không log credentials, local Mailpit không được production chấp nhận. Chưa xác minh provider thật, delivery, DNS/SPF/DKIM hoặc cấu hình mail production.
- Error JSON ẩn chi tiết tốt, nhưng request ID/metric/log đã lọc thông tin nhạy cảm chưa có trong HTTP handler. Đây là hạng mục vận hành cần bổ sung theo hạ tầng, không phải bằng chứng secrets đang được log.

## 8. Database safety và deployment boundaries

- User email unique; session/reset tokenHash unique; Favorite unique(userId,movieId), FK Cascade, user/time indexes. Cursor dùng (createdAt,movieId) với scope user; tests xác nhận không lẫn user khi movieId trùng.
- Transactions/locks/CAS cho password change, khóa User cho login/reset; Profile update có session predicate. Không phát hiện lỗi SQL injection trong các raw queries được review: chúng dùng tagged parameters, không nối input vào SQL.
- Prisma client lazy singleton; pool giới hạn 3, thời gian connect/statement/query hữu hạn; shutdown gọi disconnect. Không ghi nhận thêm pool mỗi request trong source.
- Metadata cho thấy 4 migration áp dụng đúng checksum, schema không drift. Không chạy `db:migrate`, `prisma migrate deploy/dev/reset`, cleanup session, seed, truncate/drop, grants hoặc DML trên local DB. DDL/DML trong automated tests chỉ ở fixture/RAM.
- `readDatabaseConfig` cố ý **chỉ chấp nhận localhost:5432/cineverse_dev/public**; `inspectDatabase` và migration guard cũng khóa database name. Probe xác nhận remote production URL bị chặn. Đây là guard phát triển có chủ đích, không nên xóa để deploy cho nhanh. Chưa chọn topology hosting nên không kết luận mọi deployment đều bất khả thi: same-host database khác với managed PostgreSQL.
- Nếu dùng managed DB/container: thiết kế cấu hình môi trường production riêng, TLS/CA, role tối thiểu quyền, pool limits, migration pipeline với guard production độc lập. Không đổi guard local hoặc apply SQL thật trong audit.
- `backend/index.mjs` listen cố định 127.0.0.1:3001; hợp lệ cho reverse proxy cùng máy, chưa phù hợp mọi container/PaaS. Root chưa có start script production, cấu hình public SPA fallback và reverse proxy/header policy chưa có trong repo. Build pass không chứng minh `/profile` hoặc `/movies/:id` refresh qua hosting production hoạt động.
- Chưa đo EXPLAIN/latency trên dataset lớn. Index Favorite thiếu movieId trong index user/time không đủ bằng chứng để kết luận truy vấn hiện tại chậm; cần đo tie/order cursor trước khi thêm index.

## 9. Điều kiện trước public deployment

1. Sửa H01; kiểm thử đổi cookie giữa hai tab và chặn mutation khi owner chưa được xác minh.
2. Chốt trusted reverse proxy và rate limiting H02/H03; không tin forwarding header tùy ý, không dựa vào worker cap trong frontend.
3. Cấp runtime DB role ít quyền, tách migration role; xác minh H04 trong staging.
4. Xoay vòng token đã chia sẻ ngoài repo; cấu hình production environment/HTTPS origins/cookie và SMTP thật qua secret store.
5. Chọn topology, xử lý local-only DB/listen guards có thiết kế; static frontend cần SPA fallback, `/api` same-origin và header policy phù hợp. Kiểm tra CSP/frame policy tương thích YouTube trailer thay vì thêm header máy móc. Không dùng Vite dev server làm production server.
6. Chạy quality gate lặp lại và PostgreSQL integration riêng; chốt policy M03. Bổ sung deadline TMDB, đánh giá partial failure theo M01/M02.
7. Có theo dõi lỗi/uptime, shutdown/restart strategy, backup/restore được thử trên môi trường riêng. Chưa có bằng chứng các điều kiện hạ tầng này đã hoàn thành.

## 10. Kế hoạch Phase 7B đề xuất

| Thứ tự | Công việc | Tiêu chí nghiệm thu |
| --- | --- | --- |
| P0 | H01 auth/session identity giữa tab | Tab A không thao tác nhầm B; login/logout/reset/change-password thông báo giữa tab; mutation bị chặn khi session chưa rõ; stale response không phục hồi owner cũ. |
| P0 | H02/H03 proxy/resource controls | Nhiều client không chia quota sai; spoof XFF không bypass; concurrency/queue có trần; duplicate public requests được coalesce/cache theo policy; 429/retry được kiểm thử. |
| P0 deployment | H04 + secrets + topology | Role runtime không superuser/createdb/createrole, app vẫn hoạt động; token cũ thu hồi; staging HTTPS/cookie/origin/SPA/SMTP đúng. Không tự chạy trên DB người dùng. |
| P1 | M01/M02 reliability | Timeout hữu hạn; abort chủ động không báo lỗi giả; optional metadata lỗi không chặn nội dung chính theo policy mới; retry không gọi lại phần không cần. |
| P1 | M03 policy và regression | Quy định rõ request đã xác thực trước revoke có được commit sau revoke không; test đúng ordering trên PostgreSQL test nhiều connection. |
| P1 | M04 quality gate | Setup test từ clean checkout; browser suites/Prisma service integration thành scripts/CI; dữ liệu test tách biệt và safety guard không trỏ cineverse_dev/production. |
| P2 | L01/L02 và vận hành | Unicode control policy/thông báo thống nhất; diagnostic lỗi có exit code !=0; request ID/metrics/log redaction theo nhu cầu hosting. |

Đây là phương án, **chưa triển khai Phase 7B**. Những thay đổi API/security cần review contract và regression trước khi sửa.

## 11. Kiến thức nên học từ audit

1. **AbortController và version guard giải quyết hai việc khác nhau.** `useMovieDetails.ts` vừa abort để giảm việc thừa, vừa dùng isCurrent/id/version để từ chối response cũ nếu transport không dừng. Chỉ abort chưa đủ để chứng minh không có race condition.
2. **React state không phải danh tính session phía server.** H01 cho thấy owner trong Context chỉ là ảnh chụp; cookie chia sẻ giữa tab có thể đổi độc lập. So sánh owner trong state tốt cho same-tab races nhưng không tự đồng bộ cookie.
3. **Transaction cần bảo vệ đúng ranh giới check và write.** Change Password khóa/recheck và revoke trong transaction; Favorite hiện check rồi mới write. Đọc M03 để phân biệt request mới trái phép với request đã được chấp nhận nhưng đang thực thi.
4. **Giới hạn phía client không bảo vệ backend public.** 4 workers trong `favoriteMovies.ts` giúp browser nhẹ hơn; probe trực tiếp vẫn tạo 24 upstream calls. Cần giới hạn ở nơi tài nguyên thật được sử dụng, đồng thời phân biệt IP client với IP proxy.
5. **Tests xanh cần đi kèm phạm vi bằng chứng.** TypeScript không kiểm tra dữ liệu HTTP runtime; parser vẫn cần validation. Mock transaction tuần tự không chứng minh locking thật; PGlite RAM không thay thế mọi concurrency test; build pass không chứng minh HTTPS/SPA fallback/SMTP production hoạt động.

## 12. Tài liệu chính thức đối chiếu

- Cleanup theo dependency và race guard khi fetch: [React useEffect](https://react.dev/reference/react/useEffect).
- Throttle theo tài khoản và đánh giá cơ chế bảo vệ login: [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).
- Runtime least privilege, tách quyền vận hành database: [OWASP Database Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Database_Security_Cheat_Sheet.html).
- Phân biệt timeout nhận request với deadline công việc ứng dụng: [Node.js 22 HTTP server.requestTimeout](https://nodejs.org/docs/latest-v22.x/api/http.html#serverrequesttimeout).
- TMDB yêu cầu tôn trọng 429 và giới hạn dịch vụ có thể đổi: [TMDB Rate Limiting](https://developer.themoviedb.org/docs/rate-limiting). Audit không hardcode một quota TMDB được coi là bảo đảm lâu dài.
- Migration production cần pipeline/cấu hình môi trường riêng: [Prisma migrate deploy](https://docs.prisma.io/docs/cli/v7/migrate/deploy), [Prisma environment variables](https://www.prisma.io/docs/orm/v7/more/dev-environment/environment-variables). Audit chỉ dùng validate/diff/check, không deploy migration.
