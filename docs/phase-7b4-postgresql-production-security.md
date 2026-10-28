# Phase 7B.4 — PostgreSQL Production Role Security

Baseline: `ff49877`. Đây là production readiness, **chưa provision hoặc deploy lên
production thật**. Không thay đổi role, credentials, ACL, ownership hay dữ liệu
PostgreSQL local; không mở/hiển thị nội dung `.env`. Diagnostics chỉ sử dụng cấu
hình hiện hữu nội bộ để kết nối và đọc metadata/count như workflow cũ.

## 1. Hiện trạng và rủi ro

- Prisma 7.10.1 + `PrismaPg`. Trước phase này runtime và Prisma CLI cùng lấy
  `DATABASE_URL`. Guard chỉ cho phép loopback:5432/cineverse_dev/public.
- Bốn migrations tạo `User`, `Session`, `PasswordResetToken`, `Favorite` và các
  indexes/FK trong `public`; không thay đổi nội dung/checksum các file này.
- Models dùng UUID do Prisma Client sinh; hiện không có application sequences.
- Native PostgreSQL local read-only probe xác nhận role hiện tại vẫn có
  SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS. Không hiển thị tên role,
  mật khẩu, connection string, token hoặc bản ghi tài khoản.

SUPERUSER có thể vượt phần lớn ACL và RLS, quản trị dữ liệu/roles khác. Runtime
bị xâm nhập khi dùng quyền đó có phạm vi thiệt hại lớn hơn ứng dụng cần có.
Phase này không tự sửa role local đang hoạt động. Production phải dùng role riêng;
role local hiện tại sẽ bị guard production từ chối.

## 2. Mô hình quyền

| Quyền | `cineverse_app` | `cineverse_migrator` |
| --- | --- | --- |
| LOGIN | Có, password riêng do DBA/secret manager cấp | Có, secret chỉ cấp cho deployment job |
| SUPERUSER / CREATEDB / CREATEROLE / REPLICATION / BYPASSRLS | Không | Không |
| INHERIT / membership sang role khác | Không | Không |
| CONNECT | Chỉ database ứng dụng | Chỉ database ứng dụng |
| TEMP / database ownership | Không | Không |
| CREATE trên database ứng dụng | Không | Có, để chạy migration đầu tiên |
| `public` schema | USAGE, không sở hữu/CREATE | USAGE + CREATE; schema vẫn do DBA/database owner sở hữu |
| Bốn bảng ứng dụng | SELECT/INSERT/UPDATE/DELETE, không GRANT OPTION | Sở hữu các objects do migrations của mình tạo |
| TRUNCATE / REFERENCES / TRIGGER cho app | Không | Theo quyền owner để migration tạo FK/index/DDL |
| `_prisma_migrations` | Không đọc/ghi | Owner, Prisma CLI quản lý history |
| Sequences | Không có quyền, hiện không cần | Owner nếu future migration tạo sequence |

`CREATE ON DATABASE cineverse_prod` khác với thuộc tính `CREATEDB` của role.
Migration đầu tiên giữ nguyên `CREATE SCHEMA IF NOT EXISTS public`; PostgreSQL
kiểm tra quyền CREATE database **trước** khi bỏ qua schema đã tồn tại. Migrator
cần quyền này trên **database ứng dụng**, không có quyền tạo database khác.

Schema owner vẫn là DBA/`pg_database_owner`, không phải app. Migrator sở hữu các
bảng/indexes/constraints/history mà nó tạo, đủ để ALTER TABLE và tạo FK; GRANT DML
trên bảng người khác sở hữu **không đủ** để chạy ALTER TABLE.

Runtime có quyền truy cập dữ liệu nhạy cảm mà chức năng auth thật sự cần, nhưng
không có quyền quản trị schema. Least privilege không thay thế authorization,
SQL injection prevention, backup hoặc quyền riêng tư cấp ứng dụng.

## 3. Files tạo/sửa

