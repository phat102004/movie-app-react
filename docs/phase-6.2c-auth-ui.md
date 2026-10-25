# Phase 6.2C — React Authentication UI

Tích hợp giao diện React với API Register/Login/Me/Logout hiện có. Giữ nền ivory, typography serif, nhấn olive và đường viền nhẹ của Minimal Editorial Cinema. Không đổi backend, migration, credentials hoặc dependency.

## Khảo sát thực tế và phạm vi

- React 19.2.x, TypeScript 6.0.x, Vite 8.3.x, React Router 7.18.4; API và Context mới sử dụng các package đã có.
- Router BrowserRouter nằm trong main.tsx, App giữ catalog/search/filter ngoài Routes. AuthProvider được đặt cạnh cấu trúc này và không remount khi chuyển trang.
- Backend yêu cầu POST có JSON và X-Cineverse-CSRF: 1; Logout thành công trả 204 rỗng; Me 401 là guest; lỗi hệ thống không phải bằng chứng session hết hạn.
- Kiểm tra source không thấy Favorites/localStorage logic; nút Yêu thích hiện disabled. Giữ nguyên trạng thái đó, không dựng dữ liệu yêu thích giả hoặc thêm đồng bộ PostgreSQL.
- Dự án dùng Node test runner và các browser tests Playwright từ trước, không có Vitest/React Testing Library. Tiếp tục dùng Node cho service/validation, Edge + Playwright cho React UI/hooks thật, không cài thêm test framework.

## File tạo/sửa và thứ tự đọc

| File                                                                                      | Trách nhiệm                                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| frontend/src/types/auth.ts                                                                | AuthUser, input types, field errors, AuthStatus và interface service cho Context                 |
| frontend/src/services/auth.ts                                                             | Fetch tương đối, same-origin cookie, header CSRF, DTO parsing, lỗi an toàn và xử lý 204          |
| frontend/src/utils/authForm.ts                                                            | Validation UX, kiểm tra return route và router-state thông báo đăng ký                           |
| frontend/src/contexts/auth-context.ts                                                     | Context contract, không giữ state riêng                                                          |
| frontend/src/contexts/AuthProvider.tsx                                                    | Nguồn state xác thực duy nhất, startup Me, Login/Logout/refresh và bảo vệ race                   |
| frontend/src/hooks/useAuth.ts                                                             | Đọc Context, báo lỗi lập trình nếu thiếu Provider                                                |
| frontend/src/components/AuthForm.tsx                                                      | Form dùng chung cho hai trang, Event handling, field errors, password visibility và submit guard |
| frontend/src/pages/LoginPage.tsx                                                          | Trang route /login, sử dụng AuthForm mode login                                                  |
| frontend/src/pages/RegisterPage.tsx                                                       | Trang route /register, sử dụng AuthForm mode register                                            |
| frontend/src/components/AccountMenu.tsx                                                   | Guest link, loading/unknown placeholder, avatar/name, disclosure menu và Logout                  |
| frontend/src/components/AuthSessionNotice.tsx                                             | Thông báo lỗi kiểm tra phiên, retry chủ động                                                     |
| frontend/src/components/Auth.css                                                          | Giao diện form/menu/status cùng design tokens hiện có                                            |
| frontend/src/components/Header.tsx, Header.css                                            | Gắn AccountMenu, bố trí responsive; menu thu gọn từ 1040px để đủ chỗ                             |
| frontend/src/main.tsx                                                                     | Bọc AuthProvider bên trong BrowserRouter/StrictMode                                              |
| frontend/src/App.tsx                                                                      | Hai route mới và thông báo phiên; giữ catalog/search/filter hiện có                              |
| frontend/tests/auth.test.ts                                                               | 7 test service/DTO/validation/redirect/CSRF/204/abort                                            |
| frontend/tests/auth.browser.cjs                                                           | UI → Vite → backend thật với DB mock; tự mở/đóng server tạm                                      |
| frontend/tests/authProvider.browser.html, authProvider.browser.tsx                        | Dev-only harness kiểm tra Context/race/unmount; không vào production bundle                      |
| frontend/tests/movieDetails.browser.cjs, compactMovies.browser.cjs, movieCast.browser.cjs | Fixture Me 401 để các regression tests cũ mô phỏng guest đúng contract                           |
| README.md, docs/phase-6.2c-auth-ui.md                                                     | Cách chạy, học code, kết quả và giới hạn                                                         |

