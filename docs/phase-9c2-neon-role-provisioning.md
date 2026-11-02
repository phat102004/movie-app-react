# Phase 9C.2 — Review Neon PostgreSQL role provisioning

Ngày review: 2026-11-01. **Review/design only; chưa phê duyệt chạy SQL.**

Không kết nối Neon hoặc PostgreSQL local, không gọi Neon API/CLI, không chạy
migration/provisioning, không đọc/sửa `.env`, không tạo resources, commit hay push.
Các SQL và commands dưới đây chỉ là kế hoạch cho một bước được cho phép sau này.

Bổ sung hotfix SEC-PG-PREFIX-01: ba SQL draft lọc namespace đã được sửa sang
prefix literal `LEFT(nspname, 3) <> 'pg_'`, không dùng wildcard pg_% để bỏ sót
schema người dùng. Xem [hotfix/regression](phase-9c2b-neon-security-compatibility.md), mục 11.
Không thay đổi quyền hoặc thực thi các draft này lên database thật.

## 1. Kết luận và mức độ xác minh

**Khả thi về cơ chế SQL, chưa xác nhận đạt toàn bộ security contract trên Neon.**
Không chạy nguyên bản hai script hiện tại lên cloud trước khi giải quyết đường
cấp credentials và kiểm tra ACL/provider objects. Không nới production guards.

Thông tin do người dùng cung cấp, chưa được review này xác minh bằng kết nối:

| Thuộc tính | Hiện trạng được cung cấp |
| --- | --- |
| Project / branch | `cineverse-staging` / `production` (tên branch mặc định, không đồng nghĩa môi trường production của Cineverse) |
| Database / schema / version | `cineverse_prod` / `public` / PostgreSQL 17.11 |
| Bootstrap role | `cineverse_prod_owner`; LOGIN, không SUPERUSER; có CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS; member `neon_superuser` |
| Schema owner | `pg_database_owner` |
| Hai role ứng dụng | Chưa có `cineverse_app`, `cineverse_migrator` |

Chưa có bằng chứng về actual database owner, database inventory/ACL, object
inventory, default ACL, routine privileges, TLS handshake hoặc quyền bootstrap
role trên database hệ thống. **Không suy ra database rỗng từ việc chưa có hai roles.**

## 2. Source đã đối chiếu

| File / phần code | Kết quả review |
| --- | --- |
| [production-roles.sql](../backend/database/production-roles.sql), `BOOTSTRAP` | psql-only, explicit opt-in, khóa tên database, transaction; từ chối roles/relations đã có. Tạo LOGIN/PASSWORD NULL rồi yêu cầu đặt password ngoài script. Chỉ revoke PUBLIC trên database đích. |
| [production-runtime-grants.sql](../backend/database/production-runtime-grants.sql), `RUNTIME_GRANTS` | Đòi đủ năm bảng thuộc migrator; chỉ cấp CRUD bốn bảng ứng dụng. Không cấp history/sequence/default grants. |
| [role-security.mjs](../backend/database/role-security.mjs), `inspectRoleSecurity` / `validateProductionRole` | Kiểm actual identity, attributes, membership, effective ACL và ownership; runtime còn bị chặn quyền ngoài allowlist/SECURITY DEFINER routines. |
| [connection-config.mjs](../backend/database/connection-config.mjs), `readProductionDatabaseConfig` | Khóa host, database/schema/role/port/query allowlist; driver TLS strict; pool runtime 3, migrator 1. |
| [client.mjs](../backend/database/client.mjs), [migration-client.mjs](../backend/database/migration-client.mjs) | Client riêng theo purpose; production role check trước khi trả client. |
| [prisma.config.mjs](../backend/prisma.config.mjs) | Prisma 7 lấy datasource từ migration selector, không dùng `directUrl` kiểu Prisma cũ. |
| [deploy-production.mjs](../backend/scripts/deploy-production.mjs) | Preflight, pinned migration inventory/checksums, history prefix và drift; sau đó mới deploy và kiểm lại. Không tự GRANT/đổi owner. |
| [check-production-roles.mjs](../backend/scripts/check-production-roles.mjs) | Production-only; runtime hoặc `--migration`; chỉ metadata, không sửa ACL. |
| [production-readiness.mjs](../backend/production-readiness.mjs), [runtime.mjs](../backend/runtime.mjs) | Release đòi hai secrets khác nhau; HTTP runtime từ chối migration URL; production kiểm DB trước listen. |
| [schema.prisma](../backend/prisma/schema.prisma) và bốn migrations | UUID do client tạo; không có sequence; initial migration có `CREATE SCHEMA IF NOT EXISTS public`; migrations sau tạo FK bằng ALTER TABLE. |
| [Phase 7B.4](phase-7b4-postgresql-production-security.md), [Phase 9B](phase-9b-render-neon-readiness.md) | Đều giữ cloud ACL feasibility ở trạng thái cần xác minh; không có exception cho Neon. |

## 3. Compatibility matrix

