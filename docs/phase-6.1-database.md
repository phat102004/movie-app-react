# Phase 6.1 — PostgreSQL & Prisma Foundation

Giai đoạn này chuẩn bị nơi lưu dữ liệu riêng của Cineverse. Chưa có API đăng ký/đăng nhập, hash mật khẩu, seed, tài khoản mặc định hoặc UI tài khoản. Không thay đổi code frontend và nguồn dữ liệu phim TMDB.

## Môi trường và lựa chọn phiên bản

- Windows, Node.js **22.18.0**, npm **10.9.3** đã kiểm tra thực tế.
- PostgreSQL 17 đã cài sẵn; binary trên máy báo **17.11**. `pg_isready` xác nhận localhost:5432 nhận kết nối, chưa đồng nghĩa xác thực được vào cineverse_dev.
- `prisma`, `@prisma/client`, `@prisma/adapter-pg` cùng pin **7.10.1**; driver `pg` **8.23.1**. Khi kiểm tra registry, latest của CLI đang trỏ tới Prisma 8 release candidate, nên chọn bản 7 ổn định tương thích Node hiện tại.
- Prisma 7 dùng driver adapter và cấu hình datasource URL trong `prisma.config.mjs`; schema chỉ khai báo provider PostgreSQL. Backend vẫn native Node.js ESM, không chuyển Express và không cần thêm backend/package.json. Dependencies backend ở root, dependencies giao diện vẫn ở frontend/package.json.
- Client mới dùng generator `prisma-client`, output rõ ràng trong backend/generated/prisma. Các import `.ts` chạy trực tiếp nhờ Node 22.18 hỗ trợ strip types; đã kiểm tra runtime client với PostgreSQL giả lập không khả dụng, không chỉ chạy generate.

