# Phase 7C — CI & production readiness

Ngày thực hiện: **29/10/2026**, baseline `8963813`. Không deploy, tạo release,
reset PostgreSQL hoặc sửa credentials thật. Commit/push được thực hiện theo yêu cầu
publication riêng; bằng chứng GitHub Actions ở mục 8. Tài liệu 7A/7B là snapshot lịch sử;
đọc trạng thái M04 hiện tại ở mục 8 bên dưới.

## 1. Kiến trúc CI

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
Triggers: mọi `pull_request` và `push` vào `main`; không `pull_request_target`,
không workflow deploy. Job cũ cùng PR/ref được cancel khi có revision mới.

| Job | Môi trường | Các bước bắt buộc |
| --- | --- | --- |
| Quality and browser regression | Ubuntu 24.04, Node từ `.node-version` | Checkout → npm ci root/frontend → generate Prisma → actionlint → cài Chromium/OS dependencies → `npm run check` |
| PostgreSQL 17 native concurrency and least privilege | Ubuntu 24.04 + PostgreSQL service riêng | Checkout → npm ci root → generate Prisma → `npm run test:postgres`, gồm migrations/history/drift, roles/ACL và native transaction tests |

`npm run check` tái sử dụng gate Phase 7B.5: backend/frontend automated tests,
Oxlint, TypeScript, production build, Prisma validation, toàn bộ browser regression.
Không tạo lại một runner browser khác. Native tests chạy riêng, không âm thầm
skip trong `npm test` khi thiếu database.

### Versions và supply chain

- Compatibility engine hiện hữu: Node **>=22.18.0**; CI pin **22.23.4** trong
  `.node-version`, là bản 22.x security release đã đối chiếu nguồn chính thức.
  Không thay Node đã cài toàn hệ thống trên máy developer.
- PostgreSQL **17.11-bookworm**, Docker Official Image pin digest
  `sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5`.
  Native local sử dụng PostgreSQL 17.11 binaries có sẵn; fixture từ chối major khác 17.
- Checkout **v7.0.1** và setup-node **v7.1.0** pin full commit SHA trong workflow;
  SHA được đối chiếu release và remote tags chính thức. Pin action không thay
  Node của app: action runtime và `.node-version` là hai việc riêng.
- Actionlint **1.7.12** pin SHA-256 binary; dependencies/npm/Prisma/Playwright giữ
  nguyên versions và integrity từ hai lockfiles. Không thêm package dependency.
- Ubuntu runner image vẫn được GitHub cập nhật; đây không phải môi trường bit-for-bit
  bất biến. Khi cập nhật pin, dùng PR và chạy lại cả hai jobs.

## 2. Permissions và secrets

- Workflow chỉ cấp `contents: read`, các permissions khác không được mở rộng.
- Checkout `persist-credentials: false`; setup-node tắt package-manager cache.
  Không dùng shared dependency cache hoặc upload screenshots/logs/HAR.
- Không tham chiếu repository/production secrets, OIDC, environments có quyền
  deploy, PAT hay credentials database thật. Không nội suy PR title/body vào shell.
- Service dùng bootstrap password **synthetic/public chỉ cho test**, không phải
  secret production. Runtime/migrator có test passwords riêng, không lấy từ `.env`.
- Test runner xóa fallback DATABASE_URL/MIGRATION_DATABASE_URL và các thông tin
  TMDB/SMTP trước khi gọi native tests. Khi lỗi, chỉ in tên test/summary an toàn,
  không dump native driver exception chứa DSN/SQL params/session token.
- CI không truy cập được `cineverse_dev` trên máy người dùng. Không chạy production
  provisioning/deployment script hoặc tự sửa chính sách CSRF/Origin để tests xanh.

## 3. PostgreSQL native strategy

### Ranh giới an toàn trước DDL

Config riêng: [`backend/integration/config.mjs`](../backend/integration/config.mjs).
Không gọi `loadBackendEnv()`; không có fallback từ DATABASE_URL.

Chỉ chấp nhận:

1. `CINEVERSE_NATIVE_TESTS=allow-isolated-native-tests`.
2. `CINEVERSE_CI_DATABASE_URL` dùng `postgresql://`, host đúng `127.0.0.1`, port
   explicit 1024–65535 và **khác 5432**, database đúng `cineverse_ci`.
