# Phase 9C.2B — Managed PostgreSQL security compatibility

Ngày: 2026-11-02. Status: implementation mặc định strict; **chưa duyệt bật Neon
opt-in hoặc provisioning/staging rollout**. Không kết nối Neon, không chạy SQL
lên database developer/cloud, không sửa `.env`, không deploy/commit/push.
Native tests chỉ dùng cluster mới có disposable marker/cổng riêng, fixture accounts.

**SEC-PG-PREFIX-01: CLOSED qua code/local regression** sau hotfix mục 11.
Finding và bằng chứng phát hiện trước sửa được giữ ở mục 10. Đủ điều kiện chạy
lại final security review; chưa phải approval bật Neon compatibility hoặc deploy.
Không commit/push trong nhiệm vụ hotfix này.

## 1. Findings và phản hồi provider

- Guard cũ từ chối bất kỳ effective CONNECT tới DB khác có datallowconn=true.
  PUBLIC CONNECT ở postgres/template1 khiến role thường cũng không đạt.
- Người dùng cung cấp phản hồi Neon Community: đây là default PostgreSQL privileges;
  CONNECT không tự cấp quyền dữ liệu; không khuyến nghị sửa Neon-managed DB và
  nên quản lý quyền trên objects của ứng dụng. Đây là nội dung người dùng cung
  cấp, chưa có URL/ticket hoặc attestation độc lập được kiểm chứng trong task.
