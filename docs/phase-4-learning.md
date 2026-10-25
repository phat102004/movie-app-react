# Học React qua Cineverse — Giai đoạn 4

Các ví dụ bên dưới dẫn tới code thật của dự án. Không cần ôn lại Component, JSX, map hay Form trước khi đọc. Hãy chạy app và mở Network song song với mã nguồn.

## Bài 1: fetch() và HTTP

Đọc [services/tmdb.ts](../frontend/src/services/tmdb.ts), đặc biệt `requestJson`, `getMoviePage`, `getGenres`.

**HTTP request** là một thông điệp trình duyệt gửi tới server để xin hoặc gửi dữ liệu. Cineverse dùng **GET** để đọc danh sách phim; không sửa dữ liệu TMDB. GET phía browser đi đến `/api/...` cùng origin, sau đó Vite chuyển đến proxy Node. Proxy mới thêm token và gọi TMDB.

```ts
const response = await fetch('/api/movies/popular')
if (!response.ok) throw new Error(`HTTP ${response.status}`)
const body = await response.json()
```

`Response` là object chứa status, headers và body, không phải mảng phim. `response.status` là mã số như 200, 401, 429. `response.ok` chỉ true cho status trong khoảng 200–299. Trong service thật, body được đọc một lần để lấy cả thông báo lỗi của proxy rồi kiểm tra ok.

`response.json()` đọc body bất đồng bộ và phân tích JSON. Kết quả có thể là object, array hoặc giá trị khác; nó chưa tự có kiểu `TmdbMoviePage`. Vì vậy service giữ `unknown` và gọi `parseMoviePage`/`parseGenres` trước khi tin dữ liệu.

`fetch()` trả Promise vì phản hồi mạng chưa có ngay. Request có thể thành công, lỗi mạng hoặc bị hủy. Phản hồi HTTP 401/429 vẫn thường làm fetch fulfilled với một Response; service phải tự kiểm tra ok và throw ApiError. Đây là lý do chỉ catch lỗi mạng là chưa đủ.

**Ví dụ quan sát:** mở Network, chọn `/api/movies/popular`, so sánh status và JSON. Khi chưa cấu hình token, bạn sẽ thấy 503 kèm object error; không có Bearer ở Request Headers của browser.

**Bài tập:** trong test `service chuyển HTTP 401 thành ApiError`, đổi status thành 403 và kiểm tra thuộc tính status của lỗi. Không sửa token thật để thử.

**Lỗi thường gặp:** quên await response.json(); coi Response là array; nghĩ 401 tự chạy vào catch; đưa token vào fetch frontend. Code hiện tại tránh các lỗi này bằng service và proxy.

## Bài 2: async/await và Promise

Đọc [hooks/useMovies.ts](../frontend/src/hooks/useMovies.ts), hàm `loadMovies`; xem thêm `try/finally` trong [backend/proxy.mjs](../backend/proxy.mjs).

Một hàm có `async` luôn trả Promise. Promise có ba trạng thái: **pending** khi chưa xong, **fulfilled** khi có kết quả, **rejected** khi thất bại. `await` tạm dừng phần tiếp theo của chính hàm async cho đến khi Promise hoàn tất.

```ts
const [popular, nowPlaying, topRated, genres] = await Promise.all([
  getMoviePage('popular', controller.signal),
  getMoviePage('now_playing', controller.signal),
  getMoviePage('top_rated', controller.signal),
  getGenres(controller.signal),
])
```

Bốn request không phụ thuộc nhau nên bắt đầu cùng lúc. Promise.all trả kết quả đúng thứ tự khai báo, không phải theo thứ tự request trả về. Nếu một request thất bại, cả lượt tải đi vào catch. Cineverse hiển thị lỗi và cho retry, không âm thầm thay bằng phim mẫu.

Trong hook:

- `try`: tải, map dữ liệu, cập nhật catalog khi lượt tải còn hiện hành.
- `catch`: nhận ApiError hoặc lỗi khác, cập nhật thông báo và hủy các request còn lại của lượt tải.
- `finally`: tắt loading cho lượt tải hiện hành, dù success hay error.

Trên proxy, finally dọn timer và event listener. Dọn tài nguyên là công việc cần làm ngay cả khi có exception hoặc return trong try.

