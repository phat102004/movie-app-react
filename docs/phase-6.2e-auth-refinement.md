# Phase 6.2E — Auth UI refinement và password recovery

## Audit và thay đổi có mục đích

Source hiện có đã có Login/Register/Forgot/Reset, AuthProvider, API service, SMTP abstraction và token một lần. Phase này giữ nguyên backend auth, schema/migration, password policy, Origin/CSRF và rate limit. Không sửa `.env`, không tải/cài Mailpit hoặc Docker, không dùng tài khoản thật để reset.

Các nguyên nhân layout:

- `.auth-page` trước đây max-width 1180px, gap tới 112px, đồng thời nhận gutter của page-container. Ở màn hình lớn, khoảng cách giữa phần giới thiệu và form lớn trong khi vùng form thực tế bị hẹp.
- Grid dùng `align-items: start`, nên intro ngắn và form dài không cùng trục giữa.
- Intro có margin 50px sau Back và 54px trước editorial note; heading tới 62px làm chênh lệch thị giác với form.
- App chưa có shell flex-column min-height; footer không được đẩy xuống cuối viewport trên trang ngắn.
- Khi ẩn `<br>` trên mobile, hai phần tiêu đề Register/Login cần khoảng trắng tường minh để không dính chữ.

Layout mới dùng **max-width 1100px**, hai cột **1.13fr / 1fr (~53% / 47%)**, gap **32–56px**, căn giữa theo chiều dọc. Card width 100%, max-width 440px; đo được khoảng 419–430px ở các viewport desktop đã thử. Padding card 24–36px (320/375px dùng 20px ngang), input cao tối thiểu 46px. Heading tối đa 54px, giảm các margin dư.

App thêm site-shell min-height 100vh/100svh + flex column, main flex:1. Chỉ main của bốn route Auth được căn giữa nội dung. Form dài tăng chiều cao trang tự nhiên; không fixed-height, không absolute để căn layout. Dưới 820px chuyển một cột, max-width 520px, thu gọn typography/khoảng cách intro và ẩn editorial note. Focus ring, show/hide, field errors/aria-describedby, loading và validation giữ nguyên.

## Chẩn đoán Forgot Password

Probe backend với cấu hình hiện tại, không đọc User và không gửi email thật, nhận được **HTTP 503 / `EMAIL_UNAVAILABLE`**. Source Phase 6.2D vốn đã có message riêng cho mã này. Thông báo “Dịch vụ tài khoản tạm thời không khả dụng…” trong ảnh không được tái hiện chính xác trên snapshot hiện tại; không khẳng định ảnh có cùng mã lỗi. Tuy nhiên source có đường fallback tạo thông báo chung khi 503 không có mã JSON hợp lệ hoặc khi lỗi hệ thống/account store xảy ra.

Phase 6.2E truyền ngữ cảnh endpoint vào error mapper và phân biệt:

| Phản hồi                       | Trước                                     | Sau trên Forgot                                                        |
| ------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------- |
| 400 VALIDATION_ERROR           | Kiểm tra thông tin chung                  | Nhập email hợp lệ; field error email vẫn giữ                           |
| 429 RATE_LIMITED               | Đã thử quá nhiều lần                      | Đã gửi quá nhiều yêu cầu đặt lại mật khẩu + Retry-After                |
| 503 EMAIL_UNAVAILABLE          | Chưa thể gửi email                        | Chưa thể gửi email, dịch vụ gửi thư chưa sẵn sàng                      |
| 503 không JSON/không mã hợp lệ | Dịch vụ tài khoản tạm thời không khả dụng | Dịch vụ gửi thư chưa sẵn sàng                                          |
| 503 AUTH_UNAVAILABLE           | Dịch vụ tài khoản chung                   | Dịch vụ khôi phục tài khoản chưa sẵn sàng; không quy lỗi DB thành SMTP |
| 500 INTERNAL_ERROR             | Dịch vụ tài khoản chung                   | Hệ thống chưa thể xử lý yêu cầu đặt lại mật khẩu                       |
| Fetch/network lỗi              | Không thể kết nối                         | Không thể kết nối máy chủ, kiểm tra mạng và thử lại                    |
| 200 message hợp lệ             | Thông báo trung lập                       | Giữ nguyên thông báo trung lập                                         |

