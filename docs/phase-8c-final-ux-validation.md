# Phase 8C — Final UX & accessibility validation

## Phạm vi và baseline

Baseline: `0fa7cfce9db65732d96cf366c0ff4383ef05150b` (Phase 8B), working tree
sạch trước audit. Production build lưu ở `.npm-cache/phase-8c/before-dist`;
bản sau là `frontend/dist`. Không dùng dev-mode timings để kết luận hiệu năng.
Ngày thực hiện: 31/10/2026, Windows x64, Playwright 1.64.1, Edge headless
156.0.4314.50, Node 22.18.0 (đúng engines hiện tại; CI tiếp tục pin 22.23.4).
Host báo Intel64 Family 6 Model 186 Stepping 2, 16 logical processors qua
environment Windows; CPU throttling CDP không đại diện CPU điện thoại thật.
API và ảnh trong UX tests là fixtures tổng hợp, không gọi TMDB,
SMTP hay submit tài khoản thật. Chỉ `db:check` truy vấn metadata/counts local.

Đã đọc docs 8A/8B, Router/RouteBoundary/RouteFocus, CSS, loading/error/empty
states, MovieCard/Details, hooks và browser suites hiện có. Không đổi layout,
backend, schema/migration hoặc session/CSRF/Origin policy.

## Findings và before → after

| ID / severity | Bằng chứng trước sửa | Kết quả / xử lý |
| --- | --- | --- |
| UX01 / Low | Home và Details đều có `document.title = "Cineverse"`; tìm source chỉ có title trong index.html. Khó nhận diện trang qua browser tabs/assistive technology. | `RouteFocus` đặt title tĩnh theo route, Details theo heading phim khi dữ liệu tới; loading có title dự phòng; invalid ID, 404 và lỗi tải có title tương ứng. MutationObserver cleanup khi đổi route. Regression kiểm tra đổi ID, Retry, Back/Forward và response muộn sau khi về Home. |
| OBS01 / Informational | Axe trong forced colors báo `color-contrast` ở Welcome Panel Login và hero Profile: authored ivory `#f6f3ed` trên nền đã bị ép trắng, ratio 1.1. | Đã xem screenshot: chữ được browser vẽ đen, link xanh trên nền trắng, không giống authored color mà axe sử dụng. Giữ raw diagnostics để review; không sửa thiết kế để chiều theo false positive. Kiểm tra media active và `forced-color-adjust:auto`; không tắt contrast rule của suite 8B. |
| OBS02 / Verified unchanged | Nghi ngờ Back về Home mất vị trí do RouteFocus gọi scrollTo(0). | Reproduce trên baseline: 2282px → 2282px nhờ browser history restoration. Không sửa hành vi đang đúng. Thêm assertion Back/Forward để bảo vệ. |
| LIMIT01 / Manual validation pending | Không có môi trường điều khiển browser chrome zoom hoặc screen reader/điện thoại thật. | Có reflow geometry, AX tree và touch emulation; checklist staging bên dưới. Không coi kết quả tự động là chứng nhận WCAG toàn site. |

Không tìm thấy lỗi responsive, forced-colors paint hoặc reduced-motion mới cần
đổi CSS trong các trạng thái đã kiểm tra. Chỉ sửa product code có bằng chứng UX01.

## Files thay đổi

- `frontend/src/components/RouteFocus.tsx`: title theo pathname, async heading,
  observer chỉ trên Details/NotFound, cleanup; giữ nguyên focus/scroll effect.
  Không đưa tên tài khoản, email hoặc reset token từ URL vào title.
- `frontend/tests/accessibility.browser.cjs`: thêm nhánh `--advanced` và options
  cho browser context; tái sử dụng fixture/server/axe/layout, không copy cả harness.
- `frontend/tests/uxValidation.browser.cjs`: suite production UX mới; output JSON
  và screenshots nằm trong cache bị Git ignore.
