import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'
import { createProxyServer } from './proxy.mjs'

const envPath = fileURLToPath(new URL('./.env', import.meta.url))
if (existsSync(envPath)) loadEnvFile(envPath)

const server = createProxyServer({ token: process.env.TMDB_READ_ACCESS_TOKEN })
server.on('error', (error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? 'Cổng 3001 đang được sử dụng. Dừng proxy cũ trước khi chạy npm.cmd run dev.'
      : `Không thể khởi động proxy tại 127.0.0.1:3001 (${error.code ?? 'UNKNOWN'}).`,
  )
  process.exitCode = 1
})
server.listen(3001, '127.0.0.1', () => {
  console.info('Cineverse proxy: http://127.0.0.1:3001')
  // Báo cho script dev chỉ mở Vite sau khi backend đã lắng nghe.
  process.send?.({ type: 'proxy-ready' })
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close()
    server.closeAllConnections()
  })
}
