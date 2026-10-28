# Phase 7B.3 — TMDB Proxy Hardening

Ngày triển khai/kiểm tra: **28/10/2026**, dựa trên baseline `8ec3f71`.

## 1. Nguyên nhân gốc

Audit H03 ghi nhận 24 request đồng thời cùng `/api/movies/popular` tạo 24 fetch
upstream và peak concurrency 24. `backend/proxy.mjs` đã có endpoint allowlist,
Bearer token phía server, timeout 8 giây và cancellation cho từng client, nhưng
không có shared concurrency limit, bounded queue hoặc in-flight deduplication.

`useMovies` tải bốn tài nguyên song song; `useMovieDetails` tải details và genres;
`useFavoriteMovies`/`loadFavoriteMovies` giới hạn bốn workers trong từng browser.
Các giới hạn frontend không bảo vệ upstream khi có nhiều người dùng hoặc client
gọi HTTP trực tiếp. Không có cache upstream trong baseline để tái sử dụng.

Phase này giữ UI/API frontend, Auth/Profile/Favorites, session, CSRF/Origin và
trusted proxy/rate limiting 7B.1–7B.2. Không sửa Prisma/schema/migration/database,
không cài dependency, sửa credentials, deploy, commit hoặc push.

## 2. Những file tạo/sửa

| File | Trách nhiệm |
| --- | --- |
| `backend/upstream-scheduler.mjs` — mới | Bounded scheduler FIFO, shared in-flight jobs, subscriber cancellation, queue/runtime deadline, cấu hình. |
| `backend/tmdb-client.mjs` — mới | Canonical resource key, Bearer fetch, JSON validation, upstream HTTP mapping và error-body cleanup. |
| `backend/proxy.mjs` | Giữ allowlist/URL construction; đăng ký từng HTTP client vào scheduler chung; trả JSON/error contract cũ. |
| `backend/index.mjs` | Đọc cấu hình concurrency/queue sau khi load backend env, truyền vào app server. |
| `backend/.env.example` | Bổ sung cấu hình mẫu không bí mật. Không sửa `.env` thật. |
| `backend/tests/upstream-scheduler.test.mjs` — mới | Unit tests keys, bounds, FIFO, dedup, timeout/cancellation và late completion. |
| `backend/tests/proxy-hardening.test.mjs` — mới | Native HTTP integration với upstream được điều khiển bằng gates/streams. |
| `docs/phase-7b3-tmdb-proxy-hardening.md` — mới | Thiết kế, vận hành, bằng chứng và giới hạn. |

`docs/phase-7a-project-audit.md` đã untracked trước task; không chỉnh sửa.
Không thay đổi React source, package/lockfiles hoặc bảo vệ trusted IP/account binding.

## 3. Luồng request và scheduler

```text
GET /api/... → proxy endpoint/method/ID allowlist
             → fixed-origin URL + fixed supported parameters
             → canonical key
             → scheduler.run(key, fetch-and-validate, client signal)
                ├─ existing key: attach one subscriber
                ├─ available slot: start one job
                ├─ no slot: enqueue one unique job, with deadline
                └─ capacity exhausted: 503, no upstream fetch
             → JSON body validated once → shared result → sendJson per client
```

Một app server production tạo một proxy handler và một scheduler. Tất cả catalog,
genres, details, videos và recommendations đi qua scheduler này. Không tạo một
limiter riêng cho từng endpoint hoặc người dùng.

| Giới hạn mặc định | Giá trị | Cách tính |
| --- | --- | --- |
| Upstream concurrency | **6** | Giữ slot cả lúc nhận headers, đọc JSON và validate body. |
| Queue capacity | **32** | Số **job/tài nguyên khác nhau** đang đợi slot. |
| Subscriber capacity | **256** | Tổng client đang chờ trên các job running + queued, kể cả request trùng key. |
| Queue deadline | **2 giây** | Từ khi job đầu tiên vào queue; người đến sau không reset timer. |
| Upstream deadline | **8 giây** | Từ khi job lấy được slot đến khi đọc/validate xong body. |

Job cùng key đang queued vẫn được gộp, không chiếm thêm queue entry. Đủ 256
subscribers thì từ chối cả duplicate mới để tránh một key tạo bộ nhớ chờ vô hạn.
Job mới khi queue đầy bị từ chối ngay; không gọi upstream để thử vận may.