- `scripts/test-browser.mjs`: chạy thêm suite advanced; không bỏ gate hiện có.
- `package.json`: script `test:ux`, không thêm dependency/lockfile mới.
- `README.md` và tài liệu này: cách chạy, evidence, giới hạn và checklist staging.

## Zoom và reflow

Đã thử `Control+Equal` trong Edge headless tại viewport 1280: `innerWidth=1280`,
DPR=1, visualViewport.scale=1 trước và sau. **Không có bằng chứng browser zoom
thật đã hoạt động**. Không dùng CSS zoom, CDP pinch scale hoặc DPR riêng lẻ để
tuyên bố đã kiểm thử browser zoom.

| Phép thử | CSS viewport | DPR | Kết quả |
| --- | --- | --- | --- |
| Hình học tương đương 1280×900 ở 200% | 640×450 | 2 | Không overflow trong các trạng thái kiểm tra |
| Hình học tương đương 1280×900 ở 400% | 320×225 | 4 | Không overflow trong các trạng thái kiểm tra |

24 snapshots: 9 routes × 2 cấu hình (Home, Details, Favorites, Login, Register,
Forgot, Reset với token fixture, Profile, NotFound), cộng menu mở, tìm kiếm rỗng
và form Change Password ở cả hai cấu hình. Kiểm tra overflow toàn document và
axe. Nội dung dọc được cuộn; không áp dụng ngoại lệ WCAG để bỏ qua overflow.
Các kết quả này là **viewport/DPR emulation**, không thay manual browser zoom
200/400% trên Chrome/Edge/Firefox/Safari với font và OS scaling thật.

## Forced colors, motion và AX tree

- `forcedColors:active` trên Home/member, loading Details, Login/guest,
  Profile/edit và lỗi TMDB;
  5 snapshots. Screenshot giữ viền nút/input, icon tim filled khi selected,
  focus outline và nội dung lỗi. Palette được kiểm tra là nền trắng của browser
  emulation; chưa thay thế Windows High Contrast themes thật.
- Favorite selected có `aria-pressed=true` và icon fill, không chỉ đổi màu nền;
  media active/auto-adjust/focus có assertions. Submit Login và nút trên Home
  vẫn có viền phân biệt với nền. Form Login trống vẫn có nội dung lỗi, liên kết
  aria-describedby/aria-invalid và đưa focus tới email; loading có chữ status.
- Reduced motion: media match, poster transition `0s`, animation `none`.
  CSS và animation hiện tại được giữ nguyên vì đã đạt.
- CDP `Accessibility.getFullAXTree`: xác nhận banner, navigation **khi menu đã
  mở**, search, main, contentinfo. Menu đóng dùng display:none nên không phải
  lỗi khi navigation vắng khỏi AX tree. Không sửa semantic đang đúng.
- 29 snapshots advanced ở màu thông thường: không axe violation. 5 snapshots
  forced colors: không violation ngoài contrast; giữ **2 contrast diagnostics**
  ở Login/Profile cho manual review (12 nodes). Không tuyên bố "mọi axe rule ở
  mọi forced-color state đều xanh". Chỉ 12 selector đã đối chiếu screenshot được
  ghi nhận riêng; contrast diagnostic ở selector/state mới sẽ làm gate thất bại
  để review. Đồng thời kiểm tra auto-adjust của text/controls. Suite 8B vẫn chạy
  nguyên mọi rule contrast.

**Chưa chạy NVDA/VoiceOver/TalkBack thực tế.** NVDA không có trong PATH, process
hay vị trí cài mặc định đã kiểm tra; VoiceOver không có trên Windows. AX tree
không chứng minh thứ tự đọc, phát âm, timing thông báo hay trải nghiệm thực tế.

## Touch/mobile và edge cases

Touch context: `isMobile=true`, `hasTouch=true`, DPR2; portrait 375×812 → landscape
812×375. Đã tap menu/Favorite và kiểm tra responsive, không overflow. Register
được stress với chiều cao 380px, scroll input và submit vào vùng nhìn thấy.
Đây là **layout-height proxy**, không phải keyboard iOS/Android thật hay kiểm
chứng visual viewport khi bàn phím hệ điều hành mở.

