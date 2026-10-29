# Phase 8A — Performance audit & optimization

## Phạm vi và phương pháp

Baseline: commit `47883af4a650246476ad406be2a44076a86ea430`, trước mọi sửa đổi
product của Phase 8A. Build Vite production, lưu bản sao ở
`.npm-cache/phase-8a/before/dist`. Bản sau dùng `frontend/dist`.
Không dùng Vite dev server để đưa ra kết luận performance.

Build đối chiếu bằng Node 22.23.4 (`.node-version`), Vite 8.3.4, React 19.
Harness chạy Node 22.18.0, Playwright 1.64.1, Edge headless 156.0.4314.50,
Windows x64 trên cùng máy local. Build lại bằng Node 22.23.4 cho cùng hash
assets như bản sau đã đo.

| Điều kiện | Desktop | Mobile mô phỏng |
| --- | --- | --- |
| Viewport | 1440 × 1000 | 375 × 812 |
| DPR | 1 | 2 |
| CPU CDP | 1× | 4× slowdown |
| Network CDP | 10 Mbps, 40 ms latency | 1,6 Mbps, 150 ms latency |
| Cache | Cold, context mới mỗi lần | Cold, context mới mỗi lần |
| Lần đo | 3, lấy median và khoảng min–max | 3, lấy median và khoảng min–max |

Harness `scripts/measure-performance.mjs` phục vụ **artifact build thực** bằng
HTTP local, gzip; SPA fallback cho URL trực tiếp. API là fixture 60 phim chia
3 danh sách, 2 thể loại; tài khoản synthetic chỉ phục vụ UI test. Không đọc
`.env`, không gọi live TMDB API, không kết nối PostgreSQL, không đo auth latency
thật. API/JS/CSS đi qua network throttling CDP.

Ảnh dùng 7 file JPEG công khai đã tải một lần từ TMDB (cùng byte nguồn cho cả
hai phiên bản). URL fixture khác nhau để mô phỏng poster của các phim độc lập.
Playwright intercept ảnh và trả bytes trong RAM, với delay bằng latency cộng
bytes/throughput cho từng ảnh. **Đây là mô hình từng response, không mô phỏng
đầy đủ cạnh tranh băng thông, DNS/TLS hoặc CDN.** Routing của Playwright tắt
HTTP cache; không xem các phép đo này là warm-cache. Chưa đo thiết bị mobile
thật, Lighthouse score, CrUX/RUM hoặc live TMDB/CDN waterfall.

LCP/CLS thu bằng PerformanceObserver trước khi khởi tạo React. CLS là giá trị
session window lớn nhất (gap 1s, tối đa 5s), bỏ layout shift có recent input.
Snapshot lấy 2 giây sau khi Hero hoàn tất tải, trước tương tác/cuộn. LCP
candidate của cả 6 lần mỗi phiên bản là `.hero-backdrop`.

Sau snapshot, nhập một phím thật vào Search và đổi sort để kiểm tra phản hồi.
Event Timing chỉ có các interaction được thực thi trong lab; **không phải INP
field hoặc INP đầy đủ của một phiên sử dụng**. Không gán 0 cho interaction
không vượt ngưỡng quan sát 16ms.

## Những vấn đề có bằng chứng

1. `App.tsx` import eager tất cả trang. Home tải cả Details, Profile, Auth forms
   và recovery code dù chưa mở chúng. Baseline chỉ có một JS 357.799 bytes.
2. Hero yêu cầu `w1280` ở khung 671px desktop DPR1 và 335px mobile DPR2.
   Card yêu cầu `w500` ở khung 244px desktop và 161,5px mobile. Candidate
   nhỏ hơn đáp ứng các kích thước đã đo.
3. CSS Details/Profile nằm trong CSS đầu trang 42.416 bytes dù Home không dùng.
   Dynamic imports cho phép Vite tự tách chúng; không chỉnh manualChunks.

## Thay đổi

- `App.tsx`: `React.lazy()` cho Details, Favorites, Profile, Login/Register,
  Forgot/Reset; khai báo lazy ở module scope. Home và shell vẫn tải ngay.
  `useMovies`, search/filter State và hai Providers giữ nguyên vị trí/lifetime.
