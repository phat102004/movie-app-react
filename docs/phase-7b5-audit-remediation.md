# Phase 7B.5 — Remaining audit findings & regression hardening

Ngày xác minh: **29/10/2026**. Baseline: `7f9ffe4` (Phase 7B.4).
Nguồn finding duy nhất: [audit Phase 7A](phase-7a-project-audit.md), baseline
`c1beb6a`. Không thêm finding mới để đủ số lượng. Audit gốc đã có dưới dạng
untracked khi bắt đầu và được giữ nguyên.

## 1. Kết quả và cách đọc trạng thái

**389 automated tests đạt: backend 280 + frontend 109; 0 fail/skip/cancelled.**
Browser regression Edge headless đạt; bộ remediation mới có 8 checkpoint.
Lint, TypeScript, production build, Prisma validation và database read-only checks đạt.

Ma trận có **5 resolved, 4 mitigated, 1 open**. `Resolved` chỉ nói về hành vi và
phạm vi đã xác minh; không phải chứng nhận production. `Mitigated` còn tradeoff
hoặc điều kiện deployment phải kiểm chứng. M04 vẫn `open` vì local gate đã cải thiện
nhưng CI/clean runner và PostgreSQL native nhiều kết nối chưa được xác minh.

Không chỉnh thiết kế Login/Register/Profile, API route/authorization, schema,
migrations, credentials thật hoặc cấu hình production local. Không commit/push.

## 2. Đối chiếu đúng 4 Medium và 2 Low

Các số dòng dưới đây được chép từ audit gốc, là vị trí **lịch sử**, không phải số
dòng hiện tại sau khi sửa. Bằng chứng cũ được phân biệt với kết quả kiểm tra mới.

### M01 — Thiếu timeout ở TMDB frontend

- **Vị trí gốc:** `frontend/src/services/tmdb.ts:227–235`,
  `frontend/src/hooks/useMovies.ts:20–32`, `useMovieDetails.ts:26–35`.
- **Bằng chứng gốc:** getGenres không có deadline; AbortController của hook chỉ
  hủy khi dependency đổi/unmount. Upstream timeout 8 giây không bao trùm đường
  browser → proxy hoặc body phía browser bị treo.
- **Ảnh hưởng:** loading kéo dài đến timeout hạ tầng/browser, không phải bằng chứng
  đã có một cuộc tấn công hay Internet treo vô hạn.
- **Khuyến nghị ban đầu:** ghép caller abort với deadline, phân biệt timeout,
  kiểm tra chờ headers/body bằng fake clock/fixture.
- **Trước sửa:** tái chạy service ở HEAD bằng fetch spy, không truyền caller →
  không có signal. Finding còn tồn tại sau 7B.4.
- **Sau sửa — resolved:** `withRequestDeadline` tạo controller, chuyển tiếp caller
  abort và đặt deadline **12 giây**. Bao trùm cả fetch lẫn đọc JSON. Promise race
  kết thúc việc chờ ngay cả khi transport giả bỏ qua abort; finally dọn timer và
  listener. Pre-aborted caller không gọi fetch. Không đổi session HTTP helper.
  Service trả `ApiError/REQUEST_TIMEOUT` với thông báo riêng; abort chủ động không
  bị đổi thành lỗi mạng.
- **Xác minh:** fake timer cho fetch/body treo, pre-abort/caller abort/timer cleanup;
  browser giả fetch bỏ qua abort cho một section, deadline rút ngắn có kiểm soát,
  section khác vẫn hiện. Không tuyên bố đã tái hiện sự cố Internet thực tế.

### M02 — Chưa cô lập partial failure TMDB

- **Vị trí gốc:** `useMovies.ts:27–45`, `HomePage.tsx:39–45`,
  `services/tmdb.ts:188–222`, `backend/proxy.mjs:145–153`.
- **Bằng chứng gốc:** now_playing 503 làm toàn catalog lỗi dù ba request khác
  thành công; một video `{}` làm parser details throw; backend bắt buộc cả hai
  array videos/recommendations trong append. Credits/genres phụ ở Details và
  metadata Favorites đã có fallback, không cần làm lại.
