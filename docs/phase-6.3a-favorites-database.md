# Phase 6.3A — Favorites database foundation

Chỉ bổ sung cấu trúc lưu phim yêu thích theo User, migration, kiểm tra catalog và tests. Không thêm API Favorites, nút tim, trang Favorites hoặc đồng bộ localStorage. UI/auth/TMDB hiện có được giữ nguyên; không commit/push trong phase này.

## Model và lựa chọn kiểu dữ liệu

```prisma
model Favorite {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @db.Uuid
  movieId   Int
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, movieId])
  @@index([userId, createdAt])
}
```

User thêm `favorites Favorite[]`; không đổi cột hay bản ghi của User. `id` là UUID riêng của bản ghi Favorite, được Prisma tạo khi create. `movieId` là ID phim của TMDB, không phải UUID và không phải ID một bảng Movie nội bộ.

Source TMDB khai báo `TmdbMovie.id: number`; mapper chuyển sang `Movie.id: string` để sử dụng trong giao diện/URL. Cả proxy và frontend đã giới hạn ID từ 1 tới 2,147,483,647. Vì vậy chọn Prisma `Int` / PostgreSQL `INTEGER` 32-bit; chuyển từ chuỗi URL sang số và kiểm tra input sẽ thuộc API sau này. Không đổi types/mapper/frontend ở phase này. [Prisma data types](https://www.prisma.io/docs/orm/data-modeling), [schema reference](https://docs.prisma.io/docs/orm/reference/prisma-schema-reference).

`createdAt` dùng `Timestamptz(3)` nhất quán với User/Session/PasswordResetToken, có default now để sau này sắp xếp theo thời điểm thêm. Không lưu title/poster/rating/overview và không tạo bảng Movie.

**Giới hạn cần nhớ:** database hiện ép kiểu INTEGER NOT NULL và miền Int32, nhưng **chưa có CHECK movieId > 0**. Số 0/âm vẫn có thể được ghi qua SQL trực tiếp. Phase 6.3B phải validate số nguyên dương, không vượt Int32 trước khi dùng Prisma; kiểm tra TMDB ID có tồn tại cũng không thể do FK nội bộ tự làm. Không xem việc table tồn tại là Favorites API đã hoàn thành.

## Giải thích các ràng buộc

- `userId` xác định ai sở hữu Favorite. Nếu chỉ lưu movieId, hệ thống không phân biệt được danh sách của từng tài khoản.
- Quan hệ một-nhiều: một User có thể sở hữu nhiều Favorite; mỗi Favorite thuộc đúng một User. Một movieId có thể xuất hiện ở nhiều User khác nhau.
- `@@unique([userId, movieId])` chặn cùng User thêm trùng một phim, kể cả hai request đồng thời. User A và User B cùng lưu phim 27205 vẫn hợp lệ. Database bảo vệ invariant này thay vì chỉ dựa vào một lần kiểm tra trước INSERT ở API.
- Foreign key là ràng buộc yêu cầu userId tham chiếu tới User.id tồn tại. Không thể tạo Favorite mồ côi. `onDelete: Cascade` sẽ xóa Favorite của User nếu User đó bị xóa qua một hành động có chủ đích sau này; migration này không xóa User hay sửa các FK auth hiện hữu.
- Index `(userId, createdAt)` hỗ trợ truy vấn danh sách theo User và thứ tự thời gian. Unique index `(userId, movieId)` phục vụ tìm một Favorite cụ thể và ngăn trùng. [Prisma indexes](https://docs.prisma.io/docs/orm/prisma-schema/data-model/indexes).
- TMDB là dịch vụ ngoài PostgreSQL nên không thể tạo FK trực tiếp sang API TMDB. Chỉ lưu ID tránh sao chép dữ liệu phim có thể thay đổi; metadata hiển thị sẽ được lấy từ proxy TMDB ở các phase sau. Phase này chưa tự gọi TMDB để tải Favorites.

## Migration và safety guards

Migration mới: `20261026030000_add_favorite_model`.

SQL được sinh offline từ snapshot `baselines/password-reset.prisma` tới schema mới rồi review, bọc BEGIN/COMMIT. Chỉ CREATE Favorite, primary key, unique index, index theo User và FK. Không DROP/TRUNCATE, không DML trên auth, không ghi đè ba migration cũ, không seed, không reset/shadow database.

Guard tiếp tục kiểm tra:

1. Chỉ PostgreSQL local:5432, database cineverse_dev, schema public; xác minh cả current_database thực tế.
2. Inventory table/view/sequence phải đúng prefix migration đã biết.
3. Tên, thứ tự, checksum, trạng thái finished và rolled_back của history phải hợp lệ.
4. Drift check dùng snapshot tương ứng số migration đã áp dụng: User → User+Session → User+Session+ResetToken → schema có Favorite. Không so database đang ở migration 3 với schema migration 4 trước apply.
5. Sau apply: kiểm tra lại history/checksum/drift, catalog Favorite và số lượng bản ghi các model. Chạy lại khi đã đủ migration chỉ kiểm tra, không chạy DDL lần nữa.

Lần audit đầu, script cũ dừng ở giới hạn 15 giây. Chạy riêng cùng drift check với timeout dài hơn mất khoảng 16.8 giây và trả exit code 0: **không có drift**, nguyên nhân là timeout CLI. Đã tăng timeout mỗi CLI lên 45 giây, giới hạn tổng 180 giây; vẫn dừng nếu chưa xác minh được, không bỏ qua check hay tự baseline/reset.

`database/favorite.mjs` chỉ đọc information_schema/pg_catalog để xác minh đúng bốn cột, primary key, FK tới public.User(id), Cascade, unique B-tree và index theo User hợp lệ/toàn phần. `db:check` kiểm tra delegate Prisma `favorite.count()`. Không đọc email/passwordHash/tokenHash hay bản ghi auth để audit database.

Nếu số bản ghi thay đổi trong lúc chạy migration, script báo cần review hoạt động đồng thời, không tự xóa/sửa dữ liệu hoặc rollback DDL để ép kết quả. Khi môi trường có request auth đồng thời, count khác chưa đủ để kết luận migration đã xóa dữ liệu; phải kiểm tra hoạt động ứng dụng.

## Cách chạy và kiểm tra trong pgAdmin

Từ `D:\LearnReact\Cineverse`:

```powershell
npm.cmd install
npm.cmd run db:validate
npm.cmd run db:generate
npm.cmd run db:check
npm.cmd run db:migrate
npm.cmd run db:check
```

Dùng loader cấu hình backend hiện có; không mở/in `.env` hoặc truyền credentials vào câu lệnh/chat. `db:migrate:create` hiện in diff **User+Session+ResetToken → Favorite**, không apply SQL. Sau khi phase này đã áp dụng, có thể chạy lại `db:migrate` để xác minh idempotent; không dùng migrate reset hoặc db push force-reset.

Trong pgAdmin:

1. Chọn server local → Databases → **cineverse_dev** → Schemas → **public** → Tables → Refresh.
2. Mở **Favorite → Columns**: id UUID, userId UUID, movieId integer, createdAt timestamp with time zone; cả bốn NOT NULL.
3. **Constraints → Primary Key/Foreign Keys**: kiểm tra Favorite_pkey và Favorite_userId_fkey tham chiếu User(id), Cascade.
4. **Indexes**: có Favorite_userId_movieId_key (unique) và Favorite_userId_createdAt_idx. Prisma tạo unique bằng unique index, nên không nhất thiết có một mục riêng dưới Unique Constraints.
5. Chỉ View/Edit Data → All Rows để xem bảng hiện đang rỗng; không cần thêm/xóa dữ liệu để thử. Không mở các cột hash của auth.

Có thể chạy các câu SELECT chỉ đọc sau:

```sql
SELECT COUNT(*) FROM public."Favorite";

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'Favorite'
ORDER BY ordinal_position;

SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'Favorite';
```

## Kiểm thử riêng, không ghi vào database thật

### Kết quả thực tế

Migration `20261026030000_add_favorite_model` **đã áp dụng thành công** lên `cineverse_dev`, PostgreSQL **17.11**. Prisma Client 7.10.1 đã sinh lại và nhận diện Favorite. Bốn cột, primary key, unique index, index theo User và FK Cascade được xác minh qua catalog trên PostgreSQL thật.

| Model              |  Trước migration | Sau migration | Sau chạy lại migration |
| ------------------ | ---------------: | ------------: | ---------------------: |
| User               |                2 |             2 |                      2 |
| Session            |                1 |             1 |                      1 |
| PasswordResetToken |                0 |             0 |                      0 |
| Favorite           | 0 (chưa có bảng) |             0 |                      0 |

Chạy lại db:migrate báo schema khớp và không ghi database. History có đúng bốn migration, Favorite xuất hiện **một lần**; history/checksum và các count không đổi sau lần chạy lại. Ba file SQL migration cũ không bị sửa. db:check nhận diện năm đối tượng public (bốn bảng ứng dụng và _prisma_migrations), Favorite.count() = 0 và kiểm tra cấu trúc đạt.

| Kiểm tra                             | Kết quả                                                |
| ------------------------------------ | ------------------------------------------------------ |
| db:validate / db:generate            | Đạt                                                    |
| db:migrate lần đầu / lần chạy lại    | Đạt; apply một lần, lần sau chỉ đọc                    |
| db:check                             | Đạt trên PostgreSQL 17.11 thật                         |
| npm test                             | **146 đạt**: 96 backend + 50 frontend; không fail/skip |
| SQL/guard tests tập trung            | 16 đạt, gồm PostgreSQL RAM và migration planner        |
| Lint / TypeScript / production build | Đạt                                                    |

Không có Favorite được INSERT/DELETE trong cineverse_dev để thử ràng buộc. Các thao tác CRUD/Cascade/drift test chỉ diễn ra trong RAM; không đọc hash hoặc token của người dùng thật, không mở/in `.env`, không sửa auth/UI hay commit/push.

Khai báo dev dependency **@electric-sql/pglite 0.4.3**, cùng phiên bản đã có gián tiếp qua Prisma, để tests có dependency rõ ràng. Đây là PostgreSQL WASM chạy trong RAM khi không cấp dataDir; không dùng DATABASE_URL, không tạo socket hoặc ghi file database test. Các INSERT/DELETE/DROP trong test chỉ xảy ra trong instance này và được đóng bằng finally. Đây là kiểm thử engine SQL cô lập, không phải kiểm thử CRUD trên PostgreSQL 17 của người dùng. [PGlite in-memory](https://pglite.dev/docs/filesystems).

Test tích hợp áp dụng SQL thật của các migration cũ/mới lên RAM, tạo User/Session/ResetToken giả, rồi xác minh:

- Migration additive giữ các bản ghi auth có sẵn; Favorite ban đầu rỗng.
- Catalog đúng model/FK/index và không có metadata phim dư thừa.
- createdAt có default; khác User được lưu cùng phim, cùng User được lưu nhiều phim.
- Cặp trùng bị chặn; User không tồn tại/null/UUID sai bị chặn.
- movieId dạng text/fractional parameter/null/Int32 overflow bị chặn.
- SQL apply trùng thất bại và rollback không mất dữ liệu; planner nhận diện trạng thái migration đã áp dụng.
- Cascade và guard phát hiện thiếu unique index trong RAM.
- Guard tiếp tục chặn history/checksum/bảng lạ; count=3 dùng đúng snapshot trước Favorite.

```powershell
node --test backend/tests/favorite-database.test.mjs backend/tests/migration-plan.test.mjs
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
```

Không có test tự thêm/xóa Favorite hoặc reset tài khoản trong cineverse_dev. Việc kiểm chứng PostgreSQL 17 thật chỉ đọc metadata, COUNT, Prisma delegate và history sau migration; các thao tác thử unique/FK/Cascade được thực hiện trên PGlite.

## File thay đổi

| File                                                                              | Trách nhiệm                                         |
| --------------------------------------------------------------------------------- | --------------------------------------------------- |
| backend/prisma/schema.prisma                                                      | model Favorite và relation User.favorites           |
| backend/prisma/migrations/20261026030000_add_favorite_model/migration.sql **mới** | DDL additive                                        |
| backend/prisma/baselines/password-reset.prisma **mới**                            | snapshot schema ở migration 3                       |
| backend/database/inspect.mjs                                                      | prefix migration 4, snapshot mapping, COUNT an toàn |
| backend/database/favorite.mjs **mới**                                             | kiểm tra catalog Favorite chỉ đọc                   |
| backend/scripts/migrate.mjs                                                       | kiểm tra snapshot/catalog/counts, timeout hữu hạn   |
| backend/scripts/check-database.mjs                                                | kiểm tra Favorite/Prisma/index/FK                   |
| backend/tests/favorite-database.test.mjs **mới**                                  | SQL integration trong RAM                           |
| backend/tests/migration-plan.test.mjs                                             | guard migration 4 và DDL không phá dữ liệu          |
| package.json, package-lock.json                                                   | PGlite dev dependency và diff baseline hiện hành    |
| README.md, docs/phase-6.3a-favorites-database.md **mới**                          | hướng dẫn, kết quả và giới hạn                      |

Prisma Client sinh lại trong backend/generated (ignore). Các migration cũ, config credentials, auth runtime, frontend và TMDB endpoints không thay đổi.

## Phase 6.3B tiếp theo — chỉ kế hoạch

Sau khi bạn kiểm tra phase này, bước tiếp theo có thể thêm GET/POST/DELETE Favorites API. API cần lấy userId từ session đã xác thực, không tin userId từ body; validate movieId là số nguyên dương Int32, chặn trùng bằng compound unique, chỉ đọc/xóa Favorite thuộc User hiện tại và giữ CSRF/Origin/body/rate/error controls. Metadata phim lấy từ proxy TMDB hiện có; chưa triển khai các endpoint đó ở đây.

Dừng tại Phase 6.3A.
