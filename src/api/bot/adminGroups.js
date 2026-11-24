import { Composer, InlineKeyboard } from 'grammy'

import {
  formatBotText,
  monitorValidation,
  replyFormatted,
} from '../../services'

import { escapeHtmlText } from '../../utils/common'

import { parseIntervalArguments } from './monitor/intervalArguments'

const toggleAction = /^grp:(on|off):(-[1-9]\d*):([1-9]\d*)$/
const groupAction = /^grp:(del|delok|cancel):(-[1-9]\d*)$/

const isGroupId = value =>
  monitorValidation.isChatId(value) && value.startsWith('-')

const groupHeader = async (ctx, chatId) => {
  try {
    const chat = await ctx.api.getChat(chatId)

    return ctx.t('admin_groups_title', { title: chat.title, chatId })
  } catch {
    return ctx.t('admin_groups_title_unavailable', { chatId })
  }
}

// The header is passed in so callbacks can reuse it without calling Telegram for the group.
export const renderGroupCard = (group, header, homes, t) => {
  const lines = [formatBotText(header, 'b'), '']

  const keyboard = new InlineKeyboard()

  for (const home of homes) {
    const state = group.homes.find(item => item.homeId === home.id)

    const interval =
      state.intervalMinutes === 0
        ? t('admin_groups_interval_off')
        : t('admin_groups_interval', { minutes: String(state.intervalMinutes) })

    lines.push(
      escapeHtmlText(
        t(state.subscribed ? 'admin_groups_home_on' : 'admin_groups_home_off', {
          home: home.name,
          interval,
        }),
      ),
    )

    keyboard
      .text(
        t(
          state.subscribed
            ? 'admin_groups_button_disable'
            : 'admin_groups_button_enable',
          { home: home.name },
        ),
        `grp:${state.subscribed ? 'off' : 'on'}:${group.chatId}:${home.id}`,
      )
      .row()
  }

  keyboard.text(t('admin_groups_button_delete'), `grp:del:${group.chatId}`)

  return { text: lines.join('\n'), reply_markup: keyboard }
}

//
//