- **Ảnh hưởng:** lỗi một nguồn phụ làm mất nội dung chính còn sử dụng được.
- **Khuyến nghị ban đầu:** phân biệt dữ liệu chính/phụ, bỏ record phụ không hợp lệ,
  allSettled/partial error và retry catalog, không che lỗi dữ liệu chính.
- **Trước sửa:** HEAD parser vẫn throw khi chỉ video sai; đọc lại hook/backend
  xác nhận fail-all còn nguyên. Baseline hook reproduction nằm trong audit gốc.
- **Sau sửa — resolved:** `useMovies` dùng allSettled, giữ riêng nguồn thành công;
  chỉ retry các nguồn còn thiếu/lỗi. Catalog dùng nội dung TMDB đã nhận, không
  tạo phim mẫu. Genres lỗi có warning và fallback nhãn sẵn có của mapper.
  Chỉ khi không còn phim để hiển thị mới dùng toàn trang loading/error/empty;
  lỗi nguồn còn thiếu không bị báo nhầm thành empty thành công dù nguồn khác
  trả về danh sách rỗng. Giữ lastUpdated và cache qua điều hướng.
  Backend chỉ yêu cầu ID/genres chính hợp lệ cho aggregate details; frontend
  bỏ record video/gợi ý lỗi, giữ record hợp lệ và hiện cảnh báo/retry.
  Dữ liệu chính sai, sai ID, JSON sai hoặc HTTP lỗi vẫn thất bại như trước.
- **Xác minh:** native HTTP optional aggregate thiếu vẫn 200; parser hỗn hợp tốt/xấu;
  browser section 503, genres 503, retry chỉ gọi nguồn lỗi, tất cả section lỗi,
  nguồn rỗng + sibling lỗi, details vẫn đọc được và gợi ý hợp lệ vẫn có;
  không tải iframe trước tương tác; response catalog cũ không ghi đè Retry mới.
- **Giới hạn:** lần tải đầu chờ các nguồn settle, tối đa deadline frontend;
  không streaming từng section. Retry details vẫn tải lại aggregate + genres,
  không thêm endpoint retry metadata riêng. Thông báo thể hiện nguồn thiếu rõ ràng.

### M03 — Khoảng đua thu hồi session với Favorite write

- **Vị trí gốc:** `backend/favorites/favorite-routes.mjs:69–77`,
  `favorite-service.mjs:49–57,85–88`; đối chiếu transaction password change
  `backend/profile/change-password-service.mjs:83–100`.
- **Bằng chứng gốc:** giữ create sau authentication/recheck, Logout 204, thả
  create → POST 201 và record A. Không có bằng chứng request mới dùng session
  đã revoke được chấp nhận; không phải ghi nhầm User B.
- **Root cause/ảnh hưởng:** service đã nhận owner từ session, không recheck hoặc
  khóa session bên trong write. Có khoảng giữa check và commit; logout không
  hủy ngược thao tác đã được chấp nhận.
- **Khuyến nghị ban đầu:** chốt semantics. Nếu phải chặn cả write đang chạy thì
  cần transaction/predicate/locking được kiểm thử concurrent revoke/write.
  Nếu chấp nhận completion thì document và test ranh giới.
- **Quyết định người dùng trong Phase này:** giữ in-flight completion, ghi policy
  và thêm regression; không triển khai thu hồi tuyệt đối cho Favorite đang chạy.
- **Sau đánh giá — mitigated (policy accepted):** không thay Favorite write logic.
  Request đã được xác thực và qua account precondition trước Logout có thể
  hoàn tất sau Logout, **chỉ dưới owner đã chốt của request đó**. Request mới với
  session revoked bị từ chối. Cookie đổi sang B không retarget request đang bay.
  Frontend vẫn bỏ kết quả owner/epoch cũ theo Phase 7B.1, không replay mutation.
