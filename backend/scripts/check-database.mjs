import { getPrisma, disconnectDatabase } from '../database/client.mjs'
import { databaseErrorMessage } from '../database/config.mjs'
import { inspectDatabase } from '../database/inspect.mjs'
import { assertFavoriteSchema } from '../database/favorite.mjs'

// CLI riêng, không có HTTP endpoint để đọc database.
const timeout = setTimeout(() => {
  console.error(
    'Kiểm tra database quá 15 giây; đã dừng. Kiểm tra PostgreSQL và cấu hình local.',
  )
  process.exit(1)
}, 15_000)

try {
  const client = await getPrisma()
  const snapshot = await inspectDatabase(client)
  console.info(
    `Kết nối OK: cineverse_dev, PostgreSQL ${snapshot.version}, schema public.`,
  )
  console.info(
    `Số đối tượng bảng/view/sequence hiện hữu: ${snapshot.objects.length}.`,
  )
  const hasUser = snapshot.objects.some(
    (item) =>
      item.schema === 'public' && item.name === 'User' && item.kind === 'r',
  )
  if (hasUser) {
    await client.user.count()
    console.info(
      'Bảng User tồn tại; Prisma truy vấn model thành công. Không đọc/hiển thị bản ghi người dùng.',
    )
  } else {
    console.info(
      'Chưa có bảng User. Chỉ chạy db:migrate sau khi đã kiểm tra database an toàn.',
    )
  }
  if (
    snapshot.objects.some(
      (item) =>
        item.schema === 'public' &&
        item.name === 'Session' &&
        item.kind === 'r',
    )
  ) {
    await client.session.count()
    console.info(
      'Bảng Session tồn tại; Prisma truy vấn được, không đọc tokenHash hoặc cookie.',
    )
  } else
    console.info(
      'Chưa có bảng Session; kiểm tra migration Phase 6.2B nếu cần Login.',
    )
  if (
    snapshot.objects.some(
      (item) =>
        item.schema === 'public' &&
        item.name === 'PasswordResetToken' &&
        item.kind === 'r',
    )
  ) {
    await client.passwordResetToken.count()
    console.info(
      'Bảng PasswordResetToken tồn tại; Prisma truy vấn được, không đọc tokenHash.',
    )
  }
  if (
    snapshot.objects.some(
      (item) =>
        item.schema === 'public' &&
        item.name === 'Favorite' &&
        item.kind === 'r',
    )
  ) {
    await assertFavoriteSchema(client)
    const count = await client.favorite.count()
    console.info(
      `Favorite tồn tại: ${count} bản ghi. Cột, primary key, unique(userId,movieId), index(userId,createdAt), FK User/Cascade đều hợp lệ; Prisma nhận diện model.`,
    )
  } else
    console.info(
      'Chưa có Favorite; db:migrate chỉ áp dụng migration đã review khi guard đạt.',
    )
} catch (error) {
  console.error(databaseErrorMessage(error))
  process.exitCode = 1
} finally {
  try {
    await disconnectDatabase()
  } catch {
    console.error(
      'Không thể đóng kết nối database bình thường; không hiển thị chi tiết nội bộ.',
    )
    process.exitCode = 1
  }
  clearTimeout(timeout)
}
