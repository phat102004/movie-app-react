# Phase 9C.3C — Managed PostgreSQL Security Contract V1

Ngày: 2026-11-04. Implementation và final review cho **release code default-strict**,
không phải approval Neon staging. Không kết nối Neon, bật policy thật hoặc deploy.

## 1. Versions và default

- `DATABASE_SECURITY_POLICY` không có hoặc `strict`: giữ strict mặc định.
- `neon-reviewed-system-connect`: semantics 9C.2B giữ nguyên; không cho TEMP
  hoặc provider public USAGE qua ngoại lệ Managed V1.
- **`neon-managed-v1`**: mode mới, explicit production opt-in. Profile format
  `version: 2`, `contract: managed-postgresql-v1`; số 2 phân biệt schema profile
  cũ, không phải version 2 của security contract.
- Mọi template vẫn `strict`, evidence path rỗng. Không tự nhận diện Neon hostname
  rồi bật policy. Sai mode/profile version, local/test opt-in, thiếu file, path
  tương đối, malformed JSON hoặc metadata/probe lỗi đều fail closed.

## 2. Cấu hình được hỗ trợ — chưa kích hoạt

Chỉ sau final review và authorization staging riêng, operator mới cân nhắc:

```dotenv
DATABASE_SECURITY_POLICY=neon-managed-v1
DATABASE_PROVIDER_EVIDENCE_FILE=<absolute-read-only-operator-profile-path>
```

Không có profile thật hoặc credentials trong repository. File là **trusted
operator configuration**, không phải Neon attestation, không được code xác minh
projectId/branchId qua control-plane API. TLS xác minh endpoint theo CA/hostname
policy thực tế; tên database, hostname/OID không tự chứng thực provider ownership.

Profile giữ các fields 9C.2B: provider, host, endpointId/projectId/branchId,
reviewRef, reviewedAt/expiresAt, target identity và đúng hai systemDatabases
postgres/template1. Thêm contract field ở root, và hai boolean bắt buộc ở target
và mỗi system entry: **publicTemporary**, **publicSchemaUsage**.

- Flags phải là boolean thật, không default/coercion; thiếu hoặc thừa keys bị từ chối.
- Target vẫn cineverse_prod, publicSchemaUsage=true; chủ sở hữu target/provider
  phải khác nhau và không được là app/migrator/roles đặc quyền bị cấm.
- Operator pin actual name/OID/owner OID/name/template và endpoint đã đối chiếu
  bằng kênh tin cậy. Không tự thu metadata rồi auto-trust (TOFU).
- PUBLIC TEMP/effective TEMP phải khớp flag từng DB, không direct TEMP hoặc TEMP
  grant option. Không PUBLIC CREATE, CONNECT/CREATE grant options. Target runtime
  không CREATE; migrator chỉ CREATE cần cho migrations ở target.
- Provider CONNECT chỉ PUBLIC, không direct CONNECT/grant option, chỉ hai DB
  identity đã review có allowconn=true; database lạ có effective CONNECT bị từ chối.
  Managed V1 còn từ chối CREATE/TEMP ở database khác ngoài scope, kể cả khi
  CONNECT=false. Runtime/migrator không sở hữu database nào trong inventory.
- Schema public USAGE phải khớp profile, không PUBLIC CREATE; không schema grant
  options. PUBLIC USAGE không miễn table/column/sequence/routine checks.
- Max file 8KiB; review không ở tương lai, expiry tối đa 24h và còn hạn. Đọc file
  một lần khi parse config, freeze object. Không có file watcher: cập nhật disk
  không thu hồi pool đã mở. Protect mount ACL và restart/revalidate khi đổi file.

Nếu actual Neon ACL/owners/default routines không đạt, dừng. Không sửa provider
ACL hoặc thêm ngoại lệ theo tên để làm pass.

## 3. Hard security predicates

Không có ngoại lệ Managed V1 cho:

- Wrong host/database/schema/purpose/current_user/session_user, TLS insecure,
  runtime dùng owner hoặc HTTP env chứa migration credential.
- SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS/INHERIT hoặc memberships;
  neon_superuser bị chặn kể cả NOINHERIT. Không SET ROLE để giả actual login.
- Runtime ownership/CREATE trên persistent schema objects; application tables
  không owned bởi runtime. Extra schema USAGE/CREATE/ownership bị chặn.