| File | Trách nhiệm |
| --- | --- |
| `backend/database/connection-config.mjs` (mới) | Chọn runtime/migration URL, production target/role/TLS guard, local fallback có giới hạn. |
| `backend/database/role-security.mjs` (mới) | Đọc metadata/ACL và fail closed khi actual role không đạt policy. |
| `backend/database/client.mjs` | Shared client factory, runtime config riêng; kiểm tra production role trước khi expose client. |
| `backend/database/migration-client.mjs` (mới) | Pool/lifecycle riêng, chỉ dùng migration config. |
| `backend/database/config.mjs` | Giữ nguyên local URL guard, thêm thông báo lỗi production an toàn. |
| `backend/prisma.config.mjs` | Prisma CLI lấy URL từ migration selector, không fallback sang runtime trong production. |
| `backend/scripts/migrate.mjs` | Local guard/history/drift cũ giữ nguyên; dùng migration client; chặn NODE_ENV=production. |
| `backend/database/production-migration-plan.mjs` (mới) | Pin nội dung bốn migrations, kiểm tra prefix/history/inventory production riêng. |
| `backend/scripts/deploy-production.mjs` (mới) | Preflight role + checksum/history + drift, rồi mới gọi Prisma deploy nếu còn migration. Không GRANT/đổi owner. |
| `backend/scripts/check-production-roles.mjs` (mới) | CLI production read-only, runtime hoặc `--migration`; không ghi database. |
| `backend/database/production-roles.sql` (mới) | Template DBA opt-in cho **database production mới/rỗng**, roles mới, không password thật. |
| `backend/database/production-runtime-grants.sql` (mới) | GRANT sau migration theo allowlist bốn bảng; không mở history cho app. |
| `backend/tests/production-database.test.mjs` (mới) | Config/security/static/negative CLI tests + PostgreSQL WASM RAM ACL integration. |
| `backend/.env.example` | Biến migration/host/CA mẫu; không sửa `.env` thật. |
| `package.json` | Thêm `db:roles:check`, `db:deploy:production`. Không thêm dependencies. |
| `README.md` | Chỉ dẫn production/local và liên kết workflow. |
| Tài liệu này | Quy trình, bằng chứng, giới hạn và recovery. |

Không sửa `schema.prisma`, bốn migrations, React UI, session/CSRF/Origin,
trusted proxy, rate limiting hoặc TMDB scheduler 7B.1–7B.3.
Tài liệu audit 7A đã untracked trước task; không sửa/đưa nó vào phase này.

## 4. Runtime/migration connection separation

### Local — tương thích workflow hiện tại

`DATABASE_URL` vẫn bị giới hạn loopback:5432/cineverse_dev/public bằng guard cũ.
Runtime dùng biến này. Prisma CLI/migration dùng `MIGRATION_DATABASE_URL` nếu
được điền; nếu bỏ trống thì fallback sang `DATABASE_URL` **chỉ trong local**.
Migration URL override cũng phải qua chính guard local cũ.

`db:migrate` vẫn kiểm tra inventory, migration prefix/checksum, drift, counts và
không seed/reset; production bị chặn trước khi kết nối. Không chạy lệnh migrate
trong task này, vì chỉ có thay đổi readiness, không có migration mới.

Validate/generate offline local vẫn chấp nhận datasource URL `undefined` khi cả
hai URL vắng mặt. Build container nên generate client ở build stage offline với
NODE_ENV=development/test và không inject production secrets; production runtime
không cần migration credential để sử dụng generated client đã build.

### Production — opt-in bắt buộc

Chỉ `NODE_ENV=production` bật production branch. Các giá trị dưới đây là
**placeholders**, không dùng để kết nối:

```dotenv
NODE_ENV=production
PRODUCTION_DATABASE_HOST=db.your-provider.example

# Backend runtime secret injection ONLY:
DATABASE_URL="postgresql://cineverse_app:<APP_PASSWORD>@db.your-provider.example:5432/cineverse_prod?schema=public&sslmode=require&sslaccept=strict"

# Separate deployment job injection ONLY, not the backend container:
MIGRATION_DATABASE_URL="postgresql://cineverse_migrator:<MIGRATOR_PASSWORD>@db.your-provider.example:5432/cineverse_prod?schema=public&sslmode=require&sslaccept=strict"

# Optional, absolute path to a PUBLIC provider CA bundle:
DATABASE_SSL_CA_FILE=
```