- **Xác minh mới:** hai native HTTP tests giữ POST/create hoặc DELETE/deleteMany,
  Logout 204, request mới cookie A → 401, Login B, thả thao tác. POST chỉ tạo A;
  DELETE chỉ xóa A và giữ Favorite cùng movieId của B. Browser multitab hồi quy đạt.
- **Residual risk:** không bảo đảm “sau thời điểm Logout không có commit nào của A”.
  Test dùng service/DB fixture, không chứng minh thứ tự lock/MVCC PostgreSQL native.
  Nếu policy thay đổi, cần thiết kế riêng và test nhiều connection trước khi hứa
  strict revocation. Policy đã chốt hiện tại không chặn production.

### M04 — Quality gate chưa bao trùm các lớp regression quan trọng

- **Vị trí gốc:** root `package.json:8–22`, frontend `package.json:6–14`,
  `frontend/tests/*.browser.cjs`, `backend/tests/helpers/auth-fixture.mjs:46–75`;
  chưa có `.github/workflows`.
- **Bằng chứng gốc:** npm test bỏ qua browser; Playwright lấy từ cache bằng argv;
  Prisma service probe bị ignore; mock transaction chỉ serialize bằng Promise,
  không mô phỏng PostgreSQL MVCC/locking nhiều connection.
- **Ảnh hưởng:** xanh ở local unit chưa bảo đảm hành vi browser/deployment hoặc
  ordering transaction thật. Không có số liệu phần trăm coverage.
- **Khuyến nghị ban đầu:** dependency/setup/runner/CI lặp lại; promote probes;
  PostgreSQL test riêng có guard, không dùng cineverse_dev/production.
- **Trước sửa:** đọc scripts/fixtures xác nhận cả bốn khoảng trống vẫn còn.
- **Sau sửa — open, đã giảm một phần:** khai báo exact Playwright 1.64.1 và lockfile;
  `test:browser` tự resolve dependency, chạy suites tuần tự, dừng khi fail;
  `check` ghép automated tests/lint/typecheck/build/schema/browser.
  Browser launch dùng config chung, Edge mặc định Windows, bundled Chromium
  trên nền tảng khác, có override channel. Promote Prisma + pg adapter + PGlite
  service test vào backend npm test: update, revoke session/reset token,
  giữ Favorites/owner khác và rollback SQL thật trong RAM. Không mở pg socket.
- **Bằng chứng:** runner mới đã chạy tất cả suites; Prisma test đã chạy độc lập
  và trong npm test. Runner lỗi không được coi là skipped/pass.
- **Còn mở:** chưa có CI workflow/CI run; chưa thực hiện clean checkout/install
  trên máy sạch; chưa có dedicated native PostgreSQL multi-connection test DB.
  Các việc này có kế hoạch riêng ở mục 7; không sửa helper RAM để giả vờ là MVCC.

### L01 — Thông báo validation tên rộng hơn policy C0/DEL thực tế

- **Vị trí gốc:** `backend/auth/name-validation.mjs:10–12`,
  `frontend/src/utils/profileForm.ts:8–16`.
- **Bằng chứng gốc:** tên chứa U+009F ở giữa được chấp nhận; thông báo nói không
  chứa ký tự điều khiển nhưng implementation chỉ chặn C0/DEL.
- **Ảnh hưởng:** chất lượng dữ liệu/hiển thị; không phải chứng minh XSS (React escape).
- **Khuyến nghị ban đầu:** thống nhất policy Unicode controls, không chặn bừa
  mọi format character hợp lệ.
- **Trước sửa:** chạy validator ở HEAD xác nhận `A\u009fB` vẫn hợp lệ.
- **Sau sửa — resolved:** chặn C0, DEL và toàn bộ **C1 U+0080–U+009F** tại backend
  và Profile; Register tái sử dụng cùng frontend validator. Giữ trim và giới hạn
  1–100 Unicode code points, không chặn ZWJ hay tên Việt/Á/Ả Rập/emoji hợp lệ.
  Như policy trim hiện hữu, whitespace ở biên được trim trước khi xét tên;
  tests đặt controls giữa hai chữ để không nhầm với trim.