Nguồn chính thức: [yêu cầu hệ thống Prisma 7](https://www.prisma.io/docs/orm/v7/reference/system-requirements), [generator](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators), [Prisma Config](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference), [driver adapter](https://www.prisma.io/docs/orm/v7).

## Thứ tự đọc và trách nhiệm từng file

| File tạo/sửa                                                           | Trách nhiệm                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| backend/prisma/schema.prisma                                           | User model và generator                                                         |
| backend/prisma.config.mjs                                              | Đường dẫn schema/migrations, đọc DATABASE_URL cho CLI                           |
| backend/prisma/migrations/20261026000000_init_user_model/migration.sql | DDL tạo User và unique index, bọc transaction                                   |
| backend/prisma/migrations/migration_lock.toml                          | Ghi provider PostgreSQL cho migration history                                   |
| backend/database/config.mjs                                            | Kiểm tra URL chỉ trỏ local cineverse_dev/public; driver options và lỗi an toàn  |
| backend/database/client.mjs                                            | Lazy singleton getPrisma và đóng pool                                           |
| backend/database/inspect.mjs                                           | Đọc metadata, kiểm tra database và trạng thái migration ban đầu                 |
| backend/scripts/check-database.mjs                                     | CLI kiểm tra kết nối/model, không có HTTP endpoint database                     |
| backend/scripts/migrate.mjs                                            | Kiểm tra an toàn trước khi gọi Prisma apply; timeout và đóng pool               |
| backend/env.mjs                                                        | Đọc backend/.env theo đường dẫn module, không phụ thuộc cwd                     |
| backend/index.mjs                                                      | Tái sử dụng env loader; không import Prisma, không kết nối DB                   |
| backend/tests/database.test.mjs                                        | 7 test cấu hình, an toàn migration, bảo mật lỗi, lazy import và runtime DB down |
| package.json, package-lock.json                                        | Dependencies pin version và npm scripts tại root                                |
| backend/.env.example                                                   | DATABASE_URL mẫu, không có credentials thật                                     |
| backend/.env (local, ignored)                                          | Thêm DATABASE_URL rỗng, giữ token hiện có; bạn nhập mật khẩu tại máy            |
| .gitignore                                                             | Bổ sung bỏ qua generated client; tiếp tục ignore env/secrets                    |
| README.md, docs/phase-6.1-database.md                                  | Cách chạy, giới hạn và hướng dẫn học                                            |

`backend/generated/prisma/` là output cục bộ của generate, không chỉnh tay hoặc commit. Schema, SQL migration và lockfile npm cần được quản lý trong Git.

## Cấu hình và chạy từ root

```powershell
cd D:\LearnReact\Cineverse
npm.cmd install
npm.cmd --prefix frontend install
```

Nếu clone mới, chỉ copy env khi chưa tồn tại, để không ghi đè token:

```powershell
if (-not (Test-Path backend\.env)) { Copy-Item backend\.env.example backend\.env }
```

Trong VS Code mở backend/.env, giữ nguyên token và sửa dòng database:

```dotenv
DATABASE_URL="postgresql://postgres:<PASSWORD>@localhost:5432/cineverse_dev?schema=public"
```

`<PASSWORD>` chỉ là vị trí cần thay. Khi chưa nhập mật khẩu, để `DATABASE_URL=""`; không thử kết nối với placeholder. URL gồm protocol, tài khoản, mật khẩu, host, port, database và schema. Phần mật khẩu cần percent-encoding, ví dụ `@`→`%40`, `#`→`%23`, `%`→`%25`, `:`→`%3A`, `/`→`%2F`, `?`→`%3F`, khoảng trắng→`%20`. Chỉ encode mật khẩu một lần, không encode toàn bộ URL; không dùng encoder trực tuyến cho mật khẩu thật. Không truyền URL chứa password qua tham số dòng lệnh hoặc gửi vào chat. Có thể dùng `encodeURIComponent` trong công cụ cục bộ đáng tin cậy; tránh lưu mật khẩu trong lịch sử terminal.

Environment của terminal có ưu tiên hơn file .env theo cơ chế Node loadEnvFile. Nếu đã set DATABASE_URL cũ ở terminal, mở terminal sạch để tránh kiểm tra nhầm cấu hình.

```powershell
npm.cmd run db:validate
npm.cmd run db:generate
npm.cmd run db:check
```

Hai lệnh đầu không cần PostgreSQL đang chạy hoặc URL đã cấu hình. `db:check` không thêm/sửa/xóa dữ liệu: xác nhận database thực, đọc catalog và lịch sử migration; nếu có User thì kiểm tra model bằng count, không xuất số đếm hoặc bản ghi. Timeout CLI 15 giây; pool kết nối 5 giây, query có giới hạn thời gian, được đóng sau lệnh. Lỗi không in URL, token, driver message hoặc dữ liệu User. Khi thiếu generated client/dependencies, cài root dependencies rồi generate lại.

Chạy web như trước, không phụ thuộc cấu hình DB:

```powershell
npm.cmd run dev
```

Backend ở 127.0.0.1:3001, frontend theo URL Vite thông báo. Nếu có proxy cũ, dừng tại terminal đang chạy nó trước khi mở dev mới. Không tự dừng dịch vụ PostgreSQL hay process của người dùng để test.

## Migration và an toàn dữ liệu

Migration là file SQL có thứ tự, mô tả cách đổi cấu trúc DB và được commit cùng code. `generate` chỉ sinh thư viện truy vấn; `migrate` mới tạo/đổi bảng thực. Không tự xóa file migration đã áp dụng hoặc sửa checksum để vượt lỗi.

SQL đầu tiên được Prisma sinh **offline** bằng:

```powershell
npm.cmd run db:migrate:create
```

Lệnh trên chỉ in DDL từ schema rỗng đến model hiện tại; không kết nối hoặc ghi DB. Migration đã được lưu sẵn dưới init_user_model và bọc BEGIN/COMMIT để DDL được áp dụng trong transaction. Không cần tự copy lại output hoặc sửa file SQL. Đây chỉ là cách tạo migration đầu tiên, không dùng `--from-empty` để sinh các thay đổi tiếp theo trên DB có dữ liệu.

Trước khi apply, kiểm tra pgAdmin: chọn cineverse_dev → Schemas, xem Tables/Views/Sequences và dữ liệu hiện hữu. Sau đó:

```powershell
npm.cmd run db:check
npm.cmd run db:migrate
npm.cmd run db:check
```

`db:migrate` thực hiện:

1. Kiểm tra URL thuộc local cổng 5432, DB cineverse_dev, schema public; không nhận URL upstream hoặc SQL tùy ý.
2. Kết nối thực và xác minh current_database(). Đọc metadata bảng/view/sequence trong các schema ứng dụng, không đọc thông tin người dùng.
3. Nếu có cấu trúc/lịch sử lạ, dừng và yêu cầu review; không tự baseline hoặc reset. Nếu migration đã áp dụng đúng checksum thì không chạy lại.
4. Với DB chưa có đối tượng ứng dụng, áp dụng duy nhất migration User đã review bằng `prisma migrate deploy`. Không seed, không tạo database, không sửa tài khoản/quyền.
5. Đọc lại lịch sử để xác nhận User và migration thành công; đóng pool. Lệnh con tối đa 30 giây, toàn CLI 60 giây. Nếu lỗi/timeout, kiểm tra lịch sử trước khi chạy lại, không tự khôi phục bằng reset.

Prisma `migrate dev` thông thường tạo rồi xóa một **shadow database** để phát hiện drift. Theo yêu cầu không tác động database khác, Phase này không tự chạy quy trình đó: dùng diff offline + deploy có kiểm tra. [Tài liệu shadow database chính thức](https://www.prisma.io/docs/orm/v7/prisma-migrate/understanding-prisma-migrate/shadow-database). Workflow hiện tại giới hạn cho migration đầu tiên, không phát hiện đầy đủ drift như migrate dev. Khi bắt đầu thay đổi schema ở giai đoạn sau, cần thống nhất workflow/shadow database riêng; chưa tạo hay cấu hình shadow database trong Phase 6.1.

Giới hạn: kiểm tra metadata trước apply không khóa những công cụ khác; hãy tránh sửa schema đồng thời bằng pgAdmin trong lúc migration. Nếu User đã tồn tại mà không có lịch sử Prisma, script dừng để cần baseline có review. Không sử dụng reset, force-reset hoặc DROP để khắc phục.

## Model User và dữ liệu thực

| Trường       | Ý nghĩa                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| id           | UUID primary key; Prisma sinh uuid() khi tạo User qua client, không phải số thứ tự đoán được dễ dàng                            |
| email        | TEXT NOT NULL và unique index; hiện uniqueness phân biệt hoa/thường, quy tắc chuẩn hóa email thuộc Phase Authentication sau này |
| name         | TEXT NOT NULL, tên hiển thị                                                                                                     |
| passwordHash | TEXT NOT NULL; chỉ dành cho hash từ thuật toán hash mật khẩu phù hợp, chưa triển khai tạo hash hoặc ghi User                    |
| createdAt    | TIMESTAMPTZ(3), default CURRENT_TIMESTAMP của DB                                                                                |
| updatedAt    | TIMESTAMPTZ(3), Prisma cập nhật bằng @updatedAt                                                                                 |

UUID có dạng chuỗi phân tách bằng dấu gạch ngang và lưu native PostgreSQL UUID. Giúp tạo ID độc lập, không cần counter tăng dần; không thay thế kiểm tra quyền truy cập. `uuid()` và `@updatedAt` là hành vi Prisma Client: khi viết SQL trực tiếp, phải cấp id/updatedAt hợp lệ; đừng giả định PostgreSQL tự sinh cả hai.

Hash là kết quả một chiều để xác minh mật khẩu, không phải plaintext hoặc mã hóa có thể giải ngược bằng khóa. Database không tự bảo đảm chuỗi trong passwordHash đã được hash; API Authentication sau này phải thực hiện điều đó. Giai đoạn này không tạo User giả hoặc lưu thử mật khẩu.

## PostgreSQL và SQL Server/SSMS

| Khái niệm         | Liên hệ kiến thức đã học                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| PostgreSQL Server | Dịch vụ database đang chạy, tương tự Database Engine/instance SQL Server; có thể chứa nhiều database  |
| cineverse_dev     | Một database dành cho development của Cineverse, giống database chọn trong SSMS                       |
| public            | Namespace/schema chứa bảng, gần vai trò dbo trong SQL Server; không có nghĩa tự động public qua HTTP  |
| User              | Bảng của ứng dụng trong public; có cột, primary key, unique constraint như SQL đã học                 |
| pgAdmin           | Công cụ quản trị PostgreSQL, tương tự SSMS; không phải database server                                |
| Prisma            | Thư viện ORM + CLI chạy trong Node, không thay thế PostgreSQL hoặc pgAdmin                            |
| ORM               | Ánh xạ model sang bảng, cung cấp API như prisma.user.findUnique thay cho tự ghép SQL trong từng route |
| Migration         | Lịch sử SQL thay đổi cấu trúc, giúp môi trường khác áp dụng cùng schema thay vì sửa tay từng máy      |

PostgreSQL có quy tắc quoted identifier: bảng model có chữ hoa phải viết `public."User"` trong SQL. Không dùng cú pháp dấu ngoặc vuông `[User]` của SQL Server.

Luồng database dự kiến:

```text
React → HTTP API Backend → Prisma Client → PostgreSQL → bảng public.User
```

Hiện mới có tầng Prisma/database và CLI; **chưa có HTTP API User**. Frontend không import Prisma hoặc nhận DATABASE_URL. Luồng phim vẫn riêng:

```text
React → Node proxy → TMDB (movies/details/videos/recommendations/credits)
```

Không sao chép catalog TMDB vào PostgreSQL. backend/index.mjs không import database/client.mjs; ngay cả import module client cũng chưa tạo pool. Chỉ getPrisma() mới tải generated client và tạo adapter, query mới cần kết nối. Vì thế thiếu URL/DB down không ngăn trang chủ/chi tiết phim hoạt động.

Tài khoản postgres hiện dùng cho thiết lập development theo môi trường có sẵn. Sau này nên tách tài khoản runtime ứng dụng với quyền đọc/ghi cần thiết trên bảng ứng dụng, và tài khoản migration có quyền DDL phù hợp. Không dùng superuser trong production. Phase này không tạo role hoặc thay đổi quyền hiện tại.

## Xem trong pgAdmin và Studio

Sau khi migration thực sự thành công:

1. pgAdmin → Servers → server local → Databases → cineverse_dev → Schemas → public → Tables → Refresh.
2. Mở User → Columns/Constraints/Indexes, xem UUID, unique email và các trường timestamp.
3. View/Edit Data → All Rows: bảng ban đầu rỗng. Không nhập plaintext vào passwordHash.
4. `_prisma_migrations` lưu migration name/checksum/trạng thái, không phải dữ liệu tài khoản.

```powershell
npm.cmd run db:studio
```

Mở URL local được terminal thông báo, xem User, xong nhấn Ctrl+C để dừng Studio. Đây là công cụ quản trị local, không thêm vào frontend hoặc công khai lên mạng. Chưa chạy Studio trong phiên triển khai vì thiếu credentials; chỉ mở sau khi cấu hình/migration xong.

## Kết quả kiểm tra và phần còn chờ

- `pg_isready`: localhost:5432 accepting connections; xác nhận dịch vụ đang nhận kết nối, chưa xác thực được DB do DATABASE_URL rỗng.
- Schema validate và Prisma Client generate: đạt, không cần kết nối DB.
- Node runtime generated client + adapter: đạt với tình huống cổng test đóng; không thử mật khẩu với PostgreSQL thật.
- Test backend/frontend: 64 test đạt (27 backend, 37 frontend), gồm 7 test mới về URL/guards/secrets/lazy init/DB unavailable.
- Lint, TypeScript frontend và production build: đạt.
- `db:check` và `db:migrate`: dừng có thông báo thiếu DATABASE_URL, exit code 1; **chưa xác thực, chưa đọc inventory thực của cineverse_dev, chưa áp dụng migration hoặc xác nhận bảng User**. Không có lệnh ghi database nào được chạy.
- Proxy local hiện có: popular và Inception 27205 trả HTTP 200 khi DATABASE_URL chưa cấu hình; request qua Vite /api cũng trả 200.
- Edge headless fixture hồi quy Phase 5: đạt các nhóm home/search/filter/sort/lastUpdated, điều hướng Back/Forward/direct URL/refresh, ID/404, loading/lỗi/Retry, metadata/ảnh thiếu, trailer click-to-load và cancellation/race condition.
- Smoke browser dùng TMDB thật: home, click card, chi tiết Inception, refresh và responsive 1440/768/390 đạt; không có page runtime error. Bộ live đầy đủ Phase 5 bị timeout tại bước chờ poster CDN tải xong; chưa xác minh thành công việc tải ảnh thật và các bước live tiếp sau đó. Không sửa giao diện/ảnh ngoài phạm vi database.
- Git xác nhận backend/.env và generated client bị ignore; backend/.env không được tracked. Quét 111 file có thể review/commit không thấy token TMDB thật. Frontend src/dist không chứa DATABASE_URL, PrismaClient, @prisma hoặc PostgreSQL URL.
- Vite do phiên kiểm thử tạo đã được dừng sau khi kiểm tra. Khi kết thúc, cổng 3001 cũng không còn proxy hoạt động; chạy lại `npm.cmd run dev` để mở cả backend/frontend.
- Không reset/drop database, không tạo seed/user, không đổi quyền quản trị, không commit/push.

## Ba bài tập thực hành

1. **Đọc cấu trúc bằng SQL:** sau khi migration thành công, dùng pgAdmin Query Tool truy vấn information_schema.columns cho table_schema='public' và table_name='User'. So sánh kiểu UUID/TEXT/TIMESTAMPTZ với schema.prisma, không đọc dữ liệu passwordHash.
2. **Kiểm tra unique constraint:** dùng pgAdmin xem User_email_key trong Indexes, rồi truy vấn pg_indexes chỉ lấy tên và định nghĩa index của User. Giải thích vì sao unique email khác primary key id; không cần tạo tài khoản thử.
3. **Mở rộng CLI chỉ đọc:** sửa backend/scripts/check-database.mjs để hiển thị cột nào có DEFAULT từ information_schema.columns. Chỉ in tên cột và trạng thái có default, không in credentials/bản ghi; giải thích vì sao id và updatedAt không có SQL DEFAULT dù Prisma có uuid()/@updatedAt.

Thứ tự học tiếp: đọc schema và SQL → phân biệt generate/migrate → URL + adapter → async CLI/đóng pool → metadata và migration history → transaction và quyền ứng dụng. Authentication chưa được triển khai.

Commit message đề xuất: `feat: establish PostgreSQL and Prisma foundation`. Không tự commit hoặc push.
