# Phase 8B — Responsive & accessibility

## Phương pháp và phạm vi

Baseline là production build của `d02bb96b808fc109bc1c48ed380fae8f28b2e58b`
(Phase 8A), lưu tại `.npm-cache/phase-8b/before-dist`. Audit không dùng tài
khoản thật, SMTP, token TMDB hay database thật để submit form. Không đổi
backend, schema/migrations, AuthProvider, CSRF/session/Origin policy.

Browser: Edge headless 156.0.4314.50, Playwright 1.64.1, Windows, viewport cao
900 CSS px, rộng 320/375/768/1024/1440px. Axe-core 4.14.0 là dev dependency;
không import vào mã frontend và không nằm trong production bundle.

Suite `frontend/tests/accessibility.browser.cjs` phục vụ `frontend/dist` thực
bằng static HTTP server local, SPA fallback; mock HTTP bằng fixture DTO. DOM,
CSS, Router, Providers, forms và event handlers đều là code ứng dụng. Fixture
chỉ cung cấp responses để kiểm tra UI, không chứng minh bảo mật của backend;
các suites Auth/Favorites/Profile/multi-tab hiện có vẫn kiểm thử riêng.

50 lượt trang/viewport: Home, Details hợp lệ, Favorites của member, Login,
Register, Forgot, Reset có token synthetic, Profile của member, NotFound,
Details có ID không hợp lệ. 39 trạng thái bổ sung gồm:

- Menu điều hướng/tài khoản mở, Profile edit, Change Password mở và lỗi validate.
- Search rỗng, Favorite bỏ chọn, Home loading/error và Retry.
- Tên gần 100 ký tự và email 254 ký tự; text-spacing tăng trên Home/Register/Profile.
- Cast không có ảnh: kiểm tra cả caption và semantic fallback.

Tổng **89 axe snapshots**, 54 checkpoint keyboard có tên. Tab traversal còn
kiểm tra outline/focus-within và hit-test tại tâm control để phát hiện focus bị
che trong các luồng đã đi qua. Đây là kiểm tra một phần focus visibility, không
phải bằng chứng mọi pixel outline đều không bị clip trong mọi tình huống.

Axe chạy các tags WCAG 2 A/AA, WCAG 2.1 A/AA, WCAG 2.2 AA và best-practice.
Không tắt rule, không bỏ qua selector để làm test xanh. Tương phản viền input
được tính thêm từ computed colors ở cả hai phía; caption fallback có phép đo
riêng. Không làm tròn tỷ lệ trước khi so ngưỡng.

## Findings trước → sau

