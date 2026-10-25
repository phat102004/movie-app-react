import { loadBackendEnv } from './env.mjs'
import { disconnectDatabase } from './database/client.mjs'
import { createAppServer } from './server.mjs'

loadBackendEnv()

const server = createAppServer({
  tmdb: { token: process.env.TMDB_READ_ACCESS_TOKEN },
})
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
    server.close(() => {
      disconnectDatabase().catch(() => {
        console.error(
          'Không thể đóng database bình thường; đã ẩn chi tiết nội bộ.',
        )
        process.exitCode = 1
      })
    })
    server.closeAllConnections()
  })
}