Hai dòng URL được trình bày cùng nhau để mô tả contract, **không** đề nghị inject
cả hai secrets vào runtime. Không dùng migrator làm `DATABASE_URL`; không đưa
production URLs vào `.env.example` thật với mật khẩu thật.

Production guard hiện cố ý chỉ hỗ trợ:

- Host DNS chữ thường khớp `PRODUCTION_DATABASE_HOST`, direct port 5432.
- Database `cineverse_prod`, schema `public`, hai role tên đúng như trên.
- TLS bắt buộc: URI `sslmode=require&sslaccept=strict` cho Prisma CLI; node-pg
  nhận options **tường minh** `rejectUnauthorized: true` + servername, không bị
  URL parser làm mất cấu hình SSL object.
- Không query override host/options/socket/schema khác, URL fragment hoặc query
  lặp. Không fallback local hoặc dùng runtime URL cho migration production.
- Optional CA phải là absolute path, PEM certificates parse được, không private
  key. Cùng public CA được truyền vào node-pg và `sslcert` của CLI. Không tắt
  certificate validation để sửa lỗi TLS.

Đây chưa phải adapter tự động cho mọi hosting. Provider dùng port khác, database
tên khác, role suffix khác, transaction pooler hoặc chỉ HBA/network isolation
cần thiết kế/review guard riêng, không nới allowlist tùy tiện.

## 5. SQL provisioning thủ công

### Điều kiện tiên quyết

DBA chuẩn bị một PostgreSQL production cluster/database **riêng**, backup/restore
plan và admin service connection không chứa password trong argv/logs. Tạo sẵn
`cineverse_prod` với schema `public`, admin/database owner độc lập với app/migrator.
Không dùng `cineverse_dev`, không copy role SUPERUSER local vào production.

Các file SQL không được runner/npm tự thực thi. DBA đọc toàn bộ rồi chạy thủ công
bằng `psql -X` và opt-in variable đúng. Thiếu opt-in/sai database thì thoát trước
DDL. Bootstrap cũng từ chối nếu roles/objects đã tồn tại, không tự ALTER roles,
baseline, REASSIGN OWNED hoặc đổi owner bảng hiện hữu.

Ví dụ dùng service/passfile đã được DBA cấu hình an toàn:

```powershell
psql "service=cineverse_admin" -X -v CINEVERSE_PROVISION=true -f backend/database/production-roles.sql
```

Bootstrap chạy transaction, tạo hai roles `PASSWORD NULL` để không hardcode hoặc
ghi password vào file. DBA đặt hai passwords khác nhau bằng `\password` trong
phiên tương tác an toàn hoặc cơ chế secret manager của provider. Không dùng
`ALTER ROLE ... PASSWORD 'plaintext'` trong file/history/argv.

Script chỉ bỏ PUBLIC CONNECT/TEMP trên database đích và PUBLIC USAGE/CREATE trên
schema `public` của **database mới/rỗng**; sau đó grant CONNECT/USAGE riêng và
CREATE database/schema cho migrator. Không áp dụng lên local hoặc tenant DB dùng chung.

### PUBLIC CONNECT trên database khác — bước bắt buộc riêng

PostgreSQL ACL là cộng dồn: `REVOKE CONNECT FROM cineverse_app` không thể phủ định
CONNECT mà role hưởng từ `PUBLIC`. Các database như `postgres`, `template1` hoặc
database tenant khác có thể vẫn cấp PUBLIC CONNECT.

Script không tự thay đổi chúng. DBA phải inventory và review ACL của từng
database khác có `datallowconn=true`, cấp lại explicit CONNECT cho admin/roles
thật sự cần trước khi thay PUBLIC grants trên **cluster production riêng**.
Không chạy REVOKE diện rộng hoặc làm gián đoạn tài khoản khác để chỉ làm checker xanh.

Checker cố ý fail nếu `has_database_privilege(..., 'CONNECT')` còn đúng với
database khác, kể cả qua PUBLIC. `pg_hba.conf`/firewall là defense bổ sung,
**không làm ACL check tự pass**. Hosting không cho quản lý các ACL này cần được
review mô hình isolation/provider riêng; không có flag tự xác nhận để bỏ guard.

### Existing objects/ownership

