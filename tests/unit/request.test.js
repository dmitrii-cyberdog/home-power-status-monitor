import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import test from 'node:test'
import { format } from 'node:util'

import config from '../../src/config/index.js'
import { Request } from '../../src/services/index.js'

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

test('only local debug logs include response data with sensitive fields redacted', async t => {
  const original = { envName: config.envName, isDebug: config.isDebug }

  t.after(() => Object.assign(config, original))

  config.isDebug = true

  const logs = []

  t.mock.method(console, 'log', (...values) => logs.push(values))

  const client = await serve(t, (_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(
      '{"data":{"accessToken":"private-response-sentinel","deviceName":"visible-camera"}}',
    )
  })

  for (const mode of ['local', 'dev', 'prod', 'test']) {
    config.envName = mode
    logs.length = 0

    const result = await client.get('device')

    assert.equal(result.content.data.accessToken, 'private-response-sentinel')

    const output = logs.map(args => format(...args)).join('\n')

    assert.doesNotMatch(output, /private-response-sentinel/)

    if (mode === 'local') {
      assert.match(output, /visible-camera/)
      assert.match(output, /REDACTED/)
    } else {
      assert.doesNotMatch(output, /visible-camera/)
    }
  }
})
