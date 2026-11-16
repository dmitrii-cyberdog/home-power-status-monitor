//
// ONE FLOW AT A TIME
//
// Every input flow of the bot is a conversation the user can only be in one of,
// so flows share a single session slot instead of a field each. Entering a flow leaves the
// previous one.
//
// A flow is addressed by NAME. A module asks for its own and gets null when the slot
// belongs to somebody else, so it can neither read nor end a conversation it does
// not own. Callers choose names for their own flows.
//
// All modules share the same 15-minute timeout.
//

const FLOW_TIMEOUT = 15 * 60 * 1000

export const startFlow = (ctx, name, data = {}) => {
  ctx.session.flow = {
    ...data,
    name,
    updatedAt: Date.now(),
  }

  return ctx.session.flow
}

//
// Whether the slot holds this flow at all, expired or not. A module that has to tell
// "expired" from "never started" reads this BEFORE `getFlow` clears it.
//

export const hasFlow = (ctx, name) => ctx.session.flow?.name === name

export const getFlow = (ctx, name) => {
  const flow = ctx.session.flow

  if (flow?.name !== name) {
    // somebody else's conversation, or none at all - not ours to clear either way
    return null
  }

  if (!flow.updatedAt || Date.now() - flow.updatedAt > FLOW_TIMEOUT) {
    ctx.session.flow = null

    return null
  }

  return flow
}

// the timeout is idle-based, so a flow that is still being answered stays alive
export const touchFlow = flow => {
  flow.updatedAt = Date.now()

  return flow
}

//
// With a name, the slot is emptied only when it holds that flow - a module must not
// be able to end another module's conversation from its own fall-through handler.
// Without one, whatever is open ends: that is what `/menu`, `/cancel` and `/start`
// mean.
//

export const clearFlow = (ctx, name) => {
  if (!name || hasFlow(ctx, name)) {
    ctx.session.flow = null
  }
}
