import assert from 'node:assert/strict'
import test from 'node:test'

import { Bot } from 'grammy'

import { createBotRoutes } from '../../src/api/bot/index.js'

test('protected commands gate home reads and group commands require addressing', async () => {
  let authorized = false
  let reads = 0
  let checks = 0
  const replies = []
  const bot = new Bot('1:fake')

  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: 'Power',
    username: 'power_test_bot',
  }
  bot.api.config.use(async (_previous, method, payload) => {
    replies.push({ method, payload })

    return { ok: true, result: true }
  })
  bot.use((ctx, next) => {
    ctx.t = key => key
    return next()
  })
  bot.use(
    createBotRoutes({
      access: { isAuthorized: () => authorized },
      homeMonitor: {
        check: async () => {
          checks++

          return []
        },
        getStatuses: () => {
          reads++
          return []
        },
      },
    }),
  )

  const send = (text, type = 'private') =>
    bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: 7, type },
        text,
        entities: [
          { type: 'bot_command', offset: 0, length: text.split(' ')[0].length },
        ],
      },
    })

  await send('/status')
  assert.equal(reads, 0)
  assert.equal(checks, 0)
  assert.equal(replies[0].payload.text, 'access_denied')
  authorized = true
  await send('/status', 'supergroup')
  assert.equal(reads, 0)
  assert.equal(checks, 0)
  await send('/status@power_test_bot', 'supergroup')
  assert.equal(reads, 1)
  assert.equal(checks, 1)
})

test('named status waits for the refresh and renders committed results', async () => {
  const bot = new Bot('1:fake')

  const replies = []

  let finish

  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: 'Power',
    username: 'power_test_bot',
  }
  bot.api.config.use(async (_previous, method, payload) => {
    replies.push({ method, payload })

    return { ok: true, result: true }
  })
  bot.use((ctx, next) => {
    ctx.t = key => key

    return next()
  })
  bot.use(
    createBotRoutes({
      access: { isAuthorized: () => true },
      homeMonitor: {
        getStatuses: () => [
          { id: '1', name: 'Family Home', status: 'unknown' },
        ],
        check: () =>
          new Promise(resolve => {
            finish = resolve
          }),
      },
    }),
  )

  const handling = bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: 7, type: 'private' },
      text: '/status Family Home',
      entities: [{ type: 'bot_command', offset: 0, length: 7 }],
    },
  })

  await new Promise(resolve => {
    setImmediate(resolve)
  })
  assert.equal(replies.length, 0)
  finish([
    {
      id: '1',
      name: 'Family Home',
      status: 'on',
      stats: { onMs: 0, offMs: 0, uncertainMs: 0, outageCount: 0 },
    },
  ])
  await handling
  assert.match(replies[0].payload.text, /Family Home/)
  assert.match(replies[0].payload.text, /monitor_on/)
  assert.doesNotMatch(replies[0].payload.text, /monitor_unknown/)
})

test('full status shares authorization, addressing, refresh and named filtering', async () => {
  const bot = new Bot('1:fake')
  const replies = []
  let authorized = false
  let reads = 0
  let checks = 0
  const homes = ['Family Home', 'Other Home'].map((name, index) => ({
    id: String(index + 1),
    name,
    status: 'on',
    stats: { onMs: 0, offMs: 0, uncertainMs: 0, outageCount: 0 },
  }))

  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: 'Power',
    username: 'power_test_bot',
  }
  bot.api.config.use(async (_previous, method, payload) => {
    replies.push({ method, payload })

    return { ok: true, result: true }
  })
  bot.use((ctx, next) => {
    ctx.t = key => key

    return next()
  })
  bot.use(
    createBotRoutes({
      access: { isAuthorized: () => authorized },
      homeMonitor: {
        getStatuses: () => {
          reads++

          return homes
        },
        check: async () => {
          checks++

          return homes
        },
      },
    }),
  )

  const send = (text, type = 'private') =>
    bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: 7, type },
        text,
        entities: [
          { type: 'bot_command', offset: 0, length: text.split(' ')[0].length },
        ],
      },
    })

  await send('/status_full')
  assert.equal(replies.at(-1)?.payload.text, 'access_denied')
  assert.equal(reads, 0)
  assert.equal(checks, 0)
  authorized = true
  await send('/status_full', 'supergroup')
  await send('/status_full@other_bot', 'supergroup')
  assert.equal(reads, 0)
  await send('/status_full@power_test_bot family home', 'supergroup')
  assert.equal(checks, 1)
  assert.equal(replies.at(-1).payload.parse_mode, 'HTML')
  assert.match(replies.at(-1).payload.text, /Family Home/)
  assert.doesNotMatch(replies.at(-1).payload.text, /Other Home/)
  assert.match(replies.at(-1).payload.text, /monitor_totals/)
  await send('/status_full Missing')
  assert.equal(checks, 1)
  assert.equal(replies.at(-1).payload.text, 'monitor_not_found')
  await send('/status_full')
  assert.equal(checks, 2)
  assert.match(replies.at(-1).payload.text, /Other Home/)
  await send('/status')
  assert.equal(checks, 3)
  assert.equal(replies.at(-1).payload.parse_mode, 'HTML')
  assert.doesNotMatch(replies.at(-1).payload.text, /monitor_totals/)
})

test('secret arguments remain exact and deletion failure does not change authorization', async () => {
  const bot = new Bot('1:fake')
  const calls = []
  const supplied = []

  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: 'Power',
    username: 'power_test_bot',
  }
  bot.api.config.use(async (_previous, method, payload) => {
    calls.push({ method, payload })

    if (method === 'deleteMessage') {
      throw new Error('secret-sentinel')
    }

    return { ok: true, result: true }
  })
  bot.use((ctx, next) => {
    ctx.t = key => key
    return next()
  })
  bot.use(
    createBotRoutes({
      access: {
        authorize: async (chatId, value) => {
          supplied.push({ chatId, value })
          return 'authorized'
        },
      },
    }),
  )

  await bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: 7, type: 'private' },
      text: '/secret  exact secret ',
      entities: [{ type: 'bot_command', offset: 0, length: 7 }],
    },
  })
  assert.deepEqual(supplied, [{ chatId: '7', value: ' exact secret ' }])
  assert.equal(calls[0].payload.text, 'access_authorized')
  assert.equal(calls[1].method, 'deleteMessage')
  assert.doesNotMatch(JSON.stringify(calls), /exact secret|sentinel/)
})