HTTP status/mã lỗi backend không đổi. Không hiển thị raw errors/response HTML/SMTP credentials; Login/Register/Me/Logout giữ mapper hiện có. Nếu vẫn thấy giao diện cũ, restart `npm.cmd run dev`, tải lại browser và kiểm tra status + `error.code` trong Network; không chụp/chia sẻ payload Reset, password, cookie hoặc reset URL.

## Email delivery hiện tại

- `disabled` hoặc chưa có biến mode: 503 trước khi tra User; không thông báo success.
- `local`: chỉ SMTP loopback, không auth/TLS, cấm production. Mailpit không chạy → Nodemailer từ chối kết nối → 503 EMAIL_UNAVAILABLE; backend vẫn hoạt động. Hash của token vừa tạo được xóa nếu DB khả dụng.
- `smtp`: credentials do người dùng cấu hình trên server, yêu cầu TLS; không thay đổi chế độ này trong phase.

Thành công chỉ khi SMTP chấp nhận người nhận, không khẳng định email đã đến inbox Internet. Giữ chính sách response HTTP chung cho email có/chưa có tài khoản. Với email chưa có tài khoản, chế độ gửi đang có sẽ gửi hướng dẫn kiểm tra địa chỉ, không tạo link giả; chỉ chủ hộp thư thấy nội dung riêng. Rate limit vẫn áp dụng cả hai trường hợp.

Đã kiểm tra PATH, các vị trí cài Windows phổ biến và cổng 1025/8025: **chưa tìm thấy Mailpit có thể chạy hoặc inbox/SMTP đang lắng nghe**. Không tự tải/cài để vượt qua giới hạn người dùng. Do đó **chưa kiểm chứng end-to-end qua Mailpit thật**, SMTP Internet hoặc reset tài khoản thật trong phase này.

## Chạy Mailpit trên Windows