- Runtime privileges ngoài CRUD của User, Session, PasswordResetToken, Favorite:
  không MAINTAIN/TRUNCATE/REFERENCES/TRIGGER/grant options, extra table/column
  access hay _prisma_migrations read/write. UUID models không cần sequence grants.
- Custom routine EXECUTE/ownership ngoài policy: bổ sung pg_proc inspection cho
  cả SECURITY DEFINER và INVOKER, kể cả procedures, không chỉ definer flag.
  Không có custom routine allowlist trong V1; default PUBLIC EXECUTE cũng bị chặn.
- Migrator không sở hữu DB hoặc quản trị provider; chỉ application/history
  tables public đã review có ownership. Schema ngoài public và custom standalone
  types/routines, extra relation/sequence grants vẫn bị từ chối. Implicit row/
  array types của năm bảng được nhận diện riêng, không nhầm thành custom types.
- Migration manifest/checksums/history/drift và explicit runtime grants vẫn áp
  dụng. Không ALL TABLES/default grants hoặc tự baseline/ownership transfer.

Supplementary inspector chỉ được gọi cho Managed V1. Strict/9C.2B không mất
predicate cũ; strict vẫn từ chối TEMP và other-database CONNECT. Literal pg_
prefix giữ nguyên; pgx/pgworkspace vẫn nằm trong phạm vi kiểm tra.

TEMP là ngoại lệ **temporary-object DDL/ownership trong session**, không phải
persistent schema DDL. Không tuyên bố role không thể tạo bất kỳ object nào.
Engine/system namespace và built-in routines vẫn thuộc trust boundary hiện có;
không nhận đây là audit toàn bộ PostgreSQL capabilities hoặc mọi side effect.

## 4. Verification và fail closed

1. Parse explicit config, kiểm profile identity/expiry; không dùng credentials
   owner cho app/probes, không nhận upstream DSN/database từ HTTP input.
2. Inspect role/schema/table/column/sequence như cũ; Managed V1 thêm effective
   MAINTAIN, schema grant options/default ACL, custom EXECUTE/ownership/types và
   actual search_path. Base role predicates chạy trước approval.
3. Inventory bằng actual role, kiểm target + finite provider scope/PUBLIC grant
   provenance. Mở direct metadata-only probes bằng cùng actual credential,
   endpoint/TLS; chỉ đổi tên DB đã pin. Không probe bằng admin thay runtime.
4. Probes kiểm toàn bộ persistent boundaries dù đã cho public USAGE/TEMP.
   READ ONLY không phải bằng chứng role thiếu TEMP; không thử DDL trên cloud.
5. Recheck inventory và actual target snapshot; validate expiry lần nữa. Approval
   gắn snapshot reference/digest, **profile reference và content digest**, generation
   và monotonic TTL <5s. Failed recheck xóa approval; old late success không được
   ghi đè newer denial. Profile/snapshot mutation làm mất approval.
6. Final validator vẫn kiểm base predicates. Managed TEMP luôn cần approval,
   kể cả giả sử otherDatabaseConnect=false; không sửa metadata flag thành false.

Probe timeouts giữ connect 1.5s, statement 1s, query 1.5s, deadline 4s; đóng socket
trong finally và timeout. Không retry vô hạn hoặc fallback bỏ probe. Messages chỉ
trả static error/reason code, không SQL values, passwords, tokens hoặc DSNs.

## 5. SQL qualification, temporary shadowing và pooling

Production node-pg options và SQL role defaults đổi thành
**pg_catalog, public, pg_temp**. Templates không kích hoạt policy. Không chạy
ALTER ROLE/settings lên local thật hoặc Neon. Các role-level defaults trong SQL
chỉ là provisioning template, không phải script được tự động thực thi.

Factory tiếp tục PrismaPg schema public, cùng driver như trước. Raw row-lock
queries trong Session/Change Password/Reset dùng public.User/public.Session;
history và security inventories dùng public hoặc pg_catalog-qualified relations.
Prisma-generated SQL được kiểm thực thi, không chỉ suy ra từ adapter config.

Native negative test:

- Runtime pool max=1 tạo temp User/Session/PasswordResetToken/Favorite giống các
  bảng thật và temp _prisma_migrations độc lập. Runtime không thể dùng LIKE trên
  history thật vì thiếu SELECT; test giữ nguyên sự từ chối đúng này.