| ID | Bằng chứng trước sửa | Thay đổi | Kết quả sau |
| --- | --- | --- | --- |
| B01 | 320/375/768/1024: mở menu rồi Tab đi qua menu vì nav đứng trước trigger trong DOM; Escape từ ngoài header không đóng được | Khi mở chuyển focus vào link đầu; Escape trả trigger; đóng khi focus ra ngoài header | 8 checkpoint trước fail, sau pass |
| B02 | Từ guest `/profile` → Login, nhấn skip link làm mất `history.state.usr.from`; đăng nhập xong về Home | Skip link dùng focus/scroll trực tiếp, không tạo hash history entry | Return path giữ nguyên, login trở lại Profile |
| B03 | Space trên Favorite: native disabled làm blur; hoàn tất ghi vẫn focus body | Capture keyboard intent bằng ref; effect sau commit khôi phục focus cùng epoch | Giữ focus sau ghi; Tab đi nơi khác thì không bị kéo lại |
| B04 | Axe `label-content-name-mismatch`: MovieCard dùng aria-label thay toàn bộ nhãn nhìn thấy; Favorite full có chữ “Đã/Lưu yêu thích” nhưng accessible name khác | Card dùng tên tự nhiên của Link; full Favorite bao gồm chữ đang hiển thị, giữ `aria-pressed` | Không còn rule violation trên fixtures |
| B05 | Avatar/chữ và glyph chevron bị ghép vào visible label của account button trong automated check | Trang trí bằng CSS, vẫn `aria-hidden`; accessible name giữ đủ tên user | Không thêm ký tự trang trí vào tên đọc; không suppress rule |
| B06 | Favorites nhảy H1 → MovieCard H3; các loading state không có H1 | H2 ẩn thị giác trước danh sách; H3 cho error card; H1 ẩn trong các loading state | Heading-order/page-has-heading-one best practices đạt |
| B07 | Viền `#cccac0` chỉ 1,51:1 trên ivory, 1,64:1 trên trắng | Token `--control-border: #898a80` riêng cho input/select/search/password wrappers | Khoảng 3,21:1–3,49:1; focus outline giữ olive |
| B08 | Cast fallback “Chưa có ảnh” 11px: 4,219:1 trên `#eeece5`; axe color-contrast xác nhận | Dùng `--accent-strong` sẵn có | 6,151:1, giữ nguyên font/bố cục |
| B09 | Menu 40×44; account 34×44; Login link cao 40; Logout cao khoảng 42,8 CSS px | Các control Header này có hit area ít nhất 44px | Không còn control trong nhóm đo dưới 44px |
| B10 | Account panel là div có label; placeholder Favorite tự đặt aria-label nhưng không có semantic role | Account panel là nav có tên; skeleton trang trí `aria-hidden`, summary status vẫn thông báo loading | Landmark rõ; bỏ tên không cần thiết trên skeleton |

B06 là cải thiện cấu trúc/best-practice, không tự diễn giải mọi heading jump là
một WCAG violation độc lập. B09 dùng mục tiêu usability 44px; **WCAG 2.2 AA
2.5.8 có mức tối thiểu 24px và các ngoại lệ về spacing/inline**, nên không gọi
nút 34/40px trước đây là lỗi AA chỉ vì nhỏ hơn 44px.

Với B07, không phải mọi decorative border đều bắt buộc 3:1. Thay đổi tập trung
vào ranh giới của các input rỗng/các control nhập liệu, không làm đậm toàn bộ
đường kẻ trang trí hay card. Thiết kế olive/ivory, serif, grid và Welcome Panel
được giữ nguyên.

## Responsive và nội dung

| Viewport | Trang cơ bản | Horizontal overflow trước/sau | Kết quả |
| --- | ---: | --- | --- |
| 320px | 10 | 0 / 0 | Form password khoảng 184px; input thường 238px; không tràn |
| 375px | 10 | 0 / 0 | Header controls dễ chạm; grid giữ tỷ lệ 2:3 |
| 768px | 10 | 0 / 0 | Layout tablet/form và disclosure menu ổn định |
| 1024px | 10 | 0 / 0 | Hai cột Auth và navigation responsive hoạt động |
| 1440px | 10 | 0 / 0 | Giữ layout desktop, các page lazy vẫn hiển thị đúng |

Không có bằng chứng cần thay lại breakpoints, số cột hay thu nhỏ form. Welcome
Panel ở 320px đo khoảng 303px Login và 325px Register trước sửa; không cần
redesign. Các đoạn hẹp/ellipsis ở preview card và tên Header là chủ ý; link
và accessible name vẫn cung cấp thông tin đầy đủ, Details có nội dung hoàn chỉnh.

Stress test 320/1440 với tên dài/email 254 ký tự và text-spacing (line-height
1,5; letter-spacing 0,12em; word-spacing 0,16em; paragraph spacing 2em) không
tạo horizontal overflow. Kiểm tra này không thay thế zoom thật hoặc đánh giá
khả năng đọc thủ công cho mọi font/hệ điều hành.

## Keyboard và accessibility

54 checkpoint có tên đạt, thay cho 14 checkpoint fail ở baseline. Đã đi qua:

