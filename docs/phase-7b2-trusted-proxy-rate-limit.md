# Phase 7B.2 — Trusted Proxy & Rate Limit Security

Ngày kiểm tra: **28/10/2026**. Giữ nguyên bảo vệ multi-tab của Phase 7B.1.

## 1. Nguyên nhân gốc và phạm vi

Backend dùng `node:http`, không phải Express. Trước đây Register, Login,
Forgot/Reset Password, Change Password, Profile và Favorites đều dùng trực tiếp
`request.socket.remoteAddress` làm khóa quota IP. Cách này chống được XFF giả từ
client trực tiếp, nhưng sau reverse proxy mọi người dùng có cùng IP socket của
proxy. Audit H02 tái hiện request Login thứ 21 bị 429 dù có 21 client fixture khác nhau.

Thay đổi lần này chỉ thêm chính sách xác định IP dùng chung và truyền chính sách
vào các route đã có limiter. Không sửa React, TMDB, session/cookie flags,
CSRF/Origin, account binding, Prisma schema/migrations hay dữ liệu PostgreSQL.
Không cài dependency, bật proxy trust, deploy, commit hoặc push.

## 2. Những file thay đổi

| File | Trách nhiệm |
| --- | --- |
| `backend/client-ip.mjs` (mới) | Parse/chuẩn hóa IP, compile allowlist IP/CIDR, duyệt chuỗi XFF theo trust boundary, fallback bảo thủ. |
| `backend/server.mjs` | Đọc cấu hình lúc tạo server, compile một resolver rồi inject cùng resolver vào các nhóm route. Cấu hình lỗi chặn khởi động. |
| `backend/auth/register-route.mjs` | Sử dụng resolver cho quota Register. |
| `backend/auth/session-routes.mjs` | Sử dụng resolver cho quota IP Login; không đổi Me/Logout/account binding. |
| `backend/auth/password-reset-routes.mjs` | Sử dụng resolver cho quota IP Forgot/Reset. |
| `backend/profile/change-password-routes.mjs` | Sử dụng resolver cho quota IP Change Password. |
| `backend/profile/profile-routes.mjs` | Sử dụng resolver cho quota IP GET/PATCH Profile. |
| `backend/favorites/favorite-routes.mjs` | Sử dụng resolver cho quota IP GET/POST/DELETE Favorites. |
| `backend/auth/rate-limit.mjs` | Cập nhật comment theo nguồn IP mới; thuật toán/quota không đổi. |
| `backend/.env.example` | Thêm cấu hình **rỗng** và hướng dẫn opt-in; giữ nguyên giá trị cấu hình mẫu cũ, dọn một dòng trắng có trailing space. |
| `backend/tests/client-ip.test.mjs` (mới) | Unit tests parser, CIDR, canonical keys, config, fallback và quota. |
| `backend/tests/trusted-proxy-rate-limit.test.mjs` (mới) | Native HTTP integration cho từng nhóm route, spoofing, ingress thật và security regression. |
| `docs/phase-7b2-trusted-proxy-rate-limit.md` (mới) | Thiết kế, cấu hình, bằng chứng kiểm thử và giới hạn vận hành. |

Tài liệu Phase 7A đã tồn tại dưới dạng untracked trước khi bắt đầu; không sửa nó.
`backend/.env` thật không bị đọc/hiển thị để sửa cấu hình proxy và không bị chỉnh sửa.
Lệnh kiểm tra database sử dụng cấu hình local hiện hữu theo guard của dự án.

## 3. Thuật toán xác định IP

1. Parse IP từ **TCP socket thực** bằng `node:net.isIP`. Socket thiếu/sai định dạng
   nhận khóa cố định `unknown`, vẫn phải qua limiter.
2. Chuẩn hóa IPv4 thành dotted-decimal, IPv6 thành 8 nhóm hex chữ thường, bỏ số 0
   thừa trong từng nhóm. `::ffff:192.0.2.1` và `::ffff:c000:201` cùng khóa
   `192.0.2.1`. IPv6 thường có cùng giá trị cũng chỉ có một khóa dù viết khác nhau.
3. Nếu socket không thuộc allowlist trusted proxy, **bỏ qua toàn bộ forwarding
   headers**. Không có cấu hình cũng đi qua nhánh này, kể cả socket loopback.
4. Chỉ khi socket được tin cậy, đọc duy nhất `X-Forwarded-For`. Không sử dụng
   `Forwarded`, `X-Real-IP`, `Host`, số hop cố định hoặc IP do payload khai báo.
5. XFF thiếu/sai định dạng/quá 4096 ký tự/quá 32 hop/trùng nhiều raw header fields
   đều quay về **IP socket chuẩn hóa**. Toàn bộ chain phải hợp lệ; một hop sai
   không được bỏ qua để tiếp tục tìm một địa chỉ thuận lợi hơn.