| Trạng thái | Evidence |
| --- | --- |
| Slow Details | Delay fixture 900ms, loading role=status hiện trước dữ liệu |
| Mất kết nối | Abort request bằng `internetdisconnected`; alert và Retry; không phải tắt mạng thiết bị thật |
| TMDB 503 | Fixture 503, thông báo lỗi + Retry; forced colors vẫn dùng được |
| Timeout | Delay 13s; deadline thật 12s của frontend trả error, Retry phục hồi |
| Empty search / Favorites | Không overflow; empty Favorites có link khám phá; search rỗng được axe ở reflow |
| Poster fail | Abort ảnh, Details dùng poster-fallback |
| Lazy chunk fail | Abort module Details, giữ Header và nút explicit reload; smoke performance kiểm tra reload phục hồi |
| Back/Forward | Quay lại catalog khôi phục vị trí, Forward mở đúng Details |
| Route title | Details ID1 → ID2, invalid ID, NotFound, Auth routes, Retry; request cũ không ghi title Home |
| Logout/session expired khi request còn chạy | Reuse suites multi-tab/Auth/Profile/Favorites/Change Password; không đổi policy hoặc mock thành công để lách session binding |

## Quality gates và performance

Phần performance đo trước khi chạy quality suites, không đo trong lúc Node
tests hoặc browser regressions chiếm CPU. Harness gốc `measure-performance.mjs`
không thay đổi; bản measurement-only trong ignored cache bỏ navigation smoke
khỏi lượt timing, giữ hai artifact ở cùng HTTP server và đổi đúng index.html.
Một Edge process, mỗi sample cold context mới, thứ tự **before/after/after/
before/before/after** cho mỗi device. Xác nhận initial resource URLs trỏ đúng
`index-DvlJhk4w.js` trước và `index-CPnYMZEk.js` sau. Ba samples mỗi phiên bản
mỗi device; giữ nguyên mọi sample, không loại outlier.

Điều kiện giống 8A: desktop 1440×1000/DPR1, CPU1×, 10Mbps/40ms; mobile
375×812/DPR2, CPU4×, 1.6Mbps/150ms. Cache tắt bởi Playwright routing; API fixture
và 7 JPEG TMDB cached giống nhau. Ảnh trả RAM với per-image delay, không mô
phỏng đầy đủ DNS/TLS/CDN/bandwidth contention. LCP/CLS qua PerformanceObserver
trước React, snapshot 2s sau Hero loaded, trước tương tác/scroll. CLS dùng
session windows, bỏ recent input. Candidate LCP là `.hero-backdrop`.

| Home initial payload, bytes | Before (8B) | After (8C) |
| --- | ---: | ---: |
| JS raw / gzip / Brotli | 316497 / 100024 / 87006 | 317262 / 100344 / 87284 |
| CSS raw / gzip / Brotli | 30640 / 6444 / 5643 | 30640 / 6444 / 5643 |
| JS requests / CSS requests | 2 / 1 | 2 / 1 |
| Guest API requests (cả hai devices) | 5 | 5 |
| Tổng requests desktop / mobile | 22 / 16 | 22 / 16 |
| TMDB image bytes desktop / mobile | 721527 / 339549 | 721527 / 339549 |

| Lab measurement | Before | After |
| --- | --- | --- |
| Desktop LCP samples, ms | 568 / 504 / 528 | 536 / 520 / 544 |
| Desktop median LCP; range, ms | 528; 504–568 | 536; 520–544 |
| Mobile LCP samples, ms | 2100 / 2100 / 3652 | 2120 / 2120 / 2136 |
| Mobile median LCP; range, ms | 2100; 2100–3652 | 2120; 2120–2136 |
| Desktop CLS | 0.0002956 | 0.0002956 |
| Mobile CLS | 0.00096594 | 0.00096594 |