- **Xác minh:** unit kiểm tra dải controls; HTTP Register/PATCH đã đăng nhập trả
  400 và không create/update user; browser Register báo lỗi/focus tên, không POST.
  Không viết tên lỗi vào PostgreSQL thật, không thay bố cục Auth/Profile.

### L02 — Diagnostic Prisma có thể báo thành công qua exit code

- **Vị trí gốc:** `backend/scripts/test-prisma.mjs:18–26`.
- **Bằng chứng gốc:** URL fixture sai database bị guard từ chối trước kết nối,
  catch log lỗi nhưng process exit 0; cleanup failure cũng bị nuốt.
- **Ảnh hưởng:** false green nếu dùng diagnostic làm deployment gate. db:check
  và db:validate không bị kết luận mắc lỗi tương tự.
- **Khuyến nghị ban đầu:** exitCode=1 ở main/cleanup failure, child process test,
  không đưa credentials vào error log.
- **Trước sửa:** chạy child script HEAD với synthetic URL bị guard → exit 0.
- **Sau sửa — resolved:** script chỉ query `SELECT 1`, báo lỗi bằng sanitizer,
  đặt exitCode=1 khi query/config/cleanup lỗi. Không dump exception/URL/role/user.
- **Xác minh:** child process thực trả 1 khi config bị từ chối; stdout/stderr
  không chứa synthetic password hoặc URL. Chạy CLI hiện tại trên PostgreSQL local
  bằng SELECT 1 cũng trả exit 0. Cleanup failure chưa được fault-inject riêng;
  đây là CLI diagnostic, không có UI browser.

## 3. Final Audit Matrix — toàn bộ 10 finding Phase 7A

| Finding ID | Severity | Root cause | Status | Code changes | Test evidence đã chạy | Residual risk | Chặn production? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| H01 | High | UI owner từng tab khác cookie dùng chung | resolved | 7B.1: account precondition, Auth epoch/sync, private cancellation; giữ nguyên 7B.5 | Native HTTP/session tests; 22 multi-tab browser checkpoints, kể cả missed signal và cookie đổi giữa Me/POST | XSS/compromised browser không thuộc bảo đảm; chưa phải pentest production | Không còn blocker H01 trong phạm vi đã kiểm thử; vẫn cần staging smoke |
| H02 | High | Khóa quota là IP proxy thay vì client | mitigated | 7B.2: client-ip resolver allowlist/CIDR/right-to-left chain; không đổi trust trong 7B.5 | client-ip + trusted-proxy-rate-limit native HTTP tests; spoof/multiple hops/IPv4/IPv6/429/CSRF hồi quy | Trust đang tắt; chưa xác minh ingress thật ghi đè XFF; limiter in-memory mỗi process | Có nếu deploy sau proxy mà chưa cấu hình/xác minh trust; nhiều instance cần quota strategy |
| H03 | High | Thiếu global bound/dedup upstream | mitigated | 7B.3: shared scheduler, cap/queue/waiters/deadlines; 7B.5 chỉ nới optional details validation | upstream-scheduler + proxy-hardening + proxy suites: bounded concurrency, dedup, queue/cancel/timeouts, 503/504 | Giới hạn mỗi process, không distributed quota; chưa load test staging/live TMDB | Phải xác minh topology/capacity trước public; không coi unit là load test |
| H04 | High | Runtime local dùng role đặc quyền | mitigated | 7B.4: runtime/migrator separation, ACL guard, provisioning/grants/deploy guard; không apply SQL 7B.5 | production-database RAM/SQL/guard tests; native metadata/checksum read-only xác nhận local vẫn SUPERUSER | Chưa tạo production roles/ACL/TLS/ownership/PUBLIC review/restore drill | **Có**: không mang role local lên production; bắt buộc staging least-privilege verification |
| M01 | Medium | Frontend chỉ có caller cancellation | resolved | requestDeadline.ts, tmdb.ts | Headers/body timeout unit + real browser hung-fetch fixture, cleanup/pre-abort | Deadline không bảo đảm chất lượng mạng; không thể cưỡng chế transport giả hủy tài nguyên ngoài app | Không riêng finding này |
| M02 | Medium | Fail-all catalog và optional aggregate quá strict | resolved | useMovies, HomePage, tmdb-client/parser/types/mapper, MovieLoadNotice/Details | HTTP + parser + browser partial retry/empty+error/stale results/optional details | Chờ allSettled, details retry whole aggregate; primary malformed vẫn fatal | Không riêng finding này |
| M03 | Medium | Session check trước write, không có revoke lock trong Favorite write | mitigated | Giữ service; thêm 2 HTTP regressions và policy được người dùng chấp nhận | Hold POST/DELETE → Logout → reject request mới → Login B → release, chỉ A bị tác động | Accepted in-flight commit sau logout; chưa có native concurrency proof | Không với policy đã chọn; strict revocation cần phase riêng |
| M04 | Medium | Browser/probe không có gate portable; thiếu CI/native PG concurrency | open | Playwright/lockfile, browser-options, runner/check, Prisma service RAM test, README | Full local browser runner + npm test đạt; Prisma rollback thật trong RAM | CI/clean checkout và native PG nhiều connection chưa chạy | **Có trước public release**: hoàn thành CI và isolated PG gate/staging evidence |
| L01 | Low | C0/DEL implementation khác thông báo controls nói chung | resolved | Backend name validator, Profile/Register frontend validation | Controls unit + HTTP 400/no write + browser validation/no POST | Không quét/sửa tên đã lưu trước đây; format Unicode vẫn được cho phép | Không |
| L02 | Low | CLI catch không đặt failure status | resolved | test-prisma diagnostic | Child process HEAD exit0 vs hiện tại exit1, không lộ URL/password | Chưa fault-inject riêng cleanup failure; không thay deployment gate hiện có | Không; dùng db:check cho read-only gate |