Await không chặn toàn bộ ứng dụng: khi chờ mạng, trình duyệt vẫn xử lý tương tác và render. Tuy nhiên, tính toán JavaScript nặng chạy đồng bộ vẫn có thể làm giao diện khựng; thêm async không tự chuyển nó sang một luồng nền.

**Bài tập:** trong test service, thêm độ trễ cho fetch mô phỏng. Quan sát skeleton trong browser khi API chưa resolve. Không thêm độ trễ vào code production.

**Lỗi thường gặp:** quên catch Promise bị reject; tắt loading chỉ trong nhánh success; gọi từng request bằng await liên tiếp dù chúng độc lập; hiểu Promise.all là tự retry.

## Bài 3: useEffect(), cleanup và StrictMode

Đọc toàn bộ [useMovies.ts](../frontend/src/hooks/useMovies.ts). Effect ở đây đồng bộ với một hệ thống bên ngoài React: mạng. Nó khởi động sau khi component được commit, thay vì gửi request trong mỗi lần render.

Callback của Effect không khai báo async. Code tạo `async function loadMovies()` bên trong rồi gọi `void loadMovies()`, vì callback cần trả về cleanup function, không trả một Promise.

```ts
useEffect(() => {
  const controller = new AbortController()
  let isCurrent = true
  // Gọi loadMovies() ở đây.
  return () => {
    isCurrent = false
    controller.abort()
  }
}, [requestVersion])
```

Dependency array cho biết khi nào setup cần chạy lại. `[]` phù hợp một lượt tải gắn với lần mount. `[requestVersion]` trong Cineverse còn cho phép retry: nút Thử lại tăng số này, Effect dọn lượt cũ rồi mở lượt mới. Từ khóa/bộ lọc không là dependency vì giai đoạn này lọc cục bộ.

Cleanup dùng hai lớp bảo vệ: AbortController yêu cầu hủy I/O; isCurrent ngăn callback của lượt cũ gọi setState ngay cả khi transport không tuân thủ việc hủy. Flag nằm trong từng lần setup, không dùng biến global chung cho mọi request.

