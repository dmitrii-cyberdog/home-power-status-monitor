import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { I18n } from '@grammyjs/i18n'
import { Bot } from 'grammy'

import { createBotRoutes } from '../../src/api/bot/index.js'
import config from '../../src/config/config.js'
import { configureTelegramApi } from '../../src/services/botApi.js'
import { createChatAccess } from '../../src/services/chatAccess.js'
import { openMonitorStore } from '../../src/services/monitorStore.js'
import { telegramApiThrottler } from '../../src/services/telegramApiQueue.js'

const notificationFixture = async (
  t,
  {
    chat = { id: -1007, type: 'supergroup', title: 'Home' },
    name = 'Family Home',
    admins = [],
    secret = 'test-only',
    check,
    hold,
    throttled = false,
  } = {},
) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-command-'))

  const store = await openMonitorStore({ directory, homeIds: ['1'] })

  t.after(async () => {
    await store.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const homes = [{ id: '1', name, status: 'unknown' }]

  const access = createChatAccess({ store, homes, secret })

  await access.initialize()

  const bot = new Bot('1:fake')

  const from = { id: 7, is_bot: false, first_name: 'User' }
  const replies = []
  let messageId = 0

  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: 'Power',
    username: 'power_test_bot',
  }

  bot.api.config.use(async (_previous, method, payload) => {
    await hold?.(method, payload)

    const result =
      method === 'sendMessage'
        ? {
            message_id: ++messageId,
            date: 1,
            chat,
            from: bot.botInfo,
            text: payload.text,
            reply_markup: payload.reply_markup,
          }
        : true

    replies.push({ method, payload, message: result })

    return { ok: true, result }
  })

  if (throttled) {
    configureTelegramApi(bot.api)
  }

  bot.use(new I18n(config.botSettings.i18nSettings))

  bot.use(
    createBotRoutes({
      access,
      admins,
      homeMonitor: {
        getStatuses: () => homes,
        check: check ?? (async () => homes),
      },
    }),
  )

  const send = (text, replyTo) => {
    const id = ++messageId

    const entities = text.startsWith('/')
      ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }]
      : []

    return bot.handleUpdate({
      update_id: id,
      message: {
        message_id: id,
        date: 0,
        chat,
        from,
        text,
        entities,
        reply_to_message: replyTo,
      },
    })
  }

  const click = (message, data, sender = from) =>
    bot.handleUpdate({
      update_id: ++messageId,
      callback_query: {
        id: String(messageId),
        from: sender,
        chat_instance: 'test',
        message,
        data,
      },
    })

  return { access, store, homes, chat, replies, send, click }
}

test('replying to a notification prompt saves the setting and confirms it', async t => {
  const { access, store, homes, chat, replies, send } =
    await notificationFixture(t)

  await access.authorize(String(chat.id), 'test-only', 'en')
  await send('/on_notification@power_test_bot')

  const prompt = replies.at(-1)

  await send('Family Home')
  assert.equal(replies.length, 1)
  assert.equal(access.recipients('1', store.readChats()).length, 0)
  await send('Missing', prompt.message)
  assert.equal(replies.at(-1).payload.text, 'Home not found.')
  await send(' family home ', prompt.message)
  assert.equal(replies.at(-1).payload.text, 'Notifications enabled.')
  assert.equal(
    access.recipients('1', store.readChats())[0].chatId,
    String(chat.id),
  )
  assert.deepEqual(prompt.payload.reply_markup, {
    force_reply: true,
    selective: true,
  })
  assert.equal(prompt.payload.reply_parameters.message_id, 1)

  await send('/on_notification@power_test_bot Family Home')
  assert.equal(replies.at(-1).payload.text, 'Notifications already enabled.')
  await send('/off_notification@power_test_bot')

  const disablePrompt = replies.at(-1).message

  await send('Family Home', disablePrompt)
  assert.equal(replies.at(-1).payload.text, 'Notifications disabled.')
  assert.equal(access.recipients('1', store.readChats()).length, 0)

  const rotatedAccess = createChatAccess({ store, homes, secret: 'rotated' })

  await rotatedAccess.initialize()
  await send('Family Home', prompt.message)
  assert.equal(
    replies.at(-1).payload.text,
    'This group is not authorized. Ask a bot admin to approve it from a private chat.',
  )
  assert.equal(rotatedAccess.recipients('1', store.readChats()).length, 0)
})