| Hạng mục | Đánh giá | Điều kiện / quyết định |
| --- | --- | --- |
| CREATE ROLE qua SQL | Được Neon tài liệu hóa [S1, S2] | Dùng SQL, không tạo app/migrator qua Console/API/CLI vì đường tạo đó cấp `neon_superuser`. |
| Đủ quyền admin | Chưa xác minh thực tế | CREATEROLE cho phép tạo role thường; không biến bootstrap role thành PostgreSQL SUPERUSER. Không yêu cầu SUPERUSER cho app/migrator. |
| LOGIN / password initialization | **Cần điều chỉnh runbook** | Không coi PASSWORD NULL rồi `psql \password` là workflow Neon đã được chứng minh; xem mục 6. |
| psql metacommands | Đúng với psql, không phải SQL thuần | `\set`, `\if`, `\gset`, `\quit` không paste nguyên vào Neon SQL Editor/pgAdmin Query Tool. Nếu dùng GUI cần bản SQL có target assertions tương đương. |
| Schema public thuộc pg_database_owner | Phù hợp thiết kế | Xác minh database thực sự do bootstrap owner sở hữu. Giữ schema owner; không chuyển cho app hoặc migrator [S3]. |
| CREATE trên database / public | Phù hợp với migration đã pin | Migrator cần database CREATE cho initial CREATE SCHEMA, và USAGE/CREATE trên public. Đây không phải thuộc tính CREATEDB. Runtime không có CREATE. |
| ALTER TABLE / indexes / FKs | Cần ownership | Migrator phải trực tiếp tạo các bảng; DML grants trên bảng của owner không thay thế quyền sở hữu [S4]. |
| _prisma_migrations | Tách khỏi runtime | Tạo bằng migrator; runtime không có quyền bảng/cột vào history. Không baseline hoặc tự sửa checksum. |
| Runtime CRUD | Phù hợp | Chỉ User, Session, PasswordResetToken, Favorite; không GRANT OPTION, TRUNCATE, REFERENCES, TRIGGER. |
| Sequences | Hiện không cần | Không cấp USAGE/SELECT/UPDATE theo ALL SEQUENCES. Future sequence cần review riêng. |
| ALTER DEFAULT PRIVILEGES | Có cơ chế Postgres, không cần dùng ở đây | Giữ explicit table allowlist; default grant cho mọi bảng có thể mở cả history. Default ACL theo creator, không tự tác động bảng đã có [S5]. |
| Membership | Giữ bằng 0 ở cả hai role | NOINHERIT một mình không đủ; không cấp bất kỳ role khác, kể cả grant có INHERIT FALSE/SET TRUE [S6]. |
| Other database CONNECT | **Blocker khả năng tương thích** | Cả app và migrator phải có effective CONNECT=false với mọi DB khác có datallowconn=true. Không coi network restriction là thay thế catalog ACL. |
| Provider schemas/tables/functions | Chưa có inventory | Bootstrap có thể từ chối provider relations; runtime checker có thể từ chối PUBLIC access/routines. Không tự lọc bỏ chúng để checker pass. |
| TLS / identity | Giữ strict, chưa cloud-test | Direct host/5432, đúng database/schema, current_user=session_user; không SET ROLE để giả identity. |

PostgreSQL cấp quyền cộng dồn; revoke riêng app không phủ định quyền nhận qua
PUBLIC. Other-DB policy là điều kiện Cineverse đang áp dụng, không phải khẳng
định Neon không hỗ trợ role ít quyền. Nếu provider không cho quản lý ACL cần
thiết, kết quả là **NO-GO với policy hiện tại**, không phải đổi guard tự động.

## 4. Thiết kế role và ownership

| Quyền / owner | Bootstrap owner | cineverse_migrator | cineverse_app |
| --- | --- | --- | --- |
| Mục đích | Provision/admin thủ công | Release runner riêng | Node HTTP runtime |
| Elevated flags / neon_superuser | Theo provider; không cấp cho ứng dụng | Không | Không |
| INHERIT / outbound membership | Không áp đặt thay đổi admin | false / 0 | false / 0 |
| Database owner | Giữ bootstrap nếu metadata xác nhận | Không | Không |
| public schema owner | Giữ pg_database_owner | Không | Không |
| CONNECT database đích / TEMP | Admin tự review ACL | Có / không | Có / không |
| CREATE database đích / public | Admin | Có / có | Không / không |
| Bảng/index/history tạo bởi migrations | Không chạy migrations dưới admin | Owner | Không owner |
| CRUD bốn bảng | Không dùng cho traffic | Theo quyền owner | Explicit CRUD |
| Secrets được cấp cho HTTP service | Không | Không | Chỉ runtime secret |

`pg_database_owner` có database owner hiện tại làm thành viên ngầm định; không
cần và không được GRANT role này cho app/migrator [S3]. Giữ database owner và
schema owner như hiện có nếu metadata đúng. Quyền tạo bảng trong public không
đòi sở hữu public. Quyền sở hữu bảng phát sinh từ **role thực thi CREATE TABLE**.

Với PG17, CREATEROLE creator có thể có ADMIN membership vào role mình tạo [S7].
Phải phân biệt chiều: `roleid=app, member=bootstrap_owner` không phải
`roleid=neon_superuser, member=app`. Checker đếm memberships mà **app/migrator
là member**. Không sửa catalog hoặc revoke nhầm quyền admin bootstrap chỉ để
làm số đếm đẹp. Không dùng SET ROLE cho migration: checker đòi session_user cũng
đúng migrator, nên phải đăng nhập trực tiếp.

## 5. SQL design đề xuất — chưa áp dụng

### 5.1 Preflight chỉ đọc cho bước cloud sau này

Không chạy các query này trong review. Người vận hành sau này xác nhận project,
branch và direct endpoint bằng thông tin không chứa secrets; tên database không
đủ nhận diện Neon branch. Không đưa host/connection strings riêng vào báo cáo.

```sql
SELECT current_database() AS database, current_user, session_user,
       current_setting('server_version_num') AS version;

SELECT d.datname, pg_get_userbyid(d.datdba) AS owner,
       d.datallowconn, d.datacl
FROM pg_catalog.pg_database d ORDER BY d.datname;

SELECT n.nspname, pg_get_userbyid(n.nspowner) AS owner, n.nspacl
FROM pg_catalog.pg_namespace n
WHERE LEFT(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema';

SELECT n.nspname, c.relname, c.relkind,
       pg_get_userbyid(c.relowner) AS owner
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE LEFT(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema'
ORDER BY n.nspname, c.relname;

SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
       r.rolreplication, r.rolbypassrls, r.rolinherit
FROM pg_catalog.pg_roles r
WHERE r.rolname IN ('cineverse_prod_owner', 'cineverse_migrator', 'cineverse_app');

SELECT parent.rolname AS granted_role, member.rolname AS member,
       m.admin_option, m.inherit_option, m.set_option
FROM pg_catalog.pg_auth_members m
JOIN pg_catalog.pg_roles parent ON parent.oid = m.roleid
JOIN pg_catalog.pg_roles member ON member.oid = m.member
WHERE parent.rolname IN ('cineverse_migrator', 'cineverse_app')
   OR member.rolname IN ('cineverse_migrator', 'cineverse_app');

SELECT r.rolname, d.datname,
       has_database_privilege(r.oid, d.oid, 'CONNECT') AS can_connect
FROM pg_catalog.pg_roles r CROSS JOIN pg_catalog.pg_database d
WHERE r.rolname IN ('cineverse_migrator', 'cineverse_app')
  AND d.datallowconn
ORDER BY r.rolname, d.datname;

SELECT pg_get_userbyid(defaclrole) AS creator,
       defaclnamespace::regnamespace AS schema, defaclobjtype, defaclacl
FROM pg_catalog.pg_default_acl;
```

