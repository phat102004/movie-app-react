const channel = process.env.CINEVERSE_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined)
module.exports = { headless: true, ...(channel ? { channel } : {}) }