Các file backend và thay đổi từ phase trước còn trong working tree được giữ nguyên. Không commit/push. Test fixture có tài khoản/password tổng hợp chỉ trong memory, không dùng credentials người dùng.

## Kiến trúc và luồng dữ liệu

```text
BrowserRouter
  → AuthProvider (user/status/error, gọi Me)
    → App
      → Header → AccountMenu → useAuth
      → AuthSessionNotice → useAuth
      → Routes
        /                   HomePage
        /movies/:movieId    MovieDetailsPage
        /register           RegisterPage → AuthForm → authService.register
        /login              LoginPage → AuthForm → useAuth.login → authService.login
        *                   NotFoundPage
```

AuthContext là đường truyền dữ liệu, AuthProvider mới giữ state. useAuth cho form/Header dùng cùng nguồn user; không có bản sao user riêng trong từng page. Tách Context ra file .ts giúp chỉ export component trong AuthProvider.tsx, phù hợp Fast Refresh.

### Register → Login

Frontend kiểm tra name/email/password/confirm để phản hồi nhanh. Backend vẫn quyết định dữ liệu hợp lệ và email unique. Password không trim; name/email chuẩn hóa trước request. Confirm chỉ dùng local, không gửi backend. Các input có label, required, autocomplete name/email/new-password, aria-invalid và aria-describedby khi có lỗi.

Submit ref khóa ngay trong event handler, còn state isSubmitting hiển thị loading/disable input và button. Ref chặn cả hai submit trong cùng một lượt trước khi React render lại; disabled button giúp UX nhưng không phải lớp bảo mật server. Nút Hiện/Ẩn có type=button, aria-pressed và không submit form.

Register 201 chỉ chuyển sang /login với router state `{registered:true,email,from}` và thông báo thành công. Không set user/authenticated. Không đưa password/confirm vào URL, state hoặc storage. Login prefill email từ DTO trả về; password rỗng vì form Register đã unmount.

### Login → AuthProvider → Header

Login trả User DTO và backend set cookie. Provider chuyển authenticated, Header hiển thị avatar chữ cái/tên. Điều hướng bằng React Router, không reload toàn bộ website. Tên và trạng thái Header được giữ khi sang Movie Details.

Header truyền pathname trước khi mở Login. Return path chỉ cho `/` và `/movies/<ID hợp lệ>` vì hiện đây là các route sản phẩm đang hoạt động. External URL, `//host`, backslash, auth route và ID sai quay về `/`, tránh open redirect hoặc redirect loop. User đã authenticated mở /login hoặc /register được điều hướng về route hợp lệ bằng Navigate replace.

### Me và trạng thái chưa xác minh

Khi Provider mount, Effect gọi GET /api/auth/me:

| Kết quả                                     | React state                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| Đang chờ                                    | loading, Header placeholder, chưa hiện guest link                        |
| 200 DTO hợp lệ                              | authenticated + user                                                     |
| 401                                         | guest + user null; đây là trạng thái bình thường                         |
| Network/503/response lỗi khi chưa biết user | error, không kết luận guest, có nút Kiểm tra lại phiên                   |
| Refresh lỗi khi đã biết user                | Giữ user/authenticated lần cuối, thêm thông báo chưa kiểm tra được phiên |

Status error được bổ sung ngoài ba trạng thái tối thiểu để biểu diễn rõ tình trạng chưa xác minh. Không xóa cookie, không gửi Logout khi Me lỗi và không tự retry vô hạn. Refresh chỉ chạy khi khởi động hoặc thao tác chủ động. HTTP timeout tối đa khoảng 12 giây cho auth request.

### Logout

POST Logout gửi JSON {} cùng cookie và CSRF header. Service chỉ công nhận HTTP 204, không parse JSON trên body rỗng. Sau 204 Provider mới chuyển guest, menu đóng và focus trở về link Login. Trang phim hiện tại/search/filter được giữ vì chưa có trang nào cần protected route.

Nếu lỗi mạng/server, user vẫn là trạng thái xác nhận gần nhất; menu hiển thị lỗi và cho retry. Không thông báo đăng xuất thành công giả. Khi request bị đứt sau khi server đã xử lý, trạng thái có thể chưa chắc chắn; reload/Me sẽ kiểm tra lại thực tế.

## AbortController, useRef và race condition

Provider dùng AbortController để hủy lượt Me cũ và một version ref để nhận diện lượt mới nhất. Login/Logout tăng version trước khi gọi API, nên Me cũ trả 200/401 sau đó không ghi đè state. Version guard vẫn hoạt động nếu transport bỏ qua abort; đây là điểm quan trọng cần đọc trong readSession và runMutation.