Queue FIFO và timers là event-driven, không polling, busy-wait hoặc interval.
Timers được `unref`; mọi đường kết thúc dọn timer và AbortSignal listeners.
`getStats()` chỉ trả snapshot counts cho tests; không có public metrics endpoint
hoặc log request keys/credentials.

## 4. Canonical key và deduplication

Key là URL upstream cố định origin/path và **toàn bộ query parameters ảnh hưởng
response**, sau khi sort tên tham số. Không lấy cookie, session hoặc Authorization
header của client làm input upstream; token được cấu hình riêng cho proxy handler.

- Path/ID, language, page, append payload và video language khác nhau có key khác.
- Thứ tự tên query không tạo key khác; thứ tự giá trị lặp cùng tên được giữ vì có
  thể ảnh hưởng nội dung.
- Helper từ chối origin ngoài TMDB, userinfo, fragment và các tham số credential
  như `api_key`; token thực tế chỉ ở Bearer header.
- Xóa key khi thành công, thất bại, timeout hoặc không còn subscriber. Không giữ
  response, error, TTL cache hoặc negative cache sau khi job kết thúc.
- Một request đến sau khi job hoàn tất sẽ fetch mới, kể cả URL giống hệt.
- Guard identity bảo đảm completion muộn của job cũ không xóa job mới cùng key.

**Không mở thêm query API frontend.** Route hiện có vẫn cố định `vi-VN`, trang 1,
và append `videos,recommendations,credits` cho details. Query tùy ý vẫn bị 404.
Tests page/language/filter isolation chạy ở key/scheduler layer; không ngầm thêm
pagination, language selection hoặc bộ lọc TMDB vào sản phẩm.

Đây là **in-flight deduplication**, không phải persistent caching. Response vẫn
có `Cache-Control: no-store` như trước.

## 5. Timeout và cancellation

Mỗi HTTP client có AbortController riêng. `request.aborted` hoặc response đóng
trước khi hoàn tất sẽ detach subscriber đó, hủy promise chờ của nó và gỡ listeners.

- Một client abort: không abort shared upstream nếu còn client khác.
- Subscriber cuối abort: xóa key; queued job được lấy khỏi queue mà không fetch;
  running job nhận `AbortController.abort()` để ngừng fetch/body read.
- Queue quá 2 giây: trả 503 riêng cho job đó và giải phóng queue/key/waiters.
- Upstream quá 8 giây: trả 504 cho các client còn chờ và abort upstream, bao gồm
  trường hợp headers đã tới nhưng JSON body còn treo.
- Thời gian một job mới có thể chờ thông thường tối đa xấp xỉ 2 + 8 = **10 giây**,
  không tính truyền response xuống client. Subscriber đến muộn dùng deadline cũ.
- Client abort không bị đổi thành lỗi timeout/network và không cố ghi response
  vào socket đã đóng.

**Physical slot:** chỉ tái sử dụng khi fetch/body-read promise thật sự settle.
Native fetch tôn trọng AbortSignal nên slot được giải phóng khi abort hoàn tất.
Nếu một custom transport cố ý bỏ qua abort hoặc không bao giờ settle, client vẫn
nhận timeout đúng hạn nhưng slot đó còn bị chiếm. Không mở slot mới giả tạo vì
cách đó sẽ làm số fetch thật vượt cap. Queue/waiters tiếp tục bị bound và timeout;
transport không hợp tác cần xử lý ở lớp transport/vận hành, có thể cần restart.
Đây là policy fail-closed, không cam kết phục hồi một promise treo vĩnh viễn.

Promise rejection luôn có consumer: task có try/catch/finally; proxy await từng
subscriber; cả late rejection sau abort cũng được quan sát. Không tự retry bất kỳ
upstream failure nào, không tạo retry storm khi TMDB trả 429.

## 6. HTTP error contract

Body giữ dạng `{ error: { code, message } }`. Không forward raw error body,
stack, Authorization, cookie hoặc upstream headers tùy ý.