StrictMode chạy thêm một chu kỳ setup–cleanup trong development để kiểm tra việc dọn dẹp. Dự án giữ StrictMode; vì vậy request bị canceled ban đầu có thể là bình thường. [React useEffect](https://react.dev/reference/react/useEffect)

Không dùng Effect cho `filterAndSortMovies`: đó là phép tính từ catalog, searchQuery và filters. Khi các State đổi, render tính lại trực tiếp. Không có hệ thống bên ngoài cần đồng bộ, và không cần State thứ hai cho kết quả.

**Bài tập:** đọc `tests/useMovies.browser.tsx`, mở harness trong dev. Nhấn Bật tắt hook khi request đang chờ; quan sát các request bị canceled và thuộc tính data-aborted trên phần tử html.

**Lỗi thường gặp:** bỏ cleanup; tắt StrictMode để che lỗi; đặt kết quả lọc vào Effect; phụ thuộc một object mới tạo mỗi render gây fetch liên tục; chỉ kiểm tra signal mà vẫn để callback cũ setState.

## Bài 4: Kiến trúc React

Đọc theo thứ tự: [service](../frontend/src/services/tmdb.ts) → [mapper](../frontend/src/utils/mapTmdbMovie.ts) → [hook](../frontend/src/hooks/useMovies.ts) → [App](../frontend/src/App.tsx).

| Thành phần          | Biết điều gì?                                      | Không chịu trách nhiệm gì?            |
| ------------------- | -------------------------------------------------- | ------------------------------------- |
| API service         | URL, fetch, status, JSON, validation, AbortSignal  | Không giữ React State hoặc render JSX |
| Data mapper         | Đổi tên trường, ảnh, năm, genre IDs, loại trùng ID | Không gửi request                     |
| Custom hook         | Vòng đời request, loading/error/catalog, retry     | Không quyết định hình dáng MovieCard  |
| App                 | State tìm kiếm/bộ lọc và cách ghép các phần UI     | Không parse response TMDB trực tiếp   |
| MovieDataState      | Skeleton, thông báo và nút retry qua props         | Không tự fetch                        |
| MovieList/MovieCard | Hiển thị Movie qua props                           | Không biết endpoint hoặc token        |

Custom hook là một hàm bắt đầu bằng use, có thể gọi hooks và trả dữ liệu/hàm. Component trả JSX để render. Tách hook không biến nó thành một nguồn State toàn cục: mỗi nơi gọi hook có vòng đời và State riêng. Hiện App chỉ gọi useMovies một lần.

```text
TMDB → proxy → service → mapper → hook catalog
                                    ↓
             App filters → MovieList → MovieCard
```

Catalog/loading/error thuộc hook; từ khóa và bộ lọc thuộc App là cha chung của Header và danh sách. Các select nhận options động qua props. Không để MovieCard gọi API vì có thể tạo rất nhiều request cho cùng một trang và trộn việc hiển thị với xử lý mạng.

**Bài tập:** thêm thông tin số danh sách đã tải trong UI bằng `movieSections.length`, truyền qua props nếu cần. Không gọi useMovies lần thứ hai ở footer.

**Lỗi thường gặp:** để mọi thứ trong App; hook import component; service gọi setState; mapper tự fetch thêm dữ liệu cho từng card; dùng type API trực tiếp khắp giao diện khiến mọi component phụ thuộc tên trường TMDB.

## Bài 5: TypeScript với dữ liệu API

Đọc [types/tmdb.ts](../frontend/src/types/tmdb.ts), [types/movie.ts](../frontend/src/types/movie.ts), parser trong service và [mapper](../frontend/src/utils/mapTmdbMovie.ts).

API có tên trường `original_title`, `vote_average`, `release_date`, `genre_ids`. App dùng `originalTitle`, `rating`, `year`, `genres`. Hai kiểu mô tả hai hợp đồng khác nhau; mapper là ranh giới giữa chúng.

```ts
// API: có thể thiếu hoặc null.
overview?: string | null

// App: mapper đã chuẩn hóa chuỗi; năm chưa biết giữ null.
description: string
year: number | null
```

Optional (`?`) cho phép thuộc tính không xuất hiện, khi đọc sẽ có thể là undefined. Nullable cho phép giá trị null xuất hiện rõ ràng. Không dùng 0 làm năm giả hoặc tự gán điểm khi API thiếu dữ liệu.

TypeScript kiểm tra mã lúc biên dịch, không sửa hoặc chứng minh dữ liệu mạng lúc chạy. Ép `await response.json() as TmdbMoviePage` chỉ làm compiler tin bạn, không chặn payload sai. Vì vậy requestJson trả unknown, parser kiểm tra object/array, ID, chuỗi nullable, điểm trong thang 10 và genre IDs.

Ví dụ, `{ id: "42" }` không phải ID number theo hợp đồng; parser sẽ trả lỗi dữ liệu thay vì để UI xử lý tùy tiện. `release_date` là chuỗi nhưng có thể không phải ngày hợp lệ; mapper kiểm tra ngày trước khi lấy năm. Type và runtime validation bổ sung cho nhau.

**Bài tập:** thêm trường `runtime` trong một fixture API rồi thiết kế type/validation riêng trước khi định hiển thị nó. Đừng tự coi trường chưa được endpoint trả về là đã có dữ liệu.

**Lỗi thường gặp:** dùng any cho response; lạm dụng `as`; gọi toFixed trên null; tạo URL ảnh từ null; so sánh năm là chuỗi với số; gán thể loại không có trong bảng genre IDs.

## Ba bài tập trên Cineverse sau khi đọc xong

1. Thêm test service cho HTTP 403 và JSON hợp lệ nhưng có vote_average sai kiểu. Giữ thông báo lỗi an toàn.
2. Hiển thị nhãn **Chưa có đánh giá** rõ hơn trong MovieCard khi rating là null; giữ việc lọc từ 8 điểm loại phim chưa được đánh giá.
3. Đổi tiêu chí chọn hero thành phim có backdrop và điểm cao nhất trong catalog, dùng bản sao để sort; không gọi thêm API, không đổi dữ liệu nguồn.

Các bài tập chưa được triển khai. Không phát triển chức năng ở giai đoạn tiếp theo trước khi kiểm tra và hiểu luồng dữ liệu này.
