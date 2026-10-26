# Phase 6.3C — React Favorites Integration

Người đã đăng nhập có thể lưu/bỏ lưu phim từ MovieCard, trang chi tiết và xem bộ sưu tập tại `/favorites`. Giao diện tiếp tục dùng ivory/cream, serif và olive hiện có. Source đã được đối chiếu với API Phase 6.3B; không sửa backend, schema, migration hoặc dependency trong phase này.

## File tạo mới

| File | Trách nhiệm |
| --- | --- |
| `frontend/src/types/favorites.ts` | DTO Favorite, page/cursor và API interface |
| `frontend/src/services/sessionHttp.ts` | Request options cookie same-origin, no-store, CSRF và timeout dùng chung với Auth |
| `frontend/src/services/favorites.ts` | Runtime validation, GET đủ cursor, POST 201/200, DELETE 204, lỗi an toàn |
| `frontend/src/contexts/favorites-context.ts` | Kiểu và Context dùng chung |
| `frontend/src/contexts/FavoritesProvider.tsx` | State theo tài khoản, per-movie lock, request generation/abort và đồng bộ UI |
| `frontend/src/hooks/useFavorites.ts` | Đọc Context và các thao tác Favorites |
| `frontend/src/services/favoriteMovies.ts` | Worker pool tối đa 4 request metadata, mapper Movie và lỗi từng phim |
| `frontend/src/hooks/useFavoriteMovies.ts` | Fetch/cache metadata theo User và danh sách ID đang hiển thị, retry/cleanup |
| `frontend/src/components/FavoriteButton.tsx` | Nút tim dùng chung, pending/disabled, aria-pressed, Login return route |
| `frontend/src/components/FavoritesNotice.tsx` | Thông báo lỗi Favorites và tải lại, hiển thị Retry-After nếu có |
| `frontend/src/components/Favorites.css` | Heart, trang Favorites, skeleton, empty/error và responsive |
| `frontend/src/pages/FavoritesPage.tsx` | Protected experience, danh sách/skeleton/rỗng/lỗi, xem thêm metadata |
| `frontend/tests/favorites.test.ts` | 21 unit/service tests, pagination/HTTP/metadata concurrency |
| `frontend/tests/favorites.browser.cjs` | 12 nhóm kiểm thử trình duyệt, native HTTP với DB mock |
| `frontend/tests/favoritesProvider.browser.tsx`, `.html` | Harness dev-only cho race/abort/session, không import vào production |
| `docs/phase-6.3c-favorites-frontend.md` | Tài liệu này |

## File chỉnh sửa

| File | Thay đổi |
| --- | --- |
| `frontend/src/main.tsx` | Đặt FavoritesProvider trong AuthProvider, bao quanh App |
| `frontend/src/App.tsx` | Thêm route `/favorites` và FavoritesNotice |
| `frontend/src/components/Header.tsx` | Kích hoạt NavLink Yêu thích, giữ mobile menu |
| `frontend/src/components/MovieCard.tsx`, `.css` | Nút tim là sibling của Link, absolute ở góc poster |
| `frontend/src/components/Icon.tsx` | Thêm SVG heart theo hệ thống icon hiện có |
| `frontend/src/pages/MovieDetailsPage.tsx` | Cùng FavoriteButton/Context, không state riêng |
| `frontend/src/services/auth.ts` | Tái sử dụng request options; giữ nguyên method/body/timeout/cookie/CSRF và xử lý response |
| `frontend/src/utils/authForm.ts` | Bổ sung đúng `/favorites` vào allowlist return route |
| `frontend/tests/auth.test.ts` | Kiểm tra return route `/favorites` |
| `frontend/tests/auth.browser.cjs` | DB fixture hỗ trợ GET Favorites rỗng; các flow auth cũ giữ nguyên |
| `README.md` | Cập nhật phạm vi, hướng dẫn và kết quả Phase 6.3C |

Working tree ban đầu đã có thay đổi Phase 6.3A/6.3B chưa commit. Các file backend/schema/migration/package của những phase đó được giữ nguyên. Không đọc/in `.env`, không commit/push, không ghi PostgreSQL thật.

## Kiến trúc state và luồng dữ liệu

```text
AuthProvider (user/status/isSigningOut)
  └─ FavoritesProvider
       ├─ GET đủ các cursor → Favorite[] → ReadonlySet<number>
       ├─ MovieCard → FavoriteButton ─┐
       ├─ MovieDetailsPage → button ─┼→ add/remove → API → cập nhật chung
       └─ FavoritesPage ─────────────┘
            └─ ID đang hiển thị → useFavoriteMovies → TMDB proxy → MovieCard
```

