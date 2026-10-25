# Phase 5.5 — UI Refinement & Compact Movie Layout

## Kết quả giao diện

Giữ nền giấy sáng, màu olive, Header, Hero và bố cục editorial. Các danh mục chuyển từ toàn bộ phim trong nhiều hàng sang một hàng ban đầu. Tiêu đề chuyển lên trên danh sách để tận dụng chiều rộng cho poster. Nút mở/thu dùng chữ nhỏ, đường phân cách nhẹ, target ít nhất 44px và focus-visible hiện có.

Đã kiểm tra font trên máy: Georgia tách dấu ở một số chữ tiếng Việt. Chuyển biến font-editorial sang Cambria, dự phòng Times New Roman/serif, giữ phong cách serif và không tải thêm font từ bên ngoài.

Poster vẫn tỷ lệ 2:3, lazy load; tên có vùng hai dòng để các card đều nhau. Metadata của card bố trí lại bằng Grid để tên thể loại dài không đẩy điểm/năm ra ngoài. Hover chỉ scale ảnh nhẹ trong khung poster; reduced motion giữ hiệu lực.

Khoảng cách giữa danh mục giảm; Hero được thu nhẹ qua CSS, không đổi cấu trúc hay nội dung. Bộ lọc mobile có hai cột. Các dòng chú thích/kết quả/lastUpdated vẫn đầy đủ.

Trang chi tiết dùng poster nhỏ hơn, phần tên/điểm/thể loại và metadata có chiều rộng hợp lý. Trên mobile, poster và tên nằm cạnh nhau, metadata xuống hàng chiếm đủ chiều rộng. Mô tả vẫn đầy đủ, không cắt. Backdrop và trailer nằm cạnh nhau trên desktop, xếp dọc trên mobile; iframe vẫn chỉ tải khi người dùng mở, không autoplay. Recommendations dùng cùng cơ chế một hàng và mở rộng của Home.

Tại viewport 1440px với dữ liệu thật trong lần đo:

| Trang | Trước | Sau, ở trạng thái một hàng |
| --- | --- | --- |
| Home | 15.433px | 3.467px |
| Chi tiết Inception | 6.633px | 2.062px |

Chiều cao thay đổi theo phim, nội dung TMDB, font và viewport. Con số này đo chiều dài tài liệu, không phải thời gian tải hoặc lượng dữ liệu API giảm đi. Toàn bộ phim vẫn ở State và truy cập được qua nút Xem thêm.

## Cách mở rộng theo hàng

Đọc [MovieList.tsx](../frontend/src/components/MovieList.tsx) và [useMovieColumns.ts](../frontend/src/hooks/useMovieColumns.ts).

```tsx
const columns = useMovieColumns()
const [visibleRows, setVisibleRows] = useState(1)
const visibleMovies =
  mode === 'full' ? movies : movies.slice(0, visibleRows * columns)
```

State lưu số hàng để resize không phải đồng bộ thêm một State số phim khác. Ví dụ đang mở hai hàng: desktop 5 cột hiển thị 10 phim, mobile 2 cột hiển thị 4 phim. State của mỗi MovieList thuộc riêng instance đó, nên mở Phim nổi bật không làm mở Phim đang chiếu.

| Chiều rộng viewport | Cột/hàng |
| --- | --- |
| Dưới 640px | 2 |
| 640–959px | 3 |
| 960–1279px | 4 |
| Từ 1280px | 5 |

Hook chỉ nghe thay đổi matchMedia qua ba breakpoint. Cùng giá trị columns quyết định số phần tử slice và grid-template-columns, không viết hai bộ breakpoint khác nhau trong JS và CSS. Listener được remove trong cleanup khi MovieList unmount. App hiện là SPA; chưa triển khai SSR.

Xem thêm gọi setVisibleRows(rows => rows + 1). Thu gọn gọi setVisibleRows(1). slice tạo mảng mới từ đầu tới chỉ số giới hạn, không sửa hay xóa phần tử khỏi movies; vượt chiều dài nguồn thì tự trả toàn bộ phần còn lại. Sau đó map render MovieCard theo ID hiện có, giữ thứ tự.

Conditional rendering:

- hasMore: còn phần tử chưa hiển thị thì có Xem thêm.
- isExpanded: đã nhiều hơn một hàng thì có Thu gọn.
- movies.length <= columns: không cần cụm điều khiển.
- mode="full": render toàn bộ mảng truyền xuống, không có nút mở/thu.

