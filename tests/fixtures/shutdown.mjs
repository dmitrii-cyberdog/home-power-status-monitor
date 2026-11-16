import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const scenario = process.argv[2]
const pending = new Promise(() => {})
const record = (event, details) => {
  process.stdout.write(`${JSON.stringify({ event, details })}\n`)
}
const step = async name => {
  record(`${name}:start`)

  if (scenario === name) {
    await pending
  }

  if (scenario === `${name}-error`) {
    throw new Error(`${name} failed`)
  }

  await new Promise(resolve => {
    setTimeout(resolve, 10)
  })
  record(`${name}:end`)
}

//
//

const cronTask = {
  name: 'test-cron',
  stop: () => step('cron-stop'),
  destroy: () => step('cron-destroy'),
}
const modules = {
  './config': {
    default: { envName: 'shutdown-test', isDebug: false },
  },
  './services/cron': {
    cron: { drain: () => step('cron') },
  },
  './services/logger': {
    Logger: Object.fromEntries(
      ['notice', 'warning', 'error', 'critical'].map(level => [
        level,
        (message, details) => record(message, details),
      ]),
    ),
    flushLogger: () => step('logger'),
  },
  './services/requestsService': {
    closeRequestAgents: () => {
      record('agents:close')

      if (scenario === 'agents-error') {
        throw new Error('Agent cleanup failed')
      }
    },
  },
  './services/telegramApiQueue': {
    drainTelegramApiQueue: () => step('telegram'),
  },
  './loaders': {
    default: async (runtime, _onBotFailure, signal) => {
      signal.addEventListener('abort', () => record('startup:abort'))
      runtime.cronTasks = [cronTask]

      // Mimic an SDK timer that remains referenced even after cleanup succeeds.
      setInterval(() => {}, 60000)
      setImmediate(() => {
        if (scenario === 'fatal') {
          process.emit('uncaughtException', new Error('test failure'))
        } else {
          process.emit('SIGINT')
        }

        process.emit('SIGTERM')
      })

      if (scenario === 'startup') {
        await pending
      }

      runtime.botRunner = {}
      runtime.cronTasks = [cronTask]
    },
  },
  './loaders/bot': {
    drainBotRunner: async (_runner, signal) => {
      signal.addEventListener('abort', () => record('bot:abort'))
      await step('bot')
    },
  },
}

//
//

const context = vm.createContext({
  AbortController,
  process,
  clearTimeout,
  setTimeout: (callback, delay) => {
    record('timer', delay)

    // Exercise the real deadline callbacks without making each test wait 35s.
    return setTimeout(callback, delay / 100)
  },
})
const source = await readFile(
  new URL('../../src/app.js', import.meta.url),
  'utf8',
)
// eslint-disable-next-line n/no-unsupported-features/node-builtins -- The fixture runs with --experimental-vm-modules on Node 20+.
const app = new vm.SourceTextModule(source, { context })

await app.link(specifier => {
  const exports = modules[specifier]

  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- The fixture runs with --experimental-vm-modules on Node 20+.
  return new vm.SyntheticModule(
    Object.keys(exports),
    function () {
      for (const [name, value] of Object.entries(exports)) {
        this.setExport(name, value)
      }
    },
    { context },
  )
})
await app.evaluate()
