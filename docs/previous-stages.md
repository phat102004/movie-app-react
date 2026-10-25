# Cineverse

Website xem phim dùng React + TypeScript + Vite, được xây dựng theo từng bước để vừa phát triển vừa học React.

## Phạm vi hiện tại

Giao diện hiện tại theo phong cách **Minimal Editorial Cinema**: nền giấy sáng, xanh olive, typography serif kết hợp sans-serif và hero chia hai cột ảnh–nội dung. Header, HeroBanner và ba khu vực Phim nổi bật, Phim mới cập nhật, Phim phổ biến vẫn dùng dữ liệu mẫu 12 phim, poster và ảnh nền lưu cục bộ. Đã có tìm kiếm kết hợp bộ lọc thể loại, năm, điểm đánh giá và sắp xếp. Chưa có API, backend, database hoặc React Router.

Menu mobile có thể đóng/mở và đóng bằng Escape. Header có ô tìm kiếm phim cập nhật kết quả ngay khi nhập. Trang chủ và liên kết khám phá có thể cuộn đến nội dung. Các mục Phim lẻ, Phim bộ, Yêu thích và nút Xem ngay/Chi tiết hiện được vô hiệu hóa vì chức năng tương ứng chưa nằm trong bước này. MovieCard chỉ hiển thị thông tin; chưa điều hướng hay phát phim.

## Chạy ứng dụng

```powershell
cd D:\LearnReact\Cineverse\frontend
npm.cmd run dev
```

Mở địa chỉ Local mà Vite in ra, thường là http://localhost:5173/. Giữ terminal chạy; Ctrl+C để dừng. Nếu chuyển sang máy khác, chạy `npm.cmd install` trước. Trên Windows, `npm.cmd` tránh việc PowerShell chặn script `npm.ps1`.

```powershell
npm.cmd run build
npm.cmd run lint
```

`build` kiểm tra TypeScript và sinh bản production trong `dist/`. `lint` chạy Oxlint. Các file trong `dist/` được sinh tự động; sửa mã trong `src/`.

## Cấu trúc và các file của bước trang chủ

```text
Cineverse/
├── README.md
└── frontend/
    ├── public/
    │   ├── favicon.svg
    │   └── images/movies/          # 12 poster, 1 ảnh nền và SOURCES.md
    ├── src/
    │   ├── components/
    │   │   ├── Header.tsx         # Logo, menu và state đóng/mở trên mobile
    │   │   ├── Header.css
    │   │   ├── SearchBar.tsx      # Controlled input, nhận query và callback
    │   │   ├── SearchBar.css
    │   │   ├── HeroBanner.tsx     # Nhận movie qua props và hiển thị banner
    │   │   ├── HeroBanner.css
    │   │   ├── MovieList.tsx      # Nhận danh sách và map() thành các card
    │   │   ├── MovieList.css
    │   │   ├── MovieCard.tsx      # Nhận một movie và hiển thị thông tin
    │   │   ├── MovieCard.css
    │   │   └── Icon.tsx           # Icon SVG nhỏ, không cần thư viện UI
    │   ├── data/movies.ts         # Dữ liệu mẫu, phim banner và ba nhóm phim
    │   ├── types/movie.ts         # Type Movie và MovieSection
    │   ├── App.tsx               # Ghép các component và truyền dữ liệu
    │   ├── SearchResults.css     # Thông báo và trạng thái không có kết quả
    │   ├── index.css             # Màu sắc, CSS chung, footer, giảm chuyển động
    │   └── main.tsx              # Điểm khởi chạy React, giữ nguyên
    └── index.html                # Tiêu đề, ngôn ngữ, mô tả và favicon
```

Tạo mới: các file trong `components/`, `data/movies.ts`, `types/movie.ts`, `public/favicon.svg` và `public/images/movies/`.

Chỉnh sửa: `src/App.tsx`, `src/index.css`, `index.html` và README này. Không thêm dependency.

Khi đến giai đoạn fullstack có thể thêm `backend/` cùng cấp `frontend/`.

## Luồng dữ liệu: App → MovieList → MovieCard