- `RouteBoundary.tsx`: Suspense loading accessible, giữ Header/Footer; error
  boundary khi tải module lỗi, nút tải lại do người dùng chủ động. Boundary
  reset khi đổi pathname. Không tự replay mutation hay tự reload.
- `responsiveImage.ts`: srcSet từ URL TMDB hợp lệ; giữ nguyên URL local/custom,
  không thêm candidates cho host/query/path không hợp lệ. Poster 185/342/500/780;
  backdrop 300/780/1280. Không thay mapper hoặc API DTO.
- `MovieCard.tsx`: srcSet và `sizes="auto, ..."` cho lazy poster. Browser hỗ trợ
  auto dùng chiều rộng layout thật, bao gồm grid Favorites có breakpoint khác;
  browser cũ dùng fallback rộng hơn. Giữ lazy, async, width/height và fallback.
- `HeroBanner.tsx`: srcSet/sizes theo layout; giữ ảnh eager, `fetchPriority=high`,
  aspect ratio và fallback. Không preload cả danh sách.
- `MovieDetailsPage.tsx`: chọn poster theo khung 80/110/220px; backdrop lazy có
  auto sizes. Không đổi dữ liệu, nội dung, thứ tự hoặc typography.
- `responsiveImage.test.ts`: 3 tests cho candidate đúng loại, giữ file gốc và
  bỏ qua URL ngoài phạm vi/malformed.
- `scripts/measure-performance.mjs`, `package.json`: lệnh `perf:measure`,
  bundle compression, resource timing, metric observers, screenshots và
  production route/image regression.
- `README.md` và tài liệu này: cách chạy, bằng chứng và giới hạn.

Không thay CSS thiết kế, backend, authentication, schema/migrations, token,
Origin/CSRF, session binding hay trusted proxy/scheduler.

## Bundle Before → After

Đơn vị bytes, không phải KiB. Compression đo cùng cách: Node zlib `gzipSync`
mặc định và `brotliCompressSync` mặc định; không cộng HTTP header vào bảng.
Số gzip console của Vite dùng implementation/options khác và có thể chênh nhẹ.
Compression cộng từng file độc lập, không nén gộp các chunks.

| Payload | Before raw / gzip / Brotli | After raw / gzip / Brotli |
| --- | --- | --- |
| JS ban đầu Home | 357.799 / 108.112 / 92.827 | 315.603 / 99.823 / 86.845 |
| CSS ban đầu Home | 42.416 / 8.261 / 7.236 | 30.257 / 6.348 / 5.543 |
| Tổng mọi JS chunks | 357.799 / 108.112 / 92.827 | 362.757 / 117.588 / 102.547 |
| Tổng mọi CSS chunks | 42.416 / 8.261 / 7.236 | 42.418 / 9.578 / 8.222 |

JS ban đầu giảm **11,8% raw / 7,7% gzip**; CSS ban đầu giảm **28,7% raw**.
Tổng JS tăng khoảng 1,4% raw, 8,8% gzip do import/preload machinery, boundary,
srcSet helper và compression độc lập. Đây là đánh đổi để không tải mọi trang
ngay lập tức; không tuyên bố tổng dung lượng ứng dụng giảm.

| Chunks sau tối ưu | Raw | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| index JS | 267.276 | 82.767 | 71.554 |
| jsx-runtime/shared JS (cũng tải ban đầu) | 48.327 | 17.056 | 15.291 |
| MovieDetailsPage JS | 12.005 | 4.459 | 3.954 |
| ProfilePage JS | 15.546 | 5.060 | 4.506 |
| FavoritesPage JS | 5.655 | 2.156 | 1.955 |
| AuthForm shared JS | 6.810 | 2.424 | 2.121 |
| LoginPage JS | 164 | 160 | 165 |
| RegisterPage JS | 170 | 160 | 118 |
| ForgotPasswordPage JS | 2.449 | 1.198 | 1.029 |
| ResetPasswordPage JS | 3.560 | 1.662 | 1.440 |
| PasswordRecoveryLayout shared JS | 795 | 486 | 414 |
| index CSS | 30.257 | 6.348 | 5.543 |
| MovieDetailsPage CSS | 6.163 | 1.680 | 1.422 |
| ProfilePage CSS | 5.998 | 1.550 | 1.257 |