`favorites` giữ movieId và createdAt đúng thứ tự để render collection. `favoriteIds` là Set được suy ra trực tiếp từ mảng, không có Effect đồng bộ hai nguồn state. Mỗi lần cập nhật tạo mảng/Set/Map mới. `sort()` chỉ chạy trên mảng `filter()` mới tạo. `pendingIds` giúp mọi button có cùng movieId đồng thời chuyển sang disabled.

`status` phân biệt guest/loading/ready/error. Khi chưa đọc đủ danh sách hoặc lỗi GET, heart bị vô hiệu hóa và không công bố aria-pressed=false cho trạng thái chưa biết. Không kết luận các ID ở trang chưa tải là chưa lưu. Người chưa login được đưa tới `/login`; state.from chỉ được nhận lại qua allowlist nội bộ `/`, `/movies/<Int32 ID>` và `/favorites`. External URL, query bất kỳ và route auth không được dùng để redirect.

Provider không remount App khi đổi User, nên catalog, search/filters và Router vẫn giữ state hiện có. `storedOwner` phải khớp User hiện tại mới được công bố favorites/pending/error. Do đó render đầu tiên của User B đã che toàn bộ dữ liệu A, trước khi cleanup Effect chạy.

## Cookie, CSRF và API contract

Không đọc cookie HTTP-only bằng JavaScript. Auth và Favorites dùng chung `sessionRequestInit()`:

- URL tương đối `/api/...`, `credentials: 'same-origin'`, `cache: 'no-store'`.
- POST/DELETE gửi `X-Cineverse-CSRF: 1`; browser tự tạo Origin, server kiểm tra allowlist hiện có.
- Chỉ request có body mới có Content-Type JSON. DELETE không body.
- Timeout 12 giây/request, kết hợp AbortSignal của component/provider.
- Không lưu password/token/Favorite IDs trong localStorage/sessionStorage.

`GET /api/favorites` trả `{ favorites: [{ movieId, createdAt }], nextCursor }`. Service validate shape/ID Int32/date/cursor và chỉ giữ DTO cần thiết. `POST` chấp nhận **201 hoặc 200** và kiểm tra movieId trả về khớp yêu cầu. `DELETE` chỉ xác nhận **204**, không parse JSON body rỗng. Lỗi server chỉ lấy status/code hợp lệ và Retry-After; thông báo được định nghĩa ở client, không hiển thị raw exception.

Không đổi session, AuthProvider, cookie, Origin hoặc CSRF policy. Thay đổi `auth.ts` chỉ tách options có cùng hành vi sang helper dùng chung; regression auth/recovery đã được chạy lại.

## Đọc đủ nextCursor

`favoritesService.listAll()` gọi tuần tự từng page, nối vào Map theo movieId để loại trùng, dừng khi `nextCursor === null`. Có phát hiện cursor lặp và giới hạn **100 trang, tối đa 10.000 mục theo contract 100/page**.

Nếu bất kỳ page lỗi, cursor lặp hoặc vượt giới hạn, service báo lỗi toàn bộ lượt tải thay vì trả một partial list giả thành công. Provider chưa cho thêm/xóa khi trạng thái chưa xác định. Abort được kiểm tra giữa các page và trước khi tạo request tiếp theo. Một Provider duy nhất tải danh sách; từng MovieCard không tự gọi GET Favorites.

Danh sách không phải snapshot xuyên nhiều request; khi có thay đổi ở tab/thiết bị khác, dùng Làm mới danh sách. Giới hạn 10.000 không phải giới hạn database; nếu vượt, cần thiết kế status lookup/pagination backend cho giai đoạn sau.

## Mutation, race condition và session

Áp dụng **pessimistic update**: click → khóa movieId ngay trong ref Map → API → chỉ cập nhật UI khi response thành công. Ref khóa đồng bộ cả hai lời gọi xảy ra trước render; Set pending reactive cập nhật giao diện. POST 200 duplicate là thành công; thời gian createdAt do server quyết định. Thao tác phim khác vẫn có thể chạy đồng thời.

Khi request thất bại, heart giữ trạng thái trước đó; notice cho phép tải lại. Nếu mạng ngắt sau khi server đã ghi nhưng trước khi nhận response, client không thể biết chắc kết quả: tải lại danh sách hoặc gửi lại mutation idempotent để đồng bộ.

Effect phụ thuộc owner/service/revision; cleanup abort các request cũ. Generation + mounted guard chặn response cũ kể cả transport không tôn trọng AbortSignal. Logout bắt đầu sẽ che dữ liệu ngay qua isSigningOut, abort request và clear state; nếu Logout lỗi, provider tải lại dữ liệu của User còn đăng nhập.

