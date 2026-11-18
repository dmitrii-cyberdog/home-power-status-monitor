import { openMonitorStore } from '../../src/services/index.js'

try {
  const store = await openMonitorStore({
    directory: process.argv[2],
    homeIds: ['1'],
  })

  process.send('opened')
  process.once('message', async () => {
    await store.close()
    process.disconnect()
  })
} catch {
  process.send('refused')
  process.disconnect()
}