Fresh deployment: migrator trực tiếp tạo tables/indexes/FK và history qua Prisma.
Existing production/restore: DBA inventory owner của từng object, dependency,
schema/history và migration checksum. Nếu owner khác, dừng pipeline. Chỉ sau khi
review backup và quyền mới, DBA chuyển từng object cần thiết theo kế hoạch riêng.
Không coi GRANT ALL/DML là thay thế ownership, không dùng REASSIGN OWNED rộng.
Hai script đi kèm không tự chuyển owner object hiện hữu.

## 6. Deploy migrations và cấp runtime quyền

1. Build/generate/validate offline; review đúng bốn migrations và backup plan.
2. DBA provision roles/target/other-database ACLs, đặt secrets và TLS/network policy.
3. Deployment job nhận `NODE_ENV=production`, expected host, public CA nếu cần và
   **chỉ** `MIGRATION_DATABASE_URL`:

   ```powershell
   npm.cmd run db:roles:check -- --migration
   npm.cmd run db:deploy:production
   ```

4. Runner kiểm tra role thật (không chỉ username trong URL), flags, membership,
   database ACL, public USAGE/CREATE và ownership các objects hiện có. Chỉ nhận
   allowlist migrations pinned SHA-256; nhận đúng prefix history hoàn tất.
   Chấp nhận checksum LF/CRLF của **cùng nội dung đã pin**, không chấp nhận SQL đổi.
5. Với schema đã có, `prisma migrate diff --from-config-datasource --to-schema`
   dùng snapshot đúng prefix và `--exit-code`; không dùng shadow database hay
   cần SUPERUSER. Nếu còn migrations mới review thì runner gọi `migrate deploy`
   bằng đúng Prisma config/migrator URL; kiểm tra history và drift lần nữa.
   Child stdout/stderr được capture, không log raw URL/driver error.
6. DBA/owner review và chạy post-migration grant script:

   ```powershell
   psql "service=cineverse_object_owner" -X -v CINEVERSE_GRANT_RUNTIME=true -f backend/database/production-runtime-grants.sql
   ```

   Script yêu cầu đủ năm bảng migrator-owned (bốn application tables + history),
   chỉ grant SELECT/INSERT/UPDATE/DELETE trên bốn bảng ứng dụng. Không ALL TABLES,
   không GRANT OPTION hoặc grants vào history. Runtime được UPDATE trên Session
   để các `SELECT ... FOR UPDATE` của Change Password hoạt động.
7. Backend/runtime job nhận **chỉ** app URL/host/CA và auth production config:

   ```powershell
   npm.cmd run db:roles:check
   ```

   Chỉ mở backend sau khi check đạt, rồi thử Register/Login/Me, Profile, Favorites,
   Forgot/Reset và Change Password bằng tài khoản staging riêng.

`db:deploy:production` là lệnh **ghi schema/history**, không phải diagnostic.
Không được chạy tự động trong local hoặc quality checks của task này. Gọi trực
tiếp Prisma CLI bên ngoài wrapper sẽ bỏ preflight riêng của Cineverse, nên không
là workflow CI được hỗ trợ; DB ACL vẫn phải bảo vệ ngay cả khi CLI bị dùng sai.

Không ALTER DEFAULT PRIVILEGES để auto-grant mọi bảng cho runtime: điều đó có thể
mở `_prisma_migrations`. Chọn **GRANT theo allowlist sau mỗi migration**. Future
model/sequence cần update explicit grant list, role checker và pinned migration
manifest sau review. Hiện không có sequence nên không có USAGE grant thừa.

## 7. Checker/runtime fail-closed

Production client chỉ được expose sau khi đọc catalog và xác nhận:

- `current_user` và `session_user` đúng role/purpose/database đã khóa.
- LOGIN, NOINHERIT, không flags quản trị hoặc role membership khác.
- Không sở hữu database; CONNECT đúng database, không TEMP hoặc CONNECT database khác.
- App không CREATE/own schema, không own table/view/sequence/function/type ứng dụng.
- App có đủ CRUD bốn bảng, không TRUNCATE/REFERENCES/TRIGGER/GRANT OPTION, không
  quyền truy cập table khác hoặc `_prisma_migrations` (kể cả column-level grants),
  không sequence privileges. Không chấp nhận non-system SECURITY DEFINER routine
  mà app có EXECUTE, tránh một đường nâng quyền qua function do owner khác tạo.
