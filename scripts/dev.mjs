import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const frontend = fileURLToPath(new URL('../frontend/', import.meta.url))
const vite = fileURLToPath(
  new URL('../frontend/node_modules/vite/bin/vite.js', import.meta.url),
)
if (!existsSync(vite)) {
  console.error('Chạy npm.cmd --prefix frontend install trước khi khởi động.')
  process.exit(1)
}

const options = { stdio: 'inherit', windowsHide: true }
const children = []
let stopping = false
const startupTimeout = setTimeout(() => {
  console.error('Proxy chưa sẵn sàng sau 10 giây. Kiểm tra lỗi backend ở trên.')
  stop(1)
}, 10_000)

function stop(code = 0) {
  if (stopping) return
  stopping = true
  clearTimeout(startupTimeout)
  process.exitCode = code
  for (const child of children)
    if (child.exitCode === null) child.kill('SIGTERM')
}

function watchChild(child, name) {
  children.push(child)
  child.on('error', () => {
    console.error(`Không thể khởi động ${name}.`)
    stop(1)
  })
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`${name} đã dừng. Dừng cả hai server.`)
      stop(code ?? 1)
    }
  })
  return child
}

console.info('Đang khởi động Cineverse: Node proxy → Vite…')
const backend = watchChild(
  spawn(process.execPath, ['backend/index.mjs'], {
    ...options,
    cwd: root,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  }),
  'Node proxy',
)

backend.once('message', (message) => {
  if (stopping || message?.type !== 'proxy-ready') return
  clearTimeout(startupTimeout)
  watchChild(
    spawn(process.execPath, [vite, ...process.argv.slice(2)], {
      ...options,
      cwd: frontend,
    }),
    'Vite',
  )
})

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