1. `types/movie.ts` định nghĩa hình dạng của một phim: id, tên, năm, điểm, poster, thể loại, mô tả và ảnh nền tùy chọn. Đây là hợp đồng TypeScript, không phải dữ liệu được hiển thị trực tiếp.
2. `data/movies.ts` tạo mảng `movies: Movie[]`. `heroMovie` chọn phim cho banner. `movieSections` gom phim thành ba nhóm; nhóm phổ biến sắp xếp trên bản sao mảng để không thay đổi mảng gốc.
3. `App.tsx` import dữ liệu rồi dùng `movieSections.map()` tạo một `MovieList` cho mỗi nhóm. App truyền `title`, `subtitle`, `id`, `movies` và `index` bằng props. Banner nhận một phim qua prop `movie`.
4. `MovieList.tsx` nhận props, tạo tiêu đề section và dùng `movies.map()` để render `<MovieCard movie={movie} />`. `key={movie.id}` giúp React nhận diện từng phần tử khi danh sách thay đổi. Key chỉ cần duy nhất trong cùng danh sách.
5. `MovieCard.tsx` nhận prop `movie: Movie`, đọc `movie.poster`, `movie.title`, `movie.year`, `movie.rating` để render JSX. Card không tự import dữ liệu mẫu, vì vậy có thể tái sử dụng khi dữ liệu đến từ API sau này.

```text
data/movies.ts
      ↓ import
    App.tsx
      ├── movie={heroMovie} → HeroBanner
      └── movies={section.movies} → MovieList
                                      └── map() → MovieCard movie={movie}
```

Props đi từ cha xuống con. Dữ liệu phim mẫu không cần State vì không thay đổi. App dùng State cho từ khóa và bộ lọc, Header dùng State cho menu; MovieCard dùng State cho trạng thái lỗi ảnh. Khi State thay đổi, React render lại component tương ứng.

## Thứ tự đọc mã để học

1. `types/movie.ts`: so sánh type với một object phim thực tế trong `data/movies.ts`.
2. `App.tsx`: tìm đoạn `movieSections.map()` và các props truyền xuống MovieList.
3. `MovieList.tsx`: đọc kiểu props, cách destructuring và `movies.map()` có key.
4. `MovieCard.tsx`: đọc `MovieCardProps`, JSX hiển thị thông tin và `onError` cập nhật State.
5. `HeroBanner.tsx`: thể loại được render bằng `map()`, điểm được định dạng bằng `toFixed(1)`; `backdrop ?? poster` chọn ảnh thay thế.
6. `Header.tsx`: theo dõi `isMenuOpen`, sự kiện click, class có điều kiện và `aria-expanded`.
7. Các file CSS: danh sách phim hiển thị 3 cột, giảm còn 2 cột từ 600px trở xuống. Trên desktop rộng, tiêu đề khu vực nằm thành cột bên trái lưới phim; tablet/mobile đưa tiêu đề lên trên. Menu chuyển sang nút đóng/mở ở 760px. Tắt hiệu ứng chuyển động nếu hệ điều hành yêu cầu giảm chuyển động.

## Ba bài tập tự thực hành

1. **Component và Props:** thêm một object Movie và poster cục bộ vào nhóm mới cập nhật. Kiểm tra TypeScript báo gì khi bỏ thiếu `year` hoặc gán `rating` thành chuỗi.
2. **filter() và map():** sửa dữ liệu nhóm Phim phổ biến để chỉ hiển thị phim có `rating >= 8.5`. Đọc lại đoạn sort để hiểu vì sao cần sao chép mảng trước khi sắp xếp.
3. **State và Events:** tự thêm nút Ẩn/Hiện mô tả trong HeroBanner bằng `useState`, `onClick` và JSX có điều kiện. Không cần thư viện mới.

## Tự kiểm tra giao diện

- Desktop 1440px: hero hai cột, ba danh sách, mỗi danh sách 6 card trong lưới 3 cột, hover poster nhẹ.
- Tablet 768px: lưới 3 cột, không bị cuộn ngang.
- Mobile 390px và 320px: lưới 2 cột, banner và nút không tràn; menu mở/đóng được.
- Dùng phím Tab để thấy focus; mở menu mobile rồi nhấn Escape để đóng.
- Tạm đổi một đường dẫn poster thành đường dẫn sai để quan sát card thay thế, rồi khôi phục.

Ảnh được lưu cục bộ nên không cần tải từ CDN lúc chạy. Nguồn từng ảnh được ghi tại `frontend/public/images/movies/SOURCES.md`. Các số liệu phim là dữ liệu mẫu phục vụ giao diện.