Không nhầm riêng `index.js` 267kB với toàn bộ JS ban đầu: phải cộng shared
chunk được modulepreload. `Auth.css` vẫn có phần cần cho AccountMenu trong
initial CSS; không refactor CSS dùng chung để tiếp tục giảm số liệu bằng mọi giá.

## Metrics Before → After

Các số dưới đây là lab với fixture/mô hình mạng nói trên, không phải cam kết
Core Web Vitals ngoài production. Kết quả chỉ áp dụng cho Home trong workload này.
Hai tối ưu được đo cùng nhau; chưa có phép A/B tách riêng đóng góp LCP của
code splitting so với responsive images.

| Metric | Before | After |
| --- | ---: | ---: |
| Desktop LCP median (min–max), ms | 652 (644–652) | 560 (524–568) |
| Mobile LCP median (min–max), ms | 2.772 (2.756–2.776) | 2.092 (2.084–2.112) |
| Desktop CLS | 0,000290 | 0,000290 |
| Mobile CLS | 0,000936 | 0,000936 |
| Desktop ảnh yêu cầu tại snapshot, bytes | 1.240.868 | 721.527 |
| Mobile ảnh yêu cầu tại snapshot, bytes | 619.748 | 339.549 |
| Desktop/mobile Hero candidate | w1280 | w780 |
| Desktop/mobile Card candidate đầu | w500 | w342 |
| Desktop số image requests ban đầu | 11 | 11 |
| Mobile số image requests ban đầu | 5 | 5 |
| Home API requests, guest | 5 | 5 |
| JS requests ban đầu | 1 | 2 |
| CSS requests ban đầu | 1 | 1 |
| Tổng requests tại snapshot desktop (kể cả document/ảnh/logo/favicon) | 21 | 22 |
| Tổng requests tại snapshot mobile (kể cả document/ảnh/logo) | 15 | 16 |
| Desktop max Event Timing mỗi run, ms | 16 / 24 / 24 | 16 / 16 / 24 |
| Mobile max Event Timing mỗi run, ms | 40 / 32 / 72 | 32 / 40 / 88 |

Ảnh tiết kiệm khoảng 41,9% desktop, 45,2% mobile **cho JPEG fixtures này**;
dung lượng ảnh phim thật thay đổi theo từng file. Bytes ảnh được cộng từ body
fixture đã yêu cầu, không giả dùng `transferSize=0` của cross-origin thành dung
lượng thật. Với srcSet, `naturalWidth` có thể được browser density-correct;
xác nhận candidate bằng `currentSrc`, không suy ngược tên file từ naturalWidth.

Event Timing không chứng minh cải thiện responsiveness (sample xấu nhất mobile
tăng từ 72 lên 88ms; workload ngắn/ít mẫu, không quy kết đây là INP regression).
Các long tasks desktop
không xuất hiện trong snapshot; mobile còn bootstrap/render tasks >50ms. Chưa
có profiler để quy kết chúng cho một component, nên không thêm memo hàng loạt.
CLS thấp trong lab nhưng chưa chứng minh CLS cả phiên, font/máy/mạng thực tế.

Waterfall thô có `startTime`, `duration`, `encodedBodySize`, `transferSize` cho
từng resource trong JSON. Luồng là HTML → entry/shared JS+CSS → `/me` và 4
catalog requests song song → Hero/posters. Không biến 4 request catalog thành
waterfall nối tiếp. Hero vẫn phát hiện sau API trong CSR; chưa SSR/preload API.

## Request/routing và rendering đã kiểm tra

Guest Home: `/me` + popular + now_playing + top_rated + genres = 5 API requests.
Member Home thêm Favorites list = 6. Trong cùng document, member Home → Details
thêm details + genres = 8 cumulative; Back Home vẫn 8; Forward Details = 10.
Cả trước/sau có cùng pattern. Details module chưa tải ở Home, chỉ xuất hiện sau
nhấn card; quay lại route đã import không tải lại module trong cùng document.

Mỗi direct load Favorites có `/me`, Favorites list và 3 metadata requests trong
fixture (worker pool tối đa 4); Profile có `/me`, Favorites list, Profile GET.
Những GET này giữ nguyên. Browser refresh tạo document/React state mới, không
được xem là duplicate request bug. Header focus/visibility revalidation phục vụ
multi-tab safety, không loại bỏ để giảm request count.