Không SELECT pg_authid/rolpassword hoặc dữ liệu User/Session/PasswordResetToken.
Sau khi role có LOGIN và đúng ACL, dùng inspector hiện có để kiểm cả table/column,
sequence, schema ownership và SECURITY DEFINER EXECUTE; queries trên chưa thay
thế toàn bộ `inspectRoleSecurity`.

### 5.2 Draft thay đổi bootstrap

Đề xuất **tạo migrator trước, app sau, đều NOLOGIN và không có password literal**.
Chỉ kích hoạt LOGIN ở bước credentials đã review. Bản SQL thuần dự kiến dưới đây
giữ target/freshness guards; nó chưa được chạy hoặc đưa vào executable scripts.
Nó thay thế bước bootstrap khi được duyệt, không chạy nối tiếp script cũ.

```sql
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'cineverse_prod'
     OR current_user <> 'cineverse_prod_owner'
     OR session_user <> 'cineverse_prod_owner'
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database
       WHERE datname = current_database()
         AND pg_get_userbyid(datdba) = current_user
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_namespace
       WHERE nspname = 'public'
         AND pg_get_userbyid(nspowner) = 'pg_database_owner'
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
       WHERE rolname IN ('cineverse_migrator', 'cineverse_app')
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE LEFT(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema'
     )
  THEN
    RAISE EXCEPTION 'Stopped: target, owner, roles or object inventory needs review';
  END IF;
END $$;

CREATE ROLE cineverse_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS NOINHERIT;
CREATE ROLE cineverse_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS NOINHERIT;

REVOKE CONNECT, TEMPORARY ON DATABASE cineverse_prod FROM PUBLIC;
REVOKE USAGE, CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE cineverse_prod TO cineverse_migrator, cineverse_app;
GRANT CREATE ON DATABASE cineverse_prod TO cineverse_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO cineverse_migrator;
GRANT USAGE ON SCHEMA public TO cineverse_app;
ALTER ROLE cineverse_migrator IN DATABASE cineverse_prod
  SET search_path = pg_catalog, public;
ALTER ROLE cineverse_app IN DATABASE cineverse_prod
  SET search_path = pg_catalog, public;
COMMIT;
```

Draft chỉ quản lý ACL database đích; **chưa đủ để qua otherDatabaseConnect**.
NOLOGIN là trạng thái provisioning tạm thời: production checker vẫn phải từ chối
nó đến khi đã cấp secret và chuyển LOGIN. Không sửa canLogin guard để bỏ qua.
Không biến script thành CREATE IF NOT EXISTS hoặc tự ALTER role đã có.

### 5.3 ACL database khác: review trước mọi REVOKE

Liệt kê từng DB có datallowconn=true, owner, effective CONNECT, grantees và các
dịch vụ phụ thuộc. Những tên có thể gặp là postgres/template1/neondb, không coi
danh sách này là inventory thật của branch. Với từng DB, chỉ owner/role có grant
option hợp lệ mới được sửa ACL; neon_superuser không mặc nhiên là SUPERUSER.

Nếu có PUBLIC CONNECT, DBA phải review việc cấp explicit CONNECT cho admin và
các dịch vụ cần trước khi revoke PUBLIC trên **đúng database đã duyệt**. Không
thêm loop tự revoke mọi DB, không sửa template/system objects chưa có quyền,
không cố đổi owner database provider. Không có DENY riêng để giữ PUBLIC CONNECT
cho mọi người nhưng chặn chỉ hai role này [S4].

Nếu không được sửa một DB mà checker vẫn thấy CONNECT=true: dừng trước migration.
Không coi không kết nối được qua endpoint/network hoặc datallowconn khác với
effective ACL check. Một provider isolation exception sẽ cần threat model và
quyết định policy riêng; review này không thiết kế đường bypass.

### 5.4 Runtime grants: chạy bằng object owner thực

Sau migration, kết nối **trực tiếp bằng cineverse_migrator** để thực thi script
runtime grants hiện có. Database owner không tự có table ownership/grant option;
`pg_read_all_data` / `pg_write_all_data` không phải lý do để giả định có thể GRANT.

```sql
-- Chỉ sau khi đủ năm bảng được xác nhận thuộc cineverse_migrator.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."User", public."Session", public."PasswordResetToken", public."Favorite"
  TO cineverse_app;
```

Giữ nguyên DO ownership assertion và target/opt-in của
`production-runtime-grants.sql`; block GRANT trên không thay thế chúng. Hiện
không cần đổi danh sách grant. Nếu owner bảng/history khác migrator: dừng, không
REASSIGN OWNED/ALTER OWNER rộng, không cấp GRANT ALL để né lỗi ALTER TABLE.

Không thêm `ALTER DEFAULT PRIVILEGES ... GRANT ... ON TABLES TO cineverse_app`.
Kiểm default ACL của **migrator** trước migration và effective ACL sau migration;
schema-specific REVOKE không xóa được grant mặc định ở global scope [S5]. Có
default grant lạ thì DBA review nguồn/quyền và kế hoạch thu hồi riêng, không tự
chạy một chuỗi REVOKE diện rộng trong tài liệu này.

## 6. Credentials: vấn đề khác với native PostgreSQL