401 khi GET/mutation sẽ xóa dữ liệu Favorites và kiểm tra lại session bằng `refreshUser()` hiện có; không auto retry Favorites. Một mutation 401 còn tăng generation, abort toàn bộ mutation đang chạy và xóa pending, tránh một thành công đến muộn khôi phục dữ liệu phiên đã hết hạn. Nếu Me lỗi mạng/503, AuthProvider giữ convention hiện có và thông báo kiểm tra lại phiên; không tự coi 503 là guest. Heart chờ xác minh trước khi cho điều hướng login.

## Metadata phim và phân biệt TV

Đã có endpoint **GET `/api/movies/:id`**; không cần sửa backend. `loadFavoriteMovies()` tái sử dụng `getMovieDetails()` (có runtime validation) và `mapTmdbMovie(data, data.genres)` để tạo Movie cho card. Không gọi TMDB trực tiếp hoặc đưa token vào frontend.

Trang hiển thị 24 mục đầu, Xem thêm tăng 24; chỉ tải metadata cho các ID đang hiển thị. Worker pool tối đa **4** request đồng thời. Poster giữ aspect-ratio, slot skeleton được giữ trong grid. Cache thành công ở RAM trong vòng đời trang và được tách theo User; retry chỉ cần tải lại các metadata chưa có. ID vẫn theo thứ tự Favorite của server, không theo thứ tự request kết thúc.

404 hoặc lỗi một phim tạo card thông báo có Movie ID, link chi tiết và nút bỏ yêu thích; các phim khác tiếp tục hiển thị. Không bịa title/poster cho phim lỗi. Chưa có TTL cache hoặc preload toàn bộ danh sách; refresh trang tải lại metadata.

Nguồn hiện tại và endpoint dùng Movie; mục Phim bộ vẫn disabled. Phase này **không lưu TV Series ID vào movieId**. Favorites cho TV cần model/API có mediaType và migration riêng nếu được yêu cầu sau.

## Responsive và accessibility

Favorites grid 2/3/4/5 cột ở 375/768/1024/1440px. Đã kiểm tra bằng Edge headless: không tràn ngang, vùng bấm heart ít nhất 44×44px, keyboard focus-visible và aria-pressed cập nhật. Button là sibling của MovieCard Link, không lồng interactive element trong Link; click heart không đổi route. Guest click đi Login bằng Router, không reload toàn trang.

Welcome Panel Login/Register giữ nguyên JSX/CSS. Suite auth layout đã đạt tại 320/375/768/1024/1440/1920px cho cả bốn trang auth. Screenshot Favorites dùng dữ liệu và poster fixture, không phải dữ liệu tài khoản thật:

- `../.npm-cache/phase-6.3c-screenshots/favorites-375.png`
- `../.npm-cache/phase-6.3c-screenshots/favorites-768.png`
- `../.npm-cache/phase-6.3c-screenshots/favorites-1024.png`
- `../.npm-cache/phase-6.3c-screenshots/favorites-1440.png`

Thư mục .npm-cache được ignore; ảnh là artifact local, không thêm vào Git.

## Kết quả kiểm thử

| Kiểm tra | Kết quả thực tế |
| --- | --- |
| `npm.cmd test` | **205/205 đạt**: 134 backend + 71 frontend, gồm 21 unit/service tests mới; không fail/skip |
| Favorites browser | **12 nhóm đạt**: native HTTP/Vite, session cookie + Argon2 thật, DB/TMDB fixtures |
| Auth/browser regression | Đạt Register/Login/Me/Logout, AuthProvider, recovery, home/search/filter/sort, details, compact grid và cast |
| Auth layout regression | Đạt cả bốn trang Auth, keyboard/validation/footer/responsive và SMTP error fixtures |
| Lint | Đạt, không warning |
| TypeScript check | Đạt |
| Build | Đạt |
| PostgreSQL chỉ đọc / Prisma diff | Không schema drift; counts và 4 migrations giữ nguyên so với baseline Phase 6.3B (User 2, Session 2, PasswordResetToken 0, Favorite 0) |

Favorites tests bao gồm guest/no POST, empty/loading, DTO validation, cursor 205 mục/3 pages, cursor loop/safety cap/partial-page failure, POST 201/200, DELETE 204, 401/403/429/500/503/network, pending same-ID lock, UI giữ nguyên khi lỗi, Card ↔ Details, direct Favorites URL/refresh, Logout/A→B, late GET/mutation kể cả ignores abort, concurrent mutation 401, metadata 404/retry và tối đa 4 workers.