- Cố tình đặt session path pg_temp,public,pg_catalog, release rồi reuse đúng PID.
  Chạy Prisma CRUD + actual Session/Profile/Change Password/Forgot/Reset services.
  Kiểm persistent state, session revocation, temp tables vẫn rỗng và history thật
  vẫn bị runtime từ chối. Capture SQL trong RAM; không ghi SQL/params vào báo cáo.
- Kiểm statements Prisma business có schema-qualified application references;
  assertions bổ sung từ chối unqualified application table references.
- Migrator tạo temp history rỗng cùng tên, path hostile; production migration
  inspector vẫn đọc đúng bốn migrations thật và manifest/checksum đúng.
- Actual Prisma CLI deploy hai lượt và diff chạy trên fixture cineverse_prod với
  PUBLIC TEMP. CLI mở connection riêng không dùng runtime pool; không tuyên bố
  đã tiêm temp table vào physical connection nội bộ của Prisma CLI.

Production đang dùng **direct endpoint + node-pg application pooling**, không
PgBouncer transaction pooling. Không nới hostname để nhận -pooler. Transaction
pooling chưa được kiểm chứng/cho phép bằng V1; không suy diễn PID/session behavior
trên PgBouncer từ pool node-pg. Không chèn DISCARD ALL vào Prisma pool.

Đây là bảo vệ fixed application SQL dưới threat model hiện tại, không phải sandbox
cho arbitrary SQL. Role defaults/GUC không phải mandatory authorization boundary;
attacker có DB credential vẫn có thể đổi settings hoặc sử dụng quyền đã cấp.

## 6. Threat model và residual risks

- Trust PostgreSQL engine/Neon/DBA/migration operator và config mount. Operator
  evidence không được ký/xác thực độc lập bởi Neon. OID có thể trùng giữa branches.
- Không có atomic snapshot/lock xuyên DB. Provider/admin có thể đổi ACL sau probe;
  recheck giảm nhưng không xóa TOCTOU. Guard chạy khi tạo client/pool, không trước
  mỗi query. Profile expiry không tự thu hồi pool đang chạy hoặc transaction.
- TEMP/CONNECT/USAGE cho phép resource/catalog exposure. temp_file_limit không
  tính explicit temp tables; pool max=3 chỉ giới hạn app pool, không mọi direct
  login bằng credential bị lộ. Timeouts không phải hard resource/cost isolation.
- Backend dùng một runtime role cho nhiều user, CRUD bốn bảng không là row-level
  tenant isolation. Session/account binding/CSRF/Origin/authorization vẫn cần
  giữ nguyên; không có RLS mới hoặc thay behavior authentication trong phase này.
- Custom EXECUTE ACL inspection không chứng minh mọi implicit trigger/cast hoặc
  system built-in side effect đều không thể xảy ra. Migrations/schema/provider
  extensions vẫn cần review tin cậy; không biến standard catalog access thành
  cam kết không thể ghi vào bất kỳ PostgreSQL storage/object nào.
- Actual Neon owners/ACL/default routines/TLS và provider limits chưa được probe
  bằng runtime/migrator thật; có thể vẫn BLOCKED dù metadata PUBLIC flags phù hợp.
- Database không thể CONNECT không được mở để inspect object ACL. Inventory
  kiểm quyền database/ownership; không chứng minh mọi latent object grant ở DB
  không truy cập được đều vắng mặt. Provider/admin bật CONNECT sau startup vẫn
  nằm trong TOCTOU/trusted-admin residual risk, không phải quyền tự động được duyệt.

## 7. Native fixture và bằng chứng kiểm thử

Native fixture yêu cầu opt-in, loopback non-5432, cluster_name marker, PG17 và empty
inventory trước DDL. Roles/migrations/GRANT/REVOKE chỉ trong cluster mới này; không
database developer/Neon, không dùng credentials thật, cluster dừng ở finally.

Production-NAMED fixture cineverse_prod dùng actual login app/migrator và real
Prisma migration history thay vì normalize database name trong snapshots. Same-role
cross-database probes chạy thật trên loopback PostgreSQL. Chỉ endpoint/TLS config
trong orchestration test được synthetic/injected để giữ production parser chặt;
không thêm production bypass cho loopback/TLS/database identity.

Trong test migrator, quyền CREATE còn lại trên cineverse_ci của fixture cũ phải
được thu hẹp rồi mới pass; guard từ chối quyền đó đúng theo contract mới. Sau test
khôi phục fixture để regressions cũ tiếp tục chạy, không nới production guard.