Neon tài liệu hóa password dạng plaintext khi đặt qua SQL, không nhận password
hash; `psql \password` lại mã hóa phía client trước khi gửi ALTER ROLE [S1, S8].
Vì vậy, không khẳng định hướng dẫn `PASSWORD NULL` + `\password` trong script
generic dùng được trên Neon. Việc Neon chấp nhận đúng bootstrap PASSWORD NULL
cũng chưa được kiểm tra. Draft dùng NOLOGIN không kèm PASSWORD để tách bước này.

Thiết kế nhập secret, **không thực thi trong phase này**:

1. Tạo hai secrets độc lập bằng password manager/CSPRNG tin cậy, độ dài ngẫu
   nhiên đề xuất 32 ký tự trở lên; không dùng tên project, ngày tháng hoặc mẫu
   cố định. Không in/ghi generated value vào source, docs, command line hay chat.
2. Ưu tiên Console **reset password của SQL-created role đã có** nếu provider
   xác nhận hỗ trợ trạng thái role đó và không đổi attributes/memberships.
   Đây không phải nút Add role. Lưu giá trị trực tiếp vào secret manager, không
   copy toàn bộ response/connection string ra log. Không giả định reset API có
   thể khởi tạo mọi SQL-created NOLOGIN/passwordless role.
3. Nếu cần SQL initialization, dùng một công cụ operator đã review: nhập ẩn
   trong terminal không recording hoặc lấy từ secret manager; direct TLS xác
   thực chứng chỉ/hostname; giữ secret trong RAM; chỉ gửi ALTER ROLE tới tên role
   allowlist bằng literal quoting của driver phù hợp. Không ghép chuỗi thô,
   `psql -c` chứa password, SQL Editor history, `\echo`, debug SQL, stdout/stderr
   driver hoặc file tạm. Utility DDL không nhận `$1` như value parameter trong
   một SELECT thông thường; cần thiết kế quoting đúng, không hứa bind trực tiếp.
4. Password literal đi qua TLS tới provider; local no-log **không chứng minh**
   provider không ghi statement/error/audit logs. Phải xác minh redaction với
   provider/operator trước. Nếu chưa có kênh không lưu secrets đã xác nhận,
   giữ NOLOGIN và dừng; chưa cung cấp executable credential helper ở phase này.
5. Khi secret đã được đặt an toàn, bootstrap admin kích hoạt LOGIN cho từng
   role đã review. Kiểm lại flags/membership/ACL trước và sau, không cấp owner,
   CREATEDB/CREATEROLE/BYPASSRLS/REPLICATION hoặc neon_superuser để sửa lỗi login.
6. Connection credentials dùng prompt hoặc secret manager/service configuration
   ngoài repo, không đưa password vào argv/history. App chỉ nhận DATABASE_URL;
   release runner chỉ giữ MIGRATION_DATABASE_URL trong scope cần thiết. URL
   password được encode đúng khi cấu thành trong RAM; không log URL.

API reset password có thể ngắt connections; provider báo phải chờ operations
hoàn tất [S9]. Không gọi API này trong review. Hai đường Console/reset và SQL
initialization là phương án cần xác minh, chưa được coi là credential workflow
cloud đã pass. Giữ provider-owner secret ngoài Render HTTP runtime hoàn toàn.

## 7. TLS, Prisma và migration release order

- Dùng direct FQDN chính xác, port 5432 cho cả runtime/migration theo policy 9B;
  không chuyển pooler/serverless adapter trong task này.
- Với psql/operator client, dùng verify-full và CA public tin cậy [S10]. Với app,
  giữ URI contract `schema=public&sslmode=require&sslaccept=strict`; node-pg nhận
  SSL object tường minh `rejectUnauthorized=true` + `servername=expectedHost`.
  Không đồng nhất libpq sslmode=require đơn lẻ với driver strict của Cineverse.
- Prisma 7 config đọc MIGRATION_DATABASE_URL trong production; optional CA public
  được chuyển cho CLI qua sslcert. Không thêm directUrl trong schema.prisma,
  không sửa sslmode allowlist để copy chuỗi provider có options tùy ý.
- Không dùng NODE_TLS_REJECT_UNAUTHORIZED=0, accept-invalid-cert hoặc CA/private
  key không tin cậy. Cloud certificate/hostname verification vẫn chưa được test.
- Release checkout sạch không có backend/.env; các CLI migration/check vẫn có
  loader .env hiện hữu. Đừng chạy từ workspace chứa dev .env rồi suy đoán env
  injection sẽ thắng. Review chỉ đọc implementation của loader, không đọc file.

Thứ tự sau khi có **authorization mới để thay đổi database**:

1. Xác nhận project/branch/endpoint, actual owners, empty inventory và các ACL
   ngoài database đích; chốt credential channel. Chưa đạt thì chưa provision.
2. Chạy bootstrap đã review bằng admin, kiểm trạng thái NOLOGIN/flags/membership.
3. Review và thu hẹp other-DB PUBLIC ACL nếu provider cho phép và không ảnh hưởng
   dịch vụ khác. Chạy lại metadata, không chỉ xem trực tiếp một dòng GRANT.
4. Cấp secrets/kích hoạt LOGIN theo mục 6. Đăng nhập trực tiếp từng role, kiểm
   current_user=session_user, database identity, TLS và metadata.
5. Release runner chạy read-only preflight
   `npm run db:roles:check -- --migration`. Runtime check đầy đủ chưa thể pass
   trước khi có application tables/grants; không sửa guard vì điều này.
6. Review bốn migrations/checksums, inventory/history, backup nếu đã có dữ liệu;
   sau đó mới chạy **wrapper** `npm run db:deploy:production`. Không chạy migrate
   dev/reset/db push, không bypass wrapper bằng một migrate deploy trực tiếp.
7. Xác nhận bốn migrations hoàn tất, không rolled_back, drift=0; đủ năm bảng
   migrator-owned, indexes/FKs đúng, không sequence ngoài dự kiến. Không SELECT
   account/session rows để review quyền.
8. Migrator/object owner chạy runtime grants script với explicit opt-in;
   recheck cả migration/runtime bằng kết nối role thực. Không qua SET ROLE.
