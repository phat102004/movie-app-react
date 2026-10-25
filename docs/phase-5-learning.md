# Giai đoạn 5 — Học trên code Cineverse

## Bài 1 — React Router

Đọc `frontend/src/main.tsx` rồi phần Routes trong `frontend/src/App.tsx`.

BrowserRouter nối React với URL và History của trình duyệt. Chỉ đặt một lần quanh App. Routes chọn nhánh phù hợp URL hiện tại; mỗi Route mô tả một cặp path/element. Route cuối `*` nhận các đường dẫn không khớp.

Router hiện có ba đường dẫn: `/` → HomePage, `/movies/:movieId` → MovieDetailsPage, `*` → NotFoundPage. `:movieId` là dynamic segment: cùng một component phục vụ nhiều phim. `/movies/27205` và `/movies/42` dùng cùng MovieDetailsPage nhưng param khác nhau.

Đọc đầu `MovieDetailsPage.tsx`:

```tsx
const { movieId } = useParams<{ movieId: string }>()
const { data: movie, isLoading, error, retry } = useMovieDetails(movieId)
```

useParams đọc segment mà Router đã khớp. Dữ liệu này vẫn là string/undefined, không phải một ID đã được tin cậy; phải kiểm tra trước khi gọi API.

Đọc `MovieCard.tsx`: Link tạo đường dẫn thật để copy/mở tab mới, hỗ trợ bàn phím, đồng thời cho Router xử lý click điều hướng trong ứng dụng. Thẻ a thông thường tới URL khác sẽ tải tài liệu mới. Thẻ a cho bookmark cùng trang như skip-link và Khám phá bộ sưu tập vẫn phù hợp; link YouTube bên ngoài vẫn dùng a.

Header dùng NavLink để tự xác định active cho Trang chủ; `end` giúp nó không đánh dấu active khi đang ở trang chi tiết. `useNavigate` trong App chỉ dùng khi cần làm hai việc sau nhập tìm kiếm: cập nhật query rồi chuyển về `/`. Link được dùng cho điều hướng trực tiếp thông thường.

## Bài 2 — Dynamic API

Đọc lần lượt `MovieCard.tsx` → `MovieDetailsPage.tsx` → `hooks/useMovieDetails.ts` → cuối `services/tmdb.ts` → `backend/proxy.mjs`.

```text
Click Card có id 27205
→ Link /movies/27205
→ Route /movies/:movieId
→ useParams: movieId = '27205'
→ useMovieDetails(movieId)
→ getMovieDetails(movieId, signal)
→ fetch('/api/movies/27205')
→ Vite proxy → Node proxy
→ TMDB /3/movie/27205 với append_to_response do server cố định
→ JSON validation → mapper → State → MovieDetailsPage
```

Service không ghép một URL do người dùng cung cấp vào fetch. `isValidMovieId()` chỉ nhận số nguyên dương int32 đúng dạng. Proxy kiểm tra lại vì API vẫn có thể bị gọi ngoài giao diện.

`/movies/invalid` dừng trước API và hiển thị ID sai. ID hợp lệ nhưng không có phim sẽ được TMDB trả 404; proxy giữ status 404, service tạo ApiError có status, page hiển thị NotFoundPage. Đây khác lỗi mạng/429/502: các lỗi tạm thời có nút Thử lại.

