import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { I18n } from '@grammyjs/i18n'
import { Bot } from 'grammy'

import { createBotRoutes } from '../../src/api/bot/index.js'
import config from '../../src/config/index.js'
import { createPendingUpdatesHandler } from '../../src/middlewares/bot/index.js'
import {
  configureTelegramApi,
  createChatAccess,
  openMonitorStore,
  telegramApiThrottler,
} from '../../src/services/index.js'

const telegramText = html =>
  html
    .replace(/<\/?[bi]>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')

const notificationFixture = async (
  t,
  {
    chat = { id: -1007, type: 'supergroup', title: 'Home' },
    name = 'Family Home',
    groupTitle = 'Family',
    notificationIntervalMinutes,
    admins = [],
    secret = 'test-only',
    check,
    hold,
    throttled = false,
    limitPending = false,
    unavailableChats = [],
  } = {},
) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-command-'))

  const store = await openMonitorStore({ directory, homeIds: ['1'] })

  t.after(async () => {
    await store.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const homes = [
    { id: '1', name, status: 'unknown', notificationIntervalMinutes },
  ]

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

    if (
      method === 'getChat' &&
      unavailableChats.includes(String(payload.chat_id))
    ) {
      replies.push({ method, payload })

      throw new Error('Chat unavailable')
    }

    let result = true

    if (method === 'sendMessage' || method === 'editMessageText') {
      result = {
        message_id: method === 'sendMessage' ? ++messageId : payload.message_id,
        date: 1,
        chat,
        from: bot.botInfo,
        text:
          payload.parse_mode === 'HTML'
            ? telegramText(payload.text)
            : payload.text,
        reply_markup: payload.reply_markup,
      }
    } else if (method === 'getChat') {
      result = {
        id: Number(payload.chat_id),
        type: 'supergroup',
        title: groupTitle,
      }
    }

    replies.push({ method, payload, message: result })

    return { ok: true, result }
  })

  if (throttled) {
    configureTelegramApi(bot.api)
  }

  bot.use(new I18n(config.botSettings.i18nSettings))

  if (limitPending) {
    bot.use(createPendingUpdatesHandler(access))
  }

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

  const send = (text, replyTo, sender = from) => {
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
        from: sender,
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
  assert.equal(replies.at(-1).payload.text, '<i>🔍 Home not found.</i>')
  await send(' family home ', prompt.message)
  assert.equal(replies.at(-1).payload.text, '<b>🔔 Notifications enabled.</b>')
  assert.equal(
    access.recipients('1', store.readChats())[0].chatId,
    String(chat.id),
  )
  assert.deepEqual(prompt.payload.reply_markup, {
    force_reply: true,
    selective: true,
  })
  assert.equal(prompt.payload.parse_mode, 'HTML')
  assert.equal(prompt.payload.reply_parameters.message_id, 1)

  await send('/on_notification@power_test_bot Family Home')
  assert.equal(
    replies.at(-1).payload.text,
    '<b>🔔 Notifications already enabled.</b>',
  )
  await send('/off_notification@power_test_bot')

  const disablePrompt = replies.at(-1).message

  await send('Family Home', disablePrompt)
  assert.equal(replies.at(-1).payload.text, '<b>🔕 Notifications disabled.</b>')
  assert.equal(access.recipients('1', store.readChats()).length, 0)

  const rotatedAccess = createChatAccess({ store, homes, secret: 'rotated' })

  await rotatedAccess.initialize()
  await send('Family Home', prompt.message)
  assert.equal(
    replies.at(-1).payload.text,
    '<i>🔒 This group is not authorized. Ask a bot admin to approve it from a private chat.</i>',
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
    [{ text: '🔔 Enable notifications', callback_data: 'subscription:on:1' }],
  ])

  await access.setSubscription('7', '1', true)
  await send(`/status ${name.trim()}`)
  assert.deepEqual(replies.at(-1).payload.reply_markup.inline_keyboard, [
    [{ text: '🔕 Disable notifications', callback_data: 'subscription:off:1' }],
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
  assert.equal(replies.at(-2).payload.text, '🔔 Notifications enabled.')
  assert.equal(replies.at(-1).method, 'editMessageReplyMarkup')
  assert.equal(access.recipients('1', store.readChats()).length, 1)

  const markup = replies.at(-1).payload.reply_markup

  assert.deepEqual(markup.inline_keyboard, [
    [{ text: '🔕 Disable notifications', callback_data: 'subscription:off:1' }],
  ])
  await click({ ...card, reply_markup: markup }, 'subscription:on:1')
  assert.equal(replies.at(-1).method, 'answerCallbackQuery')
  assert.equal(replies.at(-1).payload.text, '🔔 Notifications already enabled.')
  await click({ ...card, reply_markup: markup }, 'subscription:off:1')
  assert.equal(replies.at(-2).payload.text, '🔕 Notifications disabled.')
  assert.equal(access.recipients('1', store.readChats()).length, 0)

  const rotated = createChatAccess({ store, homes, secret: 'rotated' })

  await rotated.initialize()
  await click(card, 'subscription:on:1')
  assert.equal(replies.at(-1).method, 'answerCallbackQuery')
  assert.match(replies.at(-1).payload.text, /Authorize this chat/)
  assert.equal(rotated.recipients('1', store.readChats()).length, 0)
})

test('configured bot admins can read localized admin help in private', async t => {
  const { send, replies } = await notificationFixture(t, {
    chat: { id: 7, type: 'private', first_name: 'User' },
    admins: [7],
  })

  await send('/admin')
  assert.equal(replies.length, 1)
  assert.match(replies.at(-1).payload.text, /Bot administration<\/b>\n\n/)
  assert.match(replies.at(-1).payload.text, /\/authorize_group &lt;chat_id&gt;/)
  assert.match(replies.at(-1).payload.text, /\/help@power_test_bot/)
  assert.match(replies.at(-1).payload.text, /\/clear_chats &lt;chat_id&gt;/)
  assert.match(replies.at(-1).payload.text, /\/clear_chats all/)
  assert.match(replies.at(-1).payload.text, /authorize again and re-enable/)

  await send('/ru')
  await send('/admin')
  assert.match(replies.at(-1).payload.text, /Управление ботом<\/b>\n\n/)
  assert.match(replies.at(-1).payload.text, /\/help@power_test_bot/)
  assert.match(replies.at(-1).payload.text, /\/clear_chats all/)
})

test('admin help is restricted to configured admins in private chats', async t => {
  const ordinary = await notificationFixture(t, {
    chat: { id: 7, type: 'private', first_name: 'User' },
    admins: [8],
  })

  await ordinary.send('/admin')
  assert.equal(
    ordinary.replies.at(-1)?.payload.text,
    '<i>🔒 Admin access required.</i>',
  )

  const group = await notificationFixture(t, { admins: [7] })

  await group.send('/admin@power_test_bot')
  assert.equal(group.replies.length, 0)
})

test('only a configured admin in a private chat can clear registry records', async t => {
  const privateChat = { id: 7, type: 'private', first_name: 'User' }

  const ordinary = await notificationFixture(t, {
    chat: privateChat,
    admins: [8],
  })

  await ordinary.access.authorize('7', 'test-only', 'en')
  await ordinary.send('/clear_chats all')
  assert.equal(
    ordinary.replies.at(-1)?.payload.text,
    '<i>🔒 Admin access required.</i>',
  )
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
  assert.equal(replies.at(-1).payload.text, '<i>🔍 Chat record not found.</i>')
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
    ['<i>🔒 Authorize this chat with /secret &lt;value&gt; first.</i>'],
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
    [{ text: '🔔 Enable notifications', callback_data: 'subscription:on:1' }],
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
        getLocale: () => undefined,
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
  assert.equal(replies[0].payload.text, '<i>access_denied</i>')
  authorized = true
  await send('/status', 'supergroup')
  assert.equal(reads, 0)
  assert.equal(checks, 0)
  await send('/status@power_test_bot', 'supergroup')
  assert.equal(reads, 0)
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
        getLocale: () => undefined,
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
        getLocale: () => undefined,
        isAuthorized: () => authorized,
        captureGrant: () => (authorized ? {} : null),
        isGrantCurrent: () => authorized,
      },
      homeMonitor: {
        getStatuses: () => {
          reads++

          return homes
        },
        check: async (...args) => {
          assert.deepEqual(args, [])
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
  assert.equal(replies.at(-1)?.payload.text, '<i>access_denied</i>')
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
  assert.equal(replies.at(-1).payload.text, '<i>monitor_not_found</i>')
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
        getLocale: () => undefined,
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
  assert.equal(calls[0].payload.text, '<b>access_authorized</b>')
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
  assert.equal(replies[0].payload.text, '<b>✅ Chat authorized.</b>')
  assert.doesNotMatch(JSON.stringify(replies), /test-only/)
})

test('only a configured admin in a private chat can approve a group', async t => {
  const privateChat = { id: 7, type: 'private', first_name: 'User' }

  const ordinary = await notificationFixture(t, {
    chat: privateChat,
    admins: [8],
  })

  await ordinary.send('/authorize_group -1007')
  assert.equal(
    ordinary.replies.at(-1).payload.text,
    '<i>🔒 Admin access required.</i>',
  )
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
  assert.equal(replies.at(-1).payload.text, '<b>✅ Group authorized.</b>')
  assert.equal(access.isAuthorized('-1007'), true)

  await access.setSubscription('-1007', '1', true)
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
  assert.equal(
    replies.at(-1).payload.text,
    '<i>🚫 Protected access is disabled.</i>',
  )
  assert.equal(access.isAuthorized('-1007'), false)
})

test('language commands persist a chat preference and keep group replies in that language', async t => {
  const { access, store, chat, replies, send } = await notificationFixture(t)

  const english = {
    id: 7,
    is_bot: false,
    first_name: 'User',
    language_code: 'en',
  }
  const russian = {
    id: 8,
    is_bot: false,
    first_name: 'User',
    language_code: 'ru',
  }

  await send('/ru@power_test_bot', undefined, english)
  assert.equal(replies.length, 1)
  assert.equal(replies[0].payload.text, '<b>🌐 Язык чата: русский.</b>')
  assert.equal(store.readChats().chats[String(chat.id)].locale, 'ru')
  assert.equal(access.isAuthorized(String(chat.id)), false)

  await access.authorizeGroup(String(chat.id), 'en')
  await send('/status@power_test_bot', undefined, english)
  assert.match(replies.at(-1).payload.text, /Family Home/)
  assert.match(replies.at(-1).payload.text, /неизвестно/i)
  await send('/on_notification@power_test_bot Family Home', undefined, english)
  assert.equal(access.isSubscribed(String(chat.id), '1'), true)
  assert.equal(store.readChats().chats[String(chat.id)].locale, 'ru')

  await send('/off_notification@power_test_bot', undefined, english)

  const russianPrompt = replies.at(-1).message

  await send('/en@power_test_bot', undefined, russian)
  assert.equal(replies.length, 5)
  assert.equal(replies.at(-1).payload.text, '<b>🌐 Chat language: English.</b>')
  await send('/status@power_test_bot', undefined, russian)
  assert.match(replies.at(-1).payload.text, /unknown/i)
  assert.equal(access.isSubscribed(String(chat.id), '1'), true)
  await send('Family Home', russianPrompt, russian)
  assert.equal(replies.at(-1).payload.text, '<b>🔕 Notifications disabled.</b>')
  assert.equal(access.isSubscribed(String(chat.id), '1'), false)
})

test('queue-full notices use the receiving chat preference', async t => {
  const release = Promise.withResolvers()

  const { access, chat, replies, send } = await notificationFixture(t, {
    limitPending: true,
    hold: async (method, payload) => {
      if (method === 'sendMessage' && payload.text.includes('/secret')) {
        await release.promise
      }
    },
  })

  const english = {
    id: 7,
    is_bot: false,
    first_name: 'User',
    language_code: 'en',
  }

  await access.setLocale(chat.id, 'ru')

  const pending = Array.from({ length: 3 }, () =>
    send('/help@power_test_bot', undefined, english),
  )

  try {
    await send('/help@power_test_bot', undefined, english)
    assert.equal(replies.length, 1)
    assert.match(replies[0].payload.text, /\p{Script=Cyrillic}/u)
    assert.doesNotMatch(replies[0].payload.text, /\/secret/)
  } finally {
    release.resolve()

    await Promise.all(pending)
  }
})

test('group notification interval requires an addressed command and authorization', async t => {
  const { access, replies, send } = await notificationFixture(t)

  await send('/notification_interval@power_test_bot 30 Family Home')
  assert.match(replies.at(-1).payload.text, /not authorized/)

  await access.authorize('-1007', 'test-only', 'en')
  replies.length = 0

  await send('/notification_interval 30 Family Home')
  assert.equal(replies.length, 0)

  await send('/notification_interval@power_test_bot 30 Family Home')
  assert.match(replies.at(-1).payload.text, /30/)
  assert.equal(access.getIntervalMinutes('-1007', '1'), 30)
})

test('private notification interval sets, resets and disables recurring updates', async t => {
  const { access, replies, send } = await notificationFixture(t, {
    chat: { id: 7, type: 'private', first_name: 'User' },
  })

  await access.authorize('7', 'test-only', 'en')

  await send('/notification_interval 30')
  assert.match(replies.at(-1).payload.text, /30/)
  assert.equal(access.getIntervalMinutes('7', '1'), 30)

  await send('/notification_interval default')
  assert.match(replies.at(-1).payload.text, /default/i)

  await send('/notification_interval 0')
  assert.match(replies.at(-1).payload.text, /off/i)
  assert.equal(access.getIntervalMinutes('7', '1'), 0)

  await send('/notification_interval 45 family home')
  assert.equal(access.getIntervalMinutes('7', '1'), 45)
})

test('resetting the interval when the home default is off says updates are off', async t => {
  const { access, replies, send } = await notificationFixture(t, {
    chat: { id: 7, type: 'private', first_name: 'User' },
  })

  await access.authorize('7', 'test-only', 'en')
  await send('/notification_interval 30')

  await send('/notification_interval default')
  assert.equal(access.getIntervalMinutes('7', '1'), 0)
  assert.match(replies.at(-1).payload.text, /off/i)
  assert.match(replies.at(-1).payload.text, /default/i)
  assert.doesNotMatch(replies.at(-1).payload.text, /every 0/)
})

test('resetting the interval reports a non-zero home default', async t => {
  const { access, replies, send } = await notificationFixture(t, {
    chat: { id: 7, type: 'private', first_name: 'User' },
    notificationIntervalMinutes: 60,
  })

  await access.authorize('7', 'test-only', 'en')
  await send('/notification_interval 30')
  assert.equal(access.getIntervalMinutes('7', '1'), 30)

  await send('/notification_interval default')
  assert.equal(access.getIntervalMinutes('7', '1'), 60)
  assert.match(replies.at(-1).payload.text, /every \D*60\D* min/)
  assert.match(replies.at(-1).payload.text, /default/i)
})

test('notification interval rejects invalid input and unknown homes', async t => {
  const { access, replies, send } = await notificationFixture(t, {
    chat: { id: 7, type: 'private', first_name: 'User' },
  })

  await access.authorize('7', 'test-only', 'en')

  for (const text of [
    '/notification_interval 4',
    '/notification_interval 10081',
    '/notification_interval abc',
    '/notification_interval',
  ]) {
    await send(text)
    assert.match(replies.at(-1).payload.text, /5/)
    assert.match(replies.at(-1).payload.text, /10080/)
  }

  assert.equal(replies.at(-1).payload.reply_markup, undefined)

  await send('/notification_interval 30 Missing')
  assert.equal(replies.at(-1).payload.text, '<i>🔍 Home not found.</i>')
})

//
//

const plain = text => text.replace(/\p{Cf}/gu, '')

const callbackData = markup =>
  markup.inline_keyboard.flat().map(button => button.callback_data)

const groupCalls = replies =>
  replies.filter(({ payload }) => String(payload?.chat_id) === '-1007')

const adminFixture = async (t, options = {}) => {
  const fixture = await notificationFixture(t, {
    chat: { id: 7, type: 'private', first_name: 'User' },
    admins: [7],
    ...options,
  })

  await fixture.access.authorizeGroup('-1007')

  return fixture
}

const groupCard = async ({ replies, send }) => {
  replies.length = 0
  await send('/groups')

  return replies.find(({ method }) => method === 'sendMessage').message
}

test('admins list approved groups privately with controls', async t => {
  const { access, replies, send } = await notificationFixture(t, {
    chat: { id: 7, type: 'private', first_name: 'User' },
    admins: [7],
    notificationIntervalMinutes: 60,
  })

  await send('/groups')
  assert.match(replies.at(-1).payload.text, /No connected groups/)

  await access.authorizeGroup('-1007')
  await access.authorize('8', 'test-only', 'en')
  await access.setInterval('-1007', '1', 30)
  replies.length = 0

  await send('/groups')

  const sent = replies.filter(({ method }) => method === 'sendMessage')

  assert.equal(sent.length, 1)
  assert.equal(sent[0].payload.chat_id, 7)
  assert.equal(sent[0].payload.parse_mode, 'HTML')
  assert.match(plain(sent[0].payload.text), /^<b>👥 Family \(-1007\)<\/b>/)

  const text = plain(sent[0].payload.text)

  assert.match(text, /Family \(-1007\)/)
  assert.match(text, /Family Home/)
  assert.match(text, /notifications off/)
  assert.match(text, /every 30 min/)
  assert.doesNotMatch(text, /\b8\b/)
  assert.deepEqual(callbackData(sent[0].payload.reply_markup), [
    'grp:on:-1007:1',
    'grp:del:-1007',
  ])

  await access.setInterval('-1007', '1', 0)
  await send('/groups')
  assert.match(replies.at(-1).payload.text, /no recurring updates/)
})

test('a group card shows the ID when the title is unavailable', async t => {
  const { replies, send } = await adminFixture(t, {
    unavailableChats: ['-1007'],
  })

  await send('/groups')
  assert.match(plain(replies.at(-1).payload.text), /-1007.*unavailable/)
  assert.deepEqual(callbackData(replies.at(-1).payload.reply_markup), [
    'grp:on:-1007:1',
    'grp:del:-1007',
  ])
})

test('group toggle buttons change notifications silently', async t => {
  const fixture = await adminFixture(t, {
    name: 'Home <West>',
    groupTitle: 'Family & <Friends>',
  })

  const { access, replies, click } = fixture

  const card = await groupCard(fixture)

  replies.length = 0
  await click(card, 'grp:on:-1007:1')
  assert.equal(access.listGroups()[0].homes[0].subscribed, true)
  assert.equal(replies[0].method, 'answerCallbackQuery')
  assert.equal(replies[0].payload.text, '🔔 Notifications enabled.')

  const edit = replies.find(({ method }) => method === 'editMessageText')

  assert.equal(edit.payload.chat_id, 7)
  assert.equal(edit.payload.parse_mode, 'HTML')
  assert.match(
    plain(edit.payload.text),
    /<b>👥 Family &amp; &lt;Friends&gt; \(-1007\)<\/b>/,
  )
  assert.match(edit.payload.text, /Home &lt;West&gt;/)
  assert.match(plain(edit.payload.text), /notifications on/)
  assert.match(
    edit.payload.reply_markup.inline_keyboard[0][0].text,
    /Home <West>/,
  )
  assert.deepEqual(callbackData(edit.payload.reply_markup), [
    'grp:off:-1007:1',
    'grp:del:-1007',
  ])

  await click(edit.message, 'grp:off:-1007:1')
  assert.equal(access.listGroups()[0].homes[0].subscribed, false)
  assert.deepEqual(groupCalls(replies), [])
})

test('deleting a group asks for confirmation and keeps the bot silent', async t => {
  const fixture = await adminFixture(t)

  const { access, replies, click } = fixture

  const card = await groupCard(fixture)

  replies.length = 0
  await click(card, 'grp:del:-1007')

  const confirm = replies.find(({ method }) => method === 'editMessageText')

  assert.match(plain(confirm.payload.text), /Delete/)
  assert.match(plain(confirm.payload.text), /Family \(-1007\)/)
  assert.deepEqual(callbackData(confirm.payload.reply_markup), [
    'grp:delok:-1007',
    'grp:cancel:-1007',
  ])
  assert.equal(access.isAuthorized('-1007'), true)

  await click(confirm.message, 'grp:cancel:-1007')

  const restored = replies.at(-1)

  assert.equal(restored.method, 'editMessageText')
  assert.equal(restored.message.text, card.text)
  assert.deepEqual(restored.payload.reply_markup, card.reply_markup)

  await click(restored.message, 'grp:del:-1007')
  await click(replies.at(-1).message, 'grp:delok:-1007')
  assert.equal(access.isAuthorized('-1007'), false)

  const deleted = replies.at(-1)

  assert.equal(deleted.method, 'editMessageText')
  assert.match(plain(deleted.payload.text), /deleted/)
  assert.equal(deleted.payload.reply_markup, undefined)
  assert.deepEqual(groupCalls(replies), [])
})

test('group delete survives a failing card edit and still answers the callback', async t => {
  let failEdit = false

  const fixture = await adminFixture(t, {
    hold: method => {
      if (failEdit && method === 'editMessageText') {
        throw new Error('Bad Request: message is not modified')
      }
    },
  })

  const { access, replies, click } = fixture

  const card = await groupCard(fixture)

  failEdit = true
  replies.length = 0

  await click(card, 'grp:del:-1007')
  await click(card, 'grp:cancel:-1007')
  await click(card, 'grp:delok:-1007')

  assert.equal(access.isAuthorized('-1007'), false)
  assert.deepEqual(
    replies.map(({ method }) => method),
    ['answerCallbackQuery', 'answerCallbackQuery', 'answerCallbackQuery'],
  )
})

test('group delete answers the callback before rethrowing a storage failure', async t => {
  const fixture = await adminFixture(t)

  const { access, replies, click } = fixture

  const card = await groupCard(fixture)

  access.clearChats = async () => {
    throw new Error('disk full')
  }

  replies.length = 0

  await assert.rejects(click(card, 'grp:delok:-1007'), /disk full/)
  assert.deepEqual(
    replies.map(({ method }) => method),
    ['answerCallbackQuery'],
  )
})

test('stale group cards answer not found without writing', async t => {
  const fixture = await adminFixture(t)

  const { access, store, replies, click } = fixture

  const card = await groupCard(fixture)

  await access.clearChats('-1007')

  const registry = JSON.stringify(store.readChats())

  for (const data of [
    'grp:on:-1007:1',
    'grp:del:-1007',
    'grp:delok:-1007',
    'grp:cancel:-1007',
  ]) {
    replies.length = 0
    await click(card, data)
    assert.equal(replies.length, 1)
    assert.equal(replies[0].method, 'answerCallbackQuery')
    assert.match(replies[0].payload.text, /Group not found/)
  }

  assert.equal(JSON.stringify(store.readChats()), registry)
})

test('group callbacks are refused outside an admin private chat', async t => {
  const fixture = await adminFixture(t)

  const { access, replies, click } = fixture

  const card = await groupCard(fixture)

  for (const [message, sender] of [
    [card, { id: 8, is_bot: false, first_name: 'Other' }],
    [{ ...card, chat: { id: -1007, type: 'supergroup', title: 'Family' } }],
    [{ ...card, chat: { id: 9, type: 'private', first_name: 'Other' } }],
    [{ ...card, date: 0 }],
  ]) {
    replies.length = 0
    await click(message, 'grp:on:-1007:1', sender)
    await click(message, 'grp:delok:-1007', sender)
    assert.deepEqual(
      replies.map(({ method }) => method),
      ['answerCallbackQuery', 'answerCallbackQuery'],
    )
    assert.equal(access.isAuthorized('-1007'), true)
    assert.equal(access.listGroups()[0].homes[0].subscribed, false)
  }

  replies.length = 0
  await click(
    { ...card, chat: { id: 8, type: 'private', first_name: 'Other' } },
    'grp:on:-1007:1',
    { id: 8, is_bot: false, first_name: 'Other' },
  )
  assert.equal(replies.length, 1)
  assert.equal(replies[0].payload.text, '🔒 Admin access required.')
  assert.equal(access.listGroups()[0].homes[0].subscribed, false)
})

test('typed group commands change notifications and intervals silently', async t => {
  const { access, replies, send } = await adminFixture(t)

  replies.length = 0

  await send('/group_on -1007')
  assert.match(plain(replies.at(-1).payload.text), /Family Home/)
  assert.match(replies.at(-1).payload.text, /Notifications enabled/)
  assert.equal(access.listGroups()[0].homes[0].subscribed, true)

  await send('/group_off -1007 family home')
  assert.match(replies.at(-1).payload.text, /Notifications disabled/)
  assert.equal(access.listGroups()[0].homes[0].subscribed, false)

  await send('/group_off -1007 Missing')
  assert.equal(replies.at(-1).payload.text, '<i>🔍 Home not found.</i>')

  await send('/group_interval -1007 30')
  assert.equal(access.getIntervalMinutes('-1007', '1'), 30)
  assert.match(replies.at(-1).payload.text, /every \D*30\D* min/)

  await send('/group_interval -1007 default Family Home')
  assert.equal(access.getIntervalMinutes('-1007', '1'), 0)
  assert.match(replies.at(-1).payload.text, /default/)

  await send('/group_interval -1007 30 Missing')
  assert.equal(replies.at(-1).payload.text, '<i>🔍 Home not found.</i>')

  for (const text of ['/group_on', '/group_on 1007', '/group_off abc']) {
    await send(text)
    assert.match(replies.at(-1).payload.text, /Use \/group_on/)
  }

  for (const text of [
    '/group_interval',
    '/group_interval 1007 30',
    '/group_interval -1007',
    '/group_interval -1007 4',
  ]) {
    await send(text)
    assert.match(replies.at(-1).payload.text, /Use \/group_interval/)
  }

  for (const text of ['/group_on -1008', '/group_interval -1008 30']) {
    await send(text)
    assert.match(replies.at(-1).payload.text, /Group not found/)
  }

  assert.ok(replies.every(({ payload }) => payload.chat_id === 7))
  assert.deepEqual(groupCalls(replies), [])
})

test('group admin commands are restricted to admins in private chats', async t => {
  const ordinary = await adminFixture(t, { admins: [8] })

  for (const text of [
    '/groups',
    '/group_on -1007',
    '/group_interval -1007 30',
  ]) {
    await ordinary.send(text)
    assert.equal(
      ordinary.replies.at(-1).payload.text,
      '<i>🔒 Admin access required.</i>',
    )
  }

  assert.equal(ordinary.access.listGroups()[0].homes[0].subscribed, false)
  assert.equal(ordinary.access.getIntervalMinutes('-1007', '1'), 0)

  const group = await adminFixture(t, {
    chat: { id: -1007, type: 'supergroup', title: 'Family' },
  })

  await group.send('/groups@power_test_bot')
  await group.send('/group_on@power_test_bot -1007')
  assert.deepEqual(group.replies, [])
  assert.equal(group.access.listGroups()[0].homes[0].subscribed, false)

  const admin = await adminFixture(t)

  await admin.send('/admin')
  assert.match(admin.replies.at(-1).payload.text, /\/groups/)
  assert.match(admin.replies.at(-1).payload.text, /\/group_on &lt;chat_id&gt;/)
  assert.match(
    admin.replies.at(-1).payload.text,
    /\/group_interval &lt;chat_id&gt;/,
  )
  await admin.send('/ru')
  await admin.send('/admin')
  assert.match(admin.replies.at(-1).payload.text, /\/group_off &lt;chat_id&gt;/)
})
