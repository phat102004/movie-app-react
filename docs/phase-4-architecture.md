# Giai đoạn 4 — Kiến trúc và báo cáo thay đổi

## Cấu trúc

```text
Cineverse/
├── package.json                  # Các lệnh chạy/check từ thư mục gốc
├── scripts/dev.mjs               # Khởi động và dừng hai server cùng nhau
├── backend/
│   ├── .env.example              # Placeholder; token thật chỉ ở .env
│   ├── index.mjs                 # Đọc env, chạy server localhost:3001
│   ├── proxy.mjs                 # Bốn GET route cố định, fetch TMDB
│   └── tests/proxy.test.mjs       # Unit/HTTP test, upstream được mô phỏng
├── frontend/
│   ├── vite.config.ts            # /api → Node proxy, cả dev và preview
│   ├── public/tmdb-logo.svg      # Logo chính thức
│   ├── public/TMDB-SOURCES.md    # Nguồn logo và quy định attribution
│   ├── src/
│   │   ├── types/tmdb.ts         # Response API, khác với Movie của app
│   │   ├── services/tmdb.ts      # fetch, HTTP/JSON/schema validation
│   │   ├── utils/mapTmdbMovie.ts # Chuyển API → Movie, gom/loại trùng ID
│   │   ├── hooks/useMovies.ts    # State bất đồng bộ, Effect, cleanup, retry
│   │   ├── components/
│   │   │   ├── MovieDataState.tsx/.css # Loading, error, empty
│   │   │   └── TmdbAttribution.tsx    # Ghi nguồn cuối trang
│   │   └── App.tsx              # Ghép UI và tính kết quả lọc cục bộ
│   └── tests/
│       ├── tmdb.test.ts         # Service, mapper, validation, nullable fields
│       └── useMovies.browser.*  # Harness kiểm tra lifecycle trong dev
└── docs/
    ├── phase-4-learning.md
    ├── phase-4-testing.md
    └── previous-stages.md        # Hướng dẫn cũ, mang tính lịch sử
```

## Endpoints

| Trình duyệt gọi               | Node gọi TMDB v3           | Sử dụng                    |
| ----------------------------- | -------------------------- | -------------------------- |
| `GET /api/movies/popular`     | `GET /3/movie/popular`     | Phim nổi bật               |
| `GET /api/movies/now_playing` | `GET /3/movie/now_playing` | Phim đang chiếu            |
| `GET /api/movies/top_rated`   | `GET /3/movie/top_rated`   | Phim được đánh giá cao     |
| `GET /api/genres`             | `GET /3/genre/movie/list`  | Ánh xạ genre_ids thành tên |

Node cố định host TMDB, ngôn ngữ vi-VN và trang 1. Không nhận URL/query tùy ý hoặc endpoint khác. Không thêm /search/movie, /discover/movie, đăng nhập hay database.

Mỗi lần tải có bốn request độc lập chạy bằng Promise.all. Tìm kiếm và thay bộ lọc không gọi API lại. StrictMode trong development có thể tạo lượt request đầu bị hủy rồi chạy lượt mới; đây là lý do phải có cleanup.

## Luồng dữ liệu

```text
TMDB ← Authorization Bearer (chỉ server)
  ↓ HTTP JSON
Node proxy ← React service gọi /api qua Vite proxy
  ↓ unknown JSON → validation → TmdbMoviePage / TmdbGenre[]
useMovies → buildMovieCatalog → mapTmdbMovie → Movie[] / MovieSection[]
  ↓ State catalog + loading + error
App → filterAndSortMovies → MovieList → MovieCard
```

Service không biết React State. Mapper không fetch và không dùng hook. Hook quản lý vòng đời request. Component chỉ nhận dữ liệu/trạng thái để hiển thị. Việc lọc và sắp xếp vẫn tính trực tiếp khi render, không đồng bộ kết quả bằng Effect.

## Metadata và fallback

- ID của app là ID TMDB chuyển sang chuỗi, không tạo ID phim giả.
- Khi title vi-VN rỗng, dùng original_title. Nếu cả hai thiếu, hiển thị nhãn UI báo chưa có tên.
- Mô tả rỗng giữ chuỗi rỗng trong mapper; HeroBanner hiển thị thông báo chưa có mô tả. Không tự viết nội dung thay thế hoặc gọi thêm request dịch thuật.
- Năm thiếu/ngày không hợp lệ và điểm thiếu/chưa có lượt đánh giá dùng null. UI hiển thị thông báo hoặc dấu gạch, không gán năm 0 hoặc điểm giả.
- Khi đặt ngưỡng điểm, phim chưa có đánh giá không thỏa mãn. Khi không đặt ngưỡng, phim đó vẫn được hiển thị.
- Năm/điểm chưa biết được đặt cuối trong các cách sắp xếp tương ứng; sort vẫn chạy trên bản sao.
- Poster null/sai đường dẫn dùng fallback ngay; ảnh tải lỗi dùng onError. Backdrop dùng poster nếu có; nếu cả hai thiếu, hero có khung thay thế.
- Không hiển thị nhãn 4K trước đây vì API metadata không chứng minh chất lượng video.
- Thể loại và năm dropdown được lấy từ chính dữ liệu đã tải. Không tiếp tục phụ thuộc dữ liệu mẫu.
- Các nhóm phim có thể lặp cùng một phim; danh sách dùng cho tìm kiếm/bộ lọc loại trùng theo ID.