Tests chỉ dùng dữ liệu fixture và in-memory database, không thêm/xóa Favorite, User hoặc Session trong PostgreSQL thật. Không tuyên bố đã kiểm chứng CRUD Favorites bằng tài khoản thật hoặc TMDB live trong phase này. Các server/browser do test tạo đều được đóng trong finally.

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build

# Dùng đường dẫn Playwright có sẵn trên máy; không cần thêm vào dependencies.
node frontend/tests/favorites.browser.cjs <path-to-playwright>
node frontend/tests/auth.browser.cjs <path-to-playwright> --regression
node frontend/tests/authLayout.browser.cjs <path-to-playwright>
```

## Chạy và tự kiểm tra

Tại `D:\LearnReact\Cineverse`, bật PostgreSQL theo cấu hình đang có rồi chạy:

```powershell
npm.cmd run dev
```

Mở URL Vite thông báo (thường `http://localhost:5173`). Không cần migration hay cài thêm package cho phase này. Nếu đang có server cũ, Ctrl+C rồi chạy lại. Đảm bảo backend và TMDB proxy hiện tại sẵn sàng; không chép token vào frontend.

1. Guest mở `/favorites` thấy lời nhắc Login. Nhấn heart ở trang chủ → Login → trở về trang trước.
2. Dùng tài khoản test riêng của bạn để đăng nhập. Nhấn heart → chờ xác nhận; mở chi tiết, trạng thái phải khớp.
3. Mở Yêu thích, refresh và kiểm tra phim còn trong danh sách. Bỏ lưu → card biến mất; bỏ hết → empty state.
4. Logout rồi Login tài khoản B, xác nhận không thấy bộ sưu tập A. Thử responsive và thao tác bằng Tab/Enter/Space.

Các thao tác lưu/xóa khi bạn tự chạy giao diện sẽ ghi database qua API đã xác thực. Agent không chạy những thao tác này bằng tài khoản thật.

## Thứ tự đọc code và chủ đề học

1. `types/favorites.ts` → `services/sessionHttp.ts` → `services/favorites.ts`: DTO, runtime validation khác TypeScript tĩnh, cookie/CSRF và phân trang tuần tự.
2. `contexts/favorites-context.ts` → `hooks/useFavorites.ts` → `contexts/FavoritesProvider.tsx`: Context, một nguồn state, immutable Set/Map, ref cho khóa đồng bộ và generation chống race. Chú ý `matchingOwner`, `update()`, cleanup và nhánh 401.
3. `components/FavoriteButton.tsx` → `MovieCard.tsx` → `pages/MovieDetailsPage.tsx`: cùng state cho nhiều nơi, button nằm ngoài Link, trạng thái unknown/pending/accessibility.
4. `services/favoriteMovies.ts` → `hooks/useFavoriteMovies.ts` → `pages/FavoritesPage.tsx`: worker pool, cancellation, cache, partial failure, grid và Xem thêm.
5. `tests/favorites.test.ts` → `tests/favorites.browser.cjs`: ranh giới unit/service và browser integration, fixture so với database live.

Effect chỉ dùng cho I/O và cleanup, không dùng để tính favoriteIds hay sort/filter thuần. Không dùng Redux hoặc thư viện state mới cho phạm vi này.

Ba bài tập trực tiếp:

1. Trong `FavoritesPage.tsx`, hiển thị ngày lưu theo vi-VN bên dưới từng card bằng createdAt hiện có; giữ key movieId và không phát sinh API request.
2. Thêm lựa chọn sắp xếp “Lưu gần nhất / Tên phim A–Z” cho các metadata đã tải ở trang Favorites; copy mảng trước sort, không sửa thứ tự canonical trong Provider và giải thích giới hạn khi chưa tải hết metadata.
3. Thêm nút “Quay lại bộ sưu tập” khi mở chi tiết từ `/favorites`; truyền Router state và kiểm tra return path bằng allowlist, không dùng window.location hoặc mở redirect tùy ý.

## Giới hạn hiện tại

- Movie Favorites; chưa hỗ trợ TV namespace, không đổi schema.
- Tải đủ IDs tối đa 100 pages; metadata lấy theo từng 24 mục với concurrency 4. Chưa có virtualization cho collection rất lớn.
- Không tự đồng bộ giữa tabs/thiết bị; dùng Làm mới hoặc refresh. Chưa dùng BroadcastChannel/polling/realtime.
- Mutation cần chờ API thành công; request timeout/lỗi mạng có thể cần tải lại để xác nhận trạng thái server.
- Không dùng TMDB live/account thật trong automated tests. Persistence phía server tiếp tục dựa trên API/Prisma/PostgreSQL Phase 6.3B.

Dừng tại Phase 6.3C; không thêm tính năng khác hoặc commit/push.