| Tình huống | HTTP frontend | Error code / header |
| --- | --- | --- |
| Thành công, JSON hợp lệ | 200 | Public TMDB data như cũ. |
| Chưa cấu hình token | 503 | `TMDB_NOT_CONFIGURED`, không vào scheduler. |
| Upstream 400/401/403 | Giữ status | `TMDB_HTTP_<status>`, thông báo an toàn như cũ. |
| Upstream 404 ở movie/catalog/videos/recommendations | 404 | `TMDB_HTTP_404`, giữ convention cũ. |
| Upstream 404 ở genres | 502 | `TMDB_HTTP_404`, giữ convention cũ. |
| Upstream 429 | 429 | `TMDB_HTTP_429`, chỉ chuyển `Retry-After` dạng số. |
| Upstream 500/503 hoặc HTTP khác chưa hỗ trợ | 502 | `TMDB_HTTP_<status>`. |
| Network/JSON parse error | 502 | `UPSTREAM_UNAVAILABLE`. |
| JSON sai shape/ID | 502 | `INVALID_UPSTREAM_DATA`. |
| Queue/subscriber capacity đầy | 503 | `UPSTREAM_BUSY`, `Retry-After: 1`. |
| Queue deadline hết | 503 | `UPSTREAM_QUEUE_TIMEOUT`, `Retry-After: 1`. |
| Upstream deadline hết | 504 | `UPSTREAM_TIMEOUT`. |
| Client ngắt kết nối | Không gửi response mới | Detach/abort theo số subscriber còn lại. |

`Retry-After: 1` của overload là gợi ý để caller thử lại, không phải hứa chắc có
slot sau một giây. Upstream error bodies được cancel để trả tài nguyên kết nối,
không đọc rồi forward nội dung lỗi. Redirect upstream bị từ chối bằng
`redirect: 'error'`; không follow URL khác với credential server.

Allowlist, ID validation, fixed TMDB origin và query rejection giữ nguyên.
Không nhận URL upstream, headers credential hay scheduler config từ request client.
Không có nhánh chuyển lỗi upstream thành 200 hoặc dữ liệu phim mẫu.

## 7. Cấu hình và chạy ứng dụng

File mẫu bổ sung:

```dotenv
TMDB_MAX_CONCURRENT=6
TMDB_MAX_QUEUE=32
```

Startup load backend env rồi `readTmdbProxyConfig()` validate: concurrency **1…16**,
queue **0…128**, chỉ nhận số nguyên thập phân. Không cấu hình thì dùng default.
`0` queue nghĩa là không chờ unique job mới khi hết slot; duplicate vẫn có thể
join job hiện có nếu subscriber cap chưa đầy. Config sai chặn startup và thông báo
không echo giá trị. Restart backend sau khi thay đổi cấu hình.

Queue/runtime deadlines và subscriber cap có options ở factory để tests kiểm
soát; không nhận từ query và không thêm biến môi trường ngoài hai biến trên.
Giữ nguyên token backend, origins, trusted proxy policy và database guards.

Từ project root:

```powershell
npm.cmd run dev
```

Hoặc giữ workflow hai terminal `npm.cmd run dev:proxy` và
`npm.cmd run dev:frontend`. Không cần đổi frontend/API service.

## 8. Kiểm thử và bằng chứng

Upstream tests dùng mock/gates/ReadableStream có kiểm soát và HTTP loopback;
không gọi hoặc stress TMDB thật, gửi email thật hoặc sửa tài khoản/database thật.
Không dùng polling để chờ job bắt đầu trong tests mới.

Các bằng chứng chính:

- 24 HTTP clients cùng resource → **1 fetch**; sau completion, request mới fetch lại.
- 24 resource IDs khác nhau → **peak upstream 6**, tất cả hoàn tất.
- Catalog/genres/details/videos/recommendations dùng chung cap, bao gồm JSON reading.
- Key cùng resource nhưng khác page/language/filter không bị gộp sai.
- Queue và duplicate subscribers đầy → safe 503; queue deadline không chạy job hết hạn.
- Network error, sync throw, JSON/schema error, timeout và cancellation đều cleanup.
- Một client abort không hại client còn lại; tất cả abort hủy upstream.
- Transport cố ý bỏ qua abort vẫn không vượt physical cap; late failure không
  xóa key mới hoặc tạo unhandled rejection.
- 404/429/500/503 giữ status mapping; không retry; error body được cancel và không lộ token.