Tradeoff: route title thêm **765 bytes raw / 320 bytes gzip** vào initial JS;
không đổi CSS, image bytes, số requests hay lazy route structure. Median LCP
chênh +8ms desktop/+20ms mobile trong mẫu nhỏ; có outlier 3652ms trước sửa.
Không đủ cơ sở coi đây là cải thiện hoặc hồi quy timing có ý nghĩa; không
che outlier bằng cách chỉ báo sample tốt nhất. Không có cải thiện performance
mới được tuyên bố trong Phase 8C; mục tiêu là giữ tối ưu 8A.

Lệnh smoke **gốc**, chạy riêng `perf:measure -- --runs 1`, đã đạt cả desktop
và mobile: lazy Details không tải ở Home, tải khi click, URL trực tiếp/refresh,
Auth/Profile/Favorites, Back/Forward, search/sort, không overflow; lỗi module
giữ shell và explicit reload phục hồi; responsive poster lỗi có fallback.
Đây là regression smoke, không trộn vào các median đối chiếu ở trên.

Chưa chạy Lighthouse (repo không có dependency này); không có Lighthouse score,
field LCP/CLS/INP hoặc RUM/CrUX. Event Timing ngắn trong automation không được
gọi là INP thực. Các mục tiêu CWV cần xác minh lại trên staging và dữ liệu người
dùng thật nếu có hạ tầng đo.

| Quality gate trên source/build cuối | Kết quả |
| --- | --- |
| Backend Node tests | 287 đạt, 0 fail/skip |
| Frontend Node tests | 112 đạt, 0 fail/skip; tổng 399 |
| Oxlint / TypeScript / Vite production build | Đạt |
| Prisma schema validation | Đạt; đã xác nhận native exit code 0 |
| PostgreSQL read-only `db:check` | Đạt trên 17.11; metadata/count queries, không sửa bản ghi/schema |
| Browser runner | Cả 9 lượt suite đạt: Auth/movie, Auth layout, Favorites, Profile, Change Password, multi-tab, audit remediation, a11y 8B, UX 8C |
| 8B regression | 50 route snapshots + 39 states, 54 keyboard checkpoints; không overflow/axe violation/contrast failure |
| 8C advanced | 34 snapshots, 37/37 checkpoints; 0 overflow, 0 ordinary-color axe violation, 0 unexpected forced-color diagnostic |
| Multi-tab | 22 checkpoints đạt; session change/401/403, cancellation, stale responses và fallback signals |
| Tổng axe snapshots | 118 ordinary-color snapshots không violation; 5 forced-color snapshots với 2 reviewed contrast diagnostics như mô tả trên |
| Git whitespace check | `git diff --check` đạt |

Lượt full quality đầu có lỗi **fixture mới**, không phải product: cả hai card
visible ở 375px đều được lưu nên không có unselected SVG để so sánh. Đã sửa
fixture chỉ chọn một card, thêm wait rõ ràng, chạy lại targeted UX và full
quality. Lượt full cuối xuất được success summaries của cả 9 child suites
(runner chỉ in stdout sau khi `execFile` child exit 0), gồm 37/37 advanced checks.
Baseline chạy lại cùng harness cuối trên before-dist: 34 snapshots/28 checks,
chỉ fail kỳ vọng ở `route-document-title`; 9 checks bổ sung đặc thù title chỉ
chạy ở regression mode để không chờ vô hạn title mới trên build cũ.

Lưu ý công cụ Windows: redirect `*>` trong PowerShell có thể báo shell exit 1
vì diagnostic Prisma ghi stderr dù native command thành công. Đã reproduce bằng
Node chỉ ghi stderr nhưng native exit 0, và xác nhận riêng Prisma native exit 0.
Khi thu log trên Windows cần lưu `$LASTEXITCODE` rồi `exit` đúng mã, không suy
ra app fail chỉ từ `NativeCommandError`. Tất cả gates phía trên có output thành
công; không bỏ assertion/test nào để vượt lỗi fixture hoặc diagnostic này.