3. Role đúng `cineverse_ci_bootstrap`, password có prefix disposable `ci-ephemeral-`;
   URL không nhận query/fragment hoặc host override do caller chỉ định.
4. Sau kết nối, xác minh actual database/user/server port/major version; inventory
   cluster chỉ gồm `cineverse_ci`, `postgres`, `template0`, `template1`, chưa có
   application objects hoặc roles ngoài bootstrap/built-ins.
5. Server có marker `cluster_name=cineverse_native_disposable` được đặt từ initdb;
   thiếu marker thì không bootstrap, dù các giá trị URL có vẻ đúng.

Docker NAT: URL luôn dùng cổng publish ngẫu nhiên trên runner, khác 5432. Biến test
`CINEVERSE_CI_SERVER_PORT=5432` chỉ mô tả cổng PostgreSQL báo bên trong container để
kiểm tra metadata; không đổi host/port kết nối hoặc cho phép URL host :5432.
Local helper tự đặt giá trị này theo cổng cluster mới. Lỗi so sánh hai loại cổng
đã được tái hiện bằng TCP forwarding và sửa trước publication; marker, role và
inventory guards giữ nguyên.

Nếu không khớp, dừng **trước bootstrap DDL**. Suite không reset hoặc tự sửa
database đã tồn tại. Test chạy lại trên cùng DB có objects sẽ bị từ chối; cần một
service/cluster disposable mới. Tên database/opt-in đơn lẻ không là bằng chứng
isolated; inventory thực được kiểm tra thêm.

### Bootstrap, migrator và runtime là ba vai trò khác nhau

- Bootstrap role là admin của **cluster test riêng**, chỉ dùng tạo roles/grants
  và quan sát metadata/lock waits. Không dùng role này để chạy business services.
- Fixture tái sử dụng phần SQL đã review trong `production-roles.sql` và
  `production-runtime-grants.sql`; chỉ đổi identifier database cố định thành
  `cineverse_ci`. Guard psql production không bị nới để nhận test target.
- Chỉ trong cluster đã xác minh riêng, bootstrap thu hồi PUBLIC CONNECT/TEMP ở
  các database mặc định khác để test rule `otherDatabaseConnect=false`.
- Migrator `cineverse_migrator` không superuser/CREATEDB/CREATEROLE; chạy **Prisma
  migrate deploy** với config test riêng, bốn migration không đổi, chạy lại deploy
  để xác minh idempotence, đối chiếu checksum/history và migrate diff không drift.
- Runtime `cineverse_app` là login thật, không SET ROLE từ admin; chỉ có CRUD trên
  bốn bảng ứng dụng. Hai Prisma clients có pools độc lập, cùng `createDatabaseClient`
  và **PrismaPg adapter** như ứng dụng. Các service nhận getClient test qua dependency
  injection, không gọi singleton có thể tải `.env` developer.
- Test target không phải production: factory nhận test config `production:false`;
  ACL thực được inspect/test trực tiếp. Guard `validateProductionRole` vẫn từ chối
  `cineverse_ci`. Không giả đổi database trong metadata để báo production identity pass.
- TLS tắt **chỉ cho loopback disposable fixture**. Không sửa production TLS strict
  hoặc tuyên bố fixture chứng minh TLS/CA/hostname staging thật.

Prisma CLI test URL luôn thêm `schema=public`. Lượt chạy đầu thiếu tham số này làm
Prisma thử tạo migration history trong schema đầu của search_path và bị từ chối.
Production URL đã bắt buộc `schema=public`; chỉ config CI mới cần được sửa.

### Native regression scenarios

File: [`backend/integration/native.test.mjs`](../backend/integration/native.test.mjs).

- Migration/history/checksum/drift và các backend PID/role độc lập.
- Runtime không DDL/TRUNCATE/đọc migration history/CREATE DATABASE/SET ROLE migrator.
- Tám session creations đồng thời vẫn giữ tối đa năm sessions nhờ User row lock.
- Concurrent Favorite duplicate writes chỉ tạo một row, idempotent 200/201 và owner B
  cùng movie ID không bị ảnh hưởng.
- Profile updates hai owner đồng thời; request mới dùng session đã revoke bị từ chối
  ngay trong SQL update predicate.
- Logout thực sự chờ Session row lock; test quan sát **pg_blocking_pids**, không chỉ
  sleep rồi suy đoán có concurrency.
