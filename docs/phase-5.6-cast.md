# Phase 5.6 — Top Cast & Director

## Kết quả

Trang chi tiết có mục Đạo diễn trong metadata và Dàn diễn viên chính sau Nội dung phim, trước Backdrop/Trailer. Giữ nền ivory, serif Cambria, spacing compact và các chức năng hiện tại.

Cast ban đầu một hàng: dưới 640px có 2 cột, từ 640px có 3, từ 960px có 4 và từ 1280px có 6. Mỗi ảnh có khung 3:4, lazy loading, alt và fallback bằng chữ viết tắt lấy từ tên thật. Không tạo ảnh chân dung giả, không mở trang hồ sơ diễn viên.

## Lấy dữ liệu Credits

Chỉ sửa cấu hình request chi tiết trong `backend/proxy.mjs`:

```text
GET /api/movies/27205
→ https://api.themoviedb.org/3/movie/27205
  ?language=vi-VN
  &append_to_response=videos,recommendations,credits
  &include_video_language=vi,en,null
```

TMDB hỗ trợ gộp subrequest theo [append_to_response](https://developer.themoviedb.org/docs/append-to-response); dữ liệu cast/crew tương ứng [Movie Credits](https://developer.themoviedb.org/reference/movie-credits). Không thêm endpoint tùy ý hoặc endpoint `/api/person`, không gọi riêng từng diễn viên. `/api/movies/:id/credits` vẫn không nằm trong allowlist vì frontend dùng response gộp.

Token vẫn ở backend/.env. useMovieDetails và API service tiếp tục dùng request, signal, loading/error/retry cũ; số request dữ liệu không tăng. Chân dung tải trực tiếp từ CDN ảnh TMDB, không phải API hồ sơ cá nhân.

## Types và parser

Đọc [types/tmdb.ts](../frontend/src/types/tmdb.ts) và [types/movieDetails.ts](../frontend/src/types/movieDetails.ts):

| Type | Vai trò |
| --- | --- |
| TmdbCastMember | ID, tên, character, profile_path và order đã được kiểm tra |
| TmdbCrewMember | ID, tên và job |
| TmdbCredits | Hai mảng cast và crew |
| CastMember | Model hiển thị với profileUrl an toàn, khác tên trường từ API |
| MovieDirector | ID, tên và job của người được chọn là Director |
| MovieDetails | Bổ sung cast và directors; Movie dùng cho MovieCard không đổi |

`order` là number hoặc null. TMDB có thể thiếu metadata; null giữ ý nghĩa chưa biết, không tự đặt order=0 khiến người đó thành vai chính.

Đọc `parseCredits()` trong [services/tmdb.ts](../frontend/src/services/tmdb.ts):

- JSON bắt đầu từ unknown. Kiểm tra record, cast/crew là array trước khi sử dụng.
- Người phải có ID số nguyên dương an toàn và tên string không rỗng. Bản ghi sai bị bỏ, không tạo tên thay thế.
- character thiếu/sai thành chuỗi rỗng; profile_path thiếu/sai thành null; order không phải số nguyên không âm thành null.
- crew cần job string không rỗng. Trim khoảng trắng; không tự suy diễn job từ department hoặc tên phim.
- cast và crew xử lý độc lập. Cast sai không làm mất đạo diễn hợp lệ; crew sai không làm mất diễn viên.
- Thiếu/null/sai credits thành hai mảng rỗng. Thông tin chính, video và recommendations vẫn qua kiểm tra cũ; metadata credits thiếu không chặn toàn bộ trang.

TypeScript kiểm tra code khi biên dịch; parser kiểm tra giá trị HTTP lúc chạy. Hai phần có mục đích khác nhau.

## Mapper xử lý cast và đạo diễn

Đọc [mapTmdbMovieDetails.ts](../frontend/src/utils/mapTmdbMovieDetails.ts):

1. Sao chép credits.cast trước khi sort. order nhỏ đứng trước; order null đứng sau. Khi cùng order, giữ thứ tự nguồn.
2. Dùng Set theo ID để mỗi người xuất hiện một lần, giữ bản ghi có billing ưu tiên cao nhất nếu bị trùng ID.
3. Giữ người thiếu ảnh trong kết quả. `getImageUrl(profile_path, 'w185')` tạo URL HTTPS cố định; path ngoài CDN hoặc malformed trả chuỗi rỗng để UI hiển thị placeholder.
4. Lọc crew bằng `person.job === 'Director'`, loại ID trùng và giữ nhiều đạo diễn nếu TMDB cung cấp. Tên trong metadata được nối bằng dấu phẩy.

Helper ảnh cũ trong `mapTmdbMovie.ts` chỉ được mở rộng thêm size w185; ảnh poster/backdrop cũ không đổi. Không sửa dữ liệu nguồn hoặc thêm request ảnh vào hook.

## MovieCast, Props và State

Đọc [MovieCast.tsx](../frontend/src/components/MovieCast.tsx): component nhận `cast` đã chuẩn hóa qua Props, không fetch và không biết token.

```tsx
const movieColumns = useMovieColumns()
const columns = movieColumns === 5 ? 6 : movieColumns
const [visibleRows, setVisibleRows] = useState(1)
const visibleCast = cast.slice(0, visibleRows * columns)
```

Tái sử dụng breakpoint hook hiện tại: cột movie là 2/3/4/5, cast đổi mức rộng nhất thành 6. Không sửa hook hoặc layout MovieList, không thêm resize listener khác. Một số hàng đã mở sẽ được giữ khi resize, còn số người mỗi hàng theo breakpoint mới.

Xem thêm tăng visibleRows thêm 1; Thu gọn đặt lại 1. slice không sửa mảng cast, map render phần cần hiển thị. `hasMore` quyết định nút Xem thêm diễn viên; `isExpanded` quyết định Thu gọn. Khi danh sách ngắn, không có cụm nút thừa.

Component dùng style nút mở/thu hiện có của MovieList, nhưng State của nó hoàn toàn riêng. Thêm diễn viên không thay đổi số phim gợi ý đang mở và ngược lại.

Ở [MovieDetailsPage.tsx](../frontend/src/pages/MovieDetailsPage.tsx):

```tsx
<MovieCast key={`cast-${movie.id}`} cast={movie.cast} />
```

Khi ID phim đổi, key đổi khiến React tạo State mới: cast trở về một hàng. Tiền tố cast- phân biệt với key của MovieList recommendations cùng cấp, tránh trùng key giữa hai component. Ảnh lỗi có State riêng trong CastCard; key theo actor ID giữ đúng ảnh/tên. Cast rỗng ẩn section; đạo diễn rỗng hiển thị Chưa có thông tin.

Nút dùng button thật, aria-expanded/aria-controls và focus-visible có sẵn. Sau khi nút Xem thêm biến mất, focus chuyển sang Thu gọn; sau Thu gọn chuyển lại Xem thêm. Chỉ cuộn tới section khi nút mới nằm ngoài viewport, không cuộn về đầu trang.

## Những file tạo/sửa

Tạo mới:

- [frontend/src/components/MovieCast.tsx](../frontend/src/components/MovieCast.tsx)
- [frontend/src/components/MovieCast.css](../frontend/src/components/MovieCast.css)
- [frontend/tests/movieCredits.test.ts](../frontend/tests/movieCredits.test.ts)
- [frontend/tests/movieCast.browser.cjs](../frontend/tests/movieCast.browser.cjs)
- [docs/phase-5.6-cast.md](phase-5.6-cast.md)

Chỉnh sửa:

- [backend/proxy.mjs](../backend/proxy.mjs): thêm credits vào append; các guard/status/signal giữ nguyên.
- [backend/tests/proxy.test.mjs](../backend/tests/proxy.test.mjs): kiểm tra append mới và metadata tùy chọn.
- [frontend/src/types/tmdb.ts](../frontend/src/types/tmdb.ts), [movieDetails.ts](../frontend/src/types/movieDetails.ts): types cho credits và model.
- [frontend/src/services/tmdb.ts](../frontend/src/services/tmdb.ts): parseCredits và tích hợp parseMovieDetails.
- [frontend/src/utils/mapTmdbMovie.ts](../frontend/src/utils/mapTmdbMovie.ts): hỗ trợ size w185.
- [frontend/src/utils/mapTmdbMovieDetails.ts](../frontend/src/utils/mapTmdbMovieDetails.ts): map cast/directors.
- [frontend/src/pages/MovieDetailsPage.tsx](../frontend/src/pages/MovieDetailsPage.tsx), [CSS](../frontend/src/pages/MovieDetailsPage.css): mục đạo diễn và vị trí MovieCast.
- [README.md](../README.md): trạng thái Phase 5.6 và tài liệu.

Không đổi App, Router, useMovies/useMovieDetails, MovieCard/MovieList, useMovieColumns, logic tìm/lọc/sort, trailer, recommendations hoặc dependencies.

## Kết quả kiểm thử

Đã chạy:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
```

57 test đạt: 20 backend + 37 frontend, gồm 9 test mới; lint không warning/error, TypeScript và production build thành công.

Test mới xác minh parser chuẩn hóa/thiếu/sai dữ liệu, order 0/null/sai, tên/ID sai, cast/crew độc lập, không sửa nguồn, nhiều Director, loại trùng ID, profile_path ngoài CDN và proxy vẫn trả chi tiết khi credits thiếu.

Edge headless qua Playwright:

- Fixture ở 320/390/768/1024/1440px: 2/2/3/4/6 cột, portrait 3:4, đúng thứ tự và character.
- Placeholder khi thiếu ảnh hoặc HTTP ảnh 404; lazy loading và alt.
- Xem thêm từng hàng/hàng cuối chưa đủ cột, Thu gọn/focus, không gọi thêm API.
- Cast và recommendations có State độc lập; resize và chuyển phim reset đúng cast.
- Credits thiếu, null, cast sai nhưng crew đúng và crew sai nhưng cast đúng không làm crash trang; trailer/recommendations vẫn hiện.
- Movie có một diễn viên không có nút thừa; không biết Director hiển thị fallback.
- Không có lỗi React runtime hoặc tràn ngang trong các lượt đã kiểm tra. Đã sửa key trùng giữa MovieCast và MovieList cùng cấp bằng tiền tố cast-; browser test theo dõi cả console để phát hiện cảnh báo key trùng.
- TMDB thật Inception (ID 27205) trả 200 với 52 cast, 735 crew, Director Christopher Nolan, 27 video và 20 recommendations tại lúc kiểm tra. UI khớp tên/character từ response và ảnh chân dung tải thành công; mở/thu tạo thêm 0 request API.
- Đã chạy lại toàn bộ browser Phase 5 với fixture/live: Router/Back/Forward, tìm kiếm/lọc/sort/lastUpdated, URL trực tiếp/refresh, ID/404, loading/error/retry, AbortController/race guard, trailer/recommendations và token không lộ trong frontend/response đều đạt.
- Đã chạy lại compact browser Phase 5.5 với fixture: mở/thu danh mục phim, resize, bộ đếm, State độc lập và reset vẫn đạt.

Chạy browser khi app đang mở:

```powershell
node frontend/tests/movieCast.browser.cjs D:\LearnReact\Cineverse\.npm-cache\_npx\e41f203b7505f1fb\node_modules\playwright --live
```

Bỏ --live để chỉ chạy fixture. --live-only chỉ kiểm tra/chụp dữ liệu thật. Đường dẫn Playwright cache tùy máy; browser mặc định msedge, có thể đặt CINEVERSE_BROWSER_CHANNEL=chrome nếu Chrome đã cài. CINEVERSE_TEST_URL đổi URL của Vite nếu cần. Không thêm dependency production.

Ảnh chụp từ TMDB thật: [desktop](../.npm-cache/phase-5.6-cast-desktop.png), [mobile](../.npm-cache/phase-5.6-cast-mobile.png). Cache được ignore, không đưa ảnh fixture thành dữ liệu production.

## Ba bài tập nhỏ

1. **Hiển thị thứ tự vai.** Trong MovieCast.tsx, thêm nhãn số thứ tự cạnh tên bằng dữ liệu order; ẩn nhãn khi null. Nhớ order bắt đầu từ 0, nên nhãn cho người đọc thường là order + 1.
2. **Nhấn mạnh tên nhân vật.** Đổi layout CastCard để có nhãn Vai diễn, nhưng giữ fallback khi character rỗng. Chỉnh MovieCast.css và kiểm tra lại 320px với tên/nhân vật dài.
3. **Bộ lọc diễn viên cục bộ.** Thêm ô tìm tên vào MovieCast bằng useState và filter/includes, chỉ lọc danh sách đã tải, không gọi API. Giữ State tách khỏi tìm kiếm phim ở Header và reset số hàng khi từ khóa đổi. Đây là bài tự làm, chưa được triển khai.

## Giới hạn

- Cast/crew phản ánh dữ liệu TMDB, có thể thiếu hoặc thay đổi. Metadata lỗi bị bỏ an toàn, không suy đoán tên/đạo diễn/nhân vật.
- Ảnh w185 ưu tiên thumbnail nhẹ; không gọi cấu hình ảnh hay API người trong runtime. Nếu CDN ảnh lỗi, giữ actor và placeholder.
- Một người bị lặp ID trong cast chỉ giữ credit có order ưu tiên cao nhất; không tự ghép vai diễn khác thành dữ liệu mới.
- Không có tiểu sử, profile route, authentication, database hoặc Phase 6. Trailer/hosting giữ phạm vi đã ghi ở Giai đoạn 5.
