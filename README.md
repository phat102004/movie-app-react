# Cineverse

React + TypeScript + Vite với giao diện Minimal Editorial Cinema. Dữ liệu phim được tải qua proxy Node.js cục bộ; token TMDB chỉ nằm trên server.

Backend dùng Node.js, PostgreSQL và Prisma 7; mật khẩu hash Argon2id, phiên đăng nhập lưu phía server với cookie HTTP-only. Frontend dùng React Router, API service và custom hooks.

Phase 7B.4 bổ sung [PostgreSQL production role security](docs/phase-7b4-postgresql-production-security.md): runtime `cineverse_app`, migrator `cineverse_migrator`, hai connection strings tách biệt, TLS strict và metadata/ACL checks. Local vẫn giữ `cineverse_dev`; không tự tạo role, cấp quyền, đổi owner hoặc sửa `.env`. SQL provisioning chỉ dành cho DBA chạy thủ công trên database production riêng.

`db:roles:check` là kiểm tra production chỉ đọc (`-- --migration` cho migrator). `db:deploy:production` là lệnh **ghi migration**, chỉ chạy có chủ đích sau provisioning/backup/review; không dùng thay `db:migrate` local. Runtime production không được cấp migration secret. Đọc toàn bộ workflow trước khi bật `NODE_ENV=production`.

Phase 6.4C thêm **POST `/api/profile/change-password`** và Security Section tại `/profile`. Xác minh password hiện tại, hash Argon2id mới; transaction đổi hash/thu hồi toàn bộ sessions và recovery links cũ, rồi trả 204 + clear cookie. Frontend về Login với notice, không tự login; policy/CSRF/Origin/cookie giữ nguyên. [Contract, concurrency, tests và hướng dẫn tài khoản test](docs/phase-6.4c-change-password.md).

Phase 6.4B thêm trang **`/profile`** với Hero olive/ivory, avatar chữ cái, favoriteCount/ngày tham gia từ API và form sửa tên. Login → menu tài khoản → **Hồ sơ cá nhân**; guest được đưa tới Login rồi quay lại Profile. PATCH chỉ gửi name, Header cập nhật qua Me, dữ liệu được tách theo owner và có loading/error/retry. [File thay đổi, kiến trúc, tests và screenshot local](docs/phase-6.4b-profile-frontend.md).

Phase 6.4A thêm **GET/PATCH `/api/profile`**: đọc id/name/email/createdAt và favoriteCount theo User đã xác thực; PATCH chỉ nhận tên 1–100 ký tự sau trim, kiểm tra CSRF/Origin và session còn hiệu lực tại write. Không migration, không đổi email/mật khẩu hoặc React UI. [API contract, phân quyền, tests và PowerShell](docs/phase-6.4a-profile-backend.md).

Phase 6.3C kết nối **Favorites trên React**: nút tim dùng chung ở MovieCard/chi tiết, trang `/favorites`, state theo User và phục hồi từ API khi refresh. Đọc đủ cursor, khóa request trùng theo movieId, bỏ qua response lỗi thời và tải metadata qua proxy tối đa 4 request đồng thời. UI giữ ivory/cream/olive; chưa hỗ trợ TV Favorites. [Kiến trúc, file thay đổi, tests, screenshot local và hướng dẫn học](docs/phase-6.3c-favorites-frontend.md).

Phase 6.3B thêm **GET/POST /api/favorites** và **DELETE /api/favorites/:movieId** cho session đã xác thực. Mọi truy vấn lọc theo User phía server; POST idempotent 201/200, DELETE 204, GET tối đa 100 bản ghi/trang với nextCursor. POST/DELETE cần CSRF, Origin hợp lệ; API validate movieId nguyên dương Int32 và không gọi TMDB. Chưa tích hợp UI. Đọc [API contract, phân quyền, lỗi, tests và hướng dẫn PowerShell](docs/phase-6.3b-favorites-api.md).

Phase 6.3A thêm model **Favorite** theo User: UUID, userId, TMDB movieId Int32, createdAt Timestamptz(3), unique(userId,movieId), index(userId,createdAt) và FK Cascade. Migration **đã áp dụng**; User/Session/PasswordResetToken giữ nguyên số bản ghi, Favorite đang rỗng, chạy lại migration không ghi DB. Chỉ làm nền tảng database/migration/Prisma/kiểm thử; **chưa có Favorites API hoặc UI**. Tests SQL dùng PostgreSQL WASM RAM riêng, không thêm/xóa Favorite trong database thật. Đọc [thiết kế model, migration safety, pgAdmin và hướng dẫn học](docs/phase-6.3a-favorites-database.md).