Hai button có aria-controls trỏ vào ul của chính section, aria-expanded và tên truy cập phân biệt theo danh mục. Bộ đếm Đang hiển thị X / Y dùng status để thông báo thay đổi.

Khi Xem thêm hết phim, button đó bị gỡ và focus chuyển sang Thu gọn. Khi Thu gọn, focus chuyển lại Xem thêm. Chỉ cuộn tới section nếu nút mới nằm ngoài viewport sau khi danh sách co lại; không chủ động cuộn về đầu trang. Các ref chỉ phục vụ focus/đo DOM, không giữ dữ liệu API.

## Bảo toàn logic cũ

- HomePage truyền mode="full" cho visibleMovies. Không sửa filterAndSortMovies; số Tìm thấy X / Y dùng toàn bộ kết quả lọc, không lấy số card compact.
- Đổi query/filter trong full results không giữ trạng thái mở rộng khó hiểu. Reset quay lại các danh mục một hàng.
- MovieDetailsPage thêm key={movie.id} cho MovieList recommendations để reset số hàng khi đổi phim.
- Loại phim hiện tại/trùng ID vẫn do mapper cũ xử lý. Không sửa Types/Mapper hoặc thêm metadata chưa có như tagline/ngôn ngữ gốc.
- App, Router, useMovies, useMovieDetails, service, proxy và token không thay đổi. Không có API mới, không cài package mới.
- Loading/error/retry, AbortController, NotFoundPage, lastUpdated và Attribution giữ nguyên.
- Mở/thu/resize không gọi API. Ảnh lazy của card mới xuất hiện vẫn có thể tải từ CDN ảnh; đó là tải tài nguyên ảnh, không gọi thêm API dữ liệu phim.

## Danh sách file

Tạo mới:

- [frontend/src/hooks/useMovieColumns.ts](../frontend/src/hooks/useMovieColumns.ts): breakpoint và listener responsive có cleanup.
- [frontend/tests/compactMovies.browser.cjs](../frontend/tests/compactMovies.browser.cjs): kiểm thử compact UI/resize/focus/API và ảnh live.
- [docs/phase-5.5-ui.md](phase-5.5-ui.md): báo cáo và bài học này.

Chỉnh sửa:

- [MovieList.tsx](../frontend/src/components/MovieList.tsx), [MovieList.css](../frontend/src/components/MovieList.css): State theo hàng, slice, controls, Grid và header danh mục.
- [MovieCard.css](../frontend/src/components/MovieCard.css): kích thước vùng tên và metadata nhất quán.
- [HomePage.tsx](../frontend/src/pages/HomePage.tsx): kết quả tìm/lọc chọn full mode.
- [MovieDetailsPage.tsx](../frontend/src/pages/MovieDetailsPage.tsx), [MovieDetailsPage.css](../frontend/src/pages/MovieDetailsPage.css): tổ chức metadata/media gọn, key recommendations, lazy backdrop.
- [HeroBanner.css](../frontend/src/components/HeroBanner.css): giảm kích thước/spacing nhẹ, giữ Hero component.
- [MovieFilters.css](../frontend/src/components/MovieFilters.css): spacing và hai cột trên mobile.
- [index.css](../frontend/src/index.css): khoảng cách section, font serif hỗ trợ tiếng Việt.
- [SearchResults.css](../frontend/src/SearchResults.css): spacing gọn và màu lastUpdated theo token màu hiện có.
- [README.md](../README.md): trạng thái Phase 5.5 và liên kết báo cáo.

