import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { GrammyError, HttpError } from 'grammy'

const sourceDirectory = fileURLToPath(new URL('../../src/', import.meta.url))

process.chdir(sourceDirectory)

process.env.DEFAULT_LOCALE = 'en'

const { default: errorHandler } =
  await import('../../src/middlewares/bot/errorHandler.js')

const errorCases = [
  {
    error: new GrammyError(
      'API call failed',
      {
        error_code: 400,
        description: 'Bad Request',
      },
      'sendMessage',
      {},
    ),
    description: 'While handling update',
  },
  {
    error: new HttpError('Network request failed', new Error('ECONNRESET')),
    description: 'Could not contact Telegram',
  },
  {
    error: new Error('Handler failed'),
    description: 'Unknown',
  },
]

for (const { error, description } of errorCases) {
  test(`bot error handler logs ${description.toLowerCase()} errors`, async () => {
    let catchHandler
    let reply
    let logged
    const chat = {
      id: 7,
      type: 'private',
      first_name: 'User',
    }
    const ctx = {
      chat,
      log: {
        error(message, ...extra) {
          logged = { extra, message }
        },
      },
      msg: {
        message_id: 42,
      },
      async reply(message) {
        reply = message
      },
    }
    const bot = {
      catch(handler) {
        catchHandler = handler
      },
    }

    errorHandler(bot)

    await catchHandler({ ctx, error })

    assert.equal(logged.message, `Bot Error - ${description}`)
    assert.equal(logged.extra[0], error)
    assert.deepEqual(logged.extra[1], {
      updateId: undefined,
      messageId: 42,
      chatId: 7,
      chatType: 'private',
      fromId: undefined,
    })
    assert.equal(reply, 'Unknown error occurred! Please try again later')
  })
}