## Bước tìm kiếm phim

Tạo mới: `frontend/src/components/SearchBar.tsx`, `frontend/src/components/SearchBar.css` và `frontend/src/SearchResults.css`.

Chỉnh sửa: `frontend/src/App.tsx`, `frontend/src/components/Header.tsx`, `frontend/src/components/Header.css` và README này. Tái sử dụng dữ liệu `Movie`, MovieList, MovieCard và Icon; không thêm dependency.

### Luồng dữ liệu và sự kiện

```text
App: useState(searchQuery)
  ↓ props: searchQuery + setSearchQuery
Header
  ↓ props: query + onQueryChange
SearchBar: value={query}, onChange
  ↓ gọi callback khi nhập
App: setSearchQuery → render lại → filterAndSortMovies
  ↓ props: movies={visibleMovies}
MovieList: movies.map()
  ↓ props: movie={movie}
MovieCard
```

App là cha chung của Header và danh sách phim, nên từ khóa được đặt tại App. SearchBar không có State riêng cho từ khóa. Giá trị input luôn được quyết định bởi prop `query`: đây là một **controlled input**.

### Những đoạn cần đọc

- `App.tsx`: `useState('')` quản lý từ khóa; `setSearchQuery` được truyền xuống Header bằng prop `onSearchQueryChange`.
- `Header.tsx`: type `HeaderProps` mô tả dữ liệu và callback; Header truyền tiếp chúng xuống SearchBar mà không sao chép State.
- `SearchBar.tsx`: type `SearchBarProps` khai báo `query: string` và `onQueryChange: (query: string) => void`. `value={query}` hiển thị State; `onChange={(event) => onQueryChange(event.target.value)}` gửi giá trị mới về App.
- `SearchBar.tsx`: nút xóa gọi `onQueryChange('')`. `useRef` chỉ giữ tham chiếu đến input để đưa focus về ô nhập sau khi xóa; không lưu từ khóa hoặc danh sách kết quả.
- `SearchBar.tsx`: form ngăn submit mặc định để Enter không tải lại trang. Tìm kiếm diễn ra ngay khi gõ, không cần submit.
- `utils/filterMovies.ts`: `query.trim().toLowerCase()` loại khoảng trắng ở đầu/cuối và chuẩn hóa chữ hoa/thường. Chỉ chuẩn hóa biến dùng để so sánh; input vẫn giữ nguyên nội dung người dùng đang nhập.
- `utils/filterMovies.ts`: `movies.filter(...)` giữ các phim có `title.toLowerCase().includes(normalizedQuery)` hoặc `originalTitle.toLowerCase().includes(normalizedQuery)`, đồng thời thỏa mãn các bộ lọc. `includes()` cho phép khớp một phần tên. Lọc trên mảng phim gốc giúp tránh lặp phim xuất hiện trong nhiều bộ sưu tập.
- `App.tsx`: `isExploring` quyết định hiển thị một MovieList kết quả hoặc ba bộ sưu tập ban đầu. Nếu không khớp phim nào, hiển thị thông báo rõ ràng. HeroBanner vẫn giữ nguyên.
- `MovieList.tsx`: tiếp tục dùng `movies.map()` và `key={movie.id}`. MovieCard nhận cùng kiểu Movie như trước; không cần sửa hai component này.

### Vì sao không dùng useEffect?

`visibleMovies` được tính hoàn toàn từ `movies`, `searchQuery` và `filters`. Khi State thay đổi, React render lại App và tính lại mảng kết quả ngay trong lần render đó.

Nếu lưu thêm kết quả bằng State rồi dùng Effect để đồng bộ, ta phải quản lý nhiều dữ liệu phụ thuộc nhau, dễ quên cập nhật và tạo thêm lần render. Ở đây chỉ cần State cho từ khóa và lựa chọn bộ lọc; danh sách kết quả là giá trị tính toán, không phải State riêng. Bộ dữ liệu nhỏ nên chưa cần thêm cơ chế ghi nhớ kết quả.

### Chạy và kiểm tra

Chạy `npm.cmd run dev` từ `frontend/`, mở địa chỉ Local mà Vite in ra. Nếu server đang chạy, chỉ cần tải lại trang.