- [Neon access docs](https://neon.com/docs/manage/database-access) mô tả selective
  SQL roles; [role docs](https://neon.com/docs/manage/roles) phân biệt SQL-created
  roles với roles tạo qua control plane có neon_superuser. Không coi Community
  reply là chứng minh table/schema/routine ACL của mọi provider database an toàn.
- Native regression tái lập public schema USAGE trong DB mặc định. Vì vậy một
  ngoại lệ CONNECT theo tên không đủ cho yêu cầu không có quyền ngoài phạm vi.
- PostgreSQL chỉ có catalog objects của database đang kết nối; pg_database là
  catalog dùng chung. Muốn inspect table/schema ACL ở DB khác phải có connection
  khác; không suy ra từ một query trên cineverse_prod.
  [PostgreSQL 17 catalog scope](https://www.postgresql.org/docs/17/catalogs-overview.html)
  và [database catalog](https://www.postgresql.org/docs/17/catalog-pg-database.html).

## 2. Audit các predicates đang có

| Nhóm | Guard trước đây; tiếp tục áp dụng |
| --- | --- |
| Config identity | Production explicit; host DNS chính xác, direct 5432, cineverse_prod/public; đúng username theo purpose; query options allowlist. |
| TLS | node-pg rejectUnauthorized=true + servername; Prisma URI require/strict; CA public optional được parse. Không đổi sang insecure TLS/pooler/serverless adapter. |
| Actual identity | current_database=cineverse_prod; current_user=session_user đúng cineverse_app hoặc cineverse_migrator. Không SET ROLE giả identity. |
| Role attributes | LOGIN=true; SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS/INHERIT=false; pg_auth_members với role là member phải bằng 0. Neon_superuser membership bị chặn kể cả NOINHERIT. |
| Database ACL | Không sở hữu DB đích; CONNECT=true, TEMP=false; CREATE=false cho runtime, true cho migrator. Các quyền này là effective privileges. |
| Public schema | USAGE=true; CREATE chỉ cho migrator. Runtime không được own/create schema nào hoặc USAGE schema ngoài public. Migrator không có cùng blanket schema-ownership check với runtime. |
| Runtime ownership/routines | Không own non-system relations/functions/types; không executable non-system SECURITY DEFINER routines. |
| Bốn application tables | Runtime cần effective SELECT/INSERT/UPDATE/DELETE; không TRUNCATE/REFERENCES/TRIGGER, DML grant option hoặc column grant option. |
| Extra tables/history | Runtime không có quyền bảng/cột ở relations ngoài allowlist, gồm _prisma_migrations. |
| Sequences | Runtime không có usage/select/update/ownership ở sequences; model hiện dùng UUID do client tạo. |
| Migrator ownership | Relations trong public chỉ được thuộc bốn bảng + history và phải owned bởi migrator. Database mới chưa có bảng được chấp nhận trước migration. |
| Migrations | Inventory/checksums/prefix history/drift đã pin. Runtime grants explicit bốn bảng, không DEFAULT/ALL TABLES grants. |
| Startup/secrets | Production role guard trước expose client/listen. HTTP runtime không được chứa MIGRATION_DATABASE_URL; release secrets tách runtime. |

**Phân biệt provenance:** schema/table checks cũ đo effective privileges, không
khẳng định các grant đều direct hoặc kiểm riêng nguồn PUBLIC của application CRUD.
Membership count không bao gồm PUBLIC vì đây là pseudo-role. Database ownership
khác schema ownership và table ownership. Không suy diễn GRANT CRUD cho phép ALTER.
MAINTAIN không phải predicate riêng của guard application-table cũ; probes mới
chặn MAINTAIN ở provider DB. Không tuyên bố phase này audit mọi đặc quyền PostgreSQL.

## 3. Contract mới: chỉ ngoại lệ CONNECT có điều kiện

### Strict — mặc định giữ nguyên

Không khai báo DATABASE_SECURITY_POLICY, hoặc đặt `strict`, giữ hành vi cũ.
Không có provider auto-detection; hostname Neon không tự bật ngoại lệ. File được
khai báo khi mode strict, mode sai hoặc opt-in trong local/test đều bị từ chối.
Không thêm file evidence thật vào project hoặc templates.

### Explicit opt-in — tắt trong tất cả template

Hai tên biến cấu hình:

```dotenv
DATABASE_SECURITY_POLICY=strict
DATABASE_PROVIDER_EVIDENCE_FILE=
```

Giá trị mode được hỗ trợ sau khi operator review là
`neon-reviewed-system-connect`; cần NODE_ENV=production và absolute evidence file.
Task này **không bật mode**. File tối đa 8KiB, JSON schema đóng, timestamps còn
hạn, review không nằm trong tương lai, lifetime tối đa 24h. Object config được freeze.

Evidence JSON có các fields sau, không có credentials:

| Fields | Vai trò và giới hạn |
| --- | --- |
| version=1, provider=neon | Kiểu cấu hình; chữ neon tự khai không phải attestation. |
| host, endpointId | Khớp PRODUCTION_DATABASE_HOST, prefix endpoint và hậu tố .neon.tech; không pooler. Driver xác minh certificate/hostname trên actual connection. |
| projectId, branchId, reviewRef | Dấu vết review của operator. Không được xác minh qua Neon API/SQL bởi code. |
| reviewedAt, expiresAt | Freshness của operator review; không chứng minh thời điểm provider ký hoặc tính bất biến ACL. |
| target | name=cineverse_prod, OID và owner name/OID được operator kiểm độc lập và pin. |
| systemDatabases | Đúng hai built-in names postgres/template1, OID/owner name/OID/template flag đã review. Owner không phải app/migrator và phải khác target owner. |

**Evidence file là trusted configuration của operator, không phải bằng chứng
xác thực/ký từ Neon.** Không có chữ ký, API verification hoặc cryptographic
binding cho projectId/branchId/reviewRef. TLS xác minh server cho pinned hostname;
không tự chứng minh project/branch đang chọn đúng với mục đích operator. OID có
thể giống trên các clusters/branches và không chứng minh provider ownership.
Điều kiện owner khác target là một constraint bảo thủ, không phải provider attestation.

Operator phải đối chiếu endpoint/project/branch và database ownership bằng kênh
provider đáng tin cậy trước khi cấp file, lưu ngoài source, read-only đối với app,
và review filesystem/secret-mount ACL. Không tự tạo evidence từ query đầu tiên
rồi tin luôn (TOFU); không có collector tự động hoặc sample có thể bật cloud.
Nếu model vận hành không tin operator/config channel, cơ chế này **không đủ**.

### Luồng kiểm tra opt-in

1. Chạy toàn bộ predicates cũ ngoài điều kiện cross-database CONNECT trước khi
   mở connection bổ sung. Điều kiện CONNECT gốc vẫn được giữ trong snapshot.
2. Đọc database inventory bằng current role: name/OID/owner/template/allowconn,
   effective CONNECT/CREATE/TEMP, CONNECT grant option, PUBLIC CONNECT và direct
   CONNECT. Khóa target và cả hai system DB theo identity trong config.
3. Database khác có allowconn=true và effective CONNECT=true chỉ được xét khi
   khớp system entry đã review. User/unknown DB vẫn fail. Cấm DB ownership,
   direct CONNECT, grant option, CREATE hoặc TEMP ở entry được xét.
4. Với mỗi entry được xét, mở connection mới **cùng endpoint/TLS/credential role**,
   chỉ thay database sang tên đã kiểm. Không dùng owner/migrator để probe thay
   cho runtime. Bật default_transaction_read_only và BEGIN READ ONLY.
5. Kiểm current/session role, database identity, flags, membership, ownership;
   không schema USAGE/CREATE/ownership, không table/column/sequence quyền ngoài
   phạm vi, không executable non-system routines, SECURITY DEFINER hoặc MAINTAIN.
   Chỉ inspect metadata; không đọc dữ liệu User/Session/password/reset tokens.
6. Recheck database inventory và **target role/ACL snapshot**; đổi giữa probes
   và final check thì fail. Evidence hết hạn giữa chừng cũng fail.
7. Approval nằm trong WeakMap nội bộ, gắn đúng snapshot reference + SHA-256 digest
   và policy object, chỉ có cửa sổ tiêu thụ <5s theo đồng hồ monotonic. Tự tạo
   object/boolean, sửa snapshot hoặc dùng snapshot cũ không được chấp nhận. Mỗi
   recheck xóa approval trước và dùng generation riêng; response cũ hoàn tất
   muộn không thể khôi phục approval sau một recheck mới đã thất bại.
8. Validator cuối vẫn kiểm toàn bộ predicates còn lại. Không sửa flag
   otherDatabaseConnect thành false để hợp thức hóa kết quả.

Mỗi direct probe có connect timeout 1.5s, statement timeout 1s, query timeout
1.5s và deadline 4s, kết thúc connection khi lỗi/timeout. Tối đa hai probe tuần
tự mỗi client-factory check. Không có retry vô hạn, SQL write hay fallback bỏ
probe. Thông báo fail chung không echo connection strings, values hoặc raw errors.
Default strict không thêm inventory/probe requests.

## 4. Trường hợp vẫn từ chối và ảnh hưởng Neon

- Thiếu/sai/hết hạn config; sai host/TLS/role/schema/database; chỉ khớp tên hoặc
  OID nhưng owner/endpoint/target khác; không đủ quyền đọc metadata; probe không
  kết nối được hoặc timeout; unknown DB được CONNECT; inventory thay đổi.
- Runtime/migrator có membership hoặc elevated flags; runtime owner/DDL/history
  access; migrator không own application objects; mọi predicate cũ khác vẫn strict.
- Provider DB còn public schema USAGE, TEMP, data/column/sequence grants,
  executable custom routines hoặc MAINTAIN đều fail. Không tự REVOKE hoặc tạo
  ngoại lệ thêm để làm Neon pass.
- template0 allowconn=false không cần ngoại lệ CONNECT; template1 không được
  miễn chỉ vì datistemplate=true. Tên provider DB bị tái sử dụng với OID/owner
  khác bị từ chối. Không có danh sách bỏ qua tất cả database của Neon.

**Chưa chứng minh actual Neon default ACL đạt các yêu cầu trên.** Native test
chứng minh một CONNECT-only exception vẫn fail với default schema USAGE. Nếu
Neon giữ các quyền đó và không hỗ trợ thu hẹp, patch này sẽ tiếp tục từ chối,
đúng với điều kiện dừng. Chọn strict + môi trường có ACL phù hợp, hoặc review
security contract mới riêng; không đề xuất sửa provider objects trái hướng dẫn.

## 5. TOCTOU, freshness và giới hạn kiểm chứng

- Recheck bắt được inventory drift và target role/schema/table/column ACL drift
  trong khoảng đã quan sát; không có một transaction atomic bao phủ mọi DB.
  Giữa các probes, quyền trong provider DB đầu tiên vẫn có thể đổi sau khi đã
  inspect, mà DB inventory không đổi. DBA/provider cũng có thể đổi ACL sau final
  check/startup. **Không tuyên bố đã loại bỏ toàn bộ TOCTOU.**
- Điều kiện vận hành cần trusted DBA/provider, không thay ACL đồng thời với
  preflight/startup; maintenance/release review và revalidation sau thay đổi.
  Nếu yêu cầu là chống quyền thay đổi tùy ý bởi admin không tin cậy, phương án
  này không đáp ứng và phải giữ strict/NO-GO. Không lock hoặc sửa provider DB.
- Guard hiện có chạy khi tạo production client/pool, không kiểm ACL trước mỗi
  query. File expiry/approval TTL được kiểm khi xác minh mới, không tự hủy pool
  đã được expose hoặc revoke một transaction đang chạy. Không trình bày TTL như
  continuous authorization/continuous monitoring.
- Connections read-only chỉ bảo vệ đường probe, không thu hồi quyền runtime ở
  những connections khác. Snapshot âm tính không chứng minh mọi SQL statement
  không thể gây side effect/resource consumption; core pg_catalog functions và
  việc quan sát metadata tiêu chuẩn không bị cấm.
- Live probes bằng actual login role chứng minh metadata tại thời điểm kiểm tra
  cho đúng database đã mở. Chúng không chứng minh mọi DB khác trong project/
  branch, provider internals, RLS semantics hay control-plane account security.
- Không thay session, CSRF, Origin, multi-tab/account binding hoặc API contracts.

## 6. Files thay đổi

| File | Trách nhiệm |
| --- | --- |
| backend/database/provider-policy.mjs | Parse explicit mode và bounded operator-config file; identity/expiry validation. |
| backend/database/provider-connect.mjs | Database inventory, fresh actual-role probes, fail-closed checks và snapshot-bound approval. |
| backend/database/connection-config.mjs | Nối policy vào production config; cấm opt-in local/test. |
| backend/database/role-security.mjs | Giữ base predicates, strict wrapper và opt-in verification; metadata order ổn định cho recheck. |
| backend/tests/provider-policy.test.mjs | Config, positive/negative opt-in, forged snapshots, drift, expiry, stale approval và TCP timeout. |
| backend/integration/provider-policy.mjs | Native catalog/probe regression trên private cluster; không phải provisioning script. |
| backend/integration/native.test.mjs | Gắn regression mới sau bộ concurrency/Prisma/native cũ. |
| backend/.env.example, deploy/render-runtime.env.example | Chỉ thêm hai biến mẫu với mode strict và evidence path rỗng. |
| Tài liệu này | Contract, audit predicates, trust boundary, tests và staging gate. |

Phase 9C.2B ban đầu không sửa SQL provisioning. Hotfix mục 11 sửa filter prefix
trong bootstrap SQL/inventory, không thay role grants hay chạy provisioning thật.
Không sửa Prisma schema/migration files, backend/.env hoặc React UI.
`.agents/` và `skills-lock.json` có trước task, không thuộc implementation.
Tài liệu 9C.2 có trước và chưa tracked; hotfix mục 11 chỉ sửa ba SQL draft liên
quan. Không stage/commit trong nhiệm vụ này; vòng Git review sau cần báo rõ scope.

## 7. Tests và evidence boundary

- Unit tests positive sử dụng synthetic operator config + injected probe results;
  không dùng chúng để nhận đã xác thực provider. Negative cases giữ strict mặc
  định, malformed opt-in/identity/TLS, DB ngoài phạm vi, direct grant/TEMP/CREATE,
  schema/data/routine/MAINTAIN/membership, snapshot drift, expiry và timeout.
- TCP timeout test mở server loopback cổng tạm không phản hồi handshake. Không
  kết nối database thật hoặc in password; kết thúc sockets ở finally.
- Native suite tạo cluster riêng theo guard có sẵn, marker, opt-in, port khác
  5432 và synthetic accounts. Prisma migrations/roles chỉ trong fixture này.
  Không sử dụng hoặc reset database developer/cloud.
- Native fixtures mô phỏng provider owner/DB metadata: thử PUBLIC CONNECT thật,
  schema USAGE mặc định bị từ chối, quyền tối thiểu mới pass probes, unknown DB,
  direct CONNECT/TEMP, database-name spoof, membership, DDL/history denial.
- Positive native probe scenario phải thu hẹp schema ACL **trong cluster giả lập**;
  đó không phải chỉ dẫn sửa Neon-managed DB. Database alias cineverse_ci chỉ đi
  qua catalog/probe helpers; production identity guard vẫn từ chối alias này.
- Existing native tests kiểm migrator ownership/history/drift qua Prisma thật,
  runtime CRUD và multi-connection session/profile/favorite/password transactions.
- Chưa có Neon/TLS cloud verification. Không commit/push nên không có CI run
  mới cho patch. Kết quả local cuối cùng ở mục 9, không phải chứng nhận cloud.

## 8. Staging checklist và quyết định

1. Giữ DATABASE_SECURITY_POLICY=strict. Không provision hoặc đổi runtime role
   thành owner để vượt lỗi. Review riêng việc chấp nhận trusted operator config
   thay vì independent Neon attestation; không đồng nhất hai loại bằng chứng.
2. Sau authorization chỉ đọc riêng: xác minh project/branch/endpoint trong Neon
   control plane, actual target/system OID/owner, template/allowconn và PUBLIC vs
   direct/effective privileges. Không gửi secrets vào chat hoặc reports.
3. Xác minh đúng role flag/membership và pinned direct TLS với PrismaPg/CLI đang
   dùng. File config do operator review độc lập, expiry ngắn, mount read-only;
   đánh giá recovery/restart khi evidence hết hạn. Không ký giả hoặc tự TOFU.
4. Kiểm provider DB bằng actual app/migrator role trong scope được phép. Nếu
   thiếu roles thì creation/provisioning là bước ghi cần authorization riêng.
   Nếu TEMP/schema USAGE/routines chưa đạt, dừng và ghi blocker, không nới thêm.
5. Review/accept TOCTOU/startup-only residual risks hoặc chọn môi trường khác.
   Nếu cần chứng thực provider độc lập hoặc isolation atomic, patch này chưa đủ.
6. Chỉ sau các review trên và gates thành công mới cân nhắc bước commit riêng;
   commit code default-strict không có nghĩa đã duyệt bật compatibility/Neon.

Quyết định hiện tại: **NO-GO cho bật Neon compatibility/provisioning/public staging**.
Chưa có actual role/provenance/ACL/TLS evidence; không thêm bypass hoặc tiếp tục
nới quyền để đạt deploy. Full local tests không thể đóng các blocker cloud này.

## 9. Quality gates trước finding SEC-PG-PREFIX-01 — local, 2026-11-02

| Kiểm tra đã thực sự chạy | Kết quả |
| --- | --- |
| Compatibility unit suite riêng | **13/13 đạt**; có startup preflight, strict/opt-in, expiry/drift, stale generations, failed recheck và real stalled TCP handshake. |
| Automated backend/frontend | **321 + 112 = 433 đạt**, 0 fail/cancelled/skipped trong lượt cuối. |
| PostgreSQL 17 native cluster mới | **21/21 đạt**, 0 fail; gồm migrations/ownership/concurrency cũ và provider-policy helpers/probes mới; cluster shutdown được runner xác nhận exit 0. |
| `npm run check` | Exit 0: automated tests, lint, TypeScript, production build, Prisma validate và full browser regression. |
| Lint | 203 files, 0 warnings/errors; dùng bản sao có Git boundary để không bị parent cache ignore. |
| Browser | Hosting, Auth/layout, Favorites, Profile, 7 Change Password groups, **22 multi-tab checkpoints**, audit remediation đều qua. |
| Accessibility/UX | 50 pages + 39 states, không axe/overflow/keyboard failures; 34 UX snapshots/37 checks, không failure. Giữ hai nhóm forced-colors contrast manual review có trước; không coi browser emulation là screen-reader/device thật. |
| Source/security check | 10 file Phase 9C.2B được review; executable source khớp bản mirror đã test; diff whitespace và Markdown fences đạt; không phát hiện các mẫu credentials/tokens đã quét. Không đọc `.env` thật để fingerprint secrets. |
| GitHub Actions / Neon | **Chưa chạy** cho patch này; không commit/push, không kết nối Neon. |

Environment: Node 22.23.4 trên Windows, existing headless browser configuration;
Git-visible source mirror không `.env`, không dùng credentials/database developer.
Native runner tạo cluster riêng có marker, cổng ngẫu nhiên khác 5432, bootstrap
credentials tổng hợp; các thao tác CREATE ROLE/migrate/ACL chỉ là setup/test của
fixture này. SQL provisioning của ứng dụng không bị sửa hoặc chạy lên database thật.

Trong review tiếp tục đã sửa thêm việc approval cũ còn có thể tồn tại khi recheck
thất bại và bảo vệ generation khi verification cũ hoàn tất muộn. Không xóa test,
giảm assertion hoặc thêm sleep để tạo kết quả xanh. Thời gian approval ngắn đo
bằng monotonic clock; evidence expiration vẫn dùng wall clock của operator.

**Quyết định tại vòng review trước hotfix:** local gates đạt nhưng mục 10 phát
hiện blocker, nên đã dừng commit/push. Kết luận hotfix mới nhất ở mục 11. Nếu
acceptance criterion là
compatibility đã được xác thực độc lập trên Neon, hoặc không còn TOCTOU do
admin/provider thay ACL, thì **chưa đạt**. Cần review/accept trust contract hoặc
chọn môi trường khác; không bật opt-in/provision dựa trên kết quả test local.

## 10. Final Git/security review — SEC-PG-PREFIX-01 [HIGH, phát hiện trước hotfix]

Final review ngày 2026-11-02 dừng trước stage/commit/push theo điều kiện người
dùng yêu cầu. Không sửa executable code trong lượt publication này.

### Root cause đã xác minh

Filter `nspname NOT LIKE 'pg_%'` coi `_` là wildcard một ký tự, không phải dấu
gạch dưới literal. Vì thế không chỉ pg_catalog/pg_toast mà cả schema người dùng
hợp lệ như pgx hoặc pgworkspace cũng bị loại khỏi inspector. PostgreSQL chỉ
reserve prefix literal pg_, không phải mọi tên bắt đầu bằng pg.
[LIKE semantics](https://www.postgresql.org/docs/17/functions-matching.html),
[reserved schema prefix](https://www.postgresql.org/docs/17/ddl-schemas.html).

Vị trí liên quan:

- `backend/database/role-security.mjs`: filter schema, ownership của relation/
  function/type, table/sequence privileges và SECURITY DEFINER routine access.
- `backend/database/provider-connect.mjs`: filters của accessible routines và
  MAINTAIN cũng dùng cùng pattern.

Một phần lỗi có sẵn trong shared inspector trước patch; probes mới tái sử dụng
inspector và pattern đó, nên patch hiện tại không chứng minh được điều kiện
không bỏ sót DDL/data privileges ngoài phạm vi. Nếu role có quyền/ownership trong
schema pgx, metadata tương ứng có thể bị ẩn khỏi các checks thay vì bị từ chối.
Không khẳng định runtime tự tạo được schema ban đầu khi chưa có quyền; đây là
blind spot khi phát hiện quyền đã tồn tại hoặc cấu hình sai.

### Bằng chứng read-only, không provisioning

Đã chạy SELECT sau trong PostgreSQL WASM RAM, không dataDir, không kết nối Neon/
developer DB, không CREATE ROLE/SCHEMA/TABLE, GRANT/REVOKE hoặc migrations:

```sql
SELECT name,
       name NOT LIKE 'pg_%' AS inspected_by_current_filter,
       left(name, 3) <> 'pg_' AS inspected_by_literal_prefix
FROM (VALUES ('public'), ('pg_catalog'), ('pgx'), ('pgworkspace')) v(name);
```

| name | Filter cũ tại review | Literal prefix |
| --- | --- | --- |
| public | true | true |
| pg_catalog | false | false |
| pgx | false | true |
| pgworkspace | false | true |

Bằng chứng xác minh lỗi chọn schema của SQL predicate; chưa thực hiện exploit
end-to-end với role/schema thật vì nhiệm vụ này giới hạn các thao tác database.
Các tests 13/433/21 đã đạt không bao phủ ca schema pgx này, nên không đóng finding.

### Điều kiện gỡ blocker

1. Đổi các filters cần nhận diện system namespace sang prefix literal đúng,
   chẳng hạn `left(nspname, 3) <> 'pg_'`, giữ loại information_schema đúng scope.
2. Rà soát cùng pattern trong inventory/provisioning/migration checks để không
   giữ blind spot tương tự. Không tự sửa trong lượt Git review hiện tại.
3. Thêm regression trên fixture biệt lập: pgx/pgworkspace phải được inspect;
   schema ownership/CREATE/USAGE, table/column/sequence access và custom routines
   trong các schema đó phải làm guard fail. System namespaces thật vẫn bị loại.
4. Chạy lại targeted/native/full gates và security review trước khi stage.

### Trạng thái publication tại vòng review trước hotfix

- Security review: **BLOCKED**, không tạo commit và không push.
- Đã fetch xác minh main/origin đúng repo và đồng bộ, không có local commits
  chưa push tại thời điểm review; không sửa lịch sử.
- Quét 47 files modified/untracked không phát hiện các mẫu credentials thật đã
  kiểm tra. Phạm vi dự kiến vẫn 10 file 9C.2B; 37 file untracked ngoài phạm vi
  không được stage (skills, lock metadata và tài liệu 9C.2 có trước).
- Chạy lại compatibility units: 13/13 đạt. Đối chiếu executable source trùng bản
  mirror có full gate 433 tests/browser/lint/typecheck/build/schema và 21 native
  tests đạt; không chạy lại fixture DDL trong lượt final Git review.
- Không tạo GitHub Actions run mới; các kết quả CI cũ không chứng minh patch này
  đã pass CI. Working tree được giữ lại để sửa finding trong bước tiếp theo.

## 11. Hotfix SEC-PG-PREFIX-01 — CLOSED qua code/local regression

### Sửa lỗi và phạm vi rà soát

Thay **14** filter wildcard bằng prefix literal `LEFT(name, 3) <> 'pg_'`:

| File | Phạm vi |
| --- | --- |
| backend/database/role-security.mjs | 7 filters: schema, relations/functions/types ownership, table/sequence ACL, SECURITY DEFINER. |
| backend/database/provider-connect.mjs | 2 filters: executable routines và MAINTAIN trong provider probes. |
| backend/database/inspect.mjs | Local metadata/inventory. |
| backend/database/production-migration-plan.mjs | Production metadata/inventory. |
| backend/database/production-roles.sql | Bootstrap phải nhận ra relation đã có trong pgx/pgworkspace, không provision nhầm DB có dữ liệu. |
| backend/integration/fixture.mjs | Hai freshness checks cho relations và roles: user role pgx không được coi là system role. |

Giữ nguyên điều kiện loại information_schema, relation kinds, metadata queries,
ownership/ACL/membership predicates và policy defaults. Không đổi nghĩa loại các
namespaces có prefix literal pg_ như pg_catalog, pg_toast hoặc pg_temp_*.
Không đưa dấu backslash vào string prefix: literal đúng là **pg_**.

Đã rà LIKE/NOT LIKE, ILIKE, SIMILAR TO, LEFT, substring, regex và JavaScript
prefix checks trong source backend/scripts/frontend/tests. Không còn wildcard
pg_% trong executable security inspectors. Không có ILIKE/SIMILAR TO tương tự
cần sửa. Equality checks public trong Favorite inspector/runtime-grants giữ
nguyên; hostname/path startsWith là logic khác, không bị thay đổi.

Sửa thêm ba SQL draft trong docs/phase-9c2-neon-role-provisioning.md để không
hướng dẫn operator dùng lại filter sai. Chỉ giữ ví dụ LIKE sai ở mục 10 như
bằng chứng lịch sử, không phải executable provisioning instructions.

### Regression thực thi SQL thật

Files test thêm/cập nhật: backend/integration/schema-prefix.mjs,
backend/integration/native.test.mjs, backend/integration/provider-policy.mjs và
backend/tests/schema-prefix.test.mjs. Không chỉ assert chuỗi SQL.

- Native fixture có marker, cổng riêng khác 5432 và bootstrap tổng hợp tạo thêm
  database **cineverse_prod** ngay trong cluster test. Inspector nhận identity
  thật cineverse_app/cineverse_prod; strict baseline phải pass trước khi cấp từng
  quyền trái phép. Không sửa tên database trong snapshot để làm test pass/fail.
- Cả strict lẫn managed-provider probe đều thấy pgx, pgworkspace và public;
  loại pg_catalog, pg_toast, information_schema đúng policy.
- Native grants/ownership thật: schema owner, CREATE/USAGE, table SELECT,
  column SELECT, sequence USAGE, executable SECURITY DEFINER routine đều bị
  validator từ chối. Mỗi case thu hồi quyền fixture và xác nhận baseline sạch.
- Provider supplemental queries còn phải phát hiện SECURITY INVOKER routine
  và MAINTAIN ở pgx; chỉ kiểm inspector chung là chưa đủ cho hai queries này.
- Production inventory thực sự đọc relations ở pgx/pgworkspace. Local inspector
  cũng được chạy trên cineverse_dev **mới trong cluster tạm**, không phải DB
  developer ở 5432, và phải thấy cả hai namespace.
- Hai tests PostgreSQL WASM RAM riêng xác nhận bootstrap abort trước CREATE ROLE
  khi có relation trong pgx hoặc pgworkspace; relation cũ không bị sửa/xóa.
- Existing cineverse_ci native tests tiếp tục kiểm Prisma deploy/history/drift,
  runtime CRUD và concurrency. Target cineverse_prod của prefix test chỉ replay
  bốn DDL đã pin + empty fixture history để kiểm role guard/inventory; không
  tuyên bố đây là cloud migration/TLS verification.

### Before / After và quality gates

Trước sửa, hai bootstrap regression tests fail (missing expected rejection).
Native run trước sửa có 19 pass / 21 fail entries (gồm parent suites); ownership,
DDL/data/routine rejection cases thật sự fail, không chỉ so sánh biểu thức LIKE.
Đó là lượt red có chủ đích để xác minh lỗi, không bỏ assertion hoặc tăng timeout.

Kết quả sau sửa, chạy lại trên source mirror không `.env` thật:

| Gate | Kết quả hotfix |
| --- | --- |
| Compatibility unit suite | **13/13 đạt**; opt-in/strict, expiry, stale generation, failed recheck và timeout vẫn fail closed. |
| Bootstrap prefix tests | **2/2 đạt** sau khi 2/2 fail trước sửa. |
| Automated backend/frontend | **323 + 112 = 435 đạt**, 0 fail/cancelled/skipped. |
| PostgreSQL 17 native | **40/40 đạt**, 0 fail; cluster tạm được runner xác nhận shutdown và exit 0. |
| Lint | **205 files**, 0 warnings/errors. |
| TypeScript / production build / Prisma validate | Đạt trong `npm run check`, không sửa schema/migration files. |
| Full browser regression | Exit 0; hosting/Auth/Favorites/Profile, 7 Change Password groups, **22 multi-tab checkpoints** và audit remediation đạt. |
| Accessibility / UX | 50 pages + 39 states không axe/overflow/keyboard failure; 34 snapshots/37 UX checks không failure. Hai nhóm forced-colors manual review có trước không bị coi là đã giải quyết. |
| Full quality gate | `npm run check` exit 0 trên executable source khớp working tree; không dùng 433/21 của lượt trước như kết quả hotfix. |

**Finding HIGH SEC-PG-PREFIX-01 được đóng trong phạm vi code và regression local.**
Không còn filter wildcard sai trong executable security inspectors đã rà soát;
không còn bypass do prefix pgx/pgworkspace trong các ca strict/provider đã chạy.
Không tuyên bố mọi security predicate khác hoặc môi trường cloud đều đã được chứng minh.
Đủ điều kiện **chạy lại final security review** của toàn bộ working tree trước
khi cân nhắc commit riêng. Không tự stage/commit/push hoặc phát sinh CI run mới.

### Residual risks không bị coi là đã giải quyết

Strict vẫn mặc định và compatibility vẫn opt-in. Evidence validation, snapshot
generation, expiry/digest, direct probe timeouts và failure handling không đổi.
Operator-config trust, provider provenance, startup-only checks và TOCTOU do
DBA/provider đổi ACL ở mục 5 vẫn cần review; không suy diễn hotfix chứng nhận Neon.
Không kết nối Neon, không sửa .env thật, không commit/push/reset/revert working tree.
DDL/GRANT/REVOKE chỉ trong fixtures RAM/native biệt lập đã được kiểm guard.

## 12. Final release review sau hotfix — 2026-11-02

**PASS cho phát hành code default-strict**, không phải approval bật compatibility
hoặc provisioning Neon. SEC-PG-PREFIX-01 CLOSED trong code/regression local;
không phát hiện HIGH/CRITICAL mới trong patch đã review.

- Đối chiếu 266 application/test/config files với source mirror đã qua full gate,
  gồm 106 executable backend/scripts files: nội dung khớp sau chuẩn hóa CRLF.
  Giữ kết quả 435 automated tests, 40 native PostgreSQL tests và browser gates
  ở mục 11; không dùng số liệu trước hotfix. Chạy lại riêng compatibility và
  bootstrap: 15/15 đạt, không fail/cancel/skip.
- Xác nhận strict mặc định, explicit production opt-in, kiểm identity/expiry/TLS,
  snapshot digest/generation và failed-recheck/timeout fail closed. Các predicates
  membership/ownership/DDL/table-column-sequence/routine/history vẫn được giữ.
- Phạm vi release: 17 files gồm implementation, templates strict, regression
  fixtures/tests và hai tài liệu 9C.2/9C.2B. `.agents/`, `skills-lock.json`, cache,
  artifacts và `.env` thật không thuộc commit. Cảnh báo hash của skill-lock được
  phân loại là dependency checksums, không phải credentials.
- GitHub Actions cần kiểm tra theo SHA sau push; các kết quả local không phải
  CI PASS. Không kết nối Neon, tạo evidence thật, bật compatibility hoặc deploy.

Các residual risks mục 5/8/11 vẫn mở: trusted operator config không phải Neon
attestation; TLS chỉ xác thực endpoint theo CA/hostname policy thực tế; recheck
không tạo atomic isolation xuyên database và không thu hồi pool đang chạy khi
evidence hết hạn. Actual Neon ACL/provenance/TLS/probes chưa được xác minh.
Chỉ đủ điều kiện chuẩn bị **read-only staging preflight được ủy quyền riêng**;
compatibility/provisioning/public staging vẫn NO-GO cho tới khi các blocker đạt.
