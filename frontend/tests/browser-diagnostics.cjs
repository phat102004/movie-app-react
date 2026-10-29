// Emit only fixed error kinds and test source locations, never messages/values/URLs.
exports.safeBrowserFailure = (suite, error) => {
  const label = /^[A-Za-z0-9_-]+\.browser\.cjs$/.test(suite) ? suite : 'unknown.browser.cjs'
  const kind = ['AssertionError', 'TimeoutError', 'TypeError', 'RangeError', 'Error'].includes(error?.name) ? error.name : 'Unknown'
  const locations = (String(error?.stack ?? '') + '\n' + String(error?.stderr ?? '')).split('\n')
    .filter(line => /^\s*at\s/.test(line))
    .flatMap(line => line.match(/frontend[\\/]tests[\\/]([A-Za-z0-9_-]+\.browser\.cjs:\d+:\d+)/)?.slice(1) ?? [])
    .slice(0, 4)
  return `SAFE_BROWSER_FAILURE ${label}: ${kind}; locations=${locations.join(',') || 'none'}`
}