- Migrator có CREATE/USAGE và sở hữu những bảng ứng dụng/history hiện hữu; inventory
  lạ trong public bị chặn. Không tự GRANT/REVOKE khi fail.

Kết quả được kiểm tra lúc khởi tạo client/pool production; không chạy lại metadata
cho mỗi HTTP request. Đây không phải phát hiện tức thời một DBA thay quyền sau
khi process đã khởi động. Thực hiện role check lại sau migration/rotation và
rolling restart; giám sát việc đổi quyền bằng quy trình DBA.

Fail vì thiếu production config, sai identity, quyền thừa hoặc quyền thiếu đều
đóng client và không trả nó cho auth service. TMDB vẫn tách biệt với database.
Migration/runtime dùng hai singleton/lifecycle độc lập; migration guard không
mượn runtime client để inspect rồi deploy bằng role khác.

## 8. Rotation, TLS, backup và recovery

- Secret manager cấp passwords ngẫu nhiên/độc lập, URL-encode ở nơi tạo URI;
  không commit URI thật hoặc dán vào chat. Runtime không được biết migrator secret.
- Dùng SCRAM-SHA-256, TLS certificate/hostname verification và allowlist network.
  CA public có thể mount; private keys/passwords không đặt trong repo.
- Rotation theo từng role; password mới không tự hủy kết nối pool đã xác thực.
  Có kế hoạch drain/rolling restart, kiểm tra Me/transactions/role policy sau cutover;
  không vô hiệu hóa TLS hoặc dùng SUPERUSER làm fallback khi có lỗi.
- Backup chạy dưới quy trình DBA/provider, mã hóa, ngoài repo, có retention và
  quyền đọc phù hợp (runtime không cần truy cập migration history để làm backup).
  Backup chứa password/session hashes và dữ liệu tài khoản, vẫn là dữ liệu nhạy cảm.
- Restore drill vào database/cluster biệt lập; xác minh history/checksum, owners,
  constraints/FKs và smoke tests trước cutover. Không restore đè cineverse_dev hoặc
  chạy `pg_restore --clean`/reset theo thói quen. Restore `--no-owner --no-privileges`
  cần kế hoạch đặt owner và grant lại đúng mô hình, không có bảo đảm ACL tự đi theo.
- Bootstrap trước COMMIT có thể ROLLBACK transaction nếu fail; sau COMMIT, dừng
  rollout và giữ roles/objects để DBA review, không DROP roles/tables để “dọn dẹp”.
  Khôi phục theo backup/change record đã review, không migrate resolve/baseline mù.
- Migration thất bại/unfinished history: dừng, kiểm tra transaction/history và
  trạng thái schema thực; không retry vô hạn, sửa checksum hoặc rewrite migration cũ.

Task này không tạo backup, không thử rotation/password thật và không thao tác
GRANT/REVOKE/owner/role trên PostgreSQL local hoặc hosting.

## 9. Kiểm thử thực tế và giới hạn

Tests mới gồm pure config/role policy, SQL static validation, CLI negative guards
và PostgreSQL WASM RAM ACL integration. Integration **không có dataDir/socket/.env**;
roles được tạo trong instance RAM biệt lập, không phải roles trong PostgreSQL local.
RAM database tên `postgres`, nên chỉ target database identifier trong bootstrap
body được thay cho fixture; production psql guard/opt-in được static-check riêng.

Đã kiểm tra migrator không SUPERUSER áp dụng bốn SQL migrations nguyên vẹn và
ALTER bảng mình sở hữu; app CRUD bốn bảng, SELECT FOR UPDATE (User/Session và các
fixture tables), bị 42501 khi tạo/ALTER schema, ALTER bảng, đọc history hoặc SET ROLE.
Không chạy DROP database/schema/table để chứng minh deny; dựa vào ACL/ownership
checks và ALTER deny tương ứng. Không có destructive SQL trên database thật.

Không tuyên bố PGlite chứng minh TCP/password authentication, TLS/provider
certificates, native Prisma `migrate deploy`/advisory locks, HBA hoặc multi-connection
locking trên hosting. Các bước đó bắt buộc kiểm chứng trong staging/database test
riêng sau khi được phép provision; không dùng local user database để thử quyền mới.