- Skip link → main; menu mobile Enter/Tab/Escape; account Space/Tab/Escape.
- Native select bằng phím; Search, clear rồi trả focus input; Enter trên card.
- Favorite bằng Space; giữ focus sau request; không lấy lại focus khi người dùng
  đã Tab sang control khác. Native disabled và pending lock giữ nguyên.
- Guest Profile → Login → Profile; email/password validation và show/hide.
- Profile sửa/lỗi/lưu, Header cập nhật tên và focus quay về nút chỉnh sửa.
- Change Password lỗi rỗng/mismatch, sửa lỗi, submit và Login notice sau success.
- Register/Forgot/Reset hoàn tất bằng bàn phím; URL reset đã scrub token synthetic.

Test đặt focus ban đầu ở skip link hoặc trigger để bắt đầu từng scenario;
các luồng form sử dụng Tab/Enter/Space và keyboard input, không mouse click.
Một scenario riêng đặt lại focus trên Favorite để kiểm tra việc không giành
focus sau request; baseline mất focus vẫn được ghi fail, không bị che đi.

Focus restoration của Favorite chỉ chạy sau commit `disabled=false`, khi epoch
còn current và active element còn body hoặc chính button. Không replay API,
không thay trạng thái xác thực, không tập trung vào control của phiên cũ. Các
response muộn/user switch tiếp tục do Auth/Favorites epoch guard hiện có xử lý.

Form labels, `aria-describedby`, lỗi `aria-invalid`, role alert/status, poster
alt, main/header/footer/search/navigation landmarks, reduced motion và named
account navigation đã được rà soát. Reduced-motion tắt skeleton animation;
input focus có outline hoặc outline trên password/search wrapper.

Kết quả tự động sau sửa: **0 axe violations trong phạm vi 89 snapshots** và
0 focus/overflow/control-contrast checkpoint thất bại. `color-contrast` vẫn có
incomplete trên dấu `·` trang trí của Hero: `aria-hidden`, không truyền đạt thông
tin; đã review là decorative separator. Không biến incomplete thành “pass”
chung cho mọi trường hợp hoặc tuyên bố website đã được chứng nhận WCAG AA.

## File thay đổi

- `frontend/src/App.tsx`: skip link giữ Router state.
- `components/Header.tsx`, `Header.css`: disclosure focus và hit area.
- `components/AccountMenu.tsx`, `Auth.css`: nav có tên, trang trí avatar/chevron,
  target size, contrast viền form; không đổi Login/Register layout.
- `components/FavoriteButton.tsx`: tên khớp chữ hiển thị, giữ toggle semantics,
  focus sau pending có session guard.
- `components/MovieCard.tsx`: bỏ aria-label ghi đè tên tự nhiên của Link.
- `pages/FavoritesPage.tsx`, `components/Favorites.css`: heading của list/error,
  skeleton không gây nhiễu screen reader.
- `components/MovieDataState.tsx`, `RouteBoundary.tsx`, `pages/MovieDetailsPage.tsx`,
  `ProfilePage.tsx`: H1 cho loading, không đổi endpoint hoặc hook fetch.
- `index.css`, `components/SearchBar.css`, `MovieFilters.css`, `pages/ProfilePage.css`:
  helper visually-hidden và token/border control.
- `components/MovieCast.css`: tương phản caption fallback.
- `frontend/tests/accessibility.browser.cjs`: production audit, fixtures và keyboard.
- `scripts/test-browser.mjs`: chạy suite mới trong gate hiện có.
- `package.json`, `package-lock.json`: axe-core pinned dev-only, `test:a11y`.
- `README.md`, tài liệu này: lệnh chạy, bằng chứng và giới hạn.

Các đường dẫn `components/`, `pages/`, `index.css` ở trên thuộc `frontend/src/`.
Không chỉnh sửa `backend/`, database credentials, Prisma schema hay migrations.

