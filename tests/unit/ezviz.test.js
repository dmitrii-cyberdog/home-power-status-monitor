import assert from 'node:assert/strict'
import test from 'node:test'

import { createEzvizClient } from '../../src/services/index.js'

test('EZVIZ caches tokens, matches exact names and refuses partial lists', async () => {
  const calls = []
  let malformed = false
  const client = createEzvizClient(
    {
      appKey: 'fake',
      appSecret: 'fake',
      baseUrl: 'https://ieuopen.ezvizlife.com',
    },
    {
      now: () => 0,
      requestFactory: origin => ({
        postXwwwForm: async (path, fields) => {
          calls.push({ origin, path, fields })

          return {
            status: 200,
            content: path.endsWith('get')
              ? {
                  code: '200',
                  data: {
                    accessToken: 'token',
                    expireTime: 1000000,
                    areaDomain: 'https://ieuopen.ezvizlife.com',
                  },
                }
              : {
                  code: '200',
                  page: { page: 0, size: 50, total: malformed ? 2 : 1 },
                  data: [
                    { deviceName: 'Camera', deviceSerial: 'serial', status: 0 },
                  ],
                },
          }
        },
      }),
    },
  )

  assert.equal(
    (await client.observeDevices([{ name: 'Camera' }]))[0].status,
    'offline',
  )
  assert.equal(
    (await client.observeDevices([{ name: 'camera' }]))[0].errorCode,
    'device_not_found',
  )
  assert.equal(calls.filter(call => call.path.endsWith('get')).length, 1)
  malformed = true
  assert.equal(
    (await client.observeDevices([{ name: 'Camera' }]))[0].status,
    'unknown',
  )
})

test('expired token retries the complete round exactly once', async () => {
  let tokens = 0
  let lists = 0
  const client = createEzvizClient(
    { baseUrl: 'https://ieuopen.ezvizlife.com' },
    {
      now: () => 0,
      requestFactory: () => ({
        postXwwwForm: async path => {
          if (path.endsWith('get')) {
            tokens++

            return {
              status: 200,
              content: {
                code: '200',
                data: {
                  accessToken: `t${tokens}`,
                  expireTime: 1000000,
                  areaDomain: 'https://ieuopen.ezvizlife.com',
                },
              },
            }
          }

          lists++

          return {
            status: 200,
            content:
              lists === 1
                ? { code: '10002' }
                : {
                    code: '200',
                    page: { page: 0, size: 50, total: 1 },
                    data: [
                      { deviceName: 'Camera', deviceSerial: 'a', status: 1 },
                    ],
                  },
          }
        },
      }),
    },
  )

  assert.equal(
    (await client.observeDevices([{ name: 'Camera' }]))[0].status,
    'online',
  )
  assert.equal(tokens, 2)
  assert.equal(lists, 2)
})

test('complete pagination, serial disambiguation and per-device invalid statuses', async () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({
    deviceName: index >= 49 ? 'Selected' : `Other ${index}`,
    deviceSerial: `serial-${index}`,
    status: index === 50 ? 0 : 1,
  }))
  const pages = []
  const client = createEzvizClient(
    { baseUrl: 'https://ieuopen.ezvizlife.com' },
    {
      now: () => 0,
      requestFactory: () => ({
        postXwwwForm: async (path, fields) => {
          if (path.endsWith('get')) {
            return {
              status: 200,
              content: {
                code: '200',
                data: {
                  accessToken: 'token',
                  expireTime: 100000,
                  areaDomain: 'https://ieuopen.ezvizlife.com',
                },
              },
            }
          }

          pages.push(fields.pageStart)

          return {
            status: 200,
            content: {
              code: '200',
              page: { page: fields.pageStart, size: 50, total: rows.length },
              data: rows.slice(
                fields.pageStart * 50,
                fields.pageStart * 50 + 50,
              ),
            },
          }
        },
      }),
    },
  )
  const observations = await client.observeDevices([
    { name: 'Selected', serial: 'serial-50' },
    { name: 'Selected' },
    { name: 'Renamed', serial: 'serial-50' },
    { name: 'Selected', serial: 'absent' },
  ])

  assert.deepEqual(pages, [0, 1])
  assert.deepEqual(
    observations.map(item => item.status),
    ['offline', 'unknown', 'unknown', 'unknown'],
  )
  assert.deepEqual(
    observations.slice(1).map(item => item.errorCode),
    ['ambiguous_device', 'device_not_found', 'serial_mismatch'],
  )
  rows[50].status = '0'
  assert.equal(
    (
      await client.observeDevices([{ name: 'Selected', serial: 'serial-50' }])
    )[0].errorCode,
    'invalid_device_status',
  )
})

test('provider failures use fixed diagnostics and never expose raw secrets', async () => {
  for (const [content, expected] of [
    [{ code: '10007', msg: 'secret-sentinel' }, 'rate_limited'],
    [{ code: '10029' }, 'rate_limited'],
    [{ code: '10001' }, 'auth_failed'],
    [{ code: 'other' }, 'provider_error'],
    [{ code: 200 }, 'invalid_response'],
    [
      {
        code: '200',
        data: {
          accessToken: 'secret-sentinel',
          expireTime: 1,
          areaDomain: 'https://evil.example',
        },
      },
      'invalid_response',
    ],
  ]) {
    const client = createEzvizClient(
      {},
      {
        now: () => 0,
        requestFactory: () => ({
          postXwwwForm: async () => ({ status: 200, content }),
        }),
      },
    )
    const result = await client.observeDevices([{ name: 'Camera' }])

    assert.equal(result[0].errorCode, expected)
    assert.doesNotMatch(JSON.stringify(result), /secret-sentinel/)
  }
})