- Logout khi password hashing đang chờ khiến transaction recheck thất bại.
- Hai Change Password dùng cùng credentials cũ: một commit, một 401; sessions/reset
  tokens A bị thu hồi, B giữ nguyên.
- Failure được chèn giữa transaction: rollback khôi phục password/session/reset token,
  giữ Favorites. Database/transaction là PostgreSQL native, không Promise queue.
- Reset token dùng một lần với hai requests đồng thời: chỉ một lần thành công.
- Native HTTP + PostgreSQL POST/DELETE Favorite in-flight sau Logout: giữ semantics
  M03 đã được người dùng chấp nhận, luôn scope A, không ảnh hưởng Favorite cùng ID của B.
- Bootstrap lần hai từ chối DB không rỗng trước DDL, không mất records hiện hữu.

Profile test không tuyên bố strict revocation cho một UPDATE đã bắt đầu trước Logout.
Session predicate được kiểm chứng cho request mới sau revoke; snapshot/ordering khác
cần thêm policy/test nếu sản phẩm đòi hủy mọi write đã được chấp nhận.

## 4. Scripts và chạy local an toàn

Giữ nguyên `test`, `check`, `test:browser`, `db:validate`, `db:check`. Thêm:

| Script | Trách nhiệm |
| --- | --- |
| `test:postgres` | Bắt buộc config/opt-in, chạy native suite; thiếu config trả exit 1, không skip |
| `test:postgres:local` | Tạo cluster mới bằng PostgreSQL binaries đã chỉ định, cổng tạm, chạy native gate rồi dừng đúng cluster đó |
| `check:production-config` | Offline gate, đọc environment được inject rõ ràng, không tự đọc `.env`, không kết nối/deploy |

Từ root trên Windows (PostgreSQL 17 binaries phải có sẵn):

```powershell
npm.cmd ci
npm.cmd --prefix frontend ci
npm.cmd run db:generate
$env:CINEVERSE_PG_BIN = 'C:\Program Files\PostgreSQL\17\bin'
npm.cmd run test:postgres:local
npm.cmd run check
# Đọc metadata local đã cấu hình, không DML/DDL:
npm.cmd run db:check
```

Native local helper không cần quyền admin database người dùng; nó initdb vào
`.npm-cache/cineverse-native-*`, không dùng cổng 5432 hoặc database hiện hữu.
Process mở ẩn, stop bằng pg_ctl trên đúng data directory vừa tạo, kể cả launch
timeout sau khi server đã khởi động. Không recursive delete; artifacts test còn
trong cache đã ignore. Linux có thể dùng cùng script với CINEVERSE_PG_BIN trỏ đến
bin directory PostgreSQL 17, dưới user không phải root.

## 5. Clean checkout verification

CI thực dùng checkout + npm ci, không copy node_modules, `.env`, generated Prisma,
dist hoặc fixture chỉ có trong cache. Generate là bước explicit bắt buộc trước tests.

Local verification dùng **source snapshot sạch của tracked + các file mới đang
chờ commit**, không phải tuyên bố đã checkout một commit Phase 7C có trên GitHub.
Export kiểm tra không có `.env` thật/node_modules/generated/dist trước install;
npm dùng user/global config rỗng và public registry, Node 22.23.4 binary đã xác minh
SHA-256 từ nguồn Node chính thức. Cài cả hai lockfile và generate Prisma mới.
Snapshot có Git root riêng để không kế thừa ignore rule của repo cha: lần thử đầu
đặt trong cache mà chưa có Git boundary khiến Oxlint báo không có file để lint.
Đây là vấn đề môi trường export; không thêm --no-ignore hoặc thay lint để che lỗi.

Sau đó chạy lại quality gate và native test trên snapshot này. Mọi helper phục vụ
CI nằm trong source repository (`scripts/`, `backend/integration/`), không tham chiếu
đường dẫn `.npm-cache` để lấy fixture/dependency. Cache chỉ chứa kết quả local/probes.
Files Phase 7C đã được commit/push theo tác vụ được cho phép riêng. GitHub-hosted
runner đã checkout source từ commit, cài dependencies và chạy thành công cả hai
jobs; xem SHA và run URL ở mục 8. Probe export local không thay cho bằng chứng này.

## 6. Production configuration checklist

Offline checker mới nằm ở `backend/production-readiness.mjs`; không thay cấu hình
đang chạy local. Tests dùng env objects/synthetic URLs, không kết nối production.