6. Bắt đầu tại socket, xét XFF từ **phải sang trái**. Chỉ bước sang hop tiếp theo
   nếu hop hiện tại còn được tin cậy. Dừng ngay tại địa chỉ đầu tiên không tin
   cậy. Bỏ qua các địa chỉ bên trái nó dù có vẻ hợp lệ.
7. Nếu mọi hop đều được tin cậy, lấy hop ngoài cùng bên trái còn lại. Không có
   chain hợp lệ thì giữ socket. Không có đường đi nào bỏ qua rate limiting.

Ví dụ, backend trust `127.0.0.1` và `10.0.0.0/24`:

```text
TCP peer: 127.0.0.1
XFF:      203.0.113.99, 198.51.100.2, 10.0.0.7
Kết quả:  198.51.100.2
```

`203.0.113.99` có thể do client tự chèn; không được chọn. Nếu peer là
`198.51.100.2` thì chính IP socket này được dùng, không đọc XFF.

Không nhận IPv4 shorthand/leading-zero/hex, hostname, IP kèm port, IPv6 có ngoặc,
zone ID `%eth0`, dấu nháy hoặc cú pháp `for=...`. Với scoped socket IPv6 không
được hỗ trợ, fallback `unknown`; không tin XFF thay cho socket lỗi.

Fallback có thể gộp quota của những request header lỗi qua cùng proxy. Đây là
lựa chọn fail-closed: không dùng chuỗi header lỗi làm khóa và không phát sinh
vô hạn quota theo nội dung client tự gửi. Không cam kết chống DoS chỉ bằng fallback.

## 4. Trusted proxy configuration

Mặc định trong `.env.example`:

```dotenv
TRUSTED_PROXY_CIDRS=
```

Không bật tự động theo `NODE_ENV`, việc có XFF hay việc socket là loopback.
Biến này được đọc từ môi trường backend; startup hiện tại load `.env` qua
`backend/env.mjs`. Cần restart backend sau khi đổi cấu hình.

Chỉ sau khi xác minh reverse proxy cùng máy ghi đè header đúng, có thể đặt:

```dotenv
TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128
```

Ví dụ minh họa mạng proxy riêng, **không phải IP hosting đã xác minh**:

```dotenv
TRUSTED_PROXY_CIDRS=10.20.30.4/32,2001:db8:1234::4/128
```

Ưu tiên IP cụ thể `/32` hoặc `/128`; chỉ dùng CIDR nếu toàn bộ subnet thực sự
thuộc quyền kiểm soát của các proxy đáng tin. Danh sách phân cách bằng dấu phẩy,
tối đa 64 mục/8192 ký tự; cho phép khoảng trắng quanh từng mục. Không DNS lookup.
CIDR có host bits được mask về network. IPv4-mapped CIDR `/96…128` quy đổi về
IPv4 `/0…32`; `/0` sau quy đổi vẫn bị từ chối. Ví dụ `::ffff:10.0.0.0/120`
tương đương `10.0.0.0/24`. Để trust IPv4 hãy dùng rule IPv4 rõ ràng; rule IPv6
thông thường không tự trust IPv4 đã được chuẩn hóa.

Từ chối `true`, `*`, hostname, port, CIDR sai, `/0` và danh sách kết hợp phủ toàn
bộ IPv4 hoặc IPv6. Lỗi cấu hình trả thông báo chung không echo giá trị cấu hình.
Không cấu hình trust-all dưới bất kỳ tên gọi nào.

## 5. Rate limit behavior giữ nguyên

Mọi window vẫn **15 phút**, fixed-window tính từ request đầu của khóa; không
phải sliding-window. Các quota tính lượt thử theo thứ tự route hiện có, không
chỉ đếm lần đăng nhập thất bại.

| Endpoint | Quota IP/window | Quota bổ sung/window |
| --- | --- | --- |
| POST Register | 5 | Global hash concurrency 2 |
| POST Login | 20 | 10/email (khóa HMAC, không lưu email thuần trong limiter), concurrency 2 |
| POST Forgot Password | 10 | 3/email, concurrency 2 dùng chung Reset |
| POST Reset Password | 20 | Concurrency 2 dùng chung Forgot |
| POST Change Password | 10 | 5/user, concurrency 2 |
| GET/PATCH Profile | 300 chung | 30/user cho PATCH |
| GET/POST/DELETE Favorites | 300 chung | 120/user cho POST/DELETE |