## Kiểm thử đã chạy

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
```

48 test hiện có đạt; lint không warning/error, TypeScript check và build thành công. Browser dùng Edge headless với Playwright tạm đã có trong cache; không thêm dependency production.

Đã chạy lại bộ browser Giai đoạn 5, gồm fixture và TMDB thật: Home search/filter/sort/lastUpdated, Link/Back/Forward, URL trực tiếp/refresh, ID sai/404, loading/error/retry, trailer, thiếu dữ liệu, AbortController/race guard và kiểm tra token không xuất hiện trong frontend/response. Tất cả đạt sau khi thêm compact mode.

Bộ browser Phase 5.5 đã kiểm tra:

- 320/390/768/1024/1440px: lần lượt 2/2/3/4/5 cột, đúng một hàng ban đầu và poster 2:3, không tràn ngang.
- Xem thêm đúng một hàng; hàng cuối không đủ cột vẫn truy cập được; không đổi thứ tự/mất/trùng ID.
- Các section mở độc lập; danh sách ngắn hoặc vừa một hàng không có nút thừa.
- Thu gọn và keyboard focus, aria-expanded, nút còn trong viewport, không cuộn tới đầu trang.
- Resize giữ số hàng đã mở; kiểm tra cả sát biên 639/640, 959/960, 1279/1280px.
- Full results chứa đủ 23/23 phim fixture, lọc nhiều điều kiện/sort, số kết quả, empty state/reset.
- Recommendations một hàng, mở thêm, click phim mới đúng Router/ID, reset về một hàng và không có phim hiện tại.
- Ghi đếm request xác nhận mở/thu/resize/search/filter không gọi thêm API.
- Reduced motion và không có lỗi React runtime trong các lượt đã chạy.
- Dữ liệu thật: danh mục Home/recommendations, mở/thu độc lập và ảnh thật; các ảnh desktop/mobile được chụp từ lượt không mock API.

Chạy lại khi app đang mở tại localhost:5173:

```powershell
node frontend/tests/compactMovies.browser.cjs D:\LearnReact\Cineverse\.npm-cache\_npx\e41f203b7505f1fb\node_modules\playwright --live
node frontend/tests/movieDetails.browser.cjs D:\LearnReact\Cineverse\.npm-cache\_npx\e41f203b7505f1fb\node_modules\playwright --live
```

Đường dẫn Playwright trong cache tùy máy. Bỏ --live để chỉ chạy fixture; --live-only ở compactMovies chỉ kiểm tra/chụp lượt live. CINEVERSE_TEST_URL đổi địa chỉ nếu Vite dùng cổng khác. Browser mặc định msedge; CINEVERSE_BROWSER_CHANNEL có thể chọn chrome đã cài.

## Ảnh kiểm tra

Ảnh lưu trong cache bị Git ignore, không là asset production:

- [Home desktop](../.npm-cache/phase-5.5-home-desktop.png)
- [Danh mục desktop](../.npm-cache/phase-5.5-movies-desktop.png)
- [Home mobile](../.npm-cache/phase-5.5-home-mobile.png)
- [Danh mục mobile](../.npm-cache/phase-5.5-movies-mobile.png)
- [Chi tiết desktop](../.npm-cache/phase-5.5-details-desktop.png)
- [Chi tiết mobile](../.npm-cache/phase-5.5-details-mobile.png)

## Thứ tự học code mới

1. MovieList.tsx: đọc mode, columns, useState(1), visibleMovies và hai event handler. Thử tính tay: 3 cột × 2 hàng = 6 phim.
2. slice(0, n): so sánh mảng nguồn với mảng đem render. Thử trường hợp chỉ còn một phim ở hàng cuối.
3. Conditional rendering: kiểm tra tại sao hasMore và isExpanded có thể cùng true, và khi nào chỉ còn Thu gọn.
4. MovieList.css và style gridTemplateColumns: Grid tạo columns cột bằng nhau; minmax(0, 1fr) cho phép nội dung co mà không kéo tràn ngang.
5. useMovieColumns.ts: theo dõi matchMedia, State columns và cleanup. Effect dùng cho đăng ký browser events, không dùng để đồng bộ visibleMovies.
6. HomePage.tsx: so sánh Props mode="full" ở kết quả lọc với compact mặc định ở các danh mục.
7. MovieDetailsPage.tsx: key={movie.id} làm React tạo State mới cho danh sách của phim mới.

Mỗi lần render MovieList là một component instance riêng với visibleRows riêng; dùng chung code không có nghĩa dùng chung State. Các mảng movies vẫn do component cha truyền qua Props và không bị cơ chế hiển thị thay đổi.

## Giới hạn còn lại

- Xem thêm chỉ mở dữ liệu đã tải ở trang đầu TMDB, không phải phân trang API hay tìm trên toàn bộ TMDB.
- Resize giữ số hàng, không giữ nguyên số card. State mở rộng reset khi MovieList unmount hoặc đổi key; không lưu vào storage/URL.
- Tên rất dài vẫn hiển thị hai dòng với title đầy đủ trên card; nội dung đầy đủ có ở trang chi tiết. Mô tả phim không bị cắt.
- Playback YouTube, nguồn dữ liệu, hosting và authentication giữ phạm vi Giai đoạn 5. Chưa triển khai Phase 6.
