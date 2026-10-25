# Giai đoạn 5 — Kiểm thử thực tế

## Các lệnh đã chạy

Từ `D:\LearnReact\Cineverse`:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
```

Kết quả: 48 test đạt (19 backend, 29 frontend), lint không warning/error, TypeScript và production build thành công. Test Node dùng upstream mô phỏng, không cần token TMDB.

Test mới kiểm tra ID, JSON runtime, mapper metadata/null, trailer an toàn và thứ tự ưu tiên, loại recommendations trùng/phim hiện tại, service URL/signal/status, proxy allowlist/aggregate và không lộ lỗi nội bộ. 29 test từ Giai đoạn 4 vẫn được giữ; tổng cộng thêm 19 test.

## Browser — fixture có kiểm soát

Đã chạy Edge headless qua Playwright với API/ảnh/video embed được mô phỏng cho các tình huống biên:

- Home giữ tìm kiếm hoa/thường/trim, lọc thể loại+năm+điểm, sort và lastUpdated.
- Link MovieCard hoạt động bằng Enter; Hero Chi tiết và recommendations mở đúng ID.
- Điều hướng trên app không tải lại tài liệu chính; iframe là tài liệu riêng và không bị tính là reload ứng dụng.
- Back/Forward giữ State, timestamp và không gọi lại ba danh sách trang chủ đã tải.
- SearchBar từ chi tiết về Home giữ focus; reset hoạt động.
- Mở URL trực tiếp/refresh; không gọi danh sách trang chủ trên trang chi tiết.
- ID invalid/0/-1/quá int32 không gọi bất kỳ API nào.
- Đường dẫn ngoài Router và phim không tồn tại có trang 404 đúng loại.
- Loading, HTTP 429/500, lỗi mạng/JSON hỏng và Retry sau khi phục hồi.
- Poster thiếu hoặc trả 404 có fallback; metadata thiếu không làm hỏng trang.
- Không có trailer có thông báo; recommendations rỗng bị ẩn; lỗi thể loại phụ không chặn chi tiết.
- Iframe chưa tồn tại trước click, được tạo sau click, có URL cố định/key hợp lệ/title/sandbox, autoplay=0 và tỷ lệ 16:9; đóng gỡ iframe.
- Responsive 1440/768/390/320px không tràn ngang; menu mobile mở/đóng bằng Escape.
- Harness hook xác minh abort khi đổi ID/unmount. Khi cố ý bỏ qua AbortSignal, response A đến sau B vẫn không ghi đè B. ID sai không gọi API và không giữ nội dung phim cũ.

## Browser — dữ liệu TMDB thật

Không intercept API/ảnh trong lượt kiểm tra live. Đã chạy React → Vite → Node proxy → TMDB thật với token chỉ ở server.

| Request qua Vite | Kết quả tại lúc kiểm tra |
| --- | --- |
| GET /api/movies/27205 | 200, ID 27205, 27 video, 20 phim gợi ý |
| GET /api/movies/27205/videos | 200, 27 video |
| GET /api/movies/27205/recommendations | 200, 20 phim |
| GET /api/movies/invalid | 400, INVALID_MOVIE_ID |
| GET /api/movies/2147483647 | 404, TMDB_HTTP_404 |

Trình duyệt hiển thị Inception với thời lượng 148 phút, tên/ngày/điểm/số lượt/country/status từ API và poster thật đã tải thành công. Kiểm tra iframe trailer chỉ được tạo sau click với URL hợp lệ và autoplay=0; bấm phim gợi ý mở đúng ID mới, Back/refresh vẫn đúng Inception. Trang chủ live vẫn tải danh sách và hiển thị lastUpdated. Kiểm tra responsive với dữ liệu thật ở 1440/768/390/320px đạt.

Không có lỗi JavaScript trong những lượt browser này. Browser không gửi Authorization, không trực tiếp gọi api.themoviedb.org. Đã so khớp token cục bộ với response API, frontend/src và frontend/dist: không xuất hiện. Không in token ra log hoặc đưa token vào browser để kiểm tra.

Ảnh chụp viewport thật trong cache: `.npm-cache/phase-5-details-desktop.png`, `.npm-cache/phase-5-details-mobile.png`.

## Cách chạy lại browser tests

App phải đang chạy bằng `npm.cmd run dev`. Script không là một phần npm test vì cần browser/Playwright; không thêm dependency kiểm thử vào runtime app. Trong phiên này đã dùng Playwright tạm có sẵn trong npm cache và Edge đã cài:

```powershell
node frontend/tests/movieDetails.browser.cjs D:\LearnReact\Cineverse\.npm-cache\_npx\e41f203b7505f1fb\node_modules\playwright --live
```

Bỏ --live nếu chỉ chạy fixture, không gọi TMDB thật. Đường dẫn cache phụ thuộc máy; có thể truyền đường dẫn module Playwright khác. Browser mặc định msedge; biến CINEVERSE_BROWSER_CHANNEL đổi sang chrome nếu dùng Chrome đã cài. CINEVERSE_TEST_URL đổi địa chỉ app nếu Vite chọn cổng khác.

Hook harness chỉ dùng ở dev:

- `/tests/useMovieDetails.browser.html`
- `/tests/useMovieDetails.browser.html?ignoreAbort=1`

Hai file harness không nằm trong build production, tương tự harness useMovies cũ.

## Giới hạn của kiểm chứng

- Số lượng video/phim/điểm từ TMDB có thể thay đổi.
- Đã kiểm tra dữ liệu trailer, tạo/đóng iframe, URL và không autoplay; chưa bấm phát và xác minh toàn bộ nội dung video YouTube hoặc mọi khu vực. Video có thể bị chủ sở hữu giới hạn nhúng; link Mở trên YouTube vẫn có sẵn.
- Lỗi 429/500, mạng, JSON hỏng và race condition dùng fixture; không cố tạo giới hạn hoặc gây lỗi trên dịch vụ TMDB thật.
- Chưa kiểm tra triển khai hosting/SSR. Refresh/URL trực tiếp được kiểm tra trên Vite cục bộ; hosting SPA cần fallback index.html phù hợp.
