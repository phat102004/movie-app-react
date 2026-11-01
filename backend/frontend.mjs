import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { HttpError } from './http.mjs'
import { gzipSync, brotliCompressSync, constants } from 'node:zlib'

const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
const missing = () => new HttpError(404, 'NOT_FOUND', 'Không tìm thấy tài nguyên.')

// Snapshot only the dedicated public build, never resolve a request into the FS.
// Bounds avoid accidentally loading an arbitrary data directory as an artifact.
export async function createFrontendHandler(root) {
  const base = await realpath(root)
  const files = new Map()
  let bytes = 0, entries = 0
  async function collect(directory, prefix = '', depth = 0) {
    if (depth > 8) throw new Error('Build nesting exceeds bound')
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++entries > 1024) throw new Error('Build entry count exceeds bound')
      if (entry.isSymbolicLink()) throw new Error('Build symlink is not allowed')
      if (entry.name.startsWith('.')) continue
      const path = `${prefix}/${entry.name}`
      if (entry.isDirectory()) { await collect(resolve(directory, entry.name), path, depth + 1); continue }
      const extension = /\.[a-z0-9]+$/i.exec(path)?.[0].toLowerCase()
      const type = path === '/index.html' ? 'text/html; charset=utf-8' : mime[extension]
      if (!type || ['.js', '.css'].includes(extension) && !path.startsWith('/assets/')) continue
      const target = await realpath(resolve(directory, entry.name))
      if (!target.startsWith(base + sep)) throw new Error('Build path escaped')
      const metadata = await stat(target)
      if (!metadata.isFile() || metadata.size > 8 * 1024 * 1024 || bytes + metadata.size > 32 * 1024 * 1024)
        throw new Error('Build file exceeds resource bound')
      const body = await readFile(target)
      bytes += body.length
      const compressible = /^(text\/|image\/svg)/.test(type)
      const gzip = compressible ? gzipSync(body) : null
      const br = compressible ? brotliCompressSync(body, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 4 },
      }) : null
      bytes += (gzip?.length ?? 0) + (br?.length ?? 0)
      if (body.length > 8 * 1024 * 1024 || bytes > 32 * 1024 * 1024 || files.size >= 512)
        throw new Error('Build exceeds static resource bounds')
      files.set(path, { body, gzip, br, type, hashed: path.startsWith('/assets/') && /-[\w-]{8,}\.[a-z0-9]+$/i.test(path) })
    }
  }
  await collect(base)
  if (!files.has('/index.html')) throw new Error('Frontend build missing')
  return (request, response) => {
    let path
    try { path = decodeURIComponent((request.url ?? '/').split('?')[0]) } catch { throw missing() }
    if (path.includes('\\') || path.includes('\0') || path.split('/').some(part => part.startsWith('.')) ||
      /^\/(?:api|health|backend|frontend|src|node_modules|scripts|docs)(?:\/|$)/.test(path)) throw missing()
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD')
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Chỉ hỗ trợ GET hoặc HEAD.')
    }
    let file = files.get(path)
    if (!file) {
      if (path.startsWith('/assets/') || path.split('/').some(part => part.includes('.'))) throw missing()
      file = files.get('/index.html')
    }
    const encodings = new Map((request.headers?.['accept-encoding'] ?? '').split(',').map(value => {
      const match = /^\s*(br|gzip)\s*(?:;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*$/.exec(value)
      return match ? [match[1], Number(match[2] ?? 1)] : ['', 0]
    }))
    const encoding = file.br && encodings.get('br') > 0 ? 'br' : file.gzip && encodings.get('gzip') > 0 ? 'gzip' : null
    const body = encoding ? file[encoding] : file.body
    response.writeHead(200, { 'Content-Type': file.type, 'Content-Length': body.length,
      'Cache-Control': file.hashed ? 'public, max-age=31536000, immutable' : 'no-store',
      Vary: 'Accept-Encoding', ...(encoding ? { 'Content-Encoding': encoding } : {}),
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' })
    response.end(request.method === 'HEAD' ? undefined : body)
  }
}