export const createAdminGroupCommands = ({
  access,
  admins = [],
  homeMonitor,
}) => {
  const composer = new Composer()

  const findGroup = chatId =>
    access.listGroups().find(group => group.chatId === chatId)

  const adminCommand = (command, handler) => {
    composer.command(command, async ctx => {
      if (ctx.chat.type !== 'private') {
        return
      }

      if (!admins.includes(ctx.from?.id)) {
        await replyFormatted(ctx, ctx.t('admin_access_denied'), 'i')

        return
      }

      await handler(ctx)
    })
  }

  // Resolves the optional trailing home name; without a name every configured home is targeted.
  const targetHomes = name => {
    const homes = homeMonitor.getStatuses()

    if (!name) {
      return homes
    }

    const home = homes.find(
      candidate => candidate.name.toLowerCase() === name.toLowerCase(),
    )

    return home ? [home] : undefined
  }

  adminCommand('groups', async ctx => {
    const groups = access.listGroups()

    if (groups.length === 0) {
      await replyFormatted(ctx, ctx.t('admin_groups_none'), 'i')

      return
    }

    for (const group of groups) {
      const header = await groupHeader(ctx, group.chatId)

      const { text, reply_markup } = renderGroupCard(
        group,
        header,
        homeMonitor.getStatuses(),
        ctx.t.bind(ctx),
      )

      await ctx.reply(text, { reply_markup, parse_mode: 'HTML' })
    }
  })

  //
  //

  for (const command of ['group_on', 'group_off']) {
    adminCommand(command, async ctx => {
      const [target = '', ...nameParts] = ctx.match.trim().split(/\s+/)

      if (!isGroupId(target)) {
        await replyFormatted(ctx, ctx.t('admin_group_toggle_usage'), 'i')

        return
      }

      if (!findGroup(target)) {
        await replyFormatted(ctx, ctx.t('admin_groups_not_found'), 'i')

        return
      }

      const homes = targetHomes(nameParts.join(' '))

      if (!homes) {
        await replyFormatted(ctx, ctx.t('monitor_not_found'), 'i')

        return
      }

      const lines = []

      for (const home of homes) {
        const result = await access.setSubscription(
          target,
          home.id,
          command === 'group_on',
        )

        lines.push(
          ctx.t('admin_group_home_result', {
            home: home.name,
            result: ctx.t(`subscription_${result}`),
          }),
        )
      }

      await replyFormatted(ctx, lines.join('\n'), 'b')
    })
  }

  //
  //

  adminCommand('group_interval', async ctx => {
    const [target = '', value = '', ...nameParts] = ctx.match
      .trim()
      .split(/\s+/)

    if (!isGroupId(target)) {
      await replyFormatted(ctx, ctx.t('admin_group_interval_usage'), 'i')

      return
    }

    const homes = homeMonitor
      .getStatuses()
      .map(({ id, name }) => ({ id, name }))

    const name = nameParts.join(' ')

    // Without a name the value applies to every home, so the parser only validates it.
    const parsed = parseIntervalArguments(
      name ? `${value} ${name}` : value,
      name ? homes : homes.slice(0, 1),
    )

    if (parsed.error === 'usage') {
      await replyFormatted(ctx, ctx.t('admin_group_interval_usage'), 'i')

      return
    }

    if (!findGroup(target)) {
      await replyFormatted(ctx, ctx.t('admin_groups_not_found'), 'i')

      return
    }

    if (parsed.error) {
      await replyFormatted(ctx, ctx.t('monitor_not_found'), 'i')

      return
    }

    const lines = []

    for (const home of name ? [parsed.home] : homes) {
      await access.setInterval(target, home.id, parsed.minutes)

      const effective = access.getIntervalMinutes(target, home.id)

      let key = 'interval_set'

      if (parsed.minutes === null) {
        key = effective === 0 ? 'interval_reset_off' : 'interval_reset'
      } else if (effective === 0) {
        key = 'interval_off'
      }

      lines.push(ctx.t(key, { home: home.name, minutes: String(effective) }))
    }

    await replyFormatted(ctx, lines.join('\n'), 'b')
  })

  //
  //

  composer.callbackQuery(/^grp:/, async ctx => {
    const data = ctx.callbackQuery.data

    const toggle = toggleAction.exec(data)

    const action = groupAction.exec(data)

    const message = ctx.callbackQuery.message

    if (
      (!toggle && !action) ||
      !message?.date ||
      message.chat.type !== 'private' ||
      message.chat.id !== ctx.from.id
    ) {
      await ctx.answerCallbackQuery()

      return
    }

    if (!admins.includes(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: ctx.t('admin_access_denied') })

      return
    }

    const chatId = toggle ? toggle[2] : action[2]

    // A card can outlive its group, so approval is checked again before any change.
    if (!monitorValidation.isChatId(chatId) || !findGroup(chatId)) {
      await ctx.answerCallbackQuery({ text: ctx.t('admin_groups_not_found') })

      return
    }

    const header = message.text.split('\n')[0]

    const homes = homeMonitor.getStatuses()

    const card = () =>
      renderGroupCard(findGroup(chatId), header, homes, ctx.t.bind(ctx))

    if (toggle) {
      const [, target, , homeId] = toggle

      if (!homes.some(home => home.id === homeId)) {
        await ctx.answerCallbackQuery({ text: ctx.t('monitor_not_found') })

        return
      }

      let result

      try {
        result = await access.setSubscription(chatId, homeId, target === 'on')
      } catch (error) {
        await ctx.answerCallbackQuery()

        throw error
      }

      await ctx.answerCallbackQuery({ text: ctx.t(`subscription_${result}`) })

      const { text, reply_markup } = card()

      try {
        await ctx.editMessageText(text, { reply_markup, parse_mode: 'HTML' })
      } catch {
        ctx.log?.warning('group_card_edit_failed', {
          updateId: ctx.update.update_id,
        })
      }

      return
    }

    //
    //

    const [, kind] = action

    const editCard = async (text, extra) => {
      try {
        await ctx.editMessageText(text, { ...extra, parse_mode: 'HTML' })
      } catch {
        ctx.log?.warning('group_card_edit_failed', {
          updateId: ctx.update.update_id,
        })
      }
    }

    if (kind === 'del') {
      await ctx.answerCallbackQuery()
      await editCard(
        `${formatBotText(header, 'b')}\n\n${formatBotText(ctx.t('admin_groups_delete_confirm'), 'i')}`,
        {
          reply_markup: new InlineKeyboard()
            .text(ctx.t('admin_groups_button_confirm'), `grp:delok:${chatId}`)
            .text(ctx.t('admin_groups_button_cancel'), `grp:cancel:${chatId}`),
        },
      )

      return
    }

    if (kind === 'cancel') {
      await ctx.answerCallbackQuery()

      const { text, reply_markup } = card()

      await editCard(text, { reply_markup })

      return
    }

    try {
      await access.clearChats(chatId)
    } catch (error) {
      await ctx.answerCallbackQuery()

      throw error
    }

    await ctx.answerCallbackQuery()
    await editCard(
      `${formatBotText(header, 'b')}\n\n${formatBotText(ctx.t('admin_groups_deleted'), 'b')}`,
    )
  })

  return composer
}