## Quality gates và hồi quy Phase 8A

- Node automated tests: **399 = 287 backend + 112 frontend**, không cộng số
  snapshot axe hoặc checkpoint keyboard vào tổng unit/integration tests này.
- Browser runner: Auth/Recovery, Details/compact/cast, Auth layout, Favorites,
  Profile, Change Password, multi-tab (22 nhóm), audit remediation và a11y.
- Lint, TypeScript, production build, Prisma validate và DB check chỉ đọc.
- `perf:measure` vẫn chạy thành công: lazy Details không tải ở Home, Back không
  fetch lại catalog, chunk lỗi phục hồi, responsive poster lỗi vẫn fallback.
- Không chạy lại PostgreSQL native 14 tests của CI Phase 7C; không sửa backend/
  schema. Không tự commit/push, không tạo GitHub Actions run mới trong phase này.

Bundle production đo bằng cùng zlib như Phase 8A, tính cả shared initial chunk:

| Payload Home | Before raw / gzip | After raw / gzip |
| --- | --- | --- |
| JS | 315.603 / 99.823 bytes | 316.497 / 100.024 bytes |
| CSS | 30.257 / 6.348 bytes | 30.640 / 6.444 bytes |
| API requests guest | 5 | 5 |
| Desktop image bytes trong fixture | 721.527 | 721.527 |
| Mobile image bytes trong fixture | 339.549 | 339.549 |

JS tăng 894 bytes raw / 201 bytes gzip cho focus/semantic behavior; axe-core
không nằm trong bundle. Không thay srcSet/sizes, lazy routes, fetch deadlines,
caching hay scheduler. CLS ở fixture vẫn dưới 0,0011 trong cả hai profile.

Timing dùng production harness Phase 8A, cùng ảnh cache, desktop1440/DPR1/
10Mbps/40ms/CPU1 và mobile375/DPR2/1,6Mbps/150ms/CPU4, cold contexts. Lượt đo
3 samples theo từng build lần đầu có desktop LCP median 644→668ms, mobile
2.736→3.648ms. Có biến động bootstrap CPU/long tasks ngay trước các catalog
requests; không thể chỉ từ bundle tăng 201 bytes gzip mà kết luận nguyên nhân.
Các phép đối chiếu bổ sung dưới đây kiểm tra lại độ ổn định của timing.

Đo bổ sung giữ thứ tự **A–B–B–A–A–B** (A: build trước, B: build sau), cùng
fixture và cold contexts. Khi mỗi build mở browser process riêng, mobile vẫn
dao động: A 3.912/2.164/2.104ms; B 5.612/2.440/2.244ms. Không bỏ các samples
này hoặc gọi chúng là kết quả cải thiện.

Để giảm khác biệt process/startup, đã chạy lại cùng thứ tự trong **một browser
process**, mỗi sample là context mới. Server giữ cả hai bộ hashed assets và
đổi index.html đúng build trước mỗi sample. Kiểm tra resource URLs xác nhận
JS/CSS đúng phiên bản; HTTP cache vẫn bị tắt bởi routing fixtures như harness gốc.

| Mobile Home, cùng process | A trước | B sau |
| --- | --- | --- |
| LCP samples, ms | 2.192 / 2.104 / 2.152 | 2.104 / 2.120 / 2.132 |
| Median, ms | 2.152 | 2.120 |
| Range, ms | 2.104–2.192 | 2.104–2.132 |

Chưa thấy hồi quy timing trong phép đối chiếu cùng process này; **không coi
32ms chênh lệch là một cải thiện được chứng minh**. Các lượt khác cho kết quả
khác nhau nên chưa đủ cơ sở hứa hẹn LCP/INP field hoặc quy nguyên nhân chi tiết
cho host/process. INP thật chưa có; Event Timing ngắn trong lab không thay thế nó.

