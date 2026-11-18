import assert from 'node:assert/strict'
import test from 'node:test'

import { I18n } from '@grammyjs/i18n'
import { Bot } from 'grammy'

import routes from '../../src/api/bot/index.js'
import config from '../../src/config/index.js'
import { updatesHandler } from '../../src/middlewares/bot/index.js'

const group = { id: -1007, type: 'supergroup', title: 'Home' }

const user = { id: 7, is_bot: false, first_name: 'User', language_code: 'en' }

const botInfo = {
  id: 1,
  is_bot: true,
  first_name: 'Power',
  username: 'power_test_bot',
}

const handleUpdate = async update => {
  const bot = new Bot('1:test')
  const replies = []

  bot.botInfo = botInfo
  bot.api.config.use(async (_previous, method, payload) => {
    replies.push({ method, payload })

    return { ok: true, result: true }
  })
  bot.use(updatesHandler)
  bot.use(new I18n(config.botSettings.i18nSettings))
  bot.use(routes({}))

  await bot.handleUpdate({ update_id: 1, ...update })

  return replies
}

const handleMessage = (
  text,
  entities = [],
  languageCode = 'en',
  chat = group,
) =>
  handleUpdate({
    message: {
      message_id: 1,
      date: 0,
      from: { ...user, language_code: languageCode },
      chat,
      text,
      entities,
    },
  })

const handleMembership = (before, after, chat = group) =>
  handleUpdate({
    my_chat_member: {
      chat,
      from: user,
      date: 0,
      old_chat_member: { user: botInfo, status: before },
      new_chat_member: { user: botInfo, status: after },
    },
  })

test('addressed group help and start explain setup before authorization', async () => {
  for (const command of ['/help@power_test_bot', '/start@power_test_bot']) {
    const replies = await handleMessage(command, [
      { type: 'bot_command', offset: 0, length: command.length },
    ])

    assert.equal(replies.length, 1)
    assert.equal(replies[0].method, 'sendMessage')
    assert.equal(replies[0].payload.chat_id, -1007)
    assert.match(replies[0].payload.text, /Home Power Status Monitor/)
    assert.match(replies[0].payload.text, /\n\/authorize_group -1007\n\n/)
    assert.match(replies[0].payload.text, /\/status@power_test_bot/)
    assert.match(
      replies[0].payload.text,
      /\n\/status \[home name\].*\n\/status_full/,
    )
  }
})

test('Russian group members receive readable Russian help', async () => {
  const replies = await handleMessage(
    '/help@power_test_bot',
    [{ type: 'bot_command', offset: 0, length: 20 }],
    'ru',
  )

  assert.equal(replies.length, 1)
  assert.match(replies[0].payload.text, /администратор бота/)
  assert.match(replies[0].payload.text, /\n\n/)
  assert.match(replies[0].payload.text, /\/authorize_group -1007/)
  assert.match(replies[0].payload.text, /\/status@power_test_bot/)
})

test('private help explains private and group authorization', async () => {
  const replies = await handleMessage(
    '/help',
    [{ type: 'bot_command', offset: 0, length: 5 }],
    'en',
    { id: user.id, type: 'private', first_name: user.first_name },
  )

  assert.equal(replies.length, 1)
  assert.match(replies[0].payload.text, /\/secret <value>/)
  assert.match(replies[0].payload.text, /\/authorize_group <chat_id>/)
  assert.match(replies[0].payload.text, /\/help@power_test_bot/)
  assert.match(replies[0].payload.text, /\n\n/)
})

test('joining a group sends setup instructions before anyone runs a command', async () => {
  for (const [chat, before, after] of [
    [group, 'left', 'member'],
    [{ ...group, id: -42, type: 'group' }, 'kicked', 'administrator'],
  ]) {
    const replies = await handleMembership(before, after, chat)

    assert.equal(replies.length, 1)
    assert.equal(replies[0].method, 'sendMessage')
    assert.equal(replies[0].payload.chat_id, chat.id)
    assert.ok(replies[0].payload.text.includes(`/authorize_group ${chat.id}`))
    assert.match(replies[0].payload.text, /\/help@power_test_bot/)
  }
})

test('promotions, removals and private unblocks do not send setup instructions', async () => {
  assert.deepEqual(await handleMembership('member', 'administrator'), [])
  assert.deepEqual(await handleMembership('member', 'left'), [])
  assert.deepEqual(
    await handleMembership('kicked', 'member', {
      id: user.id,
      type: 'private',
    }),
    [],
  )
})

test('unrelated group conversations and commands for another bot are ignored', async () => {
  assert.deepEqual(await handleMessage('Dinner is ready'), [])
  assert.deepEqual(
    await handleMessage('/help@other_bot', [
      { type: 'bot_command', offset: 0, length: 15 },
    ]),
    [],
  )
})