test('only a named private status reply offers a subscription button', async t => {
  const name = 'Home & '.repeat(800)

  const { access, replies, send } = await notificationFixture(t, {
    chat: { id: 7, type: 'private', first_name: 'User' },
    name: name.trim(),
  })

  await access.authorize('7', 'test-only', 'en')
  await send('/status')
  assert.ok(replies.every(({ payload }) => !payload.reply_markup))
  replies.length = 0

  await send(`/status ${name.trim()}`)
  assert.ok(replies.length > 1)
  assert.ok(replies.slice(0, -1).every(({ payload }) => !payload.reply_markup))
  assert.deepEqual(replies.at(-1).payload.reply_markup.inline_keyboard, [
    [{ text: 'Enable notifications', callback_data: 'subscription:on:1' }],
  ])

  await access.setSubscription('7', '1', true, 'en')
  await send(`/status ${name.trim()}`)
  assert.deepEqual(replies.at(-1).payload.reply_markup.inline_keyboard, [
    [{ text: 'Disable notifications', callback_data: 'subscription:off:1' }],
  ])

  const group = await notificationFixture(t)

  await group.access.authorize(String(group.chat.id), 'test-only', 'en')
  await group.send('/status@power_test_bot Family Home')
  assert.equal(group.replies.at(-1).payload.reply_markup, undefined)
})

test('private status callbacks confirm saved actions and reject invalid targets', async t => {
  const { access, store, homes, replies, send, click } =
    await notificationFixture(t, {
      chat: { id: 7, type: 'private', first_name: 'User' },
    })

  await access.authorize('7', 'test-only', 'en')
  await send('/status Family Home')

  const card = replies.at(-1).message

  for (const [message, data, sender] of [
    [card, 'subscription:off:999'],
    [card, 'subscription:toggle:1'],
    [card, 'subscription:on:1', { id: 8, is_bot: false, first_name: 'Other' }],
    [{ ...card, date: 0 }, 'subscription:on:1'],
    [
      {
        ...card,
        chat: { id: -1007, type: 'supergroup' },
        text: '/home',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
      },
      'subscription:on:1',
    ],
  ]) {
    const calls = replies.length

    await click(message, data, sender)
    assert.equal(replies.length, calls + 1)
    assert.equal(replies.at(-1).method, 'answerCallbackQuery')
    assert.equal(access.recipients('1', store.readChats()).length, 0)
  }

  await click(card, 'subscription:on:1')
  assert.equal(replies.at(-2).payload.text, 'Notifications enabled.')
  assert.equal(replies.at(-1).method, 'editMessageReplyMarkup')
  assert.equal(access.recipients('1', store.readChats()).length, 1)

  const markup = replies.at(-1).payload.reply_markup

  assert.deepEqual(markup.inline_keyboard, [
    [{ text: 'Disable notifications', callback_data: 'subscription:off:1' }],
  ])
  await click({ ...card, reply_markup: markup }, 'subscription:on:1')
  assert.equal(replies.at(-1).method, 'answerCallbackQuery')
  assert.equal(replies.at(-1).payload.text, 'Notifications already enabled.')
  await click({ ...card, reply_markup: markup }, 'subscription:off:1')
  assert.equal(replies.at(-2).payload.text, 'Notifications disabled.')
  assert.equal(access.recipients('1', store.readChats()).length, 0)

  const rotated = createChatAccess({ store, homes, secret: 'rotated' })

  await rotated.initialize()
  await click(card, 'subscription:on:1')
  assert.equal(replies.at(-1).method, 'answerCallbackQuery')
  assert.match(replies.at(-1).payload.text, /Authorize this chat/)
  assert.equal(rotated.recipients('1', store.readChats()).length, 0)
})