Kết quả local đã thực sự chạy trên source mirror không có .env thật, Node
22.23.4 và PostgreSQL native **17.11**, ngày 2026-11-04:

| Gate | Kết quả |
| --- | --- |
| Automated backend/frontend, lượt final release | **331 + 112 = 443/443 đạt**, 0 fail/cancel/skip; thêm một regression cho direct/pooled configuration. |
| PostgreSQL native, source cuối | **59/59 đạt**, 0 fail/cancel/skip; runner exit 0 và shutdown cluster được xác nhận. |
| Compatibility / strict / bootstrap / Managed units | Bao gồm trong 331 backend tests; giữ legacy 13 và có 8 Managed V1 cases. |
| Full `npm run check`, final release | Chạy lại exit 0: 443 automated tests, lint, TypeScript, build, Prisma validate và tất cả browser suites. Native source cuối cũng chạy lại 59/59 đạt. |
| Lint source cuối | **209 files**, 0 warnings/errors. |
| Browser auth/favorites/profile/password | Hosting, Auth/layout, Favorites, Profile, **7 Change Password**, **22 multi-tab** checkpoints đạt; không đổi session/CSRF/Origin. |
| Accessibility / UX | **89 states** (50 pages + 39 extra), không axe/overflow/keyboard failure; **34 snapshots / 37 UX checks** đạt. Hai nhóm forced-colors contrast manual review có trước vẫn chưa được xác minh bằng screen reader/device thật. |
| Secrets scan | Không phát hiện các mẫu credential/token/private-key/DSN đã quét trong Git-visible files/index/history; không đọc .env thật để fingerprint. Skills-lock checksums được phân loại metadata, không thuộc patch. |
| GitHub Actions / Neon ở lượt local | Chưa chạy trước Git release; không actual cloud probes hoặc activation. CI sau push cần xác minh theo đúng SHA, không suy từ local tests. |

Lượt native đầu phát hiện lỗi setup: runtime bị từ chối LIKE history do không có
SELECT; migrator còn CREATE trên database fixture khác. Đã sửa setup với negative
assertions giữ nguyên, không tăng timeout/tắt test. Sau đó hai lượt native đạt 59;
lượt cuối có assertion không unqualified business-table references. Không dùng
kết quả CI 9C.2B hoặc số test trước patch làm chứng nhận Managed V1.

## 8. Checklist Neon staging — chưa thực hiện

1. Review/accept rõ TEMP DDL/resource, operator trust, startup-only và TOCTOU.
2. Read-only control-plane + per-database metadata: actual branch/endpoint,
   target/system owners/OIDs/template/allowconn, PUBLIC/direct/effective grants.
3. Các roles chưa có: chỉ provisioning trong bước ghi được cấp phép riêng, bằng
   phương án managed đã review; **không chạy production-roles.sql strict nguyên
   khối** để thu hồi PUBLIC ACL khi mục tiêu là giữ defaults. Phase này chưa tạo
   managed provisioning SQL/roles hoặc thay runtime grants tự động.
4. Runtime role flags/membership/ownership kiểm bằng actual login, không owner.
   Migrator sở hữu bảng/history, không DB owner/neon_superuser; secrets tách HTTP.
5. Probes bằng cả actual roles: schemas/table/column/sequence/routine/MAINTAIN và
   default grant sources; nếu không thể inspect hoặc vượt scope, dừng.
6. TLS strict với đúng adapter và CLI; verify peer/endpoint/profile bằng kênh tin
   cậy. Không coi profile file hoặc hostname alone là attestation.
7. Run staging auth/favorites/profile/password smoke bằng test accounts được cho
   phép, không account thật; kiểm timeout/recheck/restart/rotation và cost limits.
8. Chỉ sau final security review + authorization activation riêng mới thay mode.

## 9. Rollback và điều kiện dừng

Rollback cấu hình về strict và bỏ evidence path, drain/stop pools rồi restart để
revalidate. Nếu ACL vẫn có PUBLIC TEMP/other CONNECT, strict sẽ **từ chối startup**;
rollback không tự sửa ACL hoặc bảo đảm service tiếp tục online. Không âm thầm dùng
owner, disable guards, bỏ probes, hoặc revert session/CSRF/Origin để khởi động.

Dừng deployment khi còn HIGH/CRITICAL, native shadowing chưa đạt, unknown DB/
identity/privilege drift, malformed/expired profile, timeout/late rejection,
provider routines/ACL vượt policy, không đủ TLS/provenance evidence, không chấp
nhận TEMP/resource residual risks hoặc chưa có actual-role staging probes.