Không chạy native PostgreSQL write/concurrency suite trên database local thật;
không đổi backend/schema nên phase này dùng backend regression hiện có và DB
read-only validation. Chưa chạy GitHub Actions cho changeset 8C vì không
commit/push trong nhiệm vụ này; CI hiện có sẽ chạy advanced suite qua `check`.

## Cách chạy và đọc artifacts

```powershell
npm.cmd run check
npm.cmd run test:ux
npm.cmd run db:check
# Đối chiếu artifact cũ, không sửa product:
$env:CINEVERSE_A11Y_DIST = '.npm-cache/phase-8c/before-dist'
node frontend/tests/accessibility.browser.cjs --advanced --baseline
Remove-Item Env:CINEVERSE_A11Y_DIST
```

`--baseline` chỉ thu evidence, không dùng làm gate. `test:ux` và browser runner
luôn assert kết quả. Gate 8B vẫn nguyên; contrast diagnostics forced-colors được
ghi riêng và cần đọc screenshot, không âm thầm xóa khỏi raw result.

JSON/screenshot: `.npm-cache/phase-8c/{before,after}/report.json`, `reflow-*.png`,
`forced-*.png`. Không commit screenshots, logs, browser cache hoặc `.env`.
Performance: `performance-comparison.json` và smoke report trong cùng cache.

## Manual screen-reader và staging checklist — chưa thực hiện

- [ ] Windows + NVDA/Edge/Firefox: dùng D/landmarks, H/headings, Tab; nhận diện
  đúng Header/search/main/footer, mỗi trang có H1 và browser title đúng.
- [ ] Mở mobile/account menu bằng bàn phím: thông báo expanded/collapsed,
  Escape về trigger, menu đóng không còn trong browse order; không trap.
- [ ] Đọc card, metadata và poster alt; xác nhận không quá lặp. Toggle Favorite:
  đọc pressed/unpressed, pending và lỗi, focus giữ đúng khi hoàn tất.
- [ ] Login/Register/Profile/Change Password: đọc label/required/hints, lỗi gắn
  với input và focus trường đầu sai, password visibility, status/error/retry.
- [ ] Slow route/data: nghe loading, kết quả và title sau điều hướng; xác minh
  focus main không bị request cũ kéo đi. Back/Forward giữ lịch sử/query/state.
- [ ] macOS/iOS VoiceOver và Android TalkBack: lặp lại các luồng chính, rotor
  navigation và form entry. Kiểm tra YouTube player riêng khi có trailer hợp lệ.
- [ ] Browser chrome zoom thật 200%/400%, Windows scaling/text enlargement:
  Home/Details/search/filter/Auth/Favorites/Profile, menu, focus và reflow.
- [ ] Windows High Contrast ít nhất theme sáng/tối: focus, disabled/loading,
  selected Favorite, border input, thông báo lỗi; rà soát 2 axe diagnostics.
- [ ] iOS Safari/Android Chrome trên máy thật: tap targets, pinch/text scaling,
  orientation, autofill, password manager, virtual keyboard, safe-area và footer.
- [ ] Staging build/cache/CDN thật: SPA fallback, stale chunk explicit reload,
  offline/retry, HTTP errors, token/CSRF policy, session expiry và logout đa tab.
- [ ] Lighthouse và traces trên staging, thiết bị/mạng cố định; RUM/CrUX nếu có
  consent/infrastructure. Chưa có field INP, LCP hoặc CLS của người dùng thật.

Không deploy, bật production config, commit hoặc push trong Phase 8C. Những
mục thủ công chưa thực hiện ở trên vẫn mở để xác minh Phase 9; không phải bằng
chứng lỗi Critical/High mới và cũng không phải chứng nhận production readiness.

Nguồn phương pháp:
[WCAG Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html),
[Playwright emulation](https://playwright.dev/docs/emulation),
[Browser context options](https://playwright.dev/docs/api/class-browser),
[CDP page scale](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/).
