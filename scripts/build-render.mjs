import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

// Render exposes service variables at build time too. Do not pass secrets to
// package lifecycle scripts, Prisma generation or Vite. No VITE_* passthrough.
export function buildEnvironment(env) {
  const keys = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC',
    'ComSpec', 'PATHEXT', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR',
    'npm_config_cache', 'NPM_CONFIG_CACHE', 'CI']
  return Object.fromEntries(keys.filter(key => env[key] !== undefined).map(key => [key, env[key]]))
}

export async function assertCleanBuild() {
  for (const directory of ['.', 'backend', 'frontend'])
    if ((await readdir(directory)).some(name => /^\.env(?:\..*)?$/.test(name) && name !== '.env.example'))
      throw new Error('Use a clean checkout without real environment files for cloud build')
}

export const renderBuildSteps = [
  ['ci', '--include=dev'], ['--prefix', 'frontend', 'ci', '--include=dev'],
  ['run', 'db:generate'], ['run', 'build'],
]

async function main() {
  await assertCleanBuild()
  const npm = process.env.npm_execpath
  if (!npm) throw new Error('Invoke using npm run build:render')
  const clean = buildEnvironment(process.env)
  for (const args of renderBuildSteps) {
    const environment = { ...clean, NODE_ENV: args.includes('build') ? 'production' : 'test' }
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [npm, ...args], {
        env: environment, windowsHide: true, stdio: 'inherit',
      })
      child.once('error', reject)
      child.once('exit', code => resolve(code))
    })
    if (code !== 0) throw new Error('Cloud build step failed')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error('Render build failed. Use clean source and pinned Node/lockfiles; configuration values hidden.')
    process.exitCode = 1
  })
