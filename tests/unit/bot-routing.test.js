import assert from 'node:assert/strict'
import test from 'node:test'

import { I18n } from '@grammyjs/i18n'
import { Bot } from 'grammy'

import routes from '../../src/api/bot/index.js'
import config from '../../src/config/config.js'
import updatesHandler from '../../src/middlewares/bot/updatesHandler.js'

const handleMessage = async (text, entities = [], languageCode = 'en') => {
  const bot = new Bot('1:test')
  const replies = []

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
  bot.use(updatesHandler)
  bot.use(new I18n(config.botSettings.i18nSettings))
  bot.use(routes({}))

  await bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      from: {
        id: 7,
        is_bot: false,
        first_name: 'User',
        language_code: languageCode,
      },
      chat: { id: -1007, type: 'supergroup', title: 'Home' },
      text,
      entities,
    },
  })

  return replies
}

test('group help addressed to this bot reaches its handlers without an account', async () => {
  const replies = await handleMessage('/help@power_test_bot', [
    { type: 'bot_command', offset: 0, length: 20 },
  ])

  assert.equal(replies.length, 1)
  assert.equal(replies[0].method, 'sendMessage')
  assert.equal(replies[0].payload.chat_id, -1007)
  assert.match(replies[0].payload.text, /Home Power Status Monitor/)
})

test('Russian group members receive readable Russian help', async () => {
  const replies = await handleMessage(
    '/help@power_test_bot',
    [{ type: 'bot_command', offset: 0, length: 20 }],
    'ru',
  )

  assert.equal(replies.length, 1)
  assert.match(replies[0].payload.text, /Проверка устройств/)
  assert.match(replies[0].payload.text, /secret/)
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