Các Map vẫn tối đa 10.000 entries mỗi limiter; khi đầy, thu dọn entry hết hạn
và từ chối khóa mới nếu vẫn đầy. Không evict quota đang sống để tạo cơ hội bypass.
Rate-limited response giữ **429**, JSON `error.code = RATE_LIMITED`,
`Retry-After` số giây dương và `Cache-Control: no-store`.
Các mã busy/concurrency hiện hữu không đổi.

Quota theo email/user không phụ thuộc IP; thay IP hợp lệ không xóa quota này.
Me và Logout trước đây không có quota riêng, phase này không tự thêm.
IP client chỉ dùng cho limiter, **không** quyết định user, origin HTTPS, cookie
Secure, authorization hay account binding. Session vẫn lấy từ cookie thật và
`X-Cineverse-Account` vẫn phải khớp user được backend xác thực.

## 6. Hướng dẫn production deployment

### Một reverse proxy ở edge, cùng máy backend

Đây là **đoạn cấu hình tham khảo**, không được tự áp dụng lên hosting:

```nginx
# Trong HTTPS server block đã cấu hình TLS đúng:
location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header Forwarded "";
    proxy_set_header X-Real-IP "";
}
```

Edge phải **ghi đè** XFF từ Internet bằng địa chỉ peer nó thật sự quan sát được.
Không dùng nguyên `$http_x_forwarded_for`. Nếu Nginx có realip module, cần audit
chính sách `set_real_ip_from`/nguồn `$remote_addr` của Nginx trước: cấu hình sai ở
edge vẫn có thể tạo header giả dù backend có allowlist.

Sau đó mới opt-in IP socket của proxy trong `TRUSTED_PROXY_CIDRS`. Giữ backend
loopback-only như hiện tại khi cùng máy. Backend port không được public trực tiếp.
Vẫn phải cấu hình `NODE_ENV=production`, HTTPS origins cụ thể và same-origin `/api`
theo auth policy hiện hữu; tin proxy không thay thế các bước đó.

### Nhiều proxy/CDN/load balancer

- Public ingress xóa/ghi đè XFF do Internet gửi. Proxy nội bộ tiếp theo append
  **peer thực mà nó quan sát**, sau chain đã được làm sạch.
- Backend trust đúng IP/CIDR của các hop proxy thuộc quyền kiểm soát; không trust
  cả mạng khách hàng, cả private network hoặc provider ranges chưa xác minh.
- Hạn chế ingress bằng firewall/network policy. Một máy không tin cậy có thể
  kết nối từ subnet đã trust thì có thể giả địa chỉ client.
- Nếu một hop không trust, thuật toán dừng ở đó; người dùng sau hop đó chia quota.
  Không sửa bằng cách lấy XFF đầu tiên hoặc bật trust-all. Sửa topology/config.
- Với provider đặt header riêng, cấu hình ingress đã xác minh để chuyển thành XFF
  sạch. Backend không tự nhận header provider hoặc tự tải danh sách IP provider.

Vite dev/preview hiện chỉ proxy `/api`, **không phải mẫu production ingress có
header policy đã xác minh**. Để cấu hình rỗng khi phát triển mặc định. Không bật
trust loopback cho Vite rồi tin header client tự gửi. Không sửa Vite/UI trong phase này.

### Checklist kiểm chứng trên staging

1. Kiểm tra network path thực, socket proxy và header policy từng hop.
2. Hai client có IP khác nhau qua ingress phải có quota độc lập; client A vượt
   quota vẫn không khóa B theo IP. Account quota có thể cố ý chặn cả hai nếu cùng email.
3. Client đổi XFF/Forwarded/X-Real-IP không tạo quota mới; request tới backend
   từ peer không trust không được chọn IP header.
4. Kiểm tra 429/Retry-After, session/CSRF/Origin và regression multi-tab qua HTTPS.
5. Không log cookie/token/password hoặc toàn bộ header; nếu cần quan sát IP,
   áp dụng quyền truy cập, redaction và retention thích hợp.

Chưa có hosting/topology production được xác minh ở phase này. Backend vẫn listen
`127.0.0.1:3001`; không tự đổi listen address, database guard hoặc triển khai container.

## 7. Tests và bằng chứng

Tests mới chạy hoàn toàn trên HTTP loopback + RAM service fixtures. Một bài dùng
reverse proxy `node:http` thật để xác nhận ingress overwrite XFF. Không dùng IP
khách hàng thật, hash account thật, gửi email thật hoặc gọi TMDB ngoài mạng.

