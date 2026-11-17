import { Composer } from 'grammy'

import { createAdminCommands } from './adminCommands'
import mainCommands from './mainCommands'
import { createMonitorCommands } from './monitorCommands'

//
//

export const createBotRoutes = dependencies => {
  const composer = new Composer()

  composer.use(mainCommands)
  composer.use(createAdminCommands(dependencies))
  composer.use(createMonitorCommands(dependencies))

  return composer
}

export default createBotRoutes
