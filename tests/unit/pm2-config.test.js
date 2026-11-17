import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('PM2 manifests use local/dev/prod modes and one storage writer', async () => {
  for (const [filename, defaultMode] of [
    ['server.json', 'local'],
    ['server_local.json', 'local'],
  ]) {
    const manifest = JSON.parse(
      await readFile(new URL(`../../${filename}`, import.meta.url), 'utf8'),
    )
    const [app] = manifest.apps

    assert.equal(manifest.apps.length, 1)
    assert.equal(app.name, 'home-power-status-monitor')
    assert.equal(app.env.NODE_ENV, defaultMode)
    assert.equal(app.env_dev.NODE_ENV, 'dev')
    assert.equal(app.env_prod.NODE_ENV, 'prod')
    assert.equal(app.env.ENV, undefined)
    assert.equal(app.instances, 1)
    assert.equal(app.exec_mode, 'fork')
    assert.equal(app.cwd, './src/')
    assert.equal(app.kill_timeout, 40000)
    assert.equal(app.shutdown_with_message, true)
    assert.ok(app.node_args.includes('--import=extensionless/register'))
  }
})
