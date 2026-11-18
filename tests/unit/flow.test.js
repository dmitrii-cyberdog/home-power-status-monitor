import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const sourceDirectory = fileURLToPath(new URL('../../src/', import.meta.url))

process.chdir(sourceDirectory)

const { clearFlow, getFlow, hasFlow, startFlow, touchFlow } =
  await import('../../src/utils/index.js')

const createContext = (flow = null) => ({ session: { flow } })

const EXPIRED = Date.now() - 20 * 60 * 1000

test('starting a flow ends whatever the user was in the middle of', () => {
  const ctx = createContext({
    name: 'timeOffset',
    step: 'manual',
    updatedAt: Date.now(),
  })

  const flow = startFlow(ctx, 'admin', { step: 'message' })

  //
  // one slot, so this is the whole "leave the previous flow" step that every entry
  // point used to write out by hand

  assert.equal(ctx.session.flow, flow)
  assert.deepEqual(
    { ...flow, updatedAt: typeof flow.updatedAt },
    { name: 'admin', step: 'message', updatedAt: 'number' },
  )
  assert.equal(getFlow(ctx, 'timeOffset'), null)
})

test('a module only ever sees its own flow', () => {
  const ctx = createContext({
    name: 'admin',
    step: 'message',
    updatedAt: Date.now(),
  })

  assert.equal(getFlow(ctx, 'admin')?.name, 'admin')

  //
  // ...and asking for somebody else's must not END it: a fall-through handler of
  // one module runs on every update, including those belonging to another flow

  assert.equal(getFlow(ctx, 'payment'), null)
  assert.equal(ctx.session.flow?.name, 'admin')

  assert.equal(getFlow(createContext(), 'payment'), null)
})

test('an expired flow is cleared by its owner, and stays visible until then', () => {
  const ctx = createContext({
    name: 'payment',
    step: 'email',
    updatedAt: EXPIRED,
  })

  //
  // `hasFlow` reads the raw slot, which is how a module tells "expired" from "never
  // started" - the first needs a message, the second has to fall through

  assert.equal(hasFlow(ctx, 'payment'), true)
  assert.equal(getFlow(ctx, 'payment'), null)
  assert.equal(ctx.session.flow, null)

  // a flow with no timestamp at all cannot be trusted either
  const untimed = createContext({ name: 'payment' })

  assert.equal(getFlow(untimed, 'payment'), null)
  assert.equal(untimed.session.flow, null)
})

test('touching a flow keeps an answered conversation alive', () => {
  const flow = { name: 'admin', step: 'message', updatedAt: EXPIRED }
  const ctx = createContext(flow)

  touchFlow(flow)

  assert.equal(getFlow(ctx, 'admin'), flow)
})

test('clearing is scoped by name unless the whole slot is meant', () => {
  const ctx = createContext({
    name: 'admin',
    step: 'message',
    updatedAt: Date.now(),
  })

  clearFlow(ctx, 'payment')

  assert.equal(ctx.session.flow?.name, 'admin')

  clearFlow(ctx, 'admin')

  assert.equal(ctx.session.flow, null)

  //
  // without a name: what /menu, /cancel and /start mean

  const anyFlow = createContext({ name: 'payment', updatedAt: Date.now() })

  clearFlow(anyFlow)

  assert.equal(anyFlow.session.flow, null)
})