9. Negative permission tests trên sandbox/branch được phép, rồi xác minh production
   startup guard từ chối role/ACL/TLS sai. Chỉ cấp runtime secret cho HTTP sau
   khi tất cả pass. Không migrate trong build/start.

## 8. Test design và evidence boundary

Không viết/running cloud SQL hoặc native provisioning tests trong phase review.
Không dùng dữ liệu tài khoản thật. Những tests sau là yêu cầu cho bước thực hiện:

| Test | Kỳ vọng / bằng chứng cần thu |
| --- | --- |
| Bootstrap bằng non-superuser CREATEROLE/database owner, schema pg_database_owner | Tạo đúng hai roles; giữ owner schema; cấp schema/database CREATE đúng; xác nhận chiều ADMIN membership. Native superuser bootstrap hiện có chưa chứng minh trường hợp này. |
| NOLOGIN rồi credential activation | Trước activation không login được; sau activation login trực tiếp đúng role; flags/memberships không bị nâng quyền. Không log password/DSN. |
| Sai database/owner, role đã có, relation provider/extension đã có | Abort trước thay đổi; rollback; không tự sửa/xóa object cũ. |
| PUBLIC CONNECT ở DB khác, kể cả DB không owned bởi bootstrap | Metadata check fail closed; role-specific REVOKE không che PUBLIC. Provider không cho sửa thì ghi NO-GO, không bỏ assertion. |
| Migration bằng migrator trên schema public do role khác sở hữu | Bốn migrations + history tạo bằng migrator; idempotent deploy; drift=0; FK/ALTER TABLE hoạt động. |
| Bảng/history thuộc admin, chỉ GRANT CRUD cho migrator | Preflight ownership từ chối; không thử migrate để tìm đường bypass. |
| Runtime grants do migrator, không do admin giả định | CRUD đúng bốn bảng; grantor hợp lệ; history không có table/column access hoặc grant option. |
| Runtime negative permissions | DDL/CREATE SCHEMA/CREATE DB/TEMP/TRUNCATE/history SELECT/SET ROLE/elevated-role operations đều bị từ chối. Dùng transaction rollback và objects test trên môi trường riêng đã được phép. |
| Default privilege leak | Grant mặc định từ migrator tới app làm lộ history thì runtime check phải fail; owner mặc định khác không được coi là đã cấu hình cho migrator. |
| Sequences / routines / extra schema | Quyền ngoài allowlist hoặc executable SECURITY DEFINER không được review phải fail; không ignore theo tên provider. |
| TLS / identity | Invalid CA/hostname, wrong role/sessionRole/database/schema hoặc query override bị chặn; kết nối đúng pass với driver hiện có. |
| HTTP startup | Chưa cấp grants, sai owner runtime, hoặc có migration secret trong HTTP env đều phải fail closed; đúng config/ACL mới listen. |

Tests hiện có đã đọc:

- `backend/tests/production-database.test.mjs`: config, snapshot rejection,
  ownership, pinned migrations, SQL safety và factories. Có riêng một WASM ACL
  integration và CLI tests; chúng không được chạy trong review này.
- `backend/integration/fixture.mjs` / `native.test.mjs`: bootstrap superuser của
  cluster tạm, real multi-connection transaction/negative tests. Fixture đổi tên
  target thành cineverse_ci, cấp passwords tổng hợp và revoke PUBLIC DB hệ thống
  bằng bootstrap; không phải bằng chứng về quyền admin trên Neon.
- Regression cần bổ sung ở bước implementation: non-superuser bootstrap với
  pg_database_owner, staged NOLOGIN activation và grants chạy bằng migrator.
  Giữ test LOGIN requirement lúc kích hoạt; sửa static regex bootstrap chỉ khi
  executable script NOLOGIN được duyệt, không giảm assertions security.

Validation thực tế của review được ghi ở mục 10. Không sử dụng kết quả CI của
phase trước như một lần cloud provisioning thành công.

## 9. Go / No-Go và bước kế tiếp

Chỉ chuyển sang provisioning khi đã xác nhận:

- Đúng branch staging; database owner là bootstrap role, public owner phù hợp,
  không object/default ACL/provider routines bất ngờ.
- Đường tạo SQL roles không tự thêm elevated flags/membership; không dùng Add role.
- Provider cho phép thu hẹp mọi effective other-DB CONNECT theo guard, hoặc có
  bằng chứng hiện tại đã false. Không có ngoại lệ tự động cho postgres/template1.
- Kênh cấp password cho SQL-created roles được xác nhận, không log/history, và
  phương án activation giữ attributes nguyên vẹn.
- Direct strict TLS chạy được bằng PrismaPg/Prisma CLI đang pin; không dùng admin
  URL cho runtime; release secret scope độc lập.
- Có kế hoạch test ownership/negative permissions/rollback và quyền thực hiện
  riêng cho bước sau. Không provision chỉ vì đã review được SQL syntax.

**Bước tiếp theo đề xuất:** một đợt preflight metadata chỉ đọc trên Neon, khi
người dùng cho phép riêng; trước hết inventory database ACL/owners/default ACL
và xác minh password initialization với tài liệu/support provider. Sau đó mới
duyệt executable provisioning patch, thêm regression tương ứng và xin thực hiện
DDL theo kết quả cụ thể. Không yêu cầu gửi secrets vào chat.

## 10. Kết quả kiểm tra trong nhiệm vụ này

- Chỉ thêm tài liệu này; không sửa executable SQL, JS/TS, Prisma schema/migrations,
  credentials hoặc cấu hình production.
- Đã đọc source và tài liệu chính thức; SQL draft chỉ static review, chưa parser/
  server validation trên PG17 hoặc Neon. Không tuyên bố compatibility đã pass.
- Đã chạy **11/11 offline tests đạt** từ `production-database.test.mjs` bằng
  test-name-pattern chọn đúng các config/snapshot/ownership/manifest/static SQL/
  factory tests. Không chạy hai nhóm CLI và WASM còn lại, không instantiate DB.