## 10. Files và phạm vi

- database/provider-policy.mjs: explicit mode, closed versioned profile/flags.
- database/provider-connect.mjs: PUBLIC provenance/finite defaults, managed probes,
  recheck và content-bound approval.
- database/managed-privileges.mjs: supplementary metadata/MAINTAIN/routine/type ACL.
- database/role-security.mjs: managed-only inspection và proof-required validation.
- database/connection-config.mjs, production-roles.sql: safe search_path.
- integration/managed-contract.mjs, managed-prisma.config.mjs, schema-prefix.mjs,
  fixture.mjs: native scopes, actual CLI, SQL capture và shadowing regressions.
- tests/managed-contract.test.mjs, production-database.test.mjs: mode/flags/negative
  proofs/expiry/races và revised safe-path assertion.
- backend/.env.example, deploy/render-runtime.env.example: documentation comments,
  values vẫn strict. Tài liệu 9C.3B có trước được giữ nguyên.

Implementation không sửa frontend, Prisma schema/migration files, credentials/
.env thật, cloud ACL hoặc session/CSRF/Origin policy. Không commit/push trong lượt
implementation; conditional Git release được review riêng tại mục 11.

## 11. Final security review và conditional Git release — 2026-11-04

**PASS cho release code với strict mặc định.** Không phát hiện HIGH/CRITICAL
trong patch đã review. Không phải quyết định chấp thuận activation/provisioning
trên Neon. Giữ các residual risks và staging stop conditions ở mục 6/8/9.

- Review đủ 15 files gồm untracked implementation/tests/tài liệu mới. Tài liệu
  9C.3B có trước, .agents, skills-lock.json và ignored artifacts ngoài release.
- Production source không đổi trong final review; chỉ thêm regression vào file
  Managed tests hiện có và cập nhật tài liệu. Legacy mode/strict không bị nới.
- Direct-only Managed configuration được kiểm ở cả runtime/migration: profile
  endpointId không được kết thúc -pooler và phải khớp prefix hostname; URL options
  allowlist chặn pgbouncer/host/options override. Matching profile/pooled URL vẫn
  bị từ chối. Offline release audit 15 assertions đạt, không mở DB connection.
  Naming convention theo [Neon pooling docs](https://neon.com/docs/connect/connection-pooling).
- Không coi hostname convention là chứng thực topology độc lập. DNS/provider/
  operator vẫn là trust boundary; chưa cho phép transaction pooler hoặc custom
  opaque proxy. Runtime node-pg application pool khác PgBouncer transaction pool.
- Local TLS lab dùng node-pg và SSL options từ production config parser, một CA/
  peer certificate tổng hợp trên loopback: **3/3 đạt** (CA + hostname đúng pass,
  CA không tin cậy fail, hostname sai fail). Không sử dụng credential/database
  thật; private fixture keys chỉ trong ignored cache, không thuộc changeset.
- Prisma CLI được đối chiếu source đúng installed engine commit
  d1b3f377ca835d73fd50954a5e22128b9ebdd6b8: thêm public root CA, strict không bật
  accept-invalid-certs, không disable hostname validation. Đây là code review,
  không phải live CLI/Neon TLS test.
  [Pinned engine TLS manager](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/quaint/src/connector/postgres/native/mod.rs).
- Full gates ở mục 7 được chạy lại trong vòng release; không giảm assertion,
  tăng timeout hoặc dùng CI cũ làm bằng chứng. Secrets scan không đọc .env thật.
- Git release chỉ gồm 15 files theo hash/index review và normal push; Actions
  phải được theo dõi theo SHA sau push. CI fail thì dừng trước Neon staging.

Cho phép phát hành nhánh code còn tắt theo mặc định; actual Neon runtime-role
probes, ACL/TLS/provenance và chấp nhận residual risk vẫn là blocker activation.

## Nguồn đối chiếu

- [PostgreSQL 17 privileges](https://www.postgresql.org/docs/17/ddl-priv.html)
- [PostgreSQL 17 search_path](https://www.postgresql.org/docs/17/runtime-config-client.html)
- [PostgreSQL 17 function security](https://www.postgresql.org/docs/17/sql-createfunction.html)
- [PostgreSQL 17 resource limits](https://www.postgresql.org/docs/17/runtime-config-resource.html)
- [Neon access controls](https://neon.com/docs/manage/database-access)
