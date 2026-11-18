import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import test from 'node:test'

import { logger as Logger, Request } from '../../src/services/index.js'

const serve = async (t, handler) => {
  const server = http.createServer(handler).listen(0, '127.0.0.1')

  t.after(
    () =>
      new Promise(resolve => {
        server.close(resolve)
      }),
  )

  await once(server, 'listening')

  return new Request(`http://127.0.0.1:${server.address().port}`)
}

test('retained request transport encodes query values and reads JSON', async t => {
  let receivedUrl
  const client = await serve(t, (req, res) => {
    receivedUrl = req.url
    res.setHeader('content-type', 'application/json')
    res.end('{"online":true}')
  })

  const response = await client.get('device', { name: 'Camera & router' })

  assert.equal(receivedUrl, '/device?name=Camera%20%26%20router')
  assert.equal(response.status, 200)
  assert.deepEqual(response.content, { online: true })
})

test('form transport encodes special characters without logging values', async t => {
  let received
  const logs = []

  t.mock.method(console, 'log', (...values) => logs.push(values))

  const client = await serve(t, (req, res) => {
    let body = ''

    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', () => {
      received = new URLSearchParams(body)
      res.setHeader('content-type', 'application/json')
      res.end('{"accessToken":"response-token-sentinel"}')
    })
  })
  const response = await client.postXwwwForm('/token', {
    appKey: 'key +&=sentinel',
    appSecret: 'secret +&=sentinel',
  })

  assert.equal(received.get('appKey'), 'key +&=sentinel')
  assert.equal(received.get('appSecret'), 'secret +&=sentinel')
  assert.equal(response.content.accessToken, 'response-token-sentinel')
  assert.doesNotMatch(JSON.stringify(logs), /sentinel/)
})

test('retained request transport retries transient failures within its limit', async t => {
  let calls = 0
  const client = await serve(t, (_req, res) => {
    calls += 1
    res.statusCode = calls === 1 ? 503 : 200
    res.end('ready')
  })

  client.tries = 2
  client.errorTimeout = 0

  const response = await client.get('device')

  assert.equal(response.content, 'ready')
  assert.equal(calls, 2)
})

test('retained request transport does not retry rejected credentials', async t => {
  let calls = 0
  const client = await serve(t, (_req, res) => {
    calls += 1
    res.statusCode = 401
    res.end('unauthorized')
  })

  const response = await client.get('device')

  assert.equal(response.error.status, 401)
  assert.equal(calls, 1)
})

test('request debug logs never include provider response bodies', async t => {
  const logs = []

  t.mock.method(Logger, 'debug', (...values) => logs.push(values))

  const client = await serve(t, (_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(
      '{"accessToken":"private-response-sentinel","message":"private-response-sentinel"}',
    )
  })

  await client.get('device')
  assert.doesNotMatch(JSON.stringify(logs), /private-response-sentinel/)
})
