import { Composer } from 'grammy'

//
//

const composer = new Composer()

composer.command('start', async ctx => {
  await ctx.reply(ctx.t('start'))
})

composer.command('help', async ctx => {
  await ctx.reply(ctx.t('help'))
})

export default composer
