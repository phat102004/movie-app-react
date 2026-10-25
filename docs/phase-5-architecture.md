# Giai đoạn 5 — Kiến trúc và file thay đổi

## Router và layout

Chỉ có một BrowserRouter tại `frontend/src/main.tsx`, dùng React Router 7.18.4 (pin chính xác trong package.json/lockfile). Registry đã xác minh bản này hỗ trợ Node >=20, React >=18; phù hợp Node 22.18 và React 19.2.8 của dự án. Bản mới nhất 8.5.0 lúc kiểm tra yêu cầu Node >=22.22 nên không chọn.

```text
BrowserRouter
└── App
    ├── Header (Link logo, NavLink Trang chủ, SearchBar)
    ├── main / Routes
    │   ├── /                 → HomePage
    │   ├── /movies/:movieId  → MovieDetailsPage
    │   └── *                 → NotFoundPage
    ├── Footer / TmdbAttribution
    └── RouteFocus
```

App giữ searchQuery, filters và useMovies(enabled). HomePage nhận dữ liệu/State qua Props, giữ nguyên logic lọc/sắp xếp. Hook chỉ bắt đầu tải các danh sách khi ở `/`, giữ dữ liệu khi chuyển trang và dùng successfulVersion để tránh tải lại khi Back. Retry vẫn tăng requestVersion và tải lại. lastUpdated chỉ thay đổi sau khi tải trang chủ thành công.

Header và Footer không mount lại theo route. Nhập tìm kiếm khi ở trang khác gọi navigate('/') sau khi cập nhật query. RouteFocus cuộn về đầu và đưa focus vào main khi đổi trang, nhưng không lấy focus khỏi ô tìm kiếm. Menu Phim lẻ/Phim bộ/Yêu thích vẫn giữ trạng thái chưa hỗ trợ hiện có.

## Proxy và API

| Endpoint mới | TMDB cố định | Mục đích |
| --- | --- | --- |
| GET /api/movies/:id | /3/movie/:id?language=vi-VN&append_to_response=videos,recommendations&include_video_language=vi,en,null | Frontend dùng một response cho thông tin chính, video và phim gợi ý |
| GET /api/movies/:id/videos | /3/movie/:id/videos?language=vi-VN&include_video_language=vi,en,null | Endpoint video độc lập được hỗ trợ và kiểm thử |
| GET /api/movies/:id/recommendations | /3/movie/:id/recommendations?language=vi-VN&page=1 | Endpoint phim gợi ý độc lập được hỗ trợ và kiểm thử |

Bốn endpoint cũ vẫn hoạt động. Frontend không gọi lại hai endpoint phụ vì response chi tiết đã gộp chúng. useMovieDetails gọi thêm `/api/genres` để ánh xạ đủ genre_ids của phim gợi ý; nếu endpoint thể loại lỗi thì vẫn hiển thị chi tiết, dùng những tên thể loại có sẵn trong chính phim đó.

ID phải có dạng số nguyên dương từ 1 đến 2147483647 (TMDB khai báo int32), không số âm, thập phân, số mũ, số có zero đầu hay URL. Kiểm tra ở page/hook, service và proxy. Frontend không được truyền URL upstream, append_to_response hay query tùy ý. Token giữ trong backend/.env, không thay đổi hay chuyển sang biến VITE_.

400 xử lý ID/yêu cầu sai; 404 giữ trạng thái phim không tồn tại; 401/403/429 giữ status an toàn; TMDB 500 được chuyển thành 502 vì lỗi nằm ở upstream; timeout thành 504, lỗi mạng/JSON thành 502. Không chuyển raw error, token hoặc stack về browser. Các Route 404 trong SPA là giao diện 404; HTML từ dev server vẫn có thể trả HTTP 200, không phải SSR.

## Phân chia trách nhiệm

| Thành phần | Trách nhiệm |
| --- | --- |
| HomePage | Nội dung trang chủ cũ: hero, bộ lọc, kết quả, loading/error, lastUpdated |
| MovieDetailsPage | Lấy param, chọn trạng thái UI, bố cục ảnh/metadata/nội dung/trailer/gợi ý |
| NotFoundPage | Đường dẫn sai, ID sai hoặc phim không tồn tại với thông báo tương ứng |
| MovieTrailer | Mở/đóng iframe YouTube theo click; không tự phát; xử lý không có trailer |
| MovieList / MovieCard | Dùng chung ở Home và recommendations; Card có Link truy cập bằng chuột/bàn phím |
| useMovieDetails | Effect gọi API theo ID/Retry, cleanup/abort, State và chặn response cũ |
| services/tmdb | fetch, HTTP errors, kiểm tra JSON runtime; không phụ thuộc bố cục React |
| API types | Hình dạng dữ liệu TMDB; khác với model hiển thị của app |
| Mapper | Đổi tên trường, ảnh an toàn, null/fallback, chọn trailer, loại ID trùng/phim hiện tại |
| RouteFocus | Focus và cuộn khi điều hướng; không can thiệp tìm kiếm/bộ lọc |

