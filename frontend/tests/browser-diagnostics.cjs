// Emit only fixed error kinds and test source locations, never messages/values/URLs.
const checkpoints = new Set([
  'setup', 'guest-login', 'validation', 'wrong-current-reuse',
  'errors-and-pending', 'responsive', 'success', 'success-login-redirect',
  'success-login-notice', 'success-old-login-rejected', 'success-new-login',
  'navigate-during-change', 'stale-me',
])
const safeBrowserFailure = (suite, error, checkpoint) => {
  const label = /^[A-Za-z0-9_-]+\.browser\.cjs$/.test(suite) ? suite : 'unknown.browser.cjs'
  const kind = ['AssertionError', 'TimeoutError', 'TypeError', 'RangeError', 'Error'].includes(error?.name) ? error.name : 'Unknown'
  const locations = (String(error?.stack ?? '') + '\n' + String(error?.stderr ?? '')).split('\n')
    .filter(line => /^\s*at\s/.test(line))
    .flatMap(line => line.match(/frontend[\\/]tests[\\/]([A-Za-z0-9_-]+\.browser\.cjs:\d+:\d+)/)?.slice(1) ?? [])
    .slice(0, 4)
  const stage = label === 'changePassword.browser.cjs' && checkpoints.has(checkpoint)
    ? `; checkpoint=${checkpoint}` : ''
  return `SAFE_BROWSER_FAILURE ${label}: ${kind}; locations=${locations.join(',') || 'none'}${stage}`
}
exports.safeBrowserFailure = safeBrowserFailure

// A child suite must redact the original error before the runner forwards it.
// Never forward arbitrary stderr, form values, messages or absolute paths.
exports.browserFailureReport = (suite, error) => {
  const lines = String(error?.stderr ?? '').split('\n').map(line => line.trim()).filter(line => {
    const match = /^SAFE_BROWSER_FAILURE ([A-Za-z0-9_-]+\.browser\.cjs): (AssertionError|TimeoutError|TypeError|RangeError|Error|Unknown); locations=(none|[A-Za-z0-9_-]+\.browser\.cjs:\d+:\d+(?:,[A-Za-z0-9_-]+\.browser\.cjs:\d+:\d+){0,3})(?:; checkpoint=([a-z-]+))?$/.exec(line)
    return match && match[1] === suite && (!match[4] ||
      suite === 'changePassword.browser.cjs' && checkpoints.has(match[4]))
  })
  return lines.length ? lines : [safeBrowserFailure(suite, error)]
}