| Hạng mục | Code gate và việc phải xác minh trước deployment |
| --- | --- |
| NODE_ENV | Checker yêu cầu explicit production; backend hiện hữu mặc định development nếu bỏ biến. Pipeline triển khai phải chạy checker, không dựa vào frontend build để set backend env. |
| Origins/cookie | readAuthConfig bắt buộc exact HTTPS origins, cookie __Host-/Secure/HttpOnly/SameSite/Path. Cần browser smoke qua HTTPS staging. |
| Runtime/migrator URLs | Strict host + cineverse_prod/public + roles riêng + TLS require/strict; checker yêu cầu passwords khác nhau. Không dùng URL CI/local làm fallback. |
| TLS/CA | Offline parse kiểm tra cấu hình/certificate format; chưa chứng minh handshake, hostname verification hoặc network ACL thật. |
| Roles/ACL | Native fixture xác minh quyền thực trên test DB. Production vẫn phải provision/review rồi chạy db:roles:check trên target riêng. Không mang local superuser lên deploy. |
| SMTP | disabled được cho phép rõ ràng, recovery trả 503; nếu bật phải đúng origin/credentials/TLS. Local Mailpit bị production từ chối. Phải thử provider/delivery/DNS thật riêng. |
| TMDB | Server token bắt buộc cho readiness checker, từ chối blank/placeholder. Không gọi TMDB live trong CI; cần smoke token thực qua secret manager ngoài CI PR. |
| Trusted proxy | Blank = socket only; opt-in IP/CIDR phải compile hợp lệ, trust-all bị từ chối. Cần kiểm tra ingress ghi đè XFF và không bypass backend. |
| Scheduler | Validate integer bounds; per-process cap/queue không thay distributed quota. Cần xác nhận replicas/capacity và staging load test. |
| Hosting | Backend listen loopback 3001 hiện hữu phù hợp same-host ingress; cần chọn topology, SPA fallback/same-origin API, lifecycle/shutdown/health. Chưa deploy. |

Không đưa `check:production-config` vào portable `check` với credentials thật.
CI kiểm thử fail-closed bằng fixtures. Khi triển khai sau này, inject env qua secret
store rồi chạy checker; failure exit 1 và output không chứa values. Checker không
tự chạy db:roles:check, migrations hoặc kiểm tra mạng để tránh hành động ngầm.

## 7. Kết quả validation

| Kiểm tra thực sự đã chạy | Kết quả | Phạm vi/giới hạn |
| --- | --- | --- |
| Clean source trước install | Pass: 274 files trước khi thêm report, 275 files ở snapshot cuối; không env/node_modules/generated/dist | Prospective working-tree source; chưa là một commit Phase 7C được publish |
| npm ci root + frontend | Pass: 165 + 30 packages, npm config riêng/rỗng và public registry | Không dùng node_modules của checkout gốc, không đổi hai lockfiles |
| Prisma generate | Pass, Client 7.10.1 sinh mới trong snapshot | Không migrate database developer |
| npm run check trong snapshot | Pass, Node **22.23.4** | Cùng runtime pin CI; môi trường Windows local, chưa Ubuntu GitHub-hosted |
| Automated tests | **396/396**: backend 287 + frontend 109; 0 fail/skip/cancel | Thêm 6 config/guard tests và 1 diagnostic redaction test so với 389 ở Phase 7B.5 |
| Native PostgreSQL clean snapshot | **14/14 Node TAP tests**: 13 scenarios + 1 parent; 0 fail/skip/cancel | PostgreSQL 17.11 private cluster, actual PrismaPg, nhiều connections; thêm ngoài portable 394 tests |
| Browser regression | Pass toàn bộ runner hiện hữu | Edge local và Chromium Linux trên GitHub; Auth/Recovery/Movies/compact/cast/layout/Favorites/Profile/Password, 22 multi-tab và 8 remediation checkpoints |
| Lint, TypeScript, production build, schema | Pass | Oxlint không warning; Vite 8.3.4, 97 modules, JS 357.79 kB / gzip 109.16 kB |
| Workflow validation | Pass actionlint 1.7.12 local và bước validation trên GitHub | Windows local không có ShellCheck, dùng -shellcheck=; workflow Linux bật kiểm tra shell mặc định và đã đạt |
| Local db:check và metadata/checksum | Pass chỉ đọc | PostgreSQL 17.11 cineverse_dev, 4 migrations/Favorite constraints giữ nguyên; local runtime vẫn SUPERUSER, không gọi là production least privilege |
| Secret review | Không phát hiện real credentials trong 275 working files/index/history local được quét | URL dựng từ constants disposable được review riêng; không sửa scanner để bỏ qua credentials thật |
| GitHub Actions run | **SUCCESS**, cả quality/browser và postgres-native | Run `40865549185`, SHA `70809412a21ce81a98d3bbabeb09c8ecdca7eb9e`; Ubuntu 24.04, Chromium Linux và Docker PostgreSQL thực |

