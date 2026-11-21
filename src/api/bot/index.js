import { Composer } from 'grammy'

import { createChatLocaleHandler } from '../../middlewares/bot'

import { createAdminCommands } from './adminCommands'
import { createAdminGroupCommands } from './adminGroups'
import { createMainCommands } from './mainCommands'
import { createMonitorCommands } from './monitor'

//
//

export const createBotRoutes = dependencies => {
  const composer = new Composer()

  composer.use(createChatLocaleHandler(dependencies.access))

  composer.use(createMainCommands(dependencies))
  composer.use(createAdminCommands(dependencies))
  composer.use(createAdminGroupCommands(dependencies))
  composer.use(createMonitorCommands(dependencies))

  return composer
}

export default createBotRoutes
