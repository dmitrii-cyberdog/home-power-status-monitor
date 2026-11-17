import { Composer } from 'grammy'

import mainCommands from './mainCommands'
import { createMonitorCommands } from './monitorCommands'

//
//

export const createBotRoutes = dependencies => {
  const composer = new Composer()

  composer.use(mainCommands)
  composer.use(createMonitorCommands(dependencies))

  return composer
}

export default createBotRoutes