`useMovies` đã cache successful sources theo requestVersion trong lifetime App;
partial retry chỉ gọi resource lỗi. `useMovieDetails` có ID/dependency/current
guard và abort, `useFavoriteMovies` cache theo owner trong lifetime trang, pool
4 workers, chỉ tải các ID chưa có. FavoritesProvider bảo vệ owner/epoch,
generation, pending mutations; AuthProvider coalesce revalidation. API deadline
12s và scheduler upstream/queue bounds vẫn nguyên vẹn. Không mở cache private
toàn cục hoặc bỏ cancellation.

Lọc + sort tên 60 phim, warmup 500 lần, 5 batch × 1.000 lần trên Node local:
median khoảng **0,0069ms/lần**. Microbenchmark không phải browser render timing;
chỉ cho thấy phép tính thuần nhỏ ở quy mô hiện tại, chưa có bằng chứng cần
`useMemo`. MovieList đã chỉ mount một hàng mỗi section; Favorites chỉ tải metadata
cho nhóm đang hiển thị. Không có bằng chứng cần virtualization cho 60 phim.

Chưa đếm số lần gọi từng React component bằng production profiling build;
DOM mutations/long tasks không phải số lần React re-render. Provider value và
callbacks có thể đổi identity khi state cập nhật; chưa đủ bằng chứng để can
thiệp vào security lifecycle hoặc thêm React.memo/useCallback.

## Regression và quality gates

- `npm test`: **399 tests** = 287 backend + 112 frontend, 0 fail/skip; thêm 3
  responsive image tests so với baseline 396.
- `npm run test:browser`: toàn bộ runner đạt trên Edge: Auth/Recovery,
  MovieDetails/compact/cast, Auth layout, Favorites (12 nhóm), Profile (10),
  Change Password (7), multi-tab (22), audit remediation (8).
- Browser regressions cũ chạy Vite dev để kiểm tra hành vi, không dùng timing
  của chúng làm số liệu performance.
- Harness production kiểm tra Home/search/sort, card → Details, Back/Forward,
  direct Favorites/Profile/Login/Register/Forgot/Reset trên desktop/mobile;
  không iframe trailer trước thao tác. Lazy chunk download failure giữ shell,
  tải lại phục hồi trực tiếp Details; ảnh responsive lỗi vẫn dùng fallback cũ.
- Responsive production tại 375/1440px không tràn ngang; các regression Auth,
  Profile/Password cũ còn kiểm tra 320/375/768/1024/1440px theo từng suite.
- Lint, TypeScript check, production build, Prisma validation đạt.
- Không push nên không có GitHub Actions run mới cho Phase 8A; kết quả trên là
  gate local đã thực thi, không phải tuyên bố CI mới đã xanh.
- `db:check` chỉ đọc PostgreSQL 17.11 `cineverse_dev` đạt; không reset/migrate,
  không sửa tài khoản, password hoặc Favorites thật. Native PostgreSQL gate
  không chạy lại ở Phase này vì không sửa backend/database; không gộp 14 tests
  của báo cáo Phase 7C vào 399 tests mới.

## Tái lập và artifact

```powershell
npm.cmd run build
npm.cmd run perf:measure -- --prepare-images
npm.cmd run perf:measure -- --output .npm-cache/phase-8a/after.json
# Nếu còn baseline artifact đã lưu:
npm.cmd run perf:measure -- --dist .npm-cache/phase-8a/before/dist --output .npm-cache/phase-8a/before.json
```

Nếu chưa có dependency: `npm ci` và `npm --prefix frontend ci` bằng Node theo
`.node-version`. Edge được chọn mặc định trên Windows; máy khác cần Playwright
Chromium (`npx playwright install chromium`). Có thể chọn channel qua
`CINEVERSE_BROWSER_CHANNEL`. Download ảnh cần Internet công khai, không cần key;
khi đã cache, phép đo không gọi Internet/API thật. Không chạy backend khi đo.

Để dựng lại baseline trên máy khác, dùng checkout riêng của commit baseline rồi
build, sau đó chạy harness mới trỏ `--dist` vào artifact đó. Không checkout/reset
working tree đang làm việc để lấy số liệu cũ. Giữ cùng browser, máy, DPR,
network/CPU và bytes image fixtures. Không chạy quality suites đồng thời với
measurement lấy timing.

