export default async (ctx, next) => {
  if (ctx.senderChat?.type === 'channel' || ctx.chat?.type === 'channel') {
    return
  }

  await next()
}