test('only a configured admin in a private chat can clear registry records', async t => {
  const privateChat = { id: 7, type: 'private', first_name: 'User' }

  const ordinary = await notificationFixture(t, {
    chat: privateChat,
    admins: [8],
  })

  await ordinary.access.authorize('7', 'test-only', 'en')
  await ordinary.send('/clear_chats all')
  assert.equal(ordinary.replies.at(-1)?.payload.text, 'Admin access required.')
  assert.equal(ordinary.access.isAuthorized('7'), true)

  const group = await notificationFixture(t, { admins: [7] })

  await group.access.authorize(String(group.chat.id), 'test-only', 'en')
  await group.send('/clear_chats@power_test_bot all')
  assert.equal(group.replies.length, 0)
  assert.equal(group.access.isAuthorized(String(group.chat.id)), true)

  const { access, send, replies } = await notificationFixture(t, {
    chat: privateChat,
    admins: [7],
  })

  await access.authorize('-1007', 'test-only', 'en')
  await access.authorize('8', 'test-only', 'en')

  for (const text of [
    '/clear_chats',
    '/clear_chats -1007 extra',
    '/clear_chats 0',
    '/clear_chats 9007199254740992',
  ]) {
    await send(text)
    assert.match(replies.at(-1).payload.text, /Use \/clear_chats/)
  }

  await send('/clear_chats -1007')
  assert.match(replies.at(-1).payload.text, /Chat records removed:.*1/)
  assert.equal(access.isAuthorized('-1007'), false)
  assert.equal(access.isAuthorized('8'), true)
  await send('/clear_chats -1007')
  assert.equal(replies.at(-1).payload.text, 'Chat record not found.')
  await send('/clear_chats all')
  assert.match(replies.at(-1).payload.text, /Chat records removed:.*1/)
  assert.equal(access.isAuthorized('8'), false)
})

test('clearing a chat during a status refresh revokes access to the result', async t => {
  const started = Promise.withResolvers()
  const result = Promise.withResolvers()

  const { access, homes, replies, send } = await notificationFixture(t, {
    chat: { id: 7, type: 'private', first_name: 'User' },
    check: () => {
      started.resolve()

      return result.promise
    },
  })

  await access.authorize('7', 'test-only', 'en')

  const handling = send('/status Family Home')

  await started.promise
  await access.clearChats('7')
  result.resolve(homes)
  await handling
  assert.deepEqual(
    replies.map(({ payload }) => payload.text),
    ['Authorize this chat with /secret <value> first.'],
  )
})

const longName = 'Home & '.repeat(800).trim()

const sentTexts = replies =>
  replies
    .filter(({ method }) => method === 'sendMessage')
    .map(({ payload }) => payload.text)

const blockQueue = () => {
  const blockers = Array.from({ length: 10 }, () => Promise.withResolvers())

  const calls = blockers.map(blocker =>
    telegramApiThrottler(() => blocker.promise, 'sendMessage', {}),
  )

  return async () => {
    for (const blocker of blockers) {
      blocker.resolve()
    }

    await Promise.all(calls)
  }
}

test('an eligible guarded status sends every chunk through the queue', async t => {
  const { access, replies, send } = await notificationFixture(t, {
    chat: { id: 7, type: 'private', first_name: 'User' },
    name: longName,
    throttled: true,
  })

  await access.authorize('7', 'test-only', 'en')
  await send(`/status ${longName}`)
  assert.ok(sentTexts(replies).length > 1)
  assert.ok(replies.every(({ payload }) => !('signal' in payload)))
  assert.deepEqual(replies.at(-1).payload.reply_markup.inline_keyboard, [
    [{ text: 'Enable notifications', callback_data: 'subscription:on:1' }],
  ])
})

for (const [name, revoke] of [
  ['a grant clear', access => access.clearChats('7')],
  [
    'a grant clear followed by a new grant',
    async access => {
      await access.clearChats('7')
      await access.authorize('7', 'test-only', 'en')
    },
  ],
]) {
  test(`queued status chunks are skipped quietly after ${name}`, async t => {
    const { access, replies, send } = await notificationFixture(t, {
      chat: { id: 7, type: 'private', first_name: 'User' },
      name: longName,
      throttled: true,
    })

    await access.authorize('7', 'test-only', 'en')

    const release = blockQueue()

    const handling = send(`/status ${longName}`)

    await new Promise(resolve => {
      setImmediate(resolve)
    })
    await revoke(access)
    await release()
    await handling
    assert.deepEqual(replies, [])
  })
}