Raw evidence: `.npm-cache/phase-8a/before.json`, `after.json`; production failure
regression ở `verification.json`; build/test logs trong `.npm-cache/phase-8a-*.log`.
Screenshots tách theo tên output ở `.npm-cache/phase-8a/screenshots/before/` và
`screenshots/after/`. Đây là ảnh fixture, không đại diện dữ liệu TMDB live.
Cache, screenshots và dist được Git ignore; chỉ lưu bảng tổng hợp vào tài liệu.

## Phân loại và giới hạn

| Hạng mục | Trạng thái |
| --- | --- |
| Initial JS/CSS, code tải cho route chưa truy cập | Đã đo và cải thiện |
| Candidate ảnh theo frame/DPR, fixture bytes | Đã đo và cải thiện |
| Home LCP trong mô hình lab | Đã đo và cải thiện, không suy rộng sang field |
| CLS, fallback, keyboard/route/navigation | Đã kiểm tra, giữ hành vi |
| Memoization/virtualization, derived State | Đã xem xét, chưa có bằng chứng cần sửa |
| Deadlines, scheduler, private cache, multi-tab safety | Đã kiểm tra/regression, giữ nguyên |
| Warm HTTP cache, live CDN/TMDB và production compression | Chưa xác minh |
| Real-user LCP/INP/CLS, Lighthouse score, mobile thật | Chưa xác minh |
| React per-component production profiling | Chưa xác minh |

Tradeoff: thêm một shared JS request lúc khởi động; cold navigation phải tải
page chunks (có Suspense). Tổng mọi chunks lớn hơn. Browser cũ không hỗ trợ
auto sizes có thể chọn ảnh lớn hơn. Các màn hình/DPR ngoài hai profile lab cần
kiểm tra thêm. Khi deploy phải dùng SPA fallback, giữ assets của release cũ đủ
lâu và cấu hình immutable hashed assets/revalidation HTML phù hợp. Explicit
reload khi chunk lỗi tạo document mới; reset token chỉ nằm trong RAM như policy
hiện tại, nên nếu reload recovery thì có thể cần mở lại link email. Không lưu
token vào storage để khắc phục tình huống này.

Phase 8B nên ưu tiên: RUM có chính sách privacy và consent phù hợp; Lighthouse/
trace trên staging và mobile thật; warm-cache/CDN/compression/cache headers;
bounded cache metadata công khai nếu trace chứng minh Details/Favorites refetch
là đáng kể. Chỉ tách context/memo hóa sau profiling interaction cụ thể; cân nhắc
route prefetch có giới hạn theo thao tác người dùng nếu cold navigation chậm.
Không tự thực hiện các việc đó ở Phase 8A. Không commit/push/deploy.

## Đọc code để học

1. `App.tsx`: `lazy()` ở ngoài render, dynamic `import()`, `Suspense` trong shell.
2. `RouteBoundary.tsx`: fallback khi chờ tải và error boundary khi module lỗi.
3. `responsiveImage.ts` → `HeroBanner.tsx` / `MovieCard.tsx`: browser chọn candidate
   từ srcSet, sizes và DPR; giữ lazy cho poster và eager/high cho Hero.
4. `scripts/measure-performance.mjs`: phân biệt cold fixtures, resource bytes,
   lab LCP/CLS và interaction samples.

React re-render là chạy lại component để tính cây giao diện; React so sánh cây
mới/cũ rồi chỉ cập nhật DOM cần đổi. Một re-render không đồng nghĩa thay toàn DOM.
Code splitting chia JavaScript thành các module/chunks tải theo nhu cầu; đổi lại
có latency request khi mở route lần đầu. Lazy ảnh trì hoãn tải file ảnh theo
viewport; lazy component trì hoãn tải code rồi mới render component. `useMemo`
cache phép tính theo dependency, vẫn tốn so sánh/lưu cache và dễ sai dependency;
không giúp nếu tính toán rẻ hoặc dependency luôn đổi. Chọn nó từ profiling,
không từ số lượng component.

Nguồn chính thức: [React lazy](https://react.dev/reference/react/lazy),
[Suspense](https://react.dev/reference/react/Suspense),
[TMDB image basics](https://developer.themoviedb.org/docs/image-basics),
[TMDB configuration](https://developer.themoviedb.org/reference/configuration-details),
[INP lab/field](https://web.dev/articles/inp).