| Nhập hoặc thao tác     | Kết quả mong đợi                                       |
| ---------------------- | ------------------------------------------------------ |
| `DUNE`, `dune`, `dUnE` | Cùng tìm thấy 2 phim Dune, mỗi phim xuất hiện một lần  |
| `  dune  `             | Vẫn tìm thấy 2 phim nhờ trim()                         |
| `stellar`              | Tìm thấy Interstellar nhờ includes() trên tên gốc      |
| `ĐÁNH CẮP`             | Tìm thấy Kẻ đánh cắp giấc mơ                           |
| `zzzzzz`               | Hiển thị Không tìm thấy phim                           |
| Chỉ nhập dấu cách      | Hiển thị lại 3 bộ sưu tập ban đầu                      |
| Nhấn nút xóa           | Input rỗng, focus trở về input, khôi phục 3 bộ sưu tập |
| Nhấn Enter             | Không tải lại trang, kết quả vẫn giữ nguyên            |

Thử trên desktop và mobile. Trên mobile ô tìm kiếm nằm ở hàng riêng trong Header; menu đóng/mở như trước.

### Ba bài tập cho bước tìm kiếm

1. **filter/includes:** mở rộng điều kiện để tìm được phim theo thể loại bằng `genres.some()`. Giữ việc chuẩn hóa chữ hoa/thường.
2. **JSX có điều kiện:** thay dòng báo kết quả để phân biệt `1 phim` với nhiều phim, hoặc tùy biến lời gợi ý khi không tìm thấy phim.
3. **State và Events:** thêm nút bật/tắt chế độ chỉ tìm theo tên tiếng Việt; dùng State boolean ở App và điều chỉnh điều kiện filter.

Các bài tập trên thuộc bước tìm kiếm. Bước 3 hiện đã thêm lọc thể loại bằng `genres.includes()` và các bộ lọc bên dưới.

## Giai đoạn 3: Bộ lọc và khám phá phim

### File đã tạo và chỉnh sửa

| File tính từ frontend/            | Thay đổi và trách nhiệm                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/types/movieFilters.ts`       | Mới: kiểu lựa chọn bộ lọc và union type cho thứ tự sắp xếp                                |
| `src/data/movieFilters.ts`        | Mới: giá trị mặc định, thể loại tập trung, năm từ dữ liệu, các lựa chọn điểm và sắp xếp   |
| `src/utils/filterMovies.ts`       | Mới: hàm thuần kết hợp tìm kiếm, lọc và sắp xếp; không thay đổi nguồn                     |
| `src/components/MovieFilters.tsx` | Mới: component nhận giá trị và callback qua props, render dropdown có nhãn cùng nút reset |
| `src/components/MovieFilters.css` | Mới: dark mode, hover, focus, trạng thái đang chọn, lưới 4/2/1 cột                        |
| `tests/filterMovies.test.ts`      | Mới: kiểm tra logic lọc, ngưỡng điểm, sắp xếp và tính bất biến của nguồn                  |
| `src/App.tsx`                     | Sửa: giữ State, nối sự kiện, tính visibleMovies và chọn giao diện hiển thị                |
| `src/SearchResults.css`           | Sửa: số lượng kết quả luôn được hiển thị, kể cả lúc mặc định                              |
| `package.json`                    | Sửa: thêm npm test, dùng bộ chạy test tích hợp của Node, không thêm dependency            |

README gốc cũng được cập nhật. Không sửa Header, SearchBar, HeroBanner, MovieList, MovieCard hoặc dữ liệu phim ở giai đoạn này.

### Hành vi giao diện

- Mọi lựa chọn ở mặc định và từ khóa rỗng: giữ nguyên ba bộ sưu tập. Số lượng là **12 phim duy nhất** trong thư viện; một phim có thể xuất hiện trong nhiều bộ sưu tập.
- Khi có từ khóa, bộ lọc hoặc cách sắp xếp khác mặc định: hiển thị một danh sách kết quả duy nhất.
- Nút **Xóa bộ lọc** đưa thể loại, năm, điểm và sắp xếp về mặc định, đồng thời xóa từ khóa trong Header.
- Nút xóa riêng của SearchBar chỉ xóa từ khóa và giữ lại các bộ lọc khác.
- Thể loại gồm bảy lựa chọn được yêu cầu và các thể loại có trong dữ liệu mẫu. Hiện chưa có phim Tình cảm, Kinh dị, Hài hước nên chọn các thể loại này sẽ có kết quả rỗng. Không gán sai thể loại để tạo kết quả giả.
- Năm được lấy từ `movies.map(movie => movie.year)`, bỏ trùng bằng Set rồi sắp xếp giảm dần. Danh sách không phụ thuộc các bộ lọc đang chọn nên người dùng luôn có thể chọn lại năm khác.
- Điểm trong dữ liệu đã dùng thang 10, không cần chuẩn hóa. Giá trị 0 nghĩa là không đặt ngưỡng; 5, 7, 8 dùng điều kiện `rating >= minRating`.
- Sắp xếp A–Z theo tên tiếng Việt bằng `localeCompare(..., 'vi')`. Mặc định giữ thứ tự nguồn; sắp xếp khác không ảnh hưởng dữ liệu nguồn.

### Luồng State → Props → kết quả

```text
SearchBar → callback → App.setSearchQuery
MovieFilters → onFiltersChange → App.setFilters
                                ↓ render lại
            filterAndSortMovies(movies, searchQuery, filters)
                                ↓ visibleMovies
                  MovieList → map() → MovieCard