Coverage mới gồm socket-only, direct spoof, trusted/multi-hop/untrusted boundary,
IPv4/IPv6/mapped normalization, CIDR boundaries `/25` và `/65`, config environment,
config invalid/trust-all, malformed/duplicate/oversized headers, missing socket,
quota A/B, prefix spoof, account/user quotas, 429 convention và bảo vệ auth.
Regression H02 gửi 21 client/IP/email khác nhau qua trusted proxy: cả 21 đi tới
Login fixture thay vì bị IP quota gộp ở lượt 21. Trường hợp không cấu hình trust
vẫn bị 429 khi xoay 21 header giả trên cùng socket.

Kết quả thực tế:

| Kiểm tra | Kết quả |
| --- | --- |
| `npm.cmd test` | **332/332 pass**: backend 229, frontend 103; 0 fail/skip/cancelled. Gồm 32 tests mới của phase này. |
| Lint | Pass, Oxlint theo script thực tế. |
| TypeScript | Pass, `tsc -b --force`. |
| Production build | Pass, Vite 8.3.4, 94 modules; không đổi React/CSS. |
| `db:validate` | Pass, Prisma schema hợp lệ. |
| `db:check` | Pass, PostgreSQL 17.11; chỉ đọc metadata/count, không đọc giá trị token/cookie hay sửa dữ liệu. |
| Multi-tab auth browser | **22 nhóm checkpoint pass**, gồm missed signals, cookie đổi giữa Me/POST, stale responses và không ghi nhầm B. |
| Auth browser `--regression` | Pass: Auth/Recovery/AuthProvider, Router/Details, compact layout và cast. |
| Favorites browser | **12 nhóm checkpoint pass**. |
| Profile browser | **10 nhóm checkpoint pass**. |
| Change Password browser | **7 nhóm checkpoint pass**. |
| `git diff --check` | Pass. |

Browser regression chạy với policy mặc định socket-only; các HTTP integration mới
chạy cả socket-only và explicit trusted-proxy policy. Không tuyên bố đã thử proxy
hosting thật, HTTPS staging, Nginx live hoặc distributed limiter.

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run db:validate
npm.cmd run db:check

$playwrightPath = 'D:\LearnReact\Cineverse\.npm-cache\_npx\e41f203b7505f1fb\node_modules\playwright'
node frontend/tests/multitabAuth.browser.cjs $playwrightPath
node frontend/tests/auth.browser.cjs $playwrightPath --regression
node frontend/tests/favorites.browser.cjs $playwrightPath
node frontend/tests/profile.browser.cjs $playwrightPath
node frontend/tests/changePassword.browser.cjs $playwrightPath
```

Path Playwright trên là cache hiện hữu trong máy kiểm thử, không phải dependency
được phase này cài thêm. Browser suites dùng Edge headless và fixture accounts
riêng. Logs kiểm thử ở `.npm-cache/phase-7b2-*` được ignore.

## 8. Giới hạn và lưu ý bảo mật

- Limiter vẫn **in-memory, một process**: restart xóa quota; nhiều workers/instances
  có quota riêng. Sticky sessions không tạo quota toàn hệ thống. Trước scale-out
  cần thiết kế store chung/edge limiter tương đương, cùng key/window và fail policy;
  không tự thêm Redis hoặc tuyên bố distributed rate limit đã được giải quyết.
- Fixed-window cho phép burst ở ranh giới window; NAT chia một IP, IPv6 privacy
  addresses hoặc IP thật thay đổi có thể tạo khóa mới. Account/user caps vẫn giữ.
  Chưa thêm subnet-based IPv6 quota vì đó là thay đổi chính sách riêng.
- Trusted proxy được quyền khẳng định IP. Allowlist đúng nhưng proxy không sanitize
  header vẫn không an toàn; cần cấu hình cả hai lớp. Không dựa vào sự có mặt XFF.
- Parser có bounds; malformed XFF dùng socket quota, có thể khiến nhóm request lỗi
  sau cùng proxy bị gộp. Không dùng header lỗi/port/zone làm quota keys.
- Giữ giới hạn bộ nhớ và concurrency hiện hữu; không xử lý H03 (TMDB resource
  controls), H04 (DB privileges) hoặc các finding khác trong task này.
- Không thay đổi giới hạn in-flight request/revoke đã ghi trong Phase 7B.1.

## 9. Tài liệu chính thức đối chiếu

- [Node.js net.isIP](https://nodejs.org/api/net.html#netisipinput): xác minh định dạng
  IPv4/IPv6 trước khi chuyển đổi số/canonical key.
- [NGINX realip recursive](https://nginx.org/en/docs/http/ngx_http_realip_module.html#real_ip_recursive):
  nguyên tắc chọn địa chỉ không tin cậy gần proxy nhất khi duyệt chuỗi proxy.
- [NGINX proxy_set_header](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header):
  ghi đè/xóa headers tại reverse proxy. Cấu hình ví dụ cần được kiểm chứng theo topology thật.
