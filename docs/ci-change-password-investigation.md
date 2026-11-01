# CI investigation — Change Password browser regression

Ngày điều tra: **01/11/2026**. Baseline `c53fd93`, failed
[run 41263345920](https://github.com/phat102004/movie-app-react/actions/runs/41263345920),
job Quality/Browser `124720928548`. Không triển khai Phase 9B.

## Bằng chứng và phạm vi kết luận

- PostgreSQL native của run gốc đạt. Quality đạt 287 backend + 112 frontend tests,
  lint, TypeScript, build và Prisma validation, sau đó dừng tại
  `changePassword.browser.cjs` với `Error; locations=none`.
- Không còn stack/trace/assertion của child trong log run đó. Runner chỉ in stdout
  nếu child thành công; stderr lỗi chỉ được chuyển tiếp theo safe marker. Vì vậy
  không suy ra checkpoint thất bại từ việc thiếu dòng PASS trong log.
- `changePassword.browser.cjs` cũ bắt lỗi rồi chỉ in checkpoint và `error.name`,
  không dùng shared diagnostic có source location. Runner không nhận dạng dòng
  này và fallback sang lỗi `execFile` ở tiến trình cha: loại `Error`, không có
  vị trí trong test. Đây là **lỗi diagnostics đã xác minh**, có regression test
  tái hiện kết quả cũ và chứng minh dữ liệu mới được giữ qua runner.
- Commit 9A chỉ thêm Markdown; đối chiếu 8B/8C không chứng minh lỗi ứng dụng hay
  synchronization trong Change Password. Không tự sửa auth/focus hoặc timeout
  dựa vào các lỗi focus từng xảy ra ở Profile/MovieList.

**Nguyên nhân assertion/timeout của failure gốc vẫn chưa xác định.** Các lượt
local thành công không chứng minh lỗi đã biến mất hoặc chắc chắn chỉ là flaky
test. Không đánh dấu root cause của run gốc là resolved.

## Thay đổi tối thiểu

| File | Thay đổi |
| --- | --- |
| `frontend/tests/changePassword.browser.cjs` | Gọi `safeBrowserFailure` với lỗi gốc và checkpoint hiện có, không đổi assertions/test flow. |
| `frontend/tests/browser-diagnostics.cjs` | Chỉ xuất loại lỗi allowlist, vị trí tương đối trong browser test và checkpoint tĩnh allowlist; lọc safe child report theo đúng suite. |
| `scripts/test-browser.mjs` | Chuyển tiếp report đã lọc; giữ exit code thất bại và dừng suite như trước. |
| `backend/tests/browser-diagnostics.test.mjs` | Kiểm tra mất diagnostics kiểu cũ, giữ loại/vị trí/checkpoint kiểu mới, loại message/URL/input/absolute path, từ chối checkpoint và report giả. |
| Tài liệu này | Ghi bằng chứng, giới hạn và cách điều tra lần sau. |

Không log `error.message`, URL request, body, password, cookie, email hoặc token.
Không upload screenshot/trace/HAR. Không đổi product source, API, session rotation,
CSRF, Origin, account binding, Prisma schema/migrations hoặc dependencies.
Không thêm sleep, tăng timeout, xóa assertion hoặc retry CI tự động để tạo kết quả xanh.

## Kiểm thử thực tế

Môi trường local: Windows, Node **22.23.4**, Edge headless (bundled Chromium local
không sẵn có). Không có Linux browser run local; Linux/Chromium cần xác minh bằng
GitHub Actions đúng commit mới.

- Suite gốc chạy riêng trước khi sửa: đạt 7 checkpoints.
- Sau thay đổi diagnostics: một lượt CPU 6×, rồi sáu lượt tuần tự (ba thường,
  ba CPU 6×), đều đạt; không tăng timeout. CDP CPU throttling là phép thử local,
  không đại diện đầy đủ tải CPU hoặc scheduling của GitHub runner.
- Production build được phục vụ local bằng Vite preview chỉ trong test: 6 nhóm
  kiểm tra ứng dụng thực đạt (validation, errors/pending, responsive, password
  change/logout/re-login/revocation, navigation). Dev-only AuthProvider harness
  không có trong dist, nên stale-Me case chỉ chạy trong full dev suite.
- Tất cả tài khoản, sessions và database của browser suites ở RAM; SMTP/TMDB
  không gọi dịch vụ thật. Tests giữ password spaces, CSRF/header payload, revoke
  sessions của A, session B còn hợp lệ, redirect/notice, cancellation/stale Me.
- PostgreSQL native: **14/14** trên cluster mới dưới ignored `.npm-cache`, port
  ngẫu nhiên khác 5432; không dùng `.env`/database local. Lượt sandbox đầu không
  khởi tạo được cluster; chạy lại với quyền thực thi PostgreSQL thì đạt, cluster dừng.

Chạy gates bằng `npm run check` (tests/lint/typecheck/build/schema/full browser),
`node frontend/tests/changePassword.browser.cjs` để chạy riêng, và
`npm run test:postgres:local` khi có PG17 binaries và cấu hình test riêng.

| Local gate | Kết quả thực tế |
| --- | --- |
| `npm run check` | Exit 0: 289 backend + 112 frontend = **401 tests**, lint/typecheck/build/schema/full browser đều đạt. |
| Change Password trong full browser | 7/7 checkpoints, ngoài tám lượt standalone nêu trên. |
| Multi-tab | 22 checkpoints đạt, không đổi account binding hoặc policy. |
| Accessibility | 50 pages + 39 states, không violation/overflow/keyboard failure trong phạm vi suite. |
| Advanced UX | 34 snapshots, 37 checks đạt, 0 overflow/unexpected forced-color findings; giữ hai contrast reviews đã ghi nhận từ 8C. |
| Diagnostic tests sau lần chỉnh cuối | 3/3 đạt; lint chạy lại đạt. |
| Native PostgreSQL | 14/14 đạt, cluster test dừng. |

Run GitHub mới được báo cáo khi kết thúc nhiệm vụ; không coi local pass là bằng
chứng GitHub CI đã pass hoặc bằng chứng nguyên nhân run cũ đã resolved.

## Nếu tái diễn

1. Đọc safe report của child: suite, error kind, source line và checkpoint. Không
   bật raw stderr, Playwright DEBUG hoặc dump DOM chứa trường mật khẩu.
2. Tái hiện đúng thao tác/điều kiện ở vị trí đó bằng fixtures; phân biệt lỗi app,
   môi trường và synchronization trước khi sửa.
3. Nếu lỗi synchronization: gate trên request/state/focus thật, giữ assertions;
   không thêm khoảng chờ tùy ý hoặc nâng timeout.
4. Chạy lại suite riêng, full browser/multi-tab, quality và native isolated tests;
   chỉ kết luận root cause resolved sau bằng chứng phù hợp.
