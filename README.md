# Cineverse — Phase 5.6: Top Cast & Director

React + TypeScript + Vite với giao diện Minimal Editorial Cinema. Dữ liệu phim được tải qua proxy Node.js cục bộ; token TMDB chỉ nằm trên server.

Phase 5.6 thêm đạo diễn trong metadata và Dàn diễn viên chính sau nội dung phim. Credits được gộp vào request chi tiết; không gọi API riêng cho từng người. Danh sách cast có một hàng ban đầu, Xem thêm / Thu gọn độc lập với phim gợi ý. Xem [báo cáo, types/parser/mapper, kiểm thử và bài tập Phase 5.6](docs/phase-5.6-cast.md).

Phase 5.5 thu gọn mỗi danh mục về một hàng responsive, thêm Xem thêm / Thu gọn theo hàng và tinh chỉnh trang chi tiết. Search/filter vẫn hiển thị đầy đủ kết quả. Không thay backend, API, Types hoặc Mapper. Xem [báo cáo UI, hướng dẫn học và kiểm thử Phase 5.5](docs/phase-5.5-ui.md).

Giai đoạn 5 thêm URL chi tiết `/movies/:movieId`, trailer theo thao tác người dùng, phim gợi ý và trang 404. Đọc [kiến trúc và danh sách file](docs/phase-5-architecture.md), [5 bài học trên code](docs/phase-5-learning.md) và [kết quả kiểm thử](docs/phase-5-testing.md).

## Chạy dự án

Yêu cầu Node.js 22.18+ và npm. Từ PowerShell:

```powershell
cd D:\LearnReact\Cineverse
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

Không cần cài thư viện hoặc database cho backend. Chỉ npm install trong frontend là đủ.

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

Dừng tại Phase 5.6. Chưa có đăng nhập, database, Favorites hoặc phát phim đầy đủ. Khi đưa SPA lên hosting sau này cần cấu hình fallback các URL giao diện về index.html; hiện đã kiểm tra URL trực tiếp/refresh trên Vite cục bộ.
