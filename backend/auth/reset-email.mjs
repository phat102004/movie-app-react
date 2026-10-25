import { HttpError } from '../http.mjs'
import { isValidEmail } from './validation.mjs'

export const emailUnavailable = () =>
  new HttpError(
    503,
    'EMAIL_UNAVAILABLE',
    'Chưa thể gửi email đặt lại mật khẩu. Vui lòng thử lại sau hoặc liên hệ quản trị viên.',
  )

// Cấu hình chỉ đến từ server, không dùng Host/Origin do request cung cấp để tạo link.
export function readResetEmailConfig(env, authConfig) {
  const mode = env.PASSWORD_RESET_EMAIL_MODE ?? 'disabled'
  if (mode === 'disabled') return null
  if (!['smtp', 'local'].includes(mode)) throw emailUnavailable()
  const local = mode === 'local'
  const host = env.SMTP_HOST ?? ''
  const port = Number(env.SMTP_PORT)
  const secure = env.SMTP_SECURE === 'true'
  const from = env.SMTP_FROM ?? ''
  const origin = env.PUBLIC_APP_ORIGIN ?? ''
  if (
    !authConfig.allowedOrigins.has(origin) ||
    !isValidEmail(from) ||
    !host ||
    /[\s/@?#]/.test(host) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !['true', 'false'].includes(env.SMTP_SECURE)
  )
    throw emailUnavailable()
  if (local) {
    if (
      authConfig.production ||
      !['localhost', '127.0.0.1', '::1'].includes(host) ||
      secure ||
      env.SMTP_USER ||
      env.SMTP_PASSWORD
    )
      throw emailUnavailable()
  } else if (
    !env.SMTP_USER ||
    !env.SMTP_PASSWORD ||
    /^(your_|<)/i.test(env.SMTP_PASSWORD) ||
    (!origin.startsWith('https:') && authConfig.production)
  ) {
    throw emailUnavailable()
  }
  return {
    origin,
    from,
    options: {
      host,
      port,
      secure,
      ...(!local
        ? {
            requireTLS: true,
            auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
          }
        : { ignoreTLS: true }),
      connectionTimeout: 3000,
      greetingTimeout: 3000,
      socketTimeout: 5000,
      logger: false,
      debug: false,
      pool: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    },
  }
}

export function createResetEmailDelivery({
  config,
  env = process.env,
  createTransport,
} = {}) {
  let settings
  let transport
  return {
    ready() {
      try {
        settings ??= readResetEmailConfig(env, config)
        if (!settings) throw emailUnavailable()
        return settings.origin
      } catch {
        throw emailUnavailable()
      }
    },
    async send({ email, resetUrl }) {
      this.ready()
      try {
        if (!transport) {
          const factory =
            createTransport ??
            (await import('nodemailer')).default.createTransport
          transport = factory(settings.options)
        }
        // Cả hai trường hợp đều gửi qua SMTP, tránh tạo oracle qua lỗi provider.
        // Chỉ chủ hộp thư thấy hướng dẫn riêng; tài khoản không tồn tại không có link giả.
        const text = resetUrl
          ? `Bạn đã yêu cầu đặt lại mật khẩu Cineverse. Liên kết dùng một lần, hết hạn sau 20 phút:\n\n${resetUrl}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này. Đây không phải liên kết đăng nhập.`
          : 'Chúng tôi nhận được yêu cầu khôi phục Cineverse cho địa chỉ này, nhưng không có tài khoản để đặt lại mật khẩu. Hãy kiểm tra email bạn đã dùng để đăng ký. Nếu bạn không yêu cầu, hãy bỏ qua email này.'
        const result = await transport.sendMail({
          from: settings.from,
          to: email,
          subject: 'Yêu cầu đặt lại mật khẩu Cineverse',
          text,
          disableFileAccess: true,
          disableUrlAccess: true,
        })
        if (
          !result.accepted?.some(
            (address) => address.toLowerCase() === email,
          ) ||
          result.rejected?.length
        )
          throw emailUnavailable()
      } catch {
        throw emailUnavailable()
      }
    },
  }
}