Phase 6.2E cân bằng bốn trang Auth: container 1100px, hai cột khoảng 53/47, form tối đa 440px, thu gọn intro trên mobile và footer nằm cuối viewport tự nhiên. Forgot phân biệt validation/rate limit/email chưa sẵn sàng/lỗi hệ thống/network, không báo đã gửi khi delivery lỗi. Không thay backend auth/migration/password policy hoặc `.env`. **Mailpit chưa được phát hiện trên máy; chưa kiểm chứng gửi/nhận qua Mailpit thật.** Xem [audit, file thay đổi, hướng dẫn Windows và checklist Forgot → Reset](docs/phase-6.2e-auth-refinement.md).

Phase 6.2D thêm **/forgot-password**, **/reset-password** và liên kết Quên mật khẩu tại Login. Backend có hai POST recovery, token ngẫu nhiên 256 bit lưu SHA-256, hết hạn 20 phút, dùng một lần; đổi mật khẩu Argon2id và thu hồi session trong cùng transaction. Migration chỉ thêm PasswordResetToken, số User/Session được xác nhận không đổi. **Email mặc định tắt: cần cấu hình SMTP hoặc Mailpit local trước khi nhận thư.** Không có thông báo gửi thành công khi chưa có email delivery. Đọc [file thay đổi, luồng bảo mật, cấu hình email và kiểm thử Phase 6.2D](docs/phase-6.2d-password-recovery.md).

Phase 6.2C thêm giao diện **/register**, **/login**, AuthProvider/useAuth, kiểm tra phiên khi mở website và menu tài khoản trên Header. Form có validation/lỗi từng trường, hiện/ẩn password, loading và chặn submit lặp. Register thành công đưa tới Login; Login không reload trang; Logout chỉ cập nhật guest khi API xác nhận 204. Đọc [hướng dẫn kiến trúc React, file thay đổi, kiểm thử và thao tác trên browser](docs/phase-6.2c-auth-ui.md).

Mở URL Vite thông báo sau `npm.cmd run dev`, chọn **Đăng nhập → Đăng ký** để thử giao diện. Cookie HTTP-only do browser quản lý; React chỉ giữ user DTO trong RAM và gọi `/api/auth/me` khi khởi động. Lỗi mạng khi kiểm tra phiên có nút thử lại, không tự kết luận session hết hạn. Không ghi token/password vào localStorage/sessionStorage. Backend, migration và database không thay đổi trong Phase 6.2C; Phase 6.2D bổ sung recovery như mô tả ở trên.

Phase 6.2B thêm **POST /api/auth/login**, **GET /api/auth/me**, **POST /api/auth/logout**, Session lưu trong PostgreSQL và cookie HTTP-only 7 ngày. Token ngẫu nhiên 256 bit chỉ đi qua cookie; database lưu SHA-256 token. Migration Session đã áp dụng, tài khoản hiện có được giữ nguyên. Đọc [hướng dẫn Login/Me/Logout, PowerShell, restart và bảo mật](docs/phase-6.2b-login-session.md).

**Thay đổi cần lưu ý khi gọi API:** mọi POST `/api/auth/*` (gồm Forgot/Reset) cần header `X-Cineverse-CSRF: 1` và JSON. Browser Origin phải nằm trong `AUTH_ALLOWED_ORIGINS` (mặc định localhost/127.0.0.1 cổng 5173). CLI không gửi Origin vẫn cần custom header. Frontend dùng URL `/api/...` cùng origin qua Vite; không bật CORS credentials hoặc wildcard.

Phase 6.2A thêm **POST /api/auth/register** trên HTTP server Node hiện có: validation backend, Argon2id, lưu User bằng Prisma, response chỉ có id/name/email/createdAt, xử lý email trùng và rate limit. Register tiếp tục hoạt động, cần custom header CSRF theo Phase 6.2B. Xem [hướng dẫn Register](docs/phase-6.2a-register.md).

Phase 6.1 bổ sung nền tảng PostgreSQL local và Prisma 7.10.1 cho backend Node.js hiện có: model User, migration SQL đầu tiên, Prisma Client khởi tạo khi cần và CLI kiểm tra kết nối. Chưa triển khai Authentication. TMDB hoạt động độc lập với database. Đọc [hướng dẫn cấu hình, kiến trúc, file thay đổi và bài tập database](docs/phase-6.1-database.md).

Phase 5.6 thêm đạo diễn trong metadata và Dàn diễn viên chính sau nội dung phim. Credits được gộp vào request chi tiết; không gọi API riêng cho từng người. Danh sách cast có một hàng ban đầu, Xem thêm / Thu gọn độc lập với phim gợi ý. Xem [báo cáo, types/parser/mapper, kiểm thử và bài tập Phase 5.6](docs/phase-5.6-cast.md).