- Tài liệu: 14 local links hợp lệ, code fences cân bằng, không trailing whitespace;
  các mẫu JWT/Resend key/credential URL/private key/session cookie không phát hiện
  trong tài liệu. Không đọc secret thật để so khớp; đây không phải bảo đảm tuyệt
  đối rằng mọi loại thông tin nhạy cảm đều được phát hiện.
- Git diff xác nhận backend/frontend/scripts/package/lockfile/deploy không đổi.
  Không chạy full suite/native/WASM/cloud hoặc lint/typecheck/build vì chỉ thêm
  Markdown; không có executable-code change. Không tuyên bố SQL draft đã pass
  runtime test hoặc đã provision được Neon.
- `.agents/` và `skills-lock.json` đã untracked từ trước review; không sửa, stage
  hoặc coi chúng là deliverable của task.

## 11. Nguồn chính thức

Các nguồn được đọc ngày review; điều kiện provider vẫn phải đối chiếu trên project.

- [S1 — Neon Manage roles](https://neon.com/docs/manage/roles): SQL roles, privileges và password constraints.
- [S2 — Neon Manage database access](https://neon.com/docs/manage/database-access): selective database/schema/object grants.
- [S3 — PostgreSQL 17 predefined roles](https://www.postgresql.org/docs/17/predefined-roles.html): pg_database_owner.
- [S4 — PostgreSQL 17 privileges](https://www.postgresql.org/docs/17/ddl-priv.html): ownership, additive ACL và database defaults.
- [S5 — PostgreSQL 17 ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html): creator/global/schema semantics.
- [S6 — PostgreSQL 17 role membership](https://www.postgresql.org/docs/17/role-membership.html): INHERIT/SET.
- [S7 — PostgreSQL 17 role attributes](https://www.postgresql.org/docs/17/role-attributes.html): non-superuser CREATEROLE và ADMIN.
- [S8 — PostgreSQL 17 psql](https://www.postgresql.org/docs/17/app-psql.html): password command behavior.
- [S9 — Neon Reset role password API](https://neon.com/docs/reference/api/branches/reset-project-branch-role-password): operations/connections caveat.
- [S10 — Neon secure connections](https://neon.com/docs/connect/connect-securely): operator TLS verification.

## 12. Bổ sung 2026-11-02 — PUBLIC CONNECT blocker review

### 12.1 Metadata và kết luận trong phạm vi review

Người dùng cung cấp metadata mới từ Neon PG17.11: PUBLIC có CONNECT trên
`cineverse_prod`, `postgres`, `template0`, `template1`; riêng `template0` có
`datallowconn=false`. Bootstrap owner thuộc `neon_superuser`. Review này không
kết nối để xác minh lại; không tạo app/migrator hoặc gọi role checker lên Neon.

**Giữ PUBLIC CONNECT trên một database khác có datallowconn=true thì không thể
đạt guard nguyên trạng bằng cách chỉ cấu hình hai role ứng dụng.** Đây là bất
tương thích với security contract hiện có, chưa phải bằng chứng role truy cập
được dữ liệu tài khoản. Việc postgres/template1 do ai sở hữu, provider cho phép
sửa ACL ra sao, và effective privileges thực của hai role vẫn chưa được cloud-test.

Metadata mới chỉ nêu tường minh datallowconn của template0. Cần thu thêm cột này
cho postgres/template1 trước khi ghi nhận kết quả thực tế vô điều kiện. Với
datallowconn=true như trạng thái thường gặp, **cả postgres lẫn template1 đều là
blocker độc lập**; không suy ra cột này chỉ từ tên database hay quyền CONNECT.

### 12.2 Predicate chính xác và nơi bị chặn

[role-security.mjs](../backend/database/role-security.mjs),
`inspectRoleSecurity`, hiện dùng predicate sau, không parse chuỗi ACL bằng tay:

```sql
EXISTS(
  SELECT 1 FROM pg_catalog.pg_database x
  WHERE x.datallowconn AND x.oid <> d.oid
    AND has_database_privilege(current_user, x.oid, 'CONNECT')
) AS "otherDatabaseConnect"
```

`d` là database hiện tại; identity guard yêu cầu nó là cineverse_prod.
`validateProductionRole` dùng cùng điều kiện cho runtime lẫn migration:

```js
if (id.dbOwner !== false || id.dbConnect !== true || id.dbTemp !== false ||
  id.dbCreate !== !runtime || id.otherDatabaseConnect !== false)
  fail('DATABASE_PRIVILEGES')
```

Chỉ cần EXISTS tìm được **một** database thì otherDatabaseConnect=true. Guard
không phân biệt database hệ thống/ứng dụng, không loại bằng datistemplate hoặc
tên postgres/template1. Nó cũng không thử socket, password hay SELECT bảng của
database đó. `has_database_privilege` hỏi quyền hiệu lực của current_user [S11].

| Database | PUBLIC CONNECT theo metadata | datallowconn | Đóng góp vào otherDatabaseConnect khi current DB là cineverse_prod |
| --- | --- | --- | --- |
| cineverse_prod | Có | Không quyết định predicate này | Không: cùng OID với d. Runtime/migrator vẫn cần dbConnect=true ở database đích. |
| postgres | Có | Chưa được nêu tường minh; cần xác nhận | Có nếu true; không nếu false. Không có ngoại lệ cho database mặc định. |
| template0 | Có | false, đã được người dùng nêu | Không: bị loại ngay bởi x.datallowconn. CONNECT ACL vẫn có thể true, hai điều kiện này độc lập. |
| template1 | Có | Chưa được nêu tường minh; cần xác nhận | Có nếu true; datistemplate=true không miễn trừ. Không nếu datallowconn=false. |
| Database khác chưa inventory | Chưa biết | Chưa biết | Có nếu khác OID, datallowconn=true và role có effective CONNECT. Không giới hạn kiểm tra vào bốn tên trên. |

PostgreSQL mô tả datallowconn=false chặn kết nối mới; thay đổi cờ không tự chấm
dứt kết nối đang tồn tại. Template flag và CONNECT ACL là các thuộc tính riêng
[S12, S13]. Không đề xuất sửa cờ template/system database để làm checker xanh.

Luồng bị chặn: createDatabaseClient → assertProductionRole →
validateProductionRole. Điều này áp dụng cho CLI `db:roles:check`, migration
preflight trước deploy, và production HTTP startup qua runtime client. Với
identity/attributes đúng, otherDatabaseConnect=true dẫn tới DATABASE_PRIVILEGES.
Nếu thử dùng provider owner thay app/migrator thì có thể bị IDENTITY hoặc
attributes check từ chối sớm hơn; owner không phải cách sửa blocker.

### 12.3 Root cause và ba tầng quyền cần phân biệt

PUBLIC là pseudo-role áp dụng cho tất cả roles, kể cả role tạo sau; quyền là
tổng hợp từ direct grants, membership và PUBLIC [S14]. Vì vậy membership=0 và
NOINHERIT không làm mất PUBLIC CONNECT. Cấp riêng CONNECT trên cineverse_prod
không giới hạn role chỉ còn database đó. REVOKE riêng app/migrator cũng không
phủ định PUBLIC; ACL này không có per-role DENY ưu tiên hơn PUBLIC GRANT.

Script production-roles.sql chỉ thu hẹp PUBLIC của database **cineverse_prod**.
Nó không sửa postgres/template1 và đã ghi yêu cầu DBA xử lý ACL khác riêng.
production-runtime-grants.sql chỉ xử lý bốn bảng trong database đích, không tác
động database CONNECT. Vì vậy hoàn tất hai script vẫn chưa chứng minh guard pass.
Membership neon_superuser của owner không phải điều kiện cần để gây lỗi này:
SQL-created role thường vẫn nhận PUBLIC CONNECT.

| Tầng | Ý nghĩa | Điều guard hiện có đo được |
| --- | --- | --- |
| CONNECT ACL | has_database_privilege trả quyền theo catalog | Có; kết hợp datallowconn và khác OID. Không phải một phép thử kết nối. |
| Kết nối mới thực tế | Cần thêm LOGIN/authentication, endpoint routing, TLS/network/HBA, database chấp nhận kết nối và limits | Không kiểm hết các yếu tố này cho từng DB khác. ACL=true không bảo đảm kết nối thành công. |
| Truy cập dữ liệu / thực thi | Cần kiểm schema USAGE, table/column/sequence/routine ACL, ownership, membership và RLS nếu có | Checker hiện chỉ inventory objects trong database đang kết nối, không chứng minh isolation dữ liệu ở postgres/template1. |

CONNECT không tự cấp SELECT/INSERT/UPDATE/DELETE trên mọi bảng. Ngược lại,
database mặc định trống hoặc table ACL hạn chế không có nghĩa CONNECT vô hại:
cần review metadata visibility, schema defaults, TEMP nếu được cấp, routines và
resource consumption. Không mặc định PUBLIC chỉ có CONNECT hoặc mọi system DB
đều an toàn. PostgreSQL tách CONNECT tại startup với schema/object privileges
[S4]. DSN khóa database đích bảo vệ luồng app chuẩn; credentials bị lộ có thể được
dùng từ client khác, nên DSN validation không thay thế database isolation.

### 12.4 Neon có đáp ứng nguyên trạng mà không sửa provider DB không?

Tài liệu Neon hướng dẫn selective SQL roles và thu hồi quyền database của PUBLIC
bằng REVOKE; không mô tả một per-role deny để giữ PUBLIC CONNECT mà
has_database_privilege trả false [S1, S2]. Trong các nguồn chính thức đã đối
chiếu, **chưa tìm thấy cơ chế Neon Free được hỗ trợ giải quyết invariant này mà
giữ nguyên ACL/connection-acceptance của các DB đang gây lỗi và giữ nguyên guard**.
Đây không phải kết luận rằng mọi cấu hình Neon đều không thể least-privilege,
hoặc rằng mọi provider database tuyệt đối không được phép REVOKE: hai nhận định
đó cần provider xác nhận, không có bằng chứng trong review này.

Các cách sau không đáp ứng guard hiện tại:

- NOINHERIT, không grant neon_superuser, role riêng hoặc đổi password: vẫn có
  PUBLIC CONNECT. Các biện pháp đó vẫn cần cho least privilege ở mặt khác.
- Chỉ sửa ACL/schema/RLS trong cineverse_prod: không thay predicate trên DB khác.
- Firewall/IP allowlist/HBA/proxy chặn đường kết nối, dùng direct hay pooler:
  không biến CONNECT ACL thành false. Không coi routing restriction là bằng
  chứng kiểm soát catalog đã đạt; không giả định Neon cung cấp HBA tùy biến.
- Dùng project/branch riêng, Prisma schema khác hoặc hostname riêng: hữu ích cho
  ranh giới dữ liệu nhưng không xóa system DB/default grants trong catalog.
- Chuyển plan trả phí: không có bằng chứng tự thay đổi ACL semantics này; không
  đề xuất trả tiền như một cách sửa đã được xác minh.
- Gỡ kiểm tra, che rows trong pg_database, thêm exception theo tên không review,
  dùng owner/migrator runtime hoặc đổi datallowconn system DB: không được áp dụng.

Nếu provider xác nhận có thể xử lý ACL, đó là một nhánh giải pháp khác cần review
tác động; **không còn đáp ứng ràng buộc giữ nguyên provider-managed database**.
Nếu sau này thu được metadata cho thấy postgres/template1 đều datallowconn=false
và không có DB khác thỏa predicate, riêng guard này có thể pass dù còn PUBLIC
CONNECT. Đó là kết quả quan sát cần chứng minh, không phải lời khuyên đổi cờ.

### 12.5 Các phương án an toàn và tradeoff

| Phương án | Giữ guard? | Điều kiện, tradeoff và residual risk |
| --- | --- | --- |
| A. Giữ nguyên policy, chờ feasibility/provider clarification | Có | Lựa chọn mặc định hiện tại. Không có deploy khi chưa đạt; mất thời gian chờ nhưng không tự chấp nhận rủi ro mới. |
| B. Provider-supported ACL remediation | Có | Chỉ khi Neon xác nhận quyền và cách thao tác an toàn trên đúng DB. Cần authorization thay đổi quyền riêng; giữ admin/service access, review defaults và future DBs. Không chạy REVOKE diện rộng hay đụng template0 để né check. Không thỏa điều kiện không sửa provider DB. |
| C. Review security contract cho system DB exceptions hữu hạn | Không, cần thay đổi có duyệt | Có thể xem xét cho staging độc lập nếu chấp nhận CONNECT tới provider DB đã inventory. Không đủ chỉ allowlist tên postgres/template1 hoặc return false cho otherDatabaseConnect. Xem điều kiện review bên dưới. |
| D. Chọn môi trường PostgreSQL có quyền quản trị ACL phù hợp | Có nếu thực tế đạt | Cần kiểm chứng provider mới/self-managed PG17, role ownership, TLS và least privilege; có chi phí vận hành/backup/patching/công việc chuyển đổi. Không cam kết có phương án free; không tạo resource trong task. |

Nếu chọn C ở nhiệm vụ sau, phải có ADR/threat model và phê duyệt residual risk:

- Bỏ yêu cầu tuyệt đối không CONNECT DB khác là **thay đổi policy**, không đổi tên
  biến hoặc sửa test để coi như policy cũ vẫn đạt. Giữ behavior mặc định fail closed.
- Cần identity/owner/provider provenance, scope branch/project, datallowconn,
  effective CONNECT/CREATE/TEMP và inventory schemas/tables/columns/sequences/
  extensions/routines ở từng DB ngoại lệ. Một query từ cineverse_prod không
  inventory toàn bộ objects của database khác; cần session khác trong bước được phép.
- Không user/application data ngoài database đích; review exposure metadata,
  PUBLIC schema/TEMP, executable SECURITY DEFINER và khả năng tạo/đổi objects.
  Không tự xóa PUBLIC grants của provider để đạt acceptance criteria.
- Mọi other application/unknown database vẫn phải bị chặn; kiểm soát database
  tạo mới/rename/ownership drift, recheck theo vòng đời release/provider upgrades.
  Ranh giới project/branch riêng không phải zero cross-database capability.
- Runtime và migrator đều cần test; không bỏ flag/membership/TLS/ownership/table
  allowlist/history isolation hoặc session identity guards còn lại.
- Bộ test phải bao gồm exception hợp lệ, unknown DB, owner/provenance thay đổi,
  data/DDL/TEMP/routine exposure, template0 bị loại đúng khi datallowconn=false,
  template1 không bị bỏ qua chỉ vì datistemplate, và failure khi không đủ evidence.
- Dùng test accounts/objects trong sandbox được phép; actual connection denial
  và metadata ACL cần báo cáo riêng. Không gọi một lần connect thất bại là bằng
  chứng ACL=false hoặc an toàn vĩnh viễn.

### 12.6 Bước tiếp theo có kiểm chứng và validation của bổ sung

Đề xuất hiện tại là **A**: giữ guard và NO-GO cho rollout chưa đạt policy. Chuẩn
bị trao đổi với provider, không tự gửi message/ticket trong nhiệm vụ này:

1. Xác nhận datallowconn/datistemplate, actual owners và PUBLIC/effective CONNECT
   cho tất cả databases, đặc biệt postgres/template1; không chỉ chụp tên/ACL.
2. Hỏi Neon liệu có supported ACL policy cho hai SQL-created roles không CONNECT
   postgres/template1, ảnh hưởng tới compute/maintenance/backup/default grants,
   và policy có được giữ qua restart/branching/upgrade không. Không gửi secrets.
3. Nếu câu trả lời chỉ là network routing hoặc project isolation, ghi rõ nó
   không đáp ứng predicate hiện tại. Nếu không thể đạt và vẫn muốn dùng Neon,
   chọn C qua review riêng, hoặc D; không tạo roles/migrate để bỏ qua blocker.
4. Khi được phép kết nối chỉ đọc sau này, đối chiếu metadata và effective flags
   bằng identity thực. Chưa có hai roles thì không coi thử bằng owner là kết
   quả của app/migrator; role creation là bước ghi cần authorization khác.

Validation thực tế của lần bổ sung này:

- **2/2 unit tests hiện có đạt**, chọn bằng pattern `^(runtime|migration): rejects`
  trong `production-database.test.mjs`; kiểm trường hợp snapshot có
  otherDatabaseConnect=true bị từ chối cho cả hai purpose, cùng các attributes
  không hợp lệ. Đây không phải query has_database_privilege trên Neon.
- 15 local links hợp lệ, code fences cân bằng, không trailing whitespace;
  không phát hiện các mẫu secret đã quét trong tài liệu. Không đọc credentials
  thật để so khớp, không tuyên bố đây là secret detection tuyệt đối.
- Git diff xác nhận executable backend/frontend/scripts/package/lockfiles/deploy
  không đổi. Chỉ bổ sung tài liệu đang untracked từ review trước; `.agents/` và
  `skills-lock.json` vẫn là thay đổi có trước, không thuộc nhiệm vụ này.
- Không chạy CLI có loader .env, WASM/native SQL, migrations hay cloud checks;
  không chạy full tests/lint/typecheck/build vì chỉ đổi Markdown. Các số ở mục
  10 thuộc đợt review trước, không đại diện cho lần kiểm chứng Neon mới.

Nguồn bổ sung, đối chiếu ngày 2026-11-02:

- [S11 — PostgreSQL 17 privilege inquiry functions](https://www.postgresql.org/docs/17/functions-info.html#FUNCTIONS-INFO-ACCESS-TABLE): has_database_privilege.
- [S12 — PostgreSQL 17 pg_database](https://www.postgresql.org/docs/17/catalog-pg-database.html): datallowconn/datistemplate.
- [S13 — PostgreSQL 17 template databases](https://www.postgresql.org/docs/17/manage-ag-templatedbs.html): template status và new/existing connections.
- [S14 — PostgreSQL 17 GRANT](https://www.postgresql.org/docs/17/sql-grant.html): PUBLIC và tổng hợp quyền.