Các High được đối chiếu với tài liệu/code 7B.1–4 và **chạy lại** regression hiện tại,
không chỉ chép báo cáo cũ. Chỉ H01 có đủ bằng chứng HTTP + hai tab để đóng trong
phạm vi lỗi gốc. Các điều kiện hạ tầng H02/H03/H04 không được tự đánh dấu resolved.

## 4. File tạo/sửa

| Nhóm | Files |
| --- | --- |
| TMDB deadline | **Mới** `frontend/src/services/requestDeadline.ts`; sửa `frontend/src/services/tmdb.ts` |
| Catalog partial failure | `frontend/src/hooks/useMovies.ts`, `frontend/src/pages/HomePage.tsx` |
| Details partial metadata | `backend/tmdb-client.mjs`, frontend `services/tmdb.ts`, `types/tmdb.ts`, `types/movieDetails.ts`, `utils/mapTmdbMovieDetails.ts`, `pages/MovieDetailsPage.tsx`; **mới** `components/MovieLoadNotice.tsx` và `.css` |
| Name validation | `backend/auth/name-validation.mjs`, frontend `utils/profileForm.ts`, `utils/authForm.ts` |
| Diagnostic | `backend/scripts/test-prisma.mjs` |
| Backend tests | **Mới** `backend/tests/audit-remediation.test.mjs`, `prisma-service.test.mjs`; sửa `favorites.test.mjs`, `profile.test.mjs`, `proxy.test.mjs` |
| Frontend tests | **Mới** `frontend/tests/auditRemediation.test.ts`, `auditRemediation.browser.cjs`, `browser-options.cjs`; sửa `tmdb.test.ts`, `movieDetails.test.ts` (optional malformed video không còn fatal; signal là composed signal) |
| Browser config reuse | Sửa launch options trong `auth.browser.cjs`, `authLayout.browser.cjs`, `favorites.browser.cjs`, `profile.browser.cjs`, `changePassword.browser.cjs`, `multitabAuth.browser.cjs`, `movieDetails.browser.cjs`, `compactMovies.browser.cjs`, `movieCast.browser.cjs` |
| Gate/docs | **Mới** `scripts/test-browser.mjs`, tài liệu này; sửa root `package.json`, `package-lock.json`, `README.md` |