Một request chi tiết gộp videos và recommendations theo [cơ chế chính thức của TMDB](https://developer.themoviedb.org/docs/append-to-response). Hook gọi thêm /api/genres cho metadata của MovieCard gợi ý. Phần tên thể loại bổ sung có thể thất bại mà không làm mất thông tin chính của phim.

## Bài 3 — useEffect nâng cao

Đọc toàn bộ `hooks/useMovieDetails.ts`, đặc biệt dependency `[movieId, requestVersion]` và return cleanup.

- movieId thay đổi: request trước không còn là nguồn dữ liệu cho trang mới.
- Retry tăng requestVersion: cùng ID nhưng tạo lượt tải mới.
- AbortController tạo signal cho fetch; cleanup gọi abort khi đổi ID/Retry hoặc unmount.
- isCurrent là biến riêng của mỗi Effect. Cleanup chuyển nó thành false trước khi request cũ hoàn tất.

Ví dụ race condition: mở phim A, lập tức mở phim B. Nếu A trả về sau B mà vẫn setState, trang B sẽ hiển thị phim A. Abort giảm công việc thừa; isCurrent vẫn cần thiết vì response có thể đã hoàn tất hoặc một lớp fetch không tuân thủ signal. Bộ browser test cố ý bỏ qua signal để kiểm tra guard này.

Đọc phần cuối hook:

```ts
const current =
  state.id === movieId && state.version === requestVersion ? state : null
```

Ngay khi URL đổi, React render trước khi Effect mới chạy. Điều kiện này ngăn render dữ liệu ID cũ trong khoảng đó. Khi Retry tăng version, dữ liệu lượt cũ cũng không được dùng làm kết quả mới. `isLoading` được suy ra từ ID hợp lệ và current chưa có, không dùng Effect chỉ để đồng bộ một State loading khác.

Effect ở đây đồng bộ với hệ thống bên ngoài là HTTP. Lọc/sắp xếp HomePage và chọn trailer trong mapper là phép tính thuần, không dùng Effect.

Trong `useMovies.ts`, `successfulVersion` dùng useRef ghi nhớ lượt tải trang chủ đã thành công. Ref này không dùng để vẽ UI, nên cập nhật nó không cần gây render. App giữ hook mounted; enabled chỉ bật tải ở Home. Vì vậy quay lại Home giữ danh sách, bộ lọc và lastUpdated, không tạo lại ba request danh sách vô ích.

StrictMode có thể setup → cleanup → setup trong dev. Request đầu bị canceled là hành vi đã được kiểm tra; không tắt StrictMode để che nó.

## Bài 4 — Kiến trúc React

Page đại diện một URL và tổ chức một màn hình. Component là phần có thể tái sử dụng giữa các màn hình, như MovieCard, Header và MovieTrailer.

Service biết HTTP, status và hình dạng JSON, không biết giao diện đang loading ra sao. Custom Hook kết nối vòng đời React với service, giữ State/loading/error/Retry. Page chọn component nào để hiển thị từ kết quả hook.

TypeScript không tự kiểm tra JSON lúc chạy. Kiểu `TmdbMovieDetails` giúp trình biên dịch, còn `parseMovieDetails()` kiểm tra giá trị unknown trước khi dùng. MovieDetails là model dành cho Cineverse; mapper đổi `vote_average` thành rating, `runtime` không có thành null, path thành URL CDN an toàn và recommendations thành Movie[] dùng lại MovieCard.

Đọc `utils/mapTmdbMovieDetails.ts`:

- filter chỉ giữ Trailer từ YouTube với key hợp lệ.
- sort chạy sau filter nên sắp xếp mảng mới, không sửa dữ liệu nguồn.
- official được ưu tiên trước ngôn ngữ vi/en.
- recommendations lọc ID phim đang xem, rồi Map theo ID để loại trùng.
- Không bịa ngày, thời lượng hoặc số lượt đánh giá khi TMDB thiếu dữ liệu.

Đọc `MovieTrailer.tsx`: isOpen quyết định iframe có tồn tại hay không. Trước click, không có iframe để tải YouTube. Đóng trailer gỡ iframe và dừng trình phát; đổi phim reset component nhờ key theo movie.id. Embed không có autoplay; trailer khác phim đầy đủ.

## Bài 5 — Ba bài tập trực tiếp

1. **Đổi cách hiển thị thời lượng.** Trong `pages/MovieDetailsPage.tsx`, sửa `<dd>` của Thời lượng để 148 phút thành “2 giờ 28 phút”. Giữ fallback khi runtime null. Tự kiểm tra thêm 60, 59 và 0/thiếu.
2. **Thêm tagline thật từ TMDB.** Mở `types/tmdb.ts`, bổ sung tagline; đọc bằng readText trong `services/tmdb.ts`; thêm model trong `types/movieDetails.ts` và map trong `utils/mapTmdbMovieDetails.ts`; chỉ render dưới tên gốc khi có dữ liệu. Thêm test có/không tagline trong `tests/movieDetails.test.ts`. Không tự viết tagline thay thế.
3. **Thêm nút Quay lại theo History.** Trong `pages/MovieDetailsPage.tsx`, thử dùng useNavigate cho nút quay về trang trước, đồng thời giữ Link Về trang chủ làm lựa chọn chắc chắn khi mở URL trực tiếp. Kiểm tra Home → A → B → Back, URL trực tiếp và refresh; không dựa đơn thuần history.length để khẳng định trang trước thuộc Cineverse.

## Thứ tự đọc đề xuất

1. `main.tsx` và Routes trong `App.tsx`.
2. Link trong `MovieCard.tsx`, `HeroBanner.tsx`, `Header.tsx`.
3. `pages/MovieDetailsPage.tsx`: useParams và các nhánh render.
4. `hooks/useMovieDetails.ts`: request, dependency, cleanup và current.
5. `services/tmdb.ts`: getMovieDetails, parseMovieDetails, ApiError.
6. `types/tmdb.ts`, `types/movieDetails.ts`, `utils/movieId.ts`.
7. `utils/mapTmdbMovieDetails.ts`, `components/MovieTrailer.tsx`.
8. `backend/proxy.mjs`: movieRoute, isDetails, status, timeout.
9. `hooks/useMovies.ts`, `pages/HomePage.tsx`: giữ State/lastUpdated và logic lọc cũ.
10. `tests/movieDetails.test.ts`, `tests/movieDetails.browser.cjs` và báo cáo testing.

Nguồn tham khảo: [React Router declarative routing](https://reactrouter.com/start/declarative/routing), [navigating](https://reactrouter.com/start/declarative/navigating), [useNavigate](https://reactrouter.com/api/hooks/useNavigate), [TMDB details](https://developer.themoviedb.org/reference/movie-details).