```

`App` giữ `searchQuery` và object `filters` trong hai useState. MovieFilters là controlled component: select đọc `value` từ props; onChange gửi một object bộ lọc mới về App. MovieList và MovieCard chỉ trình bày dữ liệu đã tính, không cần biết các dropdown đang được chọn như thế nào.

### filter(), && và ||

Trong `src/utils/filterMovies.ts`, mỗi phim được kiểm tra bốn điều kiện:

```ts
return matchesQuery && matchesGenre && matchesYear && matchesRating
```

`filter()` tạo mảng mới, chỉ giữ phim có callback trả về true. `&&` yêu cầu **tất cả** điều kiện đúng, nên tìm kiếm, thể loại, năm và điểm kết hợp được với nhau.

`||` dùng khi chỉ cần **một trong hai** khả năng đúng:

```ts
const matchesGenre =
  filters.genre === '' || movie.genres.includes(filters.genre)
```

Không chọn thể loại (`''`) thì phim đi qua điều kiện này. Khi đã chọn, genres phải chứa đúng thể loại đó. Tương tự với năm. Trong tìm kiếm, tên tiếng Việt **hoặc** tên gốc chứa từ khóa là đủ. Chuỗi từ khóa rỗng khớp mọi tên vì includes('') là true.

### sort() và giữ nguyên nguồn

`sort()` thay đổi chính mảng được gọi. Vì vậy hàm tạo `sortedMovies = [...filteredMovies]` rồi mới sort bản sao. Các phim không bị thay đổi thuộc tính và `movies` không bị đổi thứ tự.

- `b.year - a.year`: năm lớn đứng trước.
- `a.year - b.year`: năm nhỏ đứng trước.
- `b.rating - a.rating`: điểm cao đứng trước.
- `a.title.localeCompare(b.title, 'vi')`: thứ tự tên theo tiếng Việt.

### Những kiến thức cần học thêm

1. **State dạng object và spread:** `{ ...filters, genre: value }` tạo object mới, chỉ thay thể loại và giữ năm/điểm/sắp xếp. Không gán trực tiếp `filters.genre = value`.
2. **Controlled select:** `value` và `onChange` hoạt động tương tự controlled input. Giá trị DOM là chuỗi, nên năm và điểm được đổi sang số bằng Number() trước khi so sánh.
3. **Derived data và hàm thuần:** danh sách kết quả được tính từ State, không lưu thêm State kết quả và không dùng Effect để đồng bộ. Hàm thuần nhận đầu vào và trả kết quả giúp kiểm tra độc lập với giao diện.
4. **TypeScript union:** MovieSortOrder chỉ cho phép năm giá trị sắp xếp đã định nghĩa. `as MovieSortOrder` trong select xác nhận kiểu của giá trị đến từ danh sách option tập trung; nó không chuyển đổi giá trị lúc chạy.
5. **JavaScript bổ trợ:** Set bỏ trùng, flatMap gộp các mảng thể loại, localeCompare so sánh chuỗi theo ngôn ngữ. Đây là kiến thức JavaScript, không phải hook React mới.

### Chạy và tự kiểm tra

Từ `frontend/`, dùng Node 22.18+ cho lệnh test hiện tại:

```powershell
npm.cmd run dev
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

`build` bao gồm TypeScript check bằng `tsc -b`. Bộ test dùng Node tích hợp và cơ chế đọc TypeScript trực tiếp, không thêm thư viện test.

