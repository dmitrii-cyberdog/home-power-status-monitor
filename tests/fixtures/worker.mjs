import { rmSync } from 'node:fs'
import { mkdtemp, mkdir, cp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const directory = await mkdtemp(path.join(os.tmpdir(), 'monitor-worker-'))

await mkdir(path.join(directory, 'src'))
await cp(
  new URL('../../system', import.meta.url),
  path.join(directory, 'system'),
  { recursive: true },
)
process.chdir(path.join(directory, 'src'))

for (const key of Object.keys(process.env)) {
  if (/^(HOME_|DEVICE_|EZVIZ_|POWER_)/.test(key)) {
    delete process.env[key]
  }
}

process.env.TG_BOT_ACCESS_SECRET = ''
process.on('exit', () => {
  process.chdir(os.tmpdir())
  rmSync(directory, { recursive: true, force: true })
})

process.on('message', message => {
  if (message === 'stop') {
    process.emit('SIGTERM')
  }
})

await import('../../src/app.js')
