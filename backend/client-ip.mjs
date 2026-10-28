import { isIP } from 'node:net'

// One representation per address: IPv4-mapped IPv6 shares the IPv4 quota.
function parseIp(raw) {
  if (typeof raw !== 'string' || raw.includes('%')) return null
  const family = isIP(raw)
  if (!family) return null
  if (family === 4) {
    const value = raw
      .split('.')
      .reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n)
    return { family, bits: 32, value, key: raw, mapped: false }
  }
  let text = raw.toLowerCase()
  if (text.includes('.')) {
    const colon = text.lastIndexOf(':')
    const bytes = text.slice(colon + 1).split('.').map(Number)
    text =
      text.slice(0, colon + 1) +
      ((bytes[0] << 8) | bytes[1]).toString(16) +
      ':' +
      ((bytes[2] << 8) | bytes[3]).toString(16)
  }
  const [left, right] = text.split('::')
  const head = left ? left.split(':') : []
  const tail = right ? right.split(':') : []
  const groups =
    right === undefined
      ? head
      : [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail]
  const value = groups.reduce(
    (acc, group) => (acc << 16n) | BigInt('0x' + group),
    0n,
  )
  if ((value >> 32n) === 0xffffn) {
    const bytes = [24n, 16n, 8n, 0n].map((shift) =>
      Number((value >> shift) & 255n),
    )
    return { ...parseIp(bytes.join('.')), mapped: true }
  }
  return {
    family,
    bits: 128,
    value,
    key: groups.map((group) => parseInt(group, 16).toString(16)).join(':'),
    mapped: false,
  }
}

const configError = () =>
  new Error(
    'TRUSTED_PROXY_CIDRS phải là IP/CIDR cụ thể, phân cách bằng dấu phẩy (tối đa 64). Không hỗ trợ trust-all, hostname, port hoặc zone ID.',
  )

function readRanges(raw) {
  if (typeof raw !== 'string' || raw.length > 8192) throw configError()
  if (!raw.trim()) return []
  const entries = raw.split(',').map((entry) => entry.trim())
  if (entries.length > 64) throw configError()
  const ranges = entries.map((entry) => {
    const parts = entry.split('/')
    const address = parseIp(parts[0])
    if (!address || parts.length > 2) throw configError()
    let prefix = parts.length === 1 ? address.bits : Number(parts[1])
    if (parts.length === 2) {
      if (!/^(0|[1-9]\d{0,2})$/.test(parts[1])) throw configError()
      // Mapped CIDRs must describe only the mapped IPv4 range.
      if (address.mapped) prefix -= 96
    }
    if (prefix <= 0 || prefix > address.bits) throw configError()
    const shift = BigInt(address.bits - prefix)
    const start = (address.value >> shift) << shift
    return {
      family: address.family,
      shift,
      network: start >> shift,
      start,
      end: start + (1n << shift) - 1n,
    }
  })
  // Also reject lists whose union is equivalent to /0.
  for (const [family, bits] of [[4, 32], [6, 128]]) {
    let covered = 0n
    const sorted = ranges
      .filter((item) => item.family === family)
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
    for (const range of sorted) {
      if (range.start > covered) break
      if (range.end >= covered) covered = range.end + 1n
    }
    if (covered === (1n << BigInt(bits))) throw configError()
  }
  return ranges
}

export function createClientIpResolver(trustedProxyCidrs = '') {
  // Compile once at server creation; invalid config prevents startup.
  const ranges = readRanges(trustedProxyCidrs)
  const trusted = (address) =>
    ranges.some((range) =>
      range.family === address.family &&
      (address.value >> range.shift) === range.network,
    )
  return (request) => {
    const socket = parseIp(request.socket?.remoteAddress)
    if (!socket) return 'unknown' // Shared, bounded quota; never skip the limiter.
    if (!trusted(socket)) return socket.key

    const header = request.headers?.['x-forwarded-for']
    if (typeof header !== 'string' || !header || header.length > 4096)
      return socket.key
    // Node normally joins duplicate XFF fields. Reject ambiguous raw duplicates.
    let fields = 0
    for (let i = 0; i < (request.rawHeaders?.length ?? 0); i += 2)
      if (request.rawHeaders[i].toLowerCase() === 'x-forwarded-for') fields++
    if (fields > 1) return socket.key
    const hops = header.split(',')
    if (hops.length > 32) return socket.key
    const addresses = hops.map((hop) => parseIp(hop.trim()))
    if (addresses.some((address) => !address)) return socket.key

    let current = socket
    for (let i = addresses.length - 1; i >= 0 && trusted(current); i--)
      current = addresses[i]
    return current.key
  }
}

// Standalone handlers fail closed to socket-only unless the server injects policy.
export const socketClientIp = createClientIpResolver()