## Bảo mật và HTTP

Token được đọc từ backend/.env hoặc biến môi trường server. Không có biến VITE_ chứa token, Authorization không được gửi từ service frontend. Ảnh công khai tải trực tiếp từ image.tmdb.org không cần token.

Proxy timeout sau 8 giây và hủy upstream nếu client đóng kết nối. Lỗi trả về JSON được kiểm soát; không log token hoặc đưa lỗi thô/headers upstream về client.

| Tình huống                        | HTTP của proxy                        |
| --------------------------------- | ------------------------------------- |
| Chưa cấu hình token               | 503                                   |
| TMDB trả 401/403                  | Giữ 401/403 với thông báo an toàn     |
| TMDB trả 429                      | Giữ 429 và Retry-After dạng số nếu có |
| TMDB lỗi khác, mất mạng, JSON sai | 502                                   |
| Timeout upstream                  | 504                                   |
| Route/query không hỗ trợ          | 404                                   |
| Method không hỗ trợ               | 405                                   |

## Danh sách file tạo mới

- `package.json`, `scripts/dev.mjs`.
- `backend/.env.example`, `backend/index.mjs`, `backend/proxy.mjs`, `backend/tests/proxy.test.mjs`.
- `frontend/src/types/tmdb.ts`, `frontend/src/services/tmdb.ts`, `frontend/src/utils/mapTmdbMovie.ts`, `frontend/src/hooks/useMovies.ts`.
- `frontend/src/components/MovieDataState.tsx`, `MovieDataState.css`, `TmdbAttribution.tsx`, `TmdbAttribution.css`.
- `frontend/tests/tmdb.test.ts`, `useMovies.browser.html`, `useMovies.browser.tsx`.
- `frontend/public/tmdb-logo.svg`, `frontend/public/TMDB-SOURCES.md`.
- Các tài liệu phase-4 trong docs và bản lưu previous-stages.md.

## Danh sách file chỉnh sửa

- `.gitignore`: bỏ qua .env và giữ .env.example.
- `frontend/package.json`: thêm typecheck; không thêm dependency.
- `frontend/vite.config.ts`: proxy dev/preview.
- `frontend/src/types/movie.ts`: year/rating cho phép null.
- `frontend/src/data/movieFilters.ts`: tạo options từ dữ liệu tải về.
- `frontend/src/data/movies.ts`: chỉ sửa comparator để tương thích kiểu nullable; giữ dữ liệu cũ, không dùng làm runtime fallback.
- `frontend/src/utils/filterMovies.ts`: xử lý năm/điểm thiếu; giữ thuật toán và cách kết hợp điều kiện.
- `frontend/src/components/MovieFilters.tsx`: nhận options động bằng props; giữ events/reset.
- `frontend/src/components/HeroBanner.tsx`, `HeroBanner.css`: fallback metadata/ảnh; bỏ thông tin 4K không có nguồn; cho phép tên dài xuống dòng.
- `frontend/src/components/MovieCard.tsx`: fallback poster và năm/điểm/thể loại thiếu.
- `frontend/src/App.tsx`: dùng hook, UI trạng thái API, phạm vi tìm kiếm cục bộ và attribution.
- `frontend/src/SearchResults.css`: thông báo phạm vi tìm kiếm cục bộ.
- `README.md`: hướng dẫn chạy giai đoạn hiện tại.

Header, SearchBar, MovieList, thiết kế Minimal Editorial và State tìm kiếm/bộ lọc vẫn được tái sử dụng. Không có fallback tự động sang mock khi API lỗi. Dữ liệu mẫu/ảnh cũ được giữ cho lịch sử và kiểm thử, không được import vào luồng runtime.

## Phạm vi và giới hạn

Chỉ tải trang đầu của ba danh sách. Tìm kiếm/lọc là cục bộ trên tập phim đó; số lượng hiển thị là số phim duy nhất đã tải, không phải tổng số trên TMDB. Giao diện có ghi rõ điều này.

Token đã được cấu hình trong backend/.env. Kiểm tra Node proxy tới TMDB thật cho thấy cả bốn endpoint trả HTTP 200: 20 phim cho mỗi danh sách và 19 thể loại tại thời điểm kiểm tra. Test tự động vẫn sử dụng upstream/response mô phỏng; browser chưa được kiểm tra lại với dữ liệu live trong lần cấu hình này. Token không được lưu trong tài liệu hoặc mã frontend.

Tài liệu chính thức: [TMDB Getting Started](https://developer.themoviedb.org/docs/getting-started), [Bearer authentication](https://developer.themoviedb.org/docs/authentication-application), [Image URL](https://developer.themoviedb.org/docs/image-basics), [Attribution](https://developer.themoviedb.org/docs/faq).
