# Giai đoạn 4 — Kết quả kiểm thử

## Đã thực hiện

- Node proxy: 11 test HTTP tích hợp qua localhost với upstream được mô phỏng.
- Frontend: 18 test logic gồm 8 test filter cũ và 10 test service/mapper mới.
- Lint frontend, backend, scripts.
- TypeScript check và production build.
- Edge headless, viewport 1440/768/390/320px: thành công bằng fixture, ảnh, metadata, dropdown động, tìm theo tên/tên gốc, hoa/thường, trim, reset, các thứ tự sắp xếp, lọc kết hợp, không tràn ngang.
- Fixture UI: skeleton, 401/429, lỗi mạng, JSON sai, retry, API rỗng, thiếu poster/backdrop/mô tả/năm/điểm/thể loại.
- Hook harness: StrictMode cleanup hủy signal; unmount hủy signal; request cũ cố ý không tuân thủ signal cũng không ghi đè kết quả mới nhờ isCurrent.
- Tìm kiếm và thay bộ lọc không tạo thêm request API sau khi tải xong.
- Luồng thật React → Vite proxy → Node proxy khi thiếu token: trả 503, hiển thị lỗi và retry được. Không hiển thị mock phim thay thế.

## Cập nhật xác minh TMDB thật

Đã cấu hình backend/.env và thực sự gọi Node proxy → TMDB với xác thực server. Kết quả:

| Endpoint proxy | HTTP | Số kết quả tại lúc kiểm tra |
| --- | --- | --- |
| /api/movies/popular | 200 | 20 phim |
| /api/movies/now_playing | 200 | 20 phim |
| /api/movies/top_rated | 200 | 20 phim |
| /api/genres | 200 | 19 thể loại |

Các test UI/mapper ban đầu phía trên dùng fixture. Sau khi sửa lỗi khởi động, đã kiểm tra lại bằng Edge headless với dữ liệu TMDB thật qua Vite và Node proxy, không chặn hoặc thay response API:

- Hiển thị 60 MovieCard thuộc ba danh sách (20 mỗi danh sách; một phim có thể xuất hiện ở nhiều danh sách).
- Tìm tên gốc với chữ hoa và khoảng trắng, kết hợp thể loại + năm + điểm: số MovieCard khớp dữ liệu thật.
- Từ khóa không có kết quả hiển thị trạng thái rỗng; reset khôi phục ba danh sách.
- Viewport 1440/768/390/320px không tràn ngang và ô tìm kiếm vẫn sử dụng được.
- Thay từ khóa/bộ lọc không gọi thêm API; không có lỗi JavaScript, Bearer trong request browser hoặc request trực tiếp tới api.themoviedb.org.

Không in token hoặc response chứa thông tin xác thực. Kịch bản live nằm tại `.npm-cache/tmdb-live-debug.cjs`, dùng cùng Playwright tạm trong cache; không thêm dependency cho app.

## Kiểm tra bản sửa khởi động

- Tái hiện trước sửa: `npm.cmd run dev` trong frontend chỉ mở Vite; cả bốn endpoint trả 502 và log `ECONNREFUSED 127.0.0.1:3001`.
- Sau sửa: cùng lệnh trong frontend mở proxy trước rồi Vite; cả bốn endpoint qua cổng Vite trả 200 như bảng trên.
- Khởi động lại từ thư mục gốc cũng đạt; Vite tự chuyển sang 5174 khi 5173 bận và cả bốn endpoint qua localhost:5174 trả 200. Cần mở đúng địa chỉ Local trong terminal.
- Thử khởi động thêm khi proxy đang chạy: script thoát mã 1, báo cổng 3001 bận và không mở Vite thứ hai.
- Dừng các phiên kiểm tra bằng Ctrl+C: proxy 3001 và Vite của phiên đó đều dừng.
- Chạy lại 29 test, lint, typecheck và build: đều đạt.

## Chạy lại

```powershell
cd D:\LearnReact\Cineverse
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
```

Browser harness có tại `/tests/useMovies.browser.html` khi Vite đang chạy; nó không nằm trong bundle production. Kịch bản browser tự động của phiên triển khai được lưu trong `.npm-cache/tmdb-browser.cjs` và dùng Playwright tạm có sẵn trong cache, không phải dependency bắt buộc của app. Harness không được import vào main.tsx.

## Kiểm tra thật sau khi cấu hình token

1. Khởi động bằng npm.cmd run dev từ thư mục gốc.
2. Mở DevTools → Network, chọn Fetch/XHR và tải lại trang.
3. Kiểm tra bốn request /api: status 200 và JSON có results hoặc genres.
4. Request Headers từ browser không có Bearer token. Browser không trực tiếp gọi api.themoviedb.org.
5. Img requests tới image.tmdb.org là tài nguyên công khai.
6. Kiểm tra title/originalTitle, ảnh và thể loại. Thử tìm một phần tên thật vừa tải.
7. Kết hợp năm + thể loại + điểm; reset toàn bộ; thử lựa chọn không có kết quả.
8. Nếu thấy 401: kiểm tra API Read Access Token trên server, không dùng nhầm API key. Nếu 429: chờ trước khi thử lại. Khi thay .env cần khởi động lại proxy.

Giữ nguyên token trên máy; không đưa vào ảnh chụp, log, báo cáo hoặc cuộc trò chuyện.