Sao measurement-only của harness gốc trong `.npm-cache/phase-8b/bench/scripts/`
chỉ bỏ các navigation smoke checks khỏi lượt timing để xen kẽ Home. Không sửa
`scripts/measure-performance.mjs` hoặc product code cho phép đo. Navigation/chunk
failure/ảnh fallback đã được kiểm tra bằng lệnh gốc riêng và đều đạt. Raw files:
`perf-before.json`, `perf-after.json`, `interleaved-*.json`, `single-browser.json`.
Để tái lập, dùng hai artifact trên cùng browser/máy, giữ nguyên CPU/network/DPR,
không chạy quality/browser suites đồng thời với các sample performance.

## Chạy và xem bằng chứng

```powershell
npm.cmd run build
npm.cmd run test:a11y
npm.cmd run check
# Chỉ đọc database local đã cấu hình:
npm.cmd run db:check
```

Mặc định cần build trước `test:a11y`; `check` đã build trước browser runner.
Browser dùng Edge trên Windows hoặc Chromium Playwright; cấu hình chung ở
`frontend/tests/browser-options.cjs`. CI đã cài Chromium theo workflow hiện có.
Audit không cần file `.env` hay API/backend thật.

JSON/screenshot trước/sau ở `.npm-cache/phase-8b/before/` và `after/`;
baseline có thể tái lập với `CINEVERSE_A11Y_DIST` trỏ bản build riêng và
`--baseline`. Lệnh `--caption-only`/`--keyboard-only` hỗ trợ kiểm tra có mục tiêu;
CI/browser runner luôn chạy suite mặc định đầy đủ. Các flags không bỏ rule.
Logs ở `.npm-cache/phase-8b-*.log`; artifact/cache/dist đều được Git ignore.

## Giới hạn và Phase 8C

- Chưa có NVDA/VoiceOver/TalkBack, speech input hoặc thiết bị cảm ứng thật.
- Chưa kiểm chứng browser zoom 200/400%, forced-colors/high contrast, iOS Safari,
  Android Chrome, landscape/virtual keyboard và mọi ngôn ngữ/title từ TMDB live.
- Không đánh giá YouTube player bên trong iframe; chỉ kiểm tra phần shell và
  cơ chế tải có thao tác như các regression hiện có.
- Color check với computed styles không mô phỏng low vision, antialias hay
  mọi ảnh thật. Automated axe không bao phủ toàn bộ WCAG hoặc chất lượng đọc.
- Timing lab local không phải INP/CrUX/RUM của người dùng thật.

Phase 8C nên ưu tiên screen-reader walkthrough và zoom/forced-colors/device
matrix, review cách đọc card có nhiều metadata, và staging performance trace
trên máy/mạng kiểm soát được. Không thêm các hạng mục đó vào sản phẩm ở đây.

## Ba khái niệm để đọc code

**Semantic HTML**: dùng đúng ý nghĩa phần tử, như Link để chuyển trang, button
để thực hiện hành động, nav cho điều hướng. Browser và assistive technology
hiểu vai trò mà không phải tự gắn ARIA cho mọi div.

**Focus management**: quyết định điểm nhận bàn phím sau mở/đóng menu, chuyển
trang, validate lỗi hoặc request. Focus cần đến đúng nơi, có dấu hiệu nhìn thấy,
và không bị thao tác async cũ kéo đi khi người dùng đã di chuyển.

**WCAG**: bộ tiêu chí về khả năng tiếp cận. A/AA là các mức yêu cầu; một axe run
xanh chỉ xác nhận các rule/trạng thái đã kiểm tra, không thay thế đánh giá thủ
công hay tự động chứng minh toàn bộ site đạt AA.

Nguồn: [WCAG 2.2](https://www.w3.org/TR/WCAG22/),
[Label in Name](https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html),
[Non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html),
[Target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html),
[Text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html),
[Axe API](https://www.deque.com/axe/core-documentation/api-documentation/).