Kết quả thực tế:

| Kiểm tra | Kết quả |
| --- | --- |
| `npm.cmd test` | **363/363 pass**: backend 260, frontend 103; 0 fail/skip/cancelled. Gồm **31 tests mới**. |
| Strict unhandled-rejection suite | **51/51 pass**, bao gồm 31 tests mới và 20 proxy regression tests cũ; không ghi nhận unhandled rejection. |
| Lint | Pass, Oxlint theo script thực tế. |
| TypeScript | Pass, `tsc -b --force`. |
| Production build | Pass, Vite 8.3.4, 94 modules; frontend artifact không đổi. |
| `db:validate` | Pass, Prisma schema hợp lệ. |
| `db:check` | Pass, PostgreSQL 17.11; chỉ đọc metadata/count, không sửa dữ liệu hay đọc giá trị token/cookie. |
| Multi-tab browser 7B.1 | **22 nhóm checkpoint pass**. |
| Auth browser `--regression` | Pass: Auth/Recovery/AuthProvider, Details/Router, compact layout và cast. |
| Favorites browser | **12 nhóm checkpoint pass**. |
| Profile browser | **10 nhóm checkpoint pass**. |
| Change Password browser | **7 nhóm checkpoint pass**. |
| Trusted proxy/rate-limit 7B.2 | Toàn bộ 32 tests của phase này tiếp tục pass trong backend suite. |
| `git diff --check` | Pass. |

Các lệnh kiểm tra:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run db:validate
npm.cmd run db:check
node --unhandled-rejections=strict --test backend/tests/upstream-scheduler.test.mjs backend/tests/proxy-hardening.test.mjs backend/tests/proxy.test.mjs

$playwrightPath = 'D:\LearnReact\Cineverse\.npm-cache\_npx\e41f203b7505f1fb\node_modules\playwright'
node frontend/tests/multitabAuth.browser.cjs $playwrightPath
node frontend/tests/auth.browser.cjs $playwrightPath --regression
node frontend/tests/favorites.browser.cjs $playwrightPath
node frontend/tests/profile.browser.cjs $playwrightPath
node frontend/tests/changePassword.browser.cjs $playwrightPath
```

Playwright dùng cache có sẵn và Edge headless, không phải dependency mới của phase.
Logs `.npm-cache/phase-7b3-*` được ignore; không đưa screenshots/cache vào source.
Chưa kiểm tra TMDB live, hosting thật, throughput production hoặc mọi transport
không chuẩn. Browser tests dùng fixture accounts, không thay đổi người dùng thật.

## 9. Giới hạn nhiều instances và production

- Scheduler thuộc từng app server/process; N instances có thể tạo N×6 upstream
  jobs và N×32 queued jobs với defaults. Dedup không xuyên process/instances.
- Không phải distributed quota hoặc requests-per-second limiter. Upstream nhanh
  vẫn có thể nhận nhiều lượt/giây. TMDB có thể trả 429; vẫn chuyển lỗi và tôn trọng
  Retry-After, không tự bật retry/cooldown/cache dài hạn.
- Cần sizing theo topology và ngân sách upstream, rate limiting tại ingress,
  network/connection/resource monitoring trước public deployment. Không thêm Redis,
  external queue hoặc sửa rate limit Authentication trong task này.
- Không cache dữ liệu Auth/Profile/Favorites. Chỉ public TMDB metadata được chia sẻ;
  không chuyển session/account headers sang TMDB.
- Không xử lý M01 (deadline frontend), H04 (database privileges), hay thay đổi
  semantics revoke/in-flight writes đã ghi trong 7B.1. Không mở rộng scope âm thầm.

## 10. Tài liệu chính thức

- [TMDB Rate Limiting](https://developer.themoviedb.org/docs/rate-limiting): giới hạn
  dịch vụ có thể thay đổi; phải tôn trọng 429, không suy ra một quota cố định được bảo đảm.
- [Node.js AbortController](https://nodejs.org/api/globals.html#class-abortcontroller):
  signal và abort để hủy hoạt động async, gỡ listener khi hoàn tất.
- [Fetch cancellation và response body](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#canceling_a_request):
  hủy cả bước đọc body sau khi fetch đã trả headers.
