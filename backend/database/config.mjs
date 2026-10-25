export class DatabaseConfigError extends Error {}

// Phase 6.1 chỉ làm việc với database local đã được người dùng tạo sẵn.
// Không đưa value hoặc URL vào thông báo lỗi.
export function readDatabaseConfig(value = process.env.DATABASE_URL) {
  if (!value?.trim()) {
    throw new DatabaseConfigError(
      'Chưa có DATABASE_URL. Điền mật khẩu cục bộ trong backend/.env rồi chạy lại.',
    )
  }

  let url
  try {
    url = new URL(value)
    decodeURIComponent(url.username)
    decodeURIComponent(url.password)
  } catch {
    throw new DatabaseConfigError(
      'DATABASE_URL không hợp lệ. Kiểm tra cấu trúc URL và URL-encode mật khẩu.',
    )
  }

  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    (url.port && url.port !== '5432') ||
    url.pathname !== '/cineverse_dev' ||
    url.searchParams.getAll('schema').some((schema) => schema !== 'public') ||
    [...url.searchParams.keys()].some(
      (key) => !['schema', 'connect_timeout'].includes(key),
    ) ||
    url.hash
  ) {
    throw new DatabaseConfigError(
      'Phase 6.1 chỉ cho phép PostgreSQL local cổng 5432, database cineverse_dev, schema public.',
    )
  }

  const password = decodeURIComponent(url.password)
  if (
    !url.username ||
    !password ||
    /^(<PASSWORD>|PASSWORD|your_password|replace_me)$/i.test(password)
  ) {
    throw new DatabaseConfigError(
      'DATABASE_URL thiếu tài khoản/mật khẩu hoặc còn placeholder. Tự nhập mật khẩu tại máy; không gửi vào chat.',
    )
  }

  // CLI và driver đều giới hạn thời gian chờ; không thay đổi URL trong file .env.
  url.searchParams.set('connect_timeout', '5')
  return {
    connectionString: url.toString(),
    driver: {
      host: url.hostname === '[::1]' ? '::1' : url.hostname,
      port: 5432,
      database: 'cineverse_dev',
      user: decodeURIComponent(url.username),
      password,
      max: 3,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 5000,
      statement_timeout: 5000,
      query_timeout: 6000,
    },
  }
}

export function databaseErrorMessage(error) {
  if (error instanceof DatabaseConfigError) return error.message
  const code = error?.code ?? error?.cause?.code
  const kind = error?.meta?.driverAdapterError?.cause?.kind
  if (
    ['28P01', '28000', 'P1000'].includes(code) ||
    kind === 'AuthenticationFailed'
  )
    return 'PostgreSQL từ chối xác thực. Kiểm tra tài khoản và mật khẩu đã URL-encode trong backend/.env.'
  if (['3D000', 'P1003'].includes(code) || kind === 'DatabaseDoesNotExist')
    return 'Không tìm thấy database cineverse_dev. Kiểm tra server/database trong pgAdmin; không tự tạo lại database.'
  if (
    ['ECONNREFUSED', 'ETIMEDOUT', 'P1001', 'P1002'].includes(code) ||
    ['DatabaseNotReachable', 'SocketTimeout'].includes(kind)
  )
    return 'Không kết nối được PostgreSQL local:5432. Kiểm tra PostgreSQL Server có đang chạy không.'
  if (['42P01', 'P2021'].includes(code) || kind === 'TableDoesNotExist')
    return 'Chưa có bảng User. Kiểm tra và áp dụng migration trước khi truy vấn model.'
  if (code === 'ERR_MODULE_NOT_FOUND')
    return 'Thiếu dependencies hoặc Prisma Client. Chạy npm.cmd install tại root, sau đó npm.cmd run db:generate.'
  return 'Thao tác database thất bại. Kiểm tra PostgreSQL, DATABASE_URL và migration trong pgAdmin. Chi tiết nội bộ đã được ẩn.'
}