Không thay `.env`/`.env.example`, Prisma schema/migration, AuthProvider,
FavoritesProvider, session/CSRF/Origin hoặc UI Auth/Profile. Các probe/log riêng
trong `.npm-cache` vẫn bị ignore; chúng không là dependency của test runner mới.

## 5. Regression tests và quality checks thực tế

Thêm **13 automated tests** so với baseline 376: backend +7, frontend +6.
Không cộng browser checkpoints vào tổng automated Node tests.

| Lệnh/kiểm tra | Kết quả | Giới hạn |
| --- | --- | --- |
| `npm.cmd test` | **389/389**, backend 280 + frontend 109, không fail/skip/cancel | Fixture/RAM cho write; không ghi PostgreSQL local |
| `npm.cmd run test:browser` | Pass toàn runner | Edge headless trên Windows; không phải clean CI |
| Auth/Recovery + movie regression | Pass | Native HTTP fixtures, Router/Home/search/filter/sort/lastUpdated, Details/compact/cast; không TMDB live |
| Auth layout | Pass | Login/Register đã duyệt; các viewport 320–1920 có trong suite |
| Favorites/Profile/Change Password | **12/10/7 nhóm checkpoint pass** | Account/DB fixture; responsive 375/768/1024/1440, không tài khoản thật |
| Multi-tab | **22 checkpoint pass** | Hai tab cùng cookie context; fallback storage/focus, dropped signals, old responses, 401/403, không refresh loop |
| Audit remediation browser | **8 checkpoint pass** | Register C1; partial section/genres retry, responsive/focus; all-fail; empty+error; optional details; deadline; stale response/unmount |
| Trusted IP + scheduler + DB role regression | Pass trong backend npm test | Native HTTP/controlled upstream và RAM ACL; không proxy/production DB thật |
| Prisma service regression | Pass trong npm test | Prisma Client/pg adapter → PGlite RAM, success/revoke/rollback; không MVCC nhiều connection |
| `npm.cmd run lint` | Pass, **Oxlint** | Theo script thực tế |
| `npm.cmd run typecheck` | Pass | tsc -b --force |
| `npm.cmd run build` | Pass | Vite 8.3.4, 97 modules; JS 357.79 kB, gzip 109.16 kB |
| `npm.cmd run db:validate` | Pass | Schema hiện hữu hợp lệ, không migrate |
| `npm.cmd run db:check` | Pass | PostgreSQL 17.11, User/Session/ResetToken/Favorite truy vấn được; Favorite constraints/index/FK hợp lệ |
| Native role metadata + migration checksum | Pass kiểm tra chỉ đọc | 4 migrations không đổi checksum; local flags superuser/createdb/createrole vẫn true → H04 chưa đóng |
| `git diff --check` | Pass | Không stage/commit/push |

Security scan cuối: **263 working files, 252 index files, 10 commits, 364
historical blobs; 0 finding** sau phân biệt placeholders, synthetic fixtures và
checksum migration công khai. Quét known configured values nội bộ và patterns;
không in secret. Đây không phải bảo đảm phát hiện mọi credential chưa biết.
Env thật, generated client, screenshots, logs và cache vẫn được ignore.

HEAD reproduction trước sửa xác nhận M01/M02/L01/L02 bằng source được đọc từ Git,
không checkout/revert working tree. L02 dùng URL synthetic bị guard từ chối trước
kết nối. M03 tái hiện trực tiếp bằng hai test ordering; kết quả mong đợi theo policy
đã chốt. Không tải nặng dịch vụ bên ngoài, gửi email thật, đổi password thật hoặc
reset/seed/apply migration vào PostgreSQL local.

Lần chạy đầu của test mới phát hiện assertion cũ vẫn coi optional video sai là
fatal; đã cập nhật đúng contract degrade. Browser assertion timeout dùng sai text
thông báo cũng được sửa và chạy lại. Kết quả cuối không tính các lượt lỗi đó là pass.

## 6. Chạy lại trên checkout