Cleanup khi unmount đánh dấu mounted=false, tăng version và abort request. StrictMode development có thể chạy setup/cleanup/setup nên thấy một request canceled rồi request mới; không phải vòng lặp. Callback service ổn định, Effect không phụ thuộc user/status nên thay đổi user không gọi Me liên tục.

Provider tuần tự hóa Login/Logout và bỏ qua refresh khi mutation đang xử lý, tránh các request xác thực tranh chấp trong cùng app. Form đăng ký sở hữu AbortController riêng; Login do Provider sở hữu để cập nhật Header kể cả form đã rời trang. Form không tự điều hướng hoặc setState khi unmount. Abort POST phía browser không hoàn tác việc server đã tạo User/Session.

Tham khảo [React useContext](https://react.dev/reference/react/useContext), [Effect và cleanup](https://react.dev/reference/react/useEffect). Đây là phần kiến thức mới cần tập trung: Context có một nguồn state, effect cho external I/O, ref cho request identity và mutation lock, không dùng Effect để tính validation từ input.

## API service và cookie

Mọi URL đều tương đối `/api/auth/...`; request dùng credentials: same-origin và cache: no-store. Mọi POST có Content-Type application/json và X-Cineverse-CSRF: 1. Không đổi sang include, không bật CORS hoặc nới Origin check backend.

User JSON được validate runtime rồi chỉ giữ id/name/email/createdAt, loại trường dư. HTTP error được ánh xạ sang thông báo tiếng Việt theo status; không hiển thị raw message/stack từ server. Lỗi field chỉ nhận các tên trường cho phép, dùng text an toàn của frontend. Có xử lý 400, 401, 403, 409, 413, 429/Retry-After và lỗi hệ thống/mạng.

Browser nhận Set-Cookie từ backend qua Vite và tự giữ cookie HTTP-only; JavaScript không đọc hoặc lưu raw token. Request cùng origin tự mang cookie theo chính sách credentials. Cookie host-only nên sử dụng nhất quán localhost hoặc 127.0.0.1. Production flags/session expiry vẫn do backend Phase 6.2B quản lý. Xem [MDN credentials](https://developer.mozilla.org/en-US/docs/Web/API/Request/credentials).

## Chạy và kiểm tra bằng browser

Từ root, nếu dependencies/client chưa có:

```powershell
cd D:\LearnReact\Cineverse
npm.cmd install
npm.cmd --prefix frontend install
npm.cmd run db:generate
npm.cmd run db:check
npm.cmd run dev
```

Trong phase này không cần migration mới. Mở đúng URL Local mà Vite in ra, thông thường http://localhost:5173. Không mở file index.html trực tiếp. Nếu proxy cũ còn chạy, dừng nó trước để tránh cổng 3001 bận.

Backend mặc định chỉ cho browser Origin localhost:5173/127.0.0.1:5173. Nếu Vite chuyển sang 5174, thêm chính xác origin đó vào AUTH_ALLOWED_ORIGINS trong backend/.env rồi restart backend; không đổi wildcard hoặc bỏ CSRF. Không gửi nội dung env vào chat. Backend thiếu kết nối DB có thể vẫn tải phim nhưng auth báo lỗi phù hợp.

Các bước sau do bạn chủ động thực hiện khi muốn tạo tài khoản thật:

1. Header Đăng nhập → Đăng ký; nhập tên/email/mật khẩu mới và confirm. Thử confirm khác nhau để thấy lỗi local, Hiện/Ẩn và Tab giữa các input.
2. Đăng ký hợp lệ: nhận thông báo ở Login, email điền sẵn và password rỗng. Chưa có session tự động.
3. Đăng nhập với tài khoản đó: Header có tên/avatar, quay về Home hoặc phim đã mở trước đó.
4. Reload: thấy placeholder ngắn khi Me tải, sau đó vẫn nhận diện tài khoản. Mở Movie Details/cast/recommendations vẫn hoạt động.
5. Mở menu bằng Enter/Space, Tab tới Đăng xuất, Escape để đóng hoặc click ngoài. Thử ở 320/390/768px và desktop.
6. Logout: Header trở về Đăng nhập sau 204, vẫn giữ trang phim/search/filter. Reload xác nhận guest.
7. Thử password sai: thông báo chung, email giữ nguyên. Thử đăng ký email trùng: lỗi cạnh email. Nếu thử quá nhiều lần có thể nhận 429; đợi theo Retry-After.
8. DevTools Network: mọi POST có CSRF header, Me 401 khi guest là bình thường, Logout 204 rỗng. Không chia sẻ request payload/password hoặc Cookie headers.
9. DevTools Application: app không ghi token/password vào localStorage/sessionStorage. Cookie HTTP-only không đọc được qua document.cookie; không in cookie/hash để kiểm tra.

Agent không dùng mật khẩu người dùng và không tự tạo tài khoản/session trong database thật. Bộ kiểm thử UI thành công dùng backend thật với database mock; các ca live thật chỉ dùng input không hợp lệ/tài khoản ngẫu nhiên không tồn tại. Bạn cần chạy chu trình tài khoản thật ở trên để xác nhận môi trường local của mình.

## Kết quả kiểm thử

- **109 automated Node tests đạt:** 65 backend cũ + 44 frontend (7 auth mới và 37 cũ).
- Lint, TypeScript source check và production build đạt. Các harness .browser.tsx là dev-only, không nằm trong production build; browser chạy trực tiếp để kiểm tra React behavior.
- Browser UI → Vite → backend native/Argon2 thực với database mock: Register fields/validation/confirm/201/409, Login đúng/sai/duplicate submit/loading/429/network, cookie HTTP-only/reload/Me, Header keyboard/Escape/click outside, Logout 503 giữ user và retry 204, return route/guest-only redirect.
- Responsive 1440/1024/768/390/320, popup nằm trong viewport; search/sort giữ qua Login/Logout, không ghi browser storage và mọi POST có custom header. Đã xem ảnh desktop/mobile để sửa typography và popup.
- Harness Provider: initial Me, StrictMode/abort, Me cũ không ghi đè Login/Logout dù fetch bỏ qua signal, refresh lỗi giữ user, unmount không nhận kết quả cũ.
- Hồi quy browser Phase 5/5.5/5.6 đạt: Home/search/filter/sort/lastUpdated, routing/Back/Forward/direct URL/404/retry/race, compact rows/collapse/focus, cast/director/recommendations/trailer và responsive.
- Live UI qua Vite/backend/TMDB/PostgreSQL thật: Home có phim, Inception chi tiết, Me guest, Login email ngẫu nhiên không tồn tại hiện thông báo 401, Register rỗng qua HTTP trả 400. Số User và Session trước/sau không đổi. Server/browser/pool tạm đều đã đóng.
- Secret scan kiểm tra source/dist và file có thể commit; không đưa credentials thật vào frontend, không sửa env/migration/backend, không commit/push.

Chạy unit/service/regression tests hiện có, không watch:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
```

Browser auth suite tự mở/đóng Node và Vite cổng tạm, dùng database mock, không cần PostgreSQL/TMDB token. Playwright/Edge dùng từ cache có sẵn trong phiên, không thêm dependency. Truyền đường dẫn Playwright của bạn nếu cache khác:

```powershell
node frontend/tests/auth.browser.cjs 'D:\LearnReact\Cineverse\.npm-cache\_npx\e41f203b7505f1fb\node_modules\playwright' --regression
```

Bỏ --regression để chỉ chạy auth UI/Provider. Lưu ý test harness không chứa dữ liệu thật; script test không đọc backend/.env và mọi thao tác đăng ký/session trong suite ghi vào memory mock.

Ảnh kiểm tra cục bộ (ignored): .npm-cache/phase-6.2c-register-desktop.png và phase-6.2c-register-mobile.png. Không coi screenshot là bằng chứng Login thật với tài khoản PostgreSQL.

## Giới hạn và Phase 6.3

Chưa kiểm tra Register/Login thành công bằng credentials thật, HTTPS production hoặc đồng bộ phiên giữa nhiều browser tab. Auth state là kết quả xác nhận gần nhất, không polling; reload/refreshUser kiểm tra lại session nếu hết hạn hoặc bị logout ở nơi khác. Chưa có protected page vì hiện chỉ có các trang phim công khai; quyền truy cập thực vẫn phải do backend kiểm tra khi thêm tính năng riêng tư.

Favorites thực tế chưa có trong source, nên phase này chỉ giữ nguyên nút disabled. Phase 6.3 có thể thiết kế dữ liệu yêu thích theo User, API xác thực và giao diện tương ứng, sau khi làm rõ cách xử lý dữ liệu local nếu được thêm; chưa triển khai trong phase này. Không thêm JWT/OAuth/reset password/MFA hoặc thiết kế lại Cineverse.