Native migration thử đầu thiếu `schema=public` đã fail đúng quyền schema; sau khi
sửa test URL, deploy/history/drift và service tests đều đạt. Clean gate thử đầu bị
ignore rule repo cha do export trong cache chưa có Git root; sau khi tạo boundary
riêng, gate chạy đầy đủ và đạt, không tắt lint. Không tính các lượt fail là pass.

Tất cả cluster test được kiểm tra bằng pg_ctl status sau các lượt chạy. Có một
cluster từ probe export bị ngắt còn chạy, đã dừng chính xác data directory trong
snapshot bằng pg_ctl fast/wait và xác nhận không còn server. Không dừng PostgreSQL
developer hoặc xóa/reset data directory. Lượt native chính thức kết thúc bình thường
và tự dừng cluster theo helper.

Evidence local nằm trong `.npm-cache/phase-7c-*`, đã ignore và không là input của CI.
Không gọi workflow là CI pass chỉ vì YAML hợp lệ hoặc local tests đạt.

## 8. M04 và việc phải xác nhận trên GitHub

**M04 đủ điều kiện đóng trong phạm vi CI/clean checkout/native multi-connection
khi cả hai jobs của HEAD hiện tại đã được xác minh success.**
Bằng chứng đã xác minh qua GitHub API và logs, không chỉ YAML hoặc kết quả local:

- Commit triển khai: `1184f5aa667767c72e06991b2a8308ddc170f2e9`, message
  `ci: add GitHub Actions and PostgreSQL integration tests`.