Xem hướng dẫn setup trong [README](../README.md#các-lệnh-kiểm-tra):

```powershell
npm.cmd ci
npm.cmd --prefix frontend ci
npm.cmd run db:generate
npx.cmd playwright install chromium
# Windows nếu muốn dùng Chromium thay Edge mặc định:
$env:CINEVERSE_BROWSER_CHANNEL = 'chromium'
npm.cmd run check
# Ngoài portable gate, chỉ đọc database local đã cấu hình:
npm.cmd run db:check
```

Linux runner dùng `npx playwright install --with-deps chromium`. Browser fixtures
tự mở/đóng Vite/Node ở cổng tạm, không cần server dev đang chạy hoặc secrets.
Prisma Client được generate từ schema, không là source cần commit. Chưa chạy lại
clean install trên workspace này để tránh động vào môi trường đang dùng; local
runner đã được thực thi bằng dependency khai báo mới, không lấy Playwright từ cache.

## 7. Việc còn mở và kế hoạch Phase 7C / Phase 9

### Phase 7C — đóng M04 bằng bằng chứng độc lập

1. Review và thêm CI workflow: clean checkout, Node >=22.18, npm ci root/frontend,
   generate client, cài Chromium + OS dependencies, `npm run check`. Không cấp
   secrets production; fail khi suite lỗi/missing browser, không auto skip.
2. Thiết kế PostgreSQL native fixture riêng: ephemeral instance/database/roles chỉ
   cho test, guard từ chối `cineverse_dev` và mọi production target; không dùng
   URL local hiện hữu làm fallback. Chốt infrastructure trước khi provision.
3. Chạy ít nhất hai connection độc lập cho lock/revoke/CAS/rollback/deadlock timeout,
   concurrent password change và session invalidation. Kiểm tra policy Favorite
   in-flight đã chọn. Không thay bằng Promise queue hoặc RAM rồi gọi là native MVCC.
4. Xác minh clean runner và remote CI thực sự đạt, lưu bằng chứng không có
   cookie/token/password/form values. Khi đó mới đánh giá đóng M04.

### Phase 9 / trước public deployment — điều kiện hạ tầng còn lại

- **H02:** xác định ingress thật, allowlist đúng IP/CIDR, ghi đè/sanitize XFF,
  chặn bypass backend, smoke nhiều IP và spoof headers. Không tự bật trust-all.
- **H03:** xác nhận số process/replica, tổng upstream capacity/QPS, 429/backpressure,
  cancellation và queue dưới tải staging; in-memory cap không là distributed quota.
- **H04:** provision roles runtime/migrator trên target riêng, ownership/PUBLIC
  privileges/ACL/TLS đúng; migration guard + grants, native role check và smoke
  bằng test users. Không dùng superuser local. Thử backup/restore và failure recovery.
- Rotation token TMDB từng chia sẻ ngoài repo, HTTPS Secure/__Host- cookies,
  SMTP thật/TLS, same-origin API và SPA fallback vẫn cần staging evidence như audit
  gốc. Không tự sửa credentials hay triển khai hosting trong 7B.5.
- L01 không backfill tên lịch sử; nếu cần phải có review dữ liệu riêng. M03 muốn
  strict revoke thay policy hiện tại sẽ cần thiết kế/phase riêng.

Không kết luận production-ready chỉ từ build/tests xanh. Không thêm Redis,
hosting, observability infrastructure hoặc tính năng ngoài audit trong phase này.

## 8. Nguồn kỹ thuật

- [MDN AbortSignal timeout](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static)
  và [kết hợp signals](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static):
  deadline khác caller cancellation. Helper dùng timer/controller có cleanup để
  dọn deadline sớm sau completion, không đòi browser hỗ trợ static any/timeout.
- [Abortable fetch](https://developer.chrome.com/blog/abortable-fetch): abort cũng
  tác động đọc response body; fake transport bỏ qua signal cần guard kết quả cũ.
- [Playwright browsers](https://playwright.dev/docs/browsers) và
  [CI setup](https://playwright.dev/docs/ci): dependency package khác browser binary
  và OS dependencies; Edge channel local không chứng minh CI Chromium đã chạy.