Kết quả thực tế:

| Kiểm tra | Kết quả |
| --- | --- |
| `npm.cmd test` | **376/376 pass**: backend 273, frontend 103; 0 fail/skip/cancelled; **13 tests mới**, nhiều negative cases theo từng thuộc tính quyền. |
| PostgreSQL WASM RAM ACL integration | Pass, migrator áp dụng bốn migrations và ALTER table owner; app CRUD/locks và các deny cases đúng như trên. |
| Lint | Pass, Oxlint theo scripts thực tế. |
| TypeScript | Pass, `tsc -b --force`. |
| Production frontend build | Pass, Vite 8.3.4, 94 modules; không đổi React/CSS. |
| `db:validate` | Pass, Prisma schema hợp lệ. |
| `db:check` | Pass, PostgreSQL local 17.11, chỉ đọc metadata/count. |
| Native Prisma/pg metadata probe | Pass, các SQL ACL queries chạy được; bốn local migration checksums không đổi. Role local vẫn SUPERUSER, không được thay đổi. |
| CLI fail-closed tests | Pass: deploy/role-check thiếu production config hoặc sai môi trường dừng với exit 1, local migrate bị chặn trong production, không kết nối/ghi database. |
| Backend regressions | Auth/Profile/Favorites, account binding, trusted proxy và TMDB scheduler hiện có tiếp tục đạt trong full suite. |

Không chạy production provisioning, native PostgreSQL integration tạo roles mới,
Prisma production deploy, TLS hosting smoke tests hoặc backup/restore thật.
Browser suites không chạy lại trong phase chỉ thay đổi database/config/scripts này;
không dùng kết quả browser của phase cũ để tuyên bố đã thử production auth mới.

SHA-256 literals trong production migration manifest là checksum của SQL công khai,
không phải password/session/reset tokens; tests đối chiếu chúng với bốn file SQL.

Lệnh đã dùng trong task (read-only đối với PostgreSQL local):

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run db:validate
npm.cmd run db:check
```

Probe metadata đọc catalog qua Prisma/native pg xác nhận bốn migration local còn
đúng checksum và inventory, không ghi DDL/DML. Logs/probe ở `.npm-cache/phase-7b4-*`
được ignore. Không đọc/hiển thị email, passwordHash, tokenHash hoặc URL thật.

## 10. Checklist trước production

- [ ] Dedicated target DB, DNS/direct port, database/schema owner đúng mô hình.
- [ ] Hai roles đúng flags, không membership hoặc runtime DDL/history access.
- [ ] PUBLIC CONNECT/TEMP/CREATE được review ở target và các database khác.
- [ ] Secrets tách biệt, TLS/CA/hostname verification và network ACL đã thử thật.
- [ ] Build client offline; migrator preflight, deploy, history/drift đạt trên staging.
- [ ] Post-migration explicit grants; runtime metadata check đạt.
- [ ] Register/Login/Profile/Favorites/Recovery/Change Password smoke tests bằng test users.
- [ ] Không ảnh hưởng 7B.1 multi-tab, 7B.2 trusted proxy hoặc 7B.3 scheduler.
- [ ] Rotation/drain, backup/restore drill và migration failure recovery được xác minh.

## 11. Tài liệu chính thức

- [PostgreSQL privileges](https://www.postgresql.org/docs/17/ddl-priv.html): PUBLIC
  privileges cộng dồn, quyền owner khác GRANT thông thường.
- [Role attributes](https://www.postgresql.org/docs/17/role-attributes.html) và
  [GRANT](https://www.postgresql.org/docs/17/sql-grant.html): LOGIN, flags, inheritance/membership.
- [PostgreSQL CREATE SCHEMA implementation](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/commands/schemacmds.c):
  kiểm tra database CREATE trước nhánh IF NOT EXISTS.
- [ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html):
  theo role tạo object; không tự áp dụng cho object đã có và không thay ownership.
- [Prisma 7 migrate deploy](https://www.prisma.io/docs/cli/v7/migrate/deploy),
  [Prisma config](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference),
  [PostgreSQL connector](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql):
  datasource CLI riêng và TLS options. Không dùng shadow-database workflow ở production.
