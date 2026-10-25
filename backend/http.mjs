export class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export function sendJson(response, status, body, headers = {}) {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  response.end(JSON.stringify(body))
}

export function sendHttpError(response, error) {
  const known = error instanceof HttpError
  sendJson(
    response,
    known ? error.status : 500,
    {
      error: {
        code: known ? error.code : 'INTERNAL_ERROR',
        message: known
          ? error.message
          : 'Không thể xử lý yêu cầu. Vui lòng thử lại sau.',
        ...(known && error.fields ? { fields: error.fields } : {}),
      },
    },
    { Connection: 'close' },
  )
}

export async function readJsonBody(
  request,
  { maxBytes = 16 * 1024, timeoutMs = 10_000 } = {},
) {
  if (
    request.headers['content-type']?.split(';')[0].trim().toLowerCase() !==
      'application/json' ||
    !['identity', undefined].includes(request.headers['content-encoding'])
  ) {
    throw new HttpError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Chỉ hỗ trợ request JSON không nén với Content-Type application/json.',
    )
  }
  const tooLarge = () =>
    new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Nội dung yêu cầu vượt quá 16 KB.')
  if (Number(request.headers['content-length']) > maxBytes) throw tooLarge()

  const buffer = await new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    const timer = setTimeout(
      () =>
        finish(
          new HttpError(
            408,
            'REQUEST_TIMEOUT',
            'Gửi nội dung yêu cầu quá lâu.',
          ),
        ),
      timeoutMs,
    )
    timer.unref()
    function finish(error) {
      clearTimeout(timer)
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('aborted', onAbort)
      request.off('error', onAbort)
      if (error) {
        request.resume()
        reject(error)
      } else resolve(Buffer.concat(chunks, bytes))
    }
    function onData(chunk) {
      bytes += chunk.length
      if (bytes > maxBytes) finish(tooLarge())
      else chunks.push(chunk)
    }
    function onEnd() {
      finish()
    }
    function onAbort() {
      finish(new HttpError(400, 'INVALID_REQUEST', 'Yêu cầu đã bị ngắt.'))
    }
    request.on('data', onData)
    request.once('end', onEnd)
    request.once('aborted', onAbort)
    request.once('error', onAbort)
  })

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer))
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Nội dung JSON không hợp lệ.')
  }
}