test('a status grant replaced between chunks stops the remaining chunks', async t => {
  const first = Promise.withResolvers()
  const resume = Promise.withResolvers()

  let held = false

  const { access, replies, send } = await notificationFixture(t, {
    chat: { id: 7, type: 'private', first_name: 'User' },
    name: longName,
    throttled: true,
    hold: async method => {
      if (method === 'sendMessage' && !held) {
        held = true
        first.resolve()
        await resume.promise
      }
    },
  })

  await access.authorize('7', 'test-only', 'en')

  const handling = send(`/status ${longName}`)

  await first.promise
  await access.clearChats('7')
  await access.authorize('7', 'test-only', 'en')
  resume.resolve()
  await handling
  assert.equal(sentTexts(replies).length, 1)
  assert.match(sentTexts(replies)[0], /Home &amp;/)
})

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
      access: {
        isAuthorized: () => authorized,
        captureGrant: () => (authorized ? {} : null),
        isGrantCurrent: () => authorized,
      },
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
      access: {
        isAuthorized: () => true,
        captureGrant: () => ({}),
        isGrantCurrent: () => true,
        isSubscribed: () => false,
      },
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
      access: {
        isAuthorized: () => authorized,
        captureGrant: () => (authorized ? {} : null),
        isGrantCurrent: () => authorized,
      },
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

test('group chats cannot submit the secret and are directed to an admin', async t => {
  const { access, chat, replies, send } = await notificationFixture(t)

  for (const type of ['group', 'supergroup']) {
    chat.type = type
    replies.length = 0

    await send('/secret@power_test_bot test-only')
    assert.equal(access.isAuthorized(String(chat.id)), false)
    assert.equal(replies[0].method, 'sendMessage')
    assert.match(replies[0].payload.text, /admin/i)
    assert.equal(replies.at(-1).method, 'deleteMessage')
    assert.doesNotMatch(JSON.stringify(replies), /test-only/)
  }

  await send('/status@power_test_bot')
  assert.match(replies.at(-1).payload.text, /group.*admin/i)
  assert.doesNotMatch(replies.at(-1).payload.text, /\/secret/)
})

test('private chats still authorize with the secret', async t => {
  const { access, replies, send } = await notificationFixture(t, {
    chat: { id: 7, type: 'private', first_name: 'User' },
  })

  await send('/secret test-only')
  assert.equal(access.isAuthorized('7'), true)
  assert.equal(replies[0].payload.text, 'Chat authorized.')
  assert.doesNotMatch(JSON.stringify(replies), /test-only/)
})

test('only a configured admin in a private chat can approve a group', async t => {
  const privateChat = { id: 7, type: 'private', first_name: 'User' }

  const ordinary = await notificationFixture(t, {
    chat: privateChat,
    admins: [8],
  })

  await ordinary.send('/authorize_group -1007')
  assert.equal(ordinary.replies.at(-1).payload.text, 'Admin access required.')
  assert.equal(ordinary.access.isAuthorized('-1007'), false)

  const group = await notificationFixture(t, { admins: [7] })

  await group.send('/authorize_group@power_test_bot -1007')
  assert.equal(group.replies.length, 0)
  assert.equal(group.access.isAuthorized('-1007'), false)

  const { access, replies, send, store } = await notificationFixture(t, {
    chat: privateChat,
    admins: [7],
  })

  for (const text of [
    '/authorize_group',
    '/authorize_group 1007',
    '/authorize_group 7',
    '/authorize_group 0',
    '/authorize_group -0',
    '/authorize_group -1007 extra',
    '/authorize_group -abc',
    '/authorize_group -9007199254740992',
  ]) {
    await send(text)
    assert.match(replies.at(-1).payload.text, /Use \/authorize_group/)
  }

  assert.deepEqual(store.readChats().chats, {})

  await send('/authorize_group -1007')
  assert.equal(replies.at(-1).payload.text, 'Group authorized.')
  assert.equal(access.isAuthorized('-1007'), true)

  await access.setSubscription('-1007', '1', true, 'en')
  await send('/authorize_group -1007')
  assert.equal(access.isSubscribed('-1007', '1'), true)
  assert.doesNotMatch(JSON.stringify(replies), /test-only/)
})

test('group approval is refused while protected access is disabled', async t => {
  const { access, replies, send } = await notificationFixture(t, {
    chat: { id: 7, type: 'private', first_name: 'User' },
    admins: [7],
    secret: '',
  })

  await send('/authorize_group -1007')
  assert.equal(replies.at(-1).payload.text, 'Protected access is disabled.')
  assert.equal(access.isAuthorized('-1007'), false)
})