1. Nhập `dune`, chọn Khoa học viễn tưởng, năm 2024, từ 8 điểm: chỉ còn Dune phần hai.
2. Đổi năm sang 2021: chỉ còn Dune phần một.
3. Đổi thể loại sang Hành động: không có kết quả, vẫn giữ nguyên các lựa chọn để chỉnh lại.
4. Chọn Xóa bộ lọc: từ khóa rỗng, các select mặc định, ba nhóm phim trở lại.
5. Chỉ chọn từ 8 điểm: 8 phim phù hợp. Chọn năm cũ nhất: phim đầu là Inception (2010). Chỉ chọn năm mới nhất: Dune phần hai (2024) đứng đầu.
6. Dùng Tab để tới select, phím mũi tên để chọn, Enter để xác nhận. Thu nhỏ màn hình kiểm tra dropdown và nhãn không tràn.

### Ba bài tập thực hành

1. Thêm lựa chọn **Từ 9 điểm** ở ratingOptions; quan sát trạng thái rỗng với dữ liệu hiện tại và bổ sung test ngưỡng mới.
2. Thêm kiểu sắp xếp **Điểm đánh giá thấp nhất**: sửa union type, sortOptions, switch trong filterAndSortMovies rồi thêm test thứ tự.
3. Thêm nút **Chỉ phim từ năm 2020** trong MovieFilters. Giữ nó trong State ở App, dùng && kết hợp với các điều kiện còn lại và bảo đảm Xóa bộ lọc cũng reset lựa chọn này.

Các bài tập chưa được triển khai. Giai đoạn 3.5 bên dưới chỉ thay đổi giao diện, không thay đổi logic này.

## Giai đoạn 3.5: Minimal Editorial Cinema

### Hướng thiết kế

- Nền giấy `#F7F5F0`, surface trắng, chữ chính `#242424`, accent olive `#66735A`, đường phân cách `#E5E3DC`.
- Chữ phụ dùng `#707069`, điều chỉnh nhẹ từ màu đề xuất `#73736E` để đạt tỷ lệ tương phản khoảng 4.58:1 trên nền giấy.
- Font sans-serif hệ thống cho nội dung, Georgia cho tiêu đề và wordmark. Không tải font từ dịch vụ bên ngoài.
- Hero chuyển từ ảnh nền toàn khung sang figure có caption, đặt cạnh tên phim, mô tả và các hành động hiện có. Mobile đưa ảnh và nội dung thành một cột.
- Danh sách được chia bằng typography và khoảng trắng; desktop rộng có cột tiêu đề riêng, lưới phim 3 cột, mobile 2 cột. Không có carousel.
- MovieCard giữ poster tỷ lệ 2:3, hiển thị tên tiếng Việt, tên gốc, năm, thể loại và điểm ngay dưới poster. Thể loại không còn chỉ xuất hiện khi hover.
- Search thu gọn thành đường gạch chân; dropdown dùng surface trắng, đường viền mảnh và màu olive khi được chọn. Focus luôn rõ ràng.
- Hover poster chỉ scale 1.015, không glow hoặc gradient. Khi bật prefers-reduced-motion, tắt transition, animation và chuyển vị/phóng to khi hover.

### File thay đổi