1. Mở [trang cài đặt chính thức](https://mailpit.axllent.org/docs/install/), theo liên kết Releases và tự tải binary Windows phù hợp máy. Giải nén, mở PowerShell trong thư mục chứa mailpit.exe. Không cần cài Docker.
2. Chạy foreground, chỉ bind loopback:

```powershell
.\mailpit.exe --smtp 127.0.0.1:1025 --listen 127.0.0.1:8025 --quiet --disable-version-check
```

Giữ terminal này mở; Ctrl+C để dừng. Không bật forwarding, relay hay verbose/debug. Cờ theo [runtime options chính thức](https://mailpit.axllent.org/docs/configuration/runtime-options/); SMTP mặc định không auth/TLS theo [SMTP docs](https://mailpit.axllent.org/docs/configuration/smtp/).

3. Chỉ sửa các biến email trong **backend/.env bằng editor**, không ghi đè DATABASE_URL/TMDB/credentials hiện có:

```dotenv
PASSWORD_RESET_EMAIL_MODE=local
PUBLIC_APP_ORIGIN=http://localhost:5173
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_FROM=cineverse@localhost.test
SMTP_USER=
SMTP_PASSWORD=
```

Đây là cấu hình catcher local, không phải credentials Internet. `PUBLIC_APP_ORIGIN` phải đúng origin Cineverse đang mở và thuộc `AUTH_ALLOWED_ORIGINS`. Nếu dùng 127.0.0.1 hay Vite đổi cổng, cập nhật cả hai cho khớp. Local mode cần development, không dùng NODE_ENV=production. Giữ `.env` ngoài Git.

4. Terminal khác, từ thư mục gốc:

```powershell
cd D:\LearnReact\Cineverse
npm.cmd run dev
```

Restart sau khi thay `.env`; script chạy backend 3001 và frontend Vite. Mở đúng địa chỉ Local Vite báo. Inbox Mailpit tại `http://127.0.0.1:8025`.

## Checklist thủ công khi Mailpit đã chạy

Dùng **tài khoản test riêng**; không thay mật khẩu tài khoản thật chỉ để kiểm thử. Nếu cần, tự tạo tài khoản test bằng Register và chọn mật khẩu chỉ dùng cho test, không chia sẻ trong chat/report.

1. Login tài khoản test ở hai profile/browser để có hai session cũ.
2. Ở cửa sổ guest, Login → Quên mật khẩu; nhập email test và gửi. Kiểm tra response 200 + thông báo trung lập.
3. Mở inbox Mailpit, mở đúng thư mới nhất và nhấn link. Không chụp/sao chép raw reset link vào báo cáo.
4. Reset mở, fragment bị xóa khỏi thanh địa chỉ. Nhập mật khẩu mới/confirm giống nhau, 12–128 ký tự, gửi và xem thông báo thành công.
5. Trong hai profile cũ, reload rồi kiểm tra Header/Me đã thành guest; session cũ bị server thu hồi.
6. Ở guest, mật khẩu cũ bị Login từ chối; mật khẩu mới Login thành công. Reset không tự đăng nhập.
7. Mở lại link đã dùng và gửi form: bị từ chối, có Link yêu cầu mới. Link sai cũng bị từ chối. Link chưa dùng sau 20 phút hết hạn; không sửa giờ hệ thống để thử.
8. Xin link mới hai lần trong giới hạn rate: chỉ link mới nhất dùng được. Không gửi liên tục để tránh 429 (3/email và 10/IP/15 phút).
9. Thử email chưa đăng ký: HTTP/UI cùng thông báo trung lập; thư trong inbox đó không có reset link giả.
10. Dừng Mailpit bằng Ctrl+C rồi thử Forgot: thấy lỗi gửi thư chưa sẵn sàng, không success. Cineverse vẫn mở Home/Details/Search được. Restart Mailpit để thử lại sau khi hết rate limit.
11. Kiểm tra cả bốn form ở 320/375/768/1024/1440/1920px; dùng Tab/Shift+Tab/Enter để di chuyển, hiện/ẩn và gửi form. Footer phải ở sau nội dung, không che nút submit.

Nếu chưa có Mailpit/provider hoạt động, **gửi email và lấy link Reset qua inbox chưa hoạt động**; form/layout và thông báo lỗi vẫn dùng được. Không có token in terminal hoặc link demo thay thế.

## File thay đổi

| File                                          | Thay đổi                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| frontend/src/components/Auth.css              | grid 53/47, card/gap/padding/typography/mobile/focus và wrapping message                     |
| frontend/src/index.css                        | shell flex-column/min-height, main phát triển tự nhiên                                       |
| frontend/src/App.tsx                          | class shell và auth-main theo route; giữ hook/state/router hiện có                           |
| frontend/src/components/AuthForm.tsx          | khoảng trắng tiêu đề khi ẩn line break trên mobile                                           |
| frontend/src/services/auth.ts                 | contextual Forgot error mapping, network message; không đổi API/CSRF                         |
| frontend/tests/passwordRecovery.test.ts       | phân biệt status/code/503 không JSON/network và giữ Login cũ                                 |
| backend/tests/password-reset.test.mjs         | Nodemailer thực gặp loopback connection refused; 503/hash cleanup/backend sống/known-unknown |
| frontend/tests/authLayout.browser.cjs **mới** | ma trận 24 layout, footer/align/card/overflow, keyboard, errors và native SMTP refused       |
| frontend/tests/auth.browser.cjs               | không in stack Playwright có thể kèm URL/input nhạy cảm                                      |
| README.md                                     | trạng thái hiện tại, link hướng dẫn mới                                                      |
| docs/phase-6.2e-auth-refinement.md **mới**    | audit, cấu hình Windows, checklist và giới hạn                                               |

Không đổi backend auth runtime, Prisma schema/migration, Vite, AuthProvider, LoginPage/RegisterPage/ForgotPasswordPage/ResetPasswordPage hoặc `.env.example` vì các phần này đã có cấu hình/flow đúng. Các page tự nhận layout qua CSS dùng chung. Không thêm dependency.

## Kiểm thử

Kết quả thực tế trong phiên triển khai:

| Kiểm tra | Kết quả |
| --- | --- |
| npm test | **134 đạt**: 84 backend + 50 frontend; 0 fail/skip |
| Lint / TypeScript / production build | Đạt |
| Auth layout trên Edge | Đạt: 4 trang × 320/375/768/1024/1440/1920px, card 400–440px trên desktop, tỷ lệ 53/47, căn giữa, footer/scroll/không clipping/overflow |
| Keyboard và trạng thái form | Đạt: focus ring, Tab/Enter/show-hide/validation/aria-describedby, lỗi và thông báo success trung lập |
| SMTP disabled/refused | Đạt: native Node + Nodemailer, 503 EMAIL_UNAVAILABLE, không success, không token hash gửi lỗi còn lại; backend tiếp tục phục vụ |
| Auth/recovery browser regression | Đạt: Register/Login/Me/Logout, AuthProvider race/abort, Forgot → Reset → Login, token dùng lại, thu hồi session, no token storage/referrer |
| Home/Details/Search/compact/cast browser regression | Đạt, gồm filter/sort/lastUpdated/Back/Forward/refresh/404/Retry/trailer/related |
| Secret scan | Không phát hiện secrets đã cấu hình trong file có thể commit/dist; frontend không import Prisma/config secrets server |
| Mailpit thật / Internet SMTP / reset account thật | **Chưa thực hiện**; không đánh đồng mock/catcher giả lập với Mailpit |

Đã xem ảnh Login desktop 1920px và Register mobile 320px. Ảnh các form trống nằm tại `.npm-cache/phase-6.2e-{login,register,forgot-password,reset-password}-{320,1920}.png` (ignore, không chứa password/token/cookie). API/Vite/browser do script mở đã được đóng. Không thêm dependency, không sửa môi trường/database/migration.

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
node frontend/tests/authLayout.browser.cjs <duong-dan-package-playwright>
node frontend/tests/auth.browser.cjs <duong-dan-package-playwright> --regression
```

Browser dùng Playwright cache sẵn với Edge headless; API/Vite tự mở ở port tạm và đóng trong finally. Database chỉ mock; không gửi email Internet. Script layout chụp các form còn trống, không chụp password/token/cookie. Hình nằm trong .npm-cache (ignore). Lỗi Playwright không in stack có thể chứa reset URL hoặc input.

Các loại kiểm chứng được phân biệt:

- **Native HTTP + SMTP refused:** backend thật, Nodemailer thật, cổng loopback không lắng nghe, database mock. Chứng minh lỗi connection refused được xử lý; không gọi đây là Mailpit thật.
- **SMTP success integration:** test Phase 6.2D dùng Nodemailer thật + SMTP catcher giả lập trong test, không phải Mailpit.
- **Positive recovery browser:** dùng native Node/Argon2/cookie và DB/email mock; chứng minh token/đổi mật khẩu/session/UI, không chứng minh giao thư qua Mailpit.
- **Layout/error browser:** bốn page × sáu viewport, tỷ lệ/căn giữa/kích thước form, footer/scroll/không clipping, focus/keyboard/validation; disabled/refused qua backend thật, các status còn lại qua response fixture.
- **Regression:** Home/Search/filter/Details/navigation và các auth/token tests hiện có.

Chưa có xác minh Mailpit inbox/link thật hoặc SMTP Internet. Phần này cần người dùng thiết lập theo checklist trên; không tự reset account thật.

Dừng tại Phase 6.2E.