- Commit diagnostic an toàn: `70809412a21ce81a98d3bbabeb09c8ecdca7eb9e`.
- [Run thành công 40865549185](https://github.com/phat102004/movie-app-react/actions/runs/40865549185):
  `Quality and browser regression` **success**; `PostgreSQL 17 native concurrency
  and least privilege` **success**, không skip gate bắt buộc.
- Main-push workflow đã chạy thực tế từ checkout mới; PR trigger/permissions được
  review trong YAML, chưa tạo một fork PR riêng để kiểm tra trigger đó.
- Sau khi HEAD được xác minh, trạng thái audit có thể cập nhật thành **6 resolved / 4 mitigated / 0 open**
  cho 10 findings gốc. Giữ nguyên tài liệu 7A/7B.5 làm lịch sử; không đổi H02/H03/H04
  thành production-verified chỉ vì CI xanh.

**Failure được giữ làm bằng chứng và rủi ro còn lại:**
[Run đầu 40863988286](https://github.com/phat102004/movie-app-react/actions/runs/40863988286)
qua native job nhưng quality fail tại `auth.browser.cjs`. Script cũ che cả vị trí
lỗi nên chưa đủ dữ liệu kết luận nguyên nhân assertion/timeout cụ thể. Thêm safe
diagnostic chỉ in loại lỗi và source locations, có test redaction; không đổi hoặc
bỏ assertion, không giảm bảo mật. Run tiếp theo thành công đầy đủ. Không tuyên bố
đã tìm/sửa nguyên nhân gốc của failure Auth đầu hoặc browser suite không còn flaky.

Các run `40866406276` và `40867051503` sau đó fail tại Profile. Diagnostic ở run
[40867051503](https://github.com/phat102004/movie-app-react/actions/runs/40867051503)
chỉ đúng `profile.browser.cjs:218`: test assert focus ngay khi input vừa visible,
trong khi ProfilePage chủ động focus qua requestAnimationFrame. Đây là race của
test với frame của ứng dụng. Bản sửa giữ assertion focus, chờ pseudo-class :focus,
và thêm frame gate điều khiển: input visible vẫn chưa focus, thả callback của app
rồi bắt buộc focus xuất hiện. Escape cũng chờ frame khôi phục focus; không tự
focus thay app, không đổi UI hoặc vô hiệu hóa test. Run xanh của revision cũ không
thay cho việc xác minh lại HEAD có bản sửa này. Failure Auth đầu vẫn là residual
reliability risk chưa đủ dữ liệu kết luận nguyên nhân, cần theo dõi qua diagnostic.

Trong lượt local bổ sung, tải Chromium Windows bị timeout; không gọi đây là local
Chromium pass. Edge local và Chromium trên GitHub là hai bằng chứng thực tế đã có.

Đối với các commit/PR tiếp theo:

1. Vào repository → Actions → **Cineverse CI**, chọn đúng commit SHA/PR revision.
2. Cả hai jobs phải xanh, không cancelled/skipped; kiểm tra Node pin, PostgreSQL
   service health, migration/history/drift, native test counts và browser checkpoints.
3. Xem logs không có DSN/token/cookie/private data; không upload artifacts nhạy cảm.
4. Xác nhận PR từ fork chạy read-only, không dùng secrets; reviewer xem changes workflow
   trước merge. Không coi YAML tồn tại hoặc một suite bị skip là bằng chứng gate đạt.
5. Owner có thể đặt cả hai jobs thành required status checks trong branch protection;
   repo settings chưa bị sửa trong Phase này.

### Khi CI fail

- `npm ci`: kiểm tra Node/lockfile/registry, không npm install hoặc bỏ lock để che lỗi.
- Thiếu generated client: xác nhận bước db:generate; không commit generated output.
- Browser thiếu executable/OS libs: xem bước Playwright install --with-deps; không
  bỏ qua suite. Local Windows mặc định Edge, CI dùng Chromium riêng.
- Native guard fail: kiểm tra service DB/role/port/opt-in. Không đổi guard để dùng
  cineverse_dev hoặc production; khởi tạo service mới khi DB test không rỗng.
- Migration/ACL fail: review đúng role/schema/public history, grants và drift. Không
  reset, baseline, nâng runtime lên superuser hoặc chạy migrations với bootstrap để né lỗi.
- Native assertion fail: log chỉ giữ test name/summary an toàn; chạy lại script local
  trên cluster mới. Xem metadata/log fixture đã ignore khi cần, không đưa vào Git/artifacts.
- Config checker fail: sửa secret-store/config ngoài source; không in env để debug,
  không tắt TLS/Origin/CSRF hoặc cấp trust-all cho thuận tiện.

## 9. Files và giới hạn còn lại

Tạo `.github/workflows/ci.yml`, `.node-version`, `backend/integration/{config,
prisma.config,fixture,native.test}.mjs`, `backend/production-readiness.mjs`,
`backend/tests/ci-safety.test.mjs`, `scripts/{test-postgres,test-postgres-local,
check-production-config}.mjs` và tài liệu này. Sửa scripts root package.json/README.
Lượt xử lý CI bổ sung `frontend/tests/browser-diagnostics.cjs`,
`backend/tests/browser-diagnostics.test.mjs`, cập nhật catch của `auth.browser.cjs`
và `scripts/test-browser.mjs` để truyền vị trí lỗi đã lọc. Sửa `profile.browser.cjs`
để kiểm thử focus theo frame, có regression gate. Không log message/giá trị form.
Không đổi dependency versions/lockfile, schema/migrations, auth behavior hoặc React UI.

Native PostgreSQL Windows và service container Linux/GitHub đều đã có kết quả;
Edge local và Chromium Linux đều đã chạy. Chưa xác minh TLS/SMTP/upstream/ingress
production, backup/restore, monitoring, rollout/rollback hoặc distributed quota.
H02/H03/H04 vẫn cần staging/production evidence theo Phase 7B.5. Không deploy trong 7C.

## 10. Nguồn chính thức đã đối chiếu

- [GitHub PostgreSQL service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers).
- [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use):
  minimum permissions, full-SHA pin và bảo vệ secrets/untrusted workflows.
- [Checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1),
  [Setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0).
- [Node 22.x distributions](https://nodejs.org/download/release/latest-v22.x/),
  [October 2026 security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).
- [Docker Official Images PostgreSQL metadata](https://github.com/docker-library/official-images/blob/master/library/postgres).
- [Actionlint v1.7.12](https://github.com/rhysd/actionlint/releases/tag/v1.7.12).