| File tính từ frontend/                            | Mục đích                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/index.css`                                   | Design tokens, light color scheme, font, spacing, footer và reduced motion |
| `src/components/Header.css`                       | Wordmark, điều hướng, menu mobile theo palette mới                         |
| `src/components/HeroBanner.tsx`, `HeroBanner.css` | Đổi cấu trúc trình bày sang editorial hai cột; giữ props và hành động      |
| `src/components/MovieCard.tsx`, `MovieCard.css`   | Sắp lại metadata; giữ state/error handler của ảnh                          |
| `src/components/MovieList.css`                    | Tiêu đề dạng mục tạp chí, lưới và khoảng cách responsive                   |
| `src/components/SearchBar.css`                    | Ô tìm kiếm tối giản, focus và nút xóa có vùng chạm 44px                    |
| `src/components/MovieFilters.css`                 | Đồng bộ dropdown, reset, trạng thái chọn và layout 4/2/1 cột               |
| `src/SearchResults.css`                           | Số lượng kết quả và trạng thái rỗng theo giao diện mới                     |
| `index.html`                                      | Theme color theo nền giấy                                                  |
| `public/favicon.svg`                              | Đồng bộ favicon olive/nền giấy                                             |

README này cũng được cập nhật. Không thêm dependency hoặc file logic ứng dụng mới.

### Logic được giữ nguyên

- `App.tsx`: State searchQuery/filters, tính visibleMovies, reset và điều kiện hiển thị các danh sách.
- `Header.tsx`: props tìm kiếm, mở/đóng menu, Escape và trả focus về nút menu.
- `SearchBar.tsx`: controlled input, onChange, xử lý Enter, nút xóa và trả focus về input.
- `MovieFilters.tsx`: toàn bộ props, select, onChange, spread để giữ các lựa chọn khác và callback reset.
- `MovieList.tsx`: props và map() tạo MovieCard.
- `filterMovies.ts`: trim, toLowerCase, includes, AND giữa các điều kiện và sort trên bản sao.
- Toàn bộ types, dữ liệu phim và cấu hình lựa chọn bộ lọc.
- MovieCard vẫn giữ useState và onError cho ảnh; HeroBanner giữ nguyên props. Các nút Xem ngay/Chi tiết tiếp tục disabled vì chưa có chức năng thật.

Các file logic không chỉnh sửa được đối chiếu bằng SHA-256 trước/sau redesign. Thư mục chưa có Git repository nên không tạo commit hoặc khởi tạo Git; có lưu bản sao các file giao diện ban đầu trong `.npm-cache/editorial-before-20261017-191530/`.

### Kiểm thử hồi quy

Đã kiểm tra bằng Edge headless trên desktop, tablet và mobile ở 1440, 1280, 1024, 820, 768, 600, 540, 390 và 320px:

1. Trang chủ có 18 card trong 3 nhóm, tương ứng thư viện 12 phim duy nhất; ảnh đều tải được.
2. Tìm tên tiếng Việt, tên gốc, một phần tên, hoa/thường và khoảng trắng đầu/cuối cho đúng kết quả.
3. Xóa từ khóa khôi phục kết quả và trả focus về input; giữ những bộ lọc đang chọn.
4. Lọc thể loại, năm, điểm; bốn lựa chọn sắp xếp và mặc định hoạt động.
5. Tìm kiếm kết hợp nhiều điều kiện không reset các lựa chọn khác.
6. Reset xóa từ khóa, thể loại, năm, điểm và sắp xếp; khôi phục ba bộ sưu tập.
7. Không có kết quả hiển thị thông báo phù hợp.
8. Menu mobile mở/đóng, Escape và liên kết Trang chủ hoạt động.
9. Select có nhãn, chọn được bằng bàn phím, focus hiển thị rõ; không tràn ngang ở các kích thước kiểm tra.
10. Ảnh lỗi hiển thị fallback của MovieCard; chế độ giảm chuyển động tắt transition.

Kiểm tra tự động: `npm.cmd test` (8 test logic), `npm.cmd run lint`, TypeScript check và `npm.cmd run build`.

### Những giới hạn vẫn giữ từ trước

Phim lẻ, Phim bộ, Yêu thích và các nút Xem ngay/Chi tiết chưa có chức năng thật nên vẫn disabled. Dữ liệu mẫu chưa có phim thuộc Tình cảm, Kinh dị, Hài hước; các lựa chọn này trả về danh sách rỗng đúng như trước.

### Kiến thức nên tìm hiểu

- **CSS variables:** sửa token để đồng bộ màu, font và khoảng cách thay vì đổi từng component.
- **Grid và Flexbox:** Grid chia cột hero/danh sách/dropdown; Flexbox xếp metadata, menu và các nút.
- **Typography:** phân cấp serif/sans-serif, line-height, letter-spacing và text-wrap để tạo nhịp đọc.
- **Responsive:** thay bố cục theo không gian thực tế; dùng minmax(0, 1fr), min-width: 0 và flex-wrap để hạn chế tràn.
- **Accessibility:** label của select/input, focus-visible, vùng chạm 44px, tương phản chữ và prefers-reduced-motion.
- **React:** tách phần trình bày JSX/CSS khỏi State và logic lọc; có thể đổi thiết kế mà giữ nguyên public props và luồng sự kiện.

Dừng sau redesign giai đoạn 3.5. Chưa triển khai tính năng của giai đoạn tiếp theo.