Phase 5.5 thu gọn mỗi danh mục về một hàng responsive, thêm Xem thêm / Thu gọn theo hàng và tinh chỉnh trang chi tiết. Search/filter vẫn hiển thị đầy đủ kết quả. Không thay backend, API, Types hoặc Mapper. Xem [báo cáo UI, hướng dẫn học và kiểm thử Phase 5.5](docs/phase-5.5-ui.md).

Giai đoạn 5 thêm URL chi tiết `/movies/:movieId`, trailer theo thao tác người dùng, phim gợi ý và trang 404. Đọc [kiến trúc và danh sách file](docs/phase-5-architecture.md), [5 bài học trên code](docs/phase-5-learning.md) và [kết quả kiểm thử](docs/phase-5-testing.md).

## Chạy dự án

Yêu cầu Node.js 22.18+ và npm. Từ PowerShell:

```powershell
cd D:\LearnReact\Cineverse
npm.cmd install
npm.cmd --prefix frontend install
if (-not (Test-Path backend\.env)) { Copy-Item backend\.env.example backend\.env }
```

Mở `backend/.env` trong VS Code. Đăng ký/đăng nhập [TMDB](https://www.themoviedb.org), vào [Settings → API](https://www.themoviedb.org/settings/api), hoàn thành đăng ký API rồi lấy **API Read Access Token**. Hướng dẫn chính thức: [Getting Started](https://developer.themoviedb.org/docs/getting-started), [Application authentication](https://developer.themoviedb.org/docs/authentication-application).

Trong file .env, thay placeholder của `TMDB_READ_ACCESS_TOKEN` bằng token cá nhân. Không dùng nhầm API key v3. Không tạo biến VITE_ chứa token, không dán token vào chat hoặc commit .env. Backend đọc file này khi khởi động.

```powershell
npm.cmd run dev
```

Lệnh này chạy cả proxy tại **127.0.0.1:3001** và Vite, thường tại **http://localhost:5173/**. Nếu cổng frontend bận, mở đúng địa chỉ Local mà Vite in ra. Nhấn Ctrl+C để dừng cả hai. Sau khi đổi .env cần dừng rồi chạy lại.

Nếu terminal đang ở `D:\LearnReact\Cineverse\frontend`, `npm.cmd run dev` cũng chạy cả hai server. Script đợi backend báo đã lắng nghe rồi mới khởi động Vite; các tham số như `-- --host 127.0.0.1` được chuyển cho Vite.

Root quản lý dependencies backend (Prisma, PostgreSQL adapter); frontend có package.json riêng. Không cần cài lại PostgreSQL. Khi chỉ khám phá phim qua TMDB, database chưa cấu hình hoặc tạm dừng vẫn không ngăn `npm.cmd run dev` khởi động.

## Email development với Mailpit

Mailpit là mail catcher local: **thư được giữ trong inbox thử nghiệm, không gửi tới hộp thư Internet** khi không bật forwarding/relay. Tự cài binary Windows theo [hướng dẫn chính thức](https://mailpit.axllent.org/docs/install/), rồi mở PowerShell tại thư mục chứa executable:

```powershell
.\mailpit.exe --smtp 127.0.0.1:1025 --listen 127.0.0.1:8025 --quiet
```

Trong `backend/.env`, dùng các cấu hình mẫu ở `.env.example`: đặt `PASSWORD_RESET_EMAIL_MODE=local`, SMTP loopback `127.0.0.1:1025`, `SMTP_SECURE=false`, không username/password; `PUBLIC_APP_ORIGIN` phải khớp origin frontend và `AUTH_ALLOWED_ORIGINS`. Giữ nguyên credentials TMDB/database. Restart `npm.cmd run dev`, mở inbox tại `http://127.0.0.1:8025` và thử Forgot bằng tài khoản test riêng. Chưa cấu hình hoặc Mailpit không chạy thì UI báo dịch vụ gửi thư chưa sẵn sàng. [Hướng dẫn Windows, cấu hình đầy đủ và checklist Forgot → Reset](docs/phase-6.2e-auth-refinement.md#chạy-mailpit-trên-windows).

## PostgreSQL local — Phase 6.1

Database đã được bạn tạo bằng pgAdmin: `localhost:5432/cineverse_dev`, schema `public`. Chỉ sửa dòng `DATABASE_URL` trong **backend/.env**, giữ nguyên `TMDB_READ_ACCESS_TOKEN`:

```dotenv
DATABASE_URL="postgresql://postgres:<PASSWORD>@localhost:5432/cineverse_dev?schema=public"
```

Thay `<PASSWORD>` bằng mật khẩu thật đã URL-encode, chỉ ở máy của bạn. Ví dụ ký tự `@` → `%40`, `#` → `%23`, `%` → `%25`; encode phần mật khẩu, không encode toàn bộ URL. Không gửi URL/mật khẩu vào chat, Git hay công cụ encode trực tuyến. Có thể để `DATABASE_URL=""` khi chưa thiết lập; validate/generate vẫn chạy được.

Chạy các lệnh sau **từ thư mục gốc**:

```powershell
npm.cmd run db:validate
npm.cmd run db:generate
npm.cmd run db:check
# Sau khi kết nối đúng và đã kiểm tra các đối tượng hiện hữu:
npm.cmd run db:migrate
npm.cmd run db:check
```

Database có bốn migration đã review: `init_user_model`, `add_session_model`, `add_password_reset_token`, `add_favorite_model`. Favorite chỉ thêm bảng/index/FK; các cột auth giữ nguyên. `db:migrate` kiểm tra database, inventory, thứ tự/checksum lịch sử và schema drift trước khi dùng `migrate deploy`, rồi kiểm tra catalog và số bản ghi. Chạy lại khi đã đủ migration chỉ kiểm tra và không ghi database. Không reset, không seed và không tác động database khác. Migration tiếp theo cần mở rộng guard có kiểm thử.

Ở bước này dùng SQL sinh offline rồi apply để không tạo/xóa shadow database của `migrate dev`. Snapshot `user.prisma`, `session.prisma`, `password-reset.prisma` dùng kiểm tra drift ở từng trạng thái trước migration kế tiếp. Xem [Favorites database foundation](docs/phase-6.3a-favorites-database.md).

| Lệnh tại root                     | Nhiệm vụ                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `npm.cmd run db:validate`         | Kiểm tra schema, không cần database                                           |
| `npm.cmd run db:generate`         | Sinh client vào backend/generated/prisma; không tạo bảng                      |
| `npm.cmd run db:migrate:create`   | In SQL từ baseline User+Session+ResetToken tới schema hiện tại, không apply   |
| `npm.cmd run db:migrate`          | Kiểm tra an toàn/drift và áp dụng bốn migration đã review                     |
| `npm.cmd run db:check`            | Kết nối chỉ đọc, kiểm tra metadata/model, không in người dùng hay credentials |
| `npm.cmd run db:studio`           | Mở Studio local; mở URL terminal thông báo, Ctrl+C để dừng                    |
| `npm.cmd run db:sessions:cleanup` | Xóa tối đa 1000 session đã hết hạn/lần, không xóa User hoặc session còn hạn   |

Sau khi migration thành công, trong pgAdmin: **Servers → server local → Databases → cineverse_dev → Schemas → public → Tables → Refresh → User**. Chọn Properties để xem cột/index, hoặc View/Edit Data → All Rows để xem bảng (ban đầu rỗng). `_prisma_migrations` lưu lịch sử kỹ thuật của Prisma. Không nhập mật khẩu gốc vào passwordHash.

## Đã sửa lỗi ECONNREFUSED cổng 3001

Trước đây, `npm run dev` trong `frontend` chỉ chạy Vite. Khi không có backend tại `127.0.0.1:3001`, cả bốn request `/api` đều gây lỗi `connect ECONNREFUSED`. Đã tái hiện lỗi này; địa chỉ proxy trong vite.config.ts đúng và không cần đổi.

Hiện tại, lệnh `dev` ở cả thư mục gốc lẫn `frontend` đều chạy Node proxy trước, Vite sau. Nếu backend không khởi động được, script dừng và báo lỗi thay vì mở frontend thiếu API. Nếu cổng 3001 bận, dừng terminal proxy cũ bằng Ctrl+C rồi chạy lại; không chạy hai lệnh `dev` đồng thời.

`backend/.env` là cấu hình thật mà backend đọc; `.env.example` chỉ là mẫu. Nếu API trả 503/401/403 sau khi backend đã chạy, kiểm tra cấu hình token theo phần hướng dẫn phía trên. Đây là lỗi khác với `ECONNREFUSED`.

## Chức năng hiện tại

- Ba danh sách từ TMDB: phim nổi bật, đang chiếu, được đánh giá cao; hero chọn từ dữ liệu đã tải.
- Tìm tên phim/tên gốc, xử lý hoa thường, trim, tìm một phần tên.
- Lọc thể loại/năm/điểm, sắp xếp, kết hợp nhiều điều kiện, xóa bộ lọc và từ khóa.
- Loading skeleton, thông báo lỗi có Thử lại, API rỗng và không có kết quả lọc.
- Fallback khi thiếu ảnh/mô tả/năm/điểm; không tạo metadata giả.
- Header/mobile menu và giao diện Minimal Editorial được giữ lại.
- Ghi nguồn TMDB ở cuối trang.
- MovieCard và nút Chi tiết của Hero dùng Link tới `/movies/:movieId`, không reload toàn bộ website.
- Chi tiết gồm ảnh, tên/tên gốc, ngày phát hành, thời lượng, thể loại, điểm/số lượt đánh giá, nội dung, quốc gia và trạng thái.
- Trailer YouTube từ TMDB: chỉ tạo iframe khi bấm Xem trailer, không autoplay; có thông báo khi thiếu trailer.
- Phim gợi ý tái sử dụng MovieList/MovieCard, loại ID trùng và phim đang xem.
- ID sai, phim không tồn tại và đường dẫn ngoài Router có giao diện xử lý riêng.
- Từ khóa, bộ lọc, dữ liệu trang chủ và lastUpdated được giữ trong phiên điều hướng; Back không tải lại các danh sách đã có.
- Danh mục Home và recommendations ban đầu có một hàng: 2 cột dưới 640px, 3 cột từ 640px, 4 từ 960px, 5 từ 1280px. Xem thêm tăng một hàng bằng dữ liệu đã tải; Thu gọn quay về một hàng. Mỗi danh mục có State riêng.
- Kết quả tìm kiếm/lọc dùng MovieList mode="full"; số Tìm thấy X / Y vẫn phản ánh tổng số phim phù hợp.
- Cast sắp theo order của TMDB, giữ người thiếu ảnh bằng placeholder; đạo diễn lấy từ crew có job chính xác Director. Credits thiếu/sai không làm mất trang chi tiết.

**Tìm kiếm và bộ lọc chỉ áp dụng cho các phim đã tải từ trang đầu của ba danh sách, không tìm toàn bộ TMDB.** Không có /search/movie, /discover/movie hoặc phân trang trong giai đoạn này.

Nếu chưa có token, UI sẽ báo chưa cấu hình kết nối. Không tự chuyển sang phim mẫu. Dữ liệu/ảnh mẫu cũ vẫn lưu để tham khảo, không còn là nguồn runtime.

## Endpoints và luồng dữ liệu

```text
POST /api/profile/change-password → session + CSRF + old password → Argon2id
  → transaction User/Session locks + password CAS + revoke sessions/reset links → 204 + clear cookie
```

```text
GET   /api/profile → session User → safe User DTO + relation _count.favorites → 200
PATCH /api/profile → CSRF + session + strict name → conditional User UPDATE → 200
```

```text
GET    /api/favorites          → session User → Prisma where userId + sort/pagination → 200
POST   /api/favorites          → CSRF + session + movieId number → create/unique → 201/200
DELETE /api/favorites/:movieId → CSRF + session → deleteMany where userId AND movieId → 204
```

GET trả `{ favorites: [{ movieId, createdAt }], nextCursor }`. Lặp cursor tới null để đọc đủ danh sách. Không nhận userId từ client, không trả internal Favorite UUID hoặc metadata phim. Favorites mutation cần `X-Cineverse-CSRF: 1` và Origin đúng allowlist; DELETE không body. Chi tiết errors/rate limits và kiểm thử nằm trong tài liệu Phase 6.3B.

```text
POST /api/auth/login  → verify Argon2id → tạo Session → Set-Cookie HTTP-only
GET  /api/auth/me     → cookie → SHA-256 → tra Session + expiry → user DTO
POST /api/auth/logout → xóa đúng Session → clear cookie → 204
POST /api/auth/forgot-password → validate/rate limit → token hash → SMTP → 200 thông báo chung
POST /api/auth/reset-password  → token hợp lệ → transaction đổi hash + xóa token/session → 200
```

Login sai email/password trả cùng 401, có dummy verification. Giới hạn Login 20 lần/IP và 10 lần/định danh HMAC trong 15 phút, tối đa 2 thao tác đồng thời. Mỗi User tối đa 5 session; login mới thu hồi phiên cũ nhất nếu vượt giới hạn. Cookie development dùng `cineverse_session`, HTTP-only/SameSite=Lax/Path=/; production bắt buộc `__Host-cineverse_session` + Secure và danh sách HTTPS Origin rõ ràng. Giao diện tài khoản gọi API cùng origin qua Vite, không dùng JWT hoặc lưu token trong Web Storage.

```text
POST /api/auth/register → validation → Argon2id → Prisma User.create → PostgreSQL
                       ← 201 { user: { id, name, email, createdAt } }
```

Body JSON gồm `name`, `email`, `password`. Tên trim, tối đa 100 ký tự; email trim/lowercase, tối đa 254; password giữ nguyên, từ 12 đến 128 ký tự. Body tối đa 16 KB. Trả 400/409/413/415/429/500/503 tương ứng lỗi validation, email trùng, body lớn, media type, rate limit, nội bộ hoặc dịch vụ chưa sẵn sàng. Request gửi body quá chậm trả 408; method khác POST trả 405.

Register giới hạn 5 lần/IP/15 phút và tối đa 2 thao tác đồng thời; bộ giới hạn chỉ ở memory của một process. HTTP 409 vẫn tiết lộ email đã tồn tại, rate limit chỉ giảm nguy cơ dò tài khoản. Đọc [cách gửi request và xác minh User an toàn](docs/phase-6.2a-register.md#kiểm-tra-thực-tế-bằng-powershell).

```text
React → /api/movies/popular      → TMDB /3/movie/popular
      → /api/movies/now_playing  → TMDB /3/movie/now_playing
      → /api/movies/top_rated    → TMDB /3/movie/top_rated
      → /api/genres             → TMDB /3/genre/movie/list
      → /api/movies/:id         → TMDB /3/movie/:id + videos,recommendations,credits
      → /api/movies/:id/videos  → TMDB /3/movie/:id/videos
      → /api/movies/:id/recommendations → TMDB /3/movie/:id/recommendations
```

Proxy cố định language=vi-VN, page=1 cho danh sách và recommendations, dùng Authorization Bearer ở server. Endpoint chi tiết gộp videos,recommendations,credits bằng append_to_response. Trình duyệt không giữ token hoặc chỉ định URL upstream. Khi bản dịch tên thiếu, mapper dùng tên gốc; mô tả thiếu hiển thị thông báo phù hợp.

```text
TMDB → Node proxy → API Service (fetch + validation)
     → Mapper → useMovies (State/Effect/cleanup)
     → App (giữ State) → HomePage (lọc cục bộ) → MovieList → MovieCard

MovieCard Link → /movies/:movieId → useParams → useMovieDetails
              → getMovieDetails → Proxy → TMDB
              → JSON validation → Mapper → MovieDetailsPage
```

## Kiểm tra bằng Chrome DevTools

1. F12 → Network → Fetch/XHR, tải lại trang.
2. Mở /api/movies/popular: xem **Headers → Status Code** và **Response/Preview** để đọc JSON results.
3. Mở /api/genres: JSON có genres để ánh xạ genre_ids.
4. Request phía browser không có Authorization Bearer. Ảnh công khai tải từ image.tmdb.org.
5. 503 nghĩa là chưa cấu hình token; 401/403 là TMDB từ chối thông tin/quyền truy cập; 429 là giới hạn request; 502/504 là lỗi kết nối/dữ liệu/timeout upstream.
6. Sau khi tải xong, đổi tìm kiếm/bộ lọc: không tạo thêm request vì xử lý cục bộ.
7. Mở `/movies/27205` trực tiếp hoặc refresh: vẫn tải đúng phim. `/movies/invalid` không gọi API; `/movies/2147483647` trả trạng thái phim không tồn tại tại lúc kiểm tra.
8. Khi vào chi tiết, kiểm tra `/api/movies/27205`: response chứa videos, recommendations và credits (cast/crew). `/api/genres` bổ sung tên thể loại cho phim gợi ý. Mở chi tiết trực tiếp không gọi ba danh sách trang chủ. Xem thêm diễn viên không gọi API; ảnh lazy tải từ CDN công khai.
9. Trước khi bấm Xem trailer không có iframe/YouTube request. Khi đóng trailer, iframe bị gỡ. Tìm kiếm từ Header ở trang khác đưa về Home và giữ focus trong ô nhập.

StrictMode được giữ trong main.tsx. Trong development có thể thấy request đầu bị canceled rồi lượt mới chạy; xem bài useEffect để hiểu cleanup.

## Các lệnh kiểm tra

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
```

Có thể chạy riêng bằng npm.cmd run dev:proxy và npm.cmd run dev:frontend từ thư mục gốc trong hai terminal. Trong thư mục frontend, npm.cmd run dev:only chỉ mở Vite và cần proxy đang chạy riêng. Production preview của Vite cũng proxy /api tới cổng 3001; cần chạy proxy riêng khi dùng preview. Chưa triển khai hosting trong bước này.

## Tài liệu và thứ tự học

1. [API types](frontend/src/types/tmdb.ts) và [API service](frontend/src/services/tmdb.ts): fetch, response.ok, JSON, lỗi và runtime validation.
2. [Data mapper](frontend/src/utils/mapTmdbMovie.ts): biến dữ liệu TMDB thành Movie của app.
3. [useMovies](frontend/src/hooks/useMovies.ts): async/await, try/catch/finally, State, Effect, AbortController và retry.
4. [App](frontend/src/App.tsx): nối hook với UI và giữ bộ lọc cục bộ.
5. [Node proxy](backend/proxy.mjs): token server, allowlist, HTTP status, timeout và cancellation.

Đọc tiếp:

- [Phase 6.4C — Đổi mật khẩu, transaction/revocation và Security UI](docs/phase-6.4c-change-password.md).
- [Phase 6.4B — Profile UI, cập nhật Header, protected routing và tests](docs/phase-6.4b-profile-frontend.md).
- [Phase 6.4A — Profile backend, name validation, session guard và PowerShell](docs/phase-6.4a-profile-backend.md).
- [Phase 6.3C — React Favorites, Context, phân trang và metadata](docs/phase-6.3c-favorites-frontend.md).
- [Phase 6.3B — Favorites API, session/ownership, pagination và PowerShell](docs/phase-6.3b-favorites-api.md).
- [Phase 6.3A — Favorite model, migration/guards, kiểm thử RAM và pgAdmin](docs/phase-6.3a-favorites-database.md).
- [Phase 6.2E — Auth layout, chẩn đoán lỗi Forgot, Mailpit Windows và checklist kiểm thử](docs/phase-6.2e-auth-refinement.md).
- [Phase 6.2D — Forgot/Reset, SMTP/Mailpit, migration, bảo mật token và kiểm thử](docs/phase-6.2d-password-recovery.md).
- [Phase 6.2C — AuthProvider/useAuth, forms, API service, kiểm thử và hướng dẫn browser](docs/phase-6.2c-auth-ui.md).
- [Phase 6.2B — PostgreSQL session, Login/Me/Logout, CSRF/cookies, kiểm thử và PowerShell](docs/phase-6.2b-login-session.md).
- [Phase 6.2A — Backend Register API, Argon2id, validation, tests và thực hành PowerShell](docs/phase-6.2a-register.md).
- [Phase 6.1 — PostgreSQL, Prisma, migration, DATABASE_URL, pgAdmin và 3 bài tập](docs/phase-6.1-database.md).
- [Phase 5.6 — Top Cast & Director, types/parser/mapper, kiểm thử và bài tập](docs/phase-5.6-cast.md).
- [Phase 5.5 — UI compact, danh sách file, cách hoạt động, kiểm thử và bài học](docs/phase-5.5-ui.md).
- [Giai đoạn 5 — kiến trúc, file thay đổi, giới hạn](docs/phase-5-architecture.md).
- [Giai đoạn 5 — Router, Dynamic API, Effect, kiến trúc và bài tập](docs/phase-5-learning.md).
- [Giai đoạn 5 — 48 test và kiểm thử trình duyệt](docs/phase-5-testing.md).
- [5 bài học trên code thực tế](docs/phase-4-learning.md).
- [Cấu trúc, danh sách file thay đổi và giới hạn](docs/phase-4-architecture.md).
- [Kết quả kiểm thử và kiểm tra kết nối thật](docs/phase-4-testing.md).
- [Tài liệu lịch sử giai đoạn 1–3.5](docs/previous-stages.md).

**Xác minh Giai đoạn 5:** 48 test Node đạt; lint, TypeScript check và build đạt. Edge headless kiểm tra cả fixture và TMDB thật: điều hướng, Back/Forward, URL trực tiếp/refresh, Retry, ID/404, metadata/ảnh/trailer/gợi ý, race condition, giữ State/lastUpdated và responsive. Chi tiết Inception thật trả 200, 27 video và 20 phim gợi ý tại thời điểm kiểm tra. Xem tài liệu testing để phân biệt những phần đã kiểm tra với giới hạn playback YouTube.

**Xác minh Phase 5.5:** 48 test cũ, lint, TypeScript và build đạt. Kiểm thử browser mới xác minh một hàng ban đầu, tăng đúng hàng, State độc lập, giữ thứ tự, hàng cuối chưa đủ cột, focus/scroll khi thu gọn, resize/breakpoint, full results và không phát sinh request API. Đã chạy lại browser Giai đoạn 5 và kiểm tra dữ liệu TMDB thật ở 320/390/768/1024/1440px. Ảnh desktop/mobile và kết quả chi tiết nằm trong tài liệu Phase 5.5.

**Xác minh Phase 5.6:** 57 test đạt (20 backend, 37 frontend), lint/TypeScript/build đạt. Browser mới kiểm tra cast/đạo diễn/ảnh/order/mở thu/reset ID ở 320/390/768/1024/1440px, và TMDB thật cho Inception: 52 cast, Christopher Nolan, không thêm API request khi mở/thu. Kiểm thử hồi quy browser Phase 5 và compact Phase 5.5 đều đạt.

**Xác minh Phase 6.2D:** 131 test đạt (83 backend, 48 frontend); lint/typecheck/build và kiểm thử Edge auth/recovery + hồi quy phim/compact/cast đạt. Migration thêm bảng token, kiểm tra lại không drift; số User/Session không đổi. Live TMDB vẫn hoạt động; email chưa cấu hình trả 503 đúng và không ghi dữ liệu. SMTP đã thử bằng Nodemailer + catcher giả lập loopback, chưa xác minh provider Internet. Chi tiết nằm trong tài liệu Phase 6.2D.

**Xác minh Phase 6.2E:** 134 tests đạt (84 backend, 50 frontend), lint/typecheck/build đạt. Edge kiểm tra bốn trang Auth ở 320/375/768/1024/1440/1920px, keyboard/focus/validation/footer/overflow và lỗi SMTP disabled/refused; hồi quy Auth/recovery/Home/Details/Search/compact/cast đạt. Mailpit thật và SMTP Internet chưa xác minh; không sửa `.env`, migration hay tài khoản thật. Xem tài liệu Phase 6.2E để tự thiết lập và chạy checklist.

**Xác minh Phase 6.3A:** 146 tests đạt (96 backend, 50 frontend), lint/typecheck/build và validate/generate/migrate/db:check đạt. Favorite đã được tạo trên cineverse_dev/PostgreSQL 17.11; unique/FK/index/cột đúng catalog. User 2→2, Session 1→1, ResetToken 0→0, Favorite 0; migration chạy lại giữ nguyên history/counts và chỉ có một bản ghi add_favorite_model. Kiểm thử CRUD/unique/Cascade trong PostgreSQL WASM RAM, không thêm/xóa Favorite thật. Chưa chặn movieId 0/âm ở DB; validation số nguyên dương Int32 thuộc Phase 6.3B.

**Xác minh Phase 6.3B:** 184 tests đạt (134 backend, 50 frontend, gồm 38 Favorites tests mới), lint/typecheck/build và browser regression đạt. Prisma diff chỉ đọc không có schema drift; counts/history trước và sau giữ nguyên (User 2, Session 2, ResetToken 0, Favorite 0; 4 migrations). CRUD Favorites được kiểm thử với database mock; không thêm/xóa Favorite thật. Xem chi tiết và hướng dẫn PowerShell trong tài liệu Phase 6.3B.

**Xác minh Phase 6.3C:** 205 tests đạt (134 backend + 71 frontend, gồm 21 tests mới), Favorites browser 12 nhóm đạt; auth/movie/layout regression và lint/typecheck/build đạt. UI Favorites kiểm tra tại 375/768/1024/1440px. Tests dùng DB/TMDB fixtures, không ghi PostgreSQL thật. Không sửa backend/schema/migration/dependencies trong phase này.

**Xác minh Phase 6.4A:** 235 tests đạt (164 backend + 71 frontend, gồm 30 Profile tests mới); lint/typecheck/build và db:validate/db:check đạt. Không schema drift; counts/history giữ nguyên (User 2, Session 1, ResetToken 0, Favorite 4; 4 migrations). PATCH/Profile chỉ kiểm thử bằng fixtures; Prisma Client + pg adapter cũng được kiểm chứng với PostgreSQL WASM RAM. Không sửa tài khoản thật, schema/migration hoặc React UI.

**Xác minh Phase 6.4B:** 251 tests đạt (164 backend + 87 frontend, gồm 16 frontend Profile tests mới), Profile browser 10 nhóm và Favorites browser 12 nhóm đạt; auth/movie/layout regression và lint/typecheck/build đạt. Profile view/edit kiểm tra tại 375/768/1024/1440px; fixtures không sửa tài khoản thật. Không đổi backend/schema/migration trong phase frontend.

**Xác minh Phase 6.4C:** 287 tests đạt (187 backend + 100 frontend; thêm 23 backend và 13 frontend tests), 7 nhóm Change Password browser cùng hồi quy Profile/Favorites/Auth/movie/layout đạt; lint/typecheck/build và db:validate/db:check đạt. Không schema drift; counts/history giữ nguyên (User 3, Session 1, ResetToken 1, Favorite 3; 4 migrations). Positive password changes chỉ dùng fixtures/PGlite RAM; không đổi mật khẩu tài khoản thật.

Dừng tại Phase 6.4C. Profile có sửa tên và đổi mật khẩu, email chỉ đọc/chưa avatar; password change buộc Login lại sau khi thu hồi sessions. Favorites và giao diện hiện có giữ nguyên; email delivery cần người dùng cấu hình để nhận link thật. Chưa thêm TV Favorites, JWT/OAuth/MFA hoặc phát phim đầy đủ. Khi đưa SPA lên hosting cần fallback các URL giao diện về index.html (bao gồm `/favorites` và `/profile`), đặt no-store cho trang recovery và Referrer-Policy: no-referrer; xem tài liệu Phase 6.2D/6.2E.