DetailsState lưu cả id và version. UI chỉ đọc State khớp movieId và requestVersion hiện tại. Vì thế khi ID đổi hoặc bấm Retry, loading được suy ra ngay khi render, không cần setState đồng bộ trong Effect để xóa dữ liệu cũ.

Trailer chỉ chấp nhận site YouTube, type Trailer và video key đúng 11 ký tự an toàn. Ưu tiên official, sau đó tiếng Việt, tiếng Anh, ngôn ngữ khác. Nếu chỉ có trailer không official thì không gắn nhãn chính thức. Iframe dùng youtube-nocookie.com, autoplay=0, title, sandbox và referrerPolicy; bị gỡ khi đóng hoặc đổi phim. Có link YouTube ngoài nếu embed bị giới hạn.

## File mới

- `frontend/src/pages/HomePage.tsx`
- `frontend/src/pages/MovieDetailsPage.tsx`
- `frontend/src/pages/MovieDetailsPage.css`
- `frontend/src/pages/NotFoundPage.tsx`
- `frontend/src/pages/NotFoundPage.css`
- `frontend/src/components/MovieTrailer.tsx`
- `frontend/src/components/RouteFocus.tsx`
- `frontend/src/hooks/useMovieDetails.ts`
- `frontend/src/types/movieDetails.ts`
- `frontend/src/utils/movieId.ts`
- `frontend/src/utils/mapTmdbMovieDetails.ts`
- `frontend/tests/movieDetails.test.ts`
- `frontend/tests/movieDetails.browser.cjs`
- `frontend/tests/useMovieDetails.browser.html`
- `frontend/tests/useMovieDetails.browser.tsx`
- `docs/phase-5-architecture.md`
- `docs/phase-5-learning.md`
- `docs/phase-5-testing.md`

## File chỉnh sửa

- `frontend/package.json`, `frontend/package-lock.json`: React Router 7.18.4.
- `frontend/src/main.tsx`: BrowserRouter.
- `frontend/src/App.tsx`: Routes, layout chung và State trang chủ.
- `frontend/src/index.css`: main nhận programmatic focus không có viền bao toàn trang.
- `frontend/src/hooks/useMovies.ts`: enabled + cache phiên điều hướng, giữ lastUpdated và Retry.
- `frontend/src/types/tmdb.ts`: API types details/video.
- `frontend/src/services/tmdb.ts`: parseMovieDetails/getMovieDetails.
- `frontend/src/components/Header.tsx`: Link/NavLink và active route.
- `frontend/src/components/HeroBanner.tsx`, `HeroBanner.css`: link Chi tiết, hover nút; nút Xem ngay cũ không được biến thành phát phim.
- `frontend/src/components/MovieCard.tsx`, `MovieCard.css`: link bao thẻ, focus rõ ràng.
- `backend/proxy.mjs`: route động, validation ID, aggregate, HTTP 404/400 an toàn.
- `backend/tests/proxy.test.mjs`: cập nhật allowlist và thêm 8 test.
- `README.md`: cách chạy, tính năng, endpoint và liên kết tài liệu Giai đoạn 5.

Ảnh chụp kiểm tra nằm trong `.npm-cache/phase-5-details-desktop.png` và `phase-5-details-mobile.png`; cache được ignore. Không đưa harness vào bundle production.

## Giới hạn chủ đích

- Trang chủ vẫn chỉ tìm/lọc trên ba trang dữ liệu đã tải; không có global TMDB search hay phân trang.
- State trang chủ được giữ khi điều hướng trong phiên; refresh khởi tạo lại State như trước, chưa đồng bộ bộ lọc vào URL/storage.
- Dữ liệu chi tiết tải lại theo ID/Retry, không thêm cache dữ liệu toàn cục hoặc thư viện quản lý State.
- Recommendations chỉ lấy trang đầu. Nếu rỗng, ẩn mục gợi ý.
- Nếu một phần aggregate thiếu cấu trúc JSON, báo lỗi/Retry thay vì chế dữ liệu. Lỗi riêng `/api/genres` không chặn nội dung chính.
- Khả năng phát từng trailer phụ thuộc YouTube, video và khu vực. Không khẳng định mọi trailer đều phát được; không triển khai phát phim đầy đủ.
- Chưa triển khai hosting. Hosting SPA cần rewrite URL giao diện về index.html, nhưng giữ `/api` cho proxy. Đã kiểm tra mở trực tiếp/refresh ở Vite cục bộ.

Nguồn chính thức đã đối chiếu: [React Router routing](https://reactrouter.com/start/declarative/routing), [navigation](https://reactrouter.com/start/declarative/navigating), [TMDB details](https://developer.themoviedb.org/reference/movie-details), [videos](https://developer.themoviedb.org/reference/movie-videos), [recommendations](https://developer.themoviedb.org/reference/movie-recommendations), [append_to_response](https://developer.themoviedb.org/docs/append-to-response).
