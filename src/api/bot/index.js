import { Composer } from 'grammy'

import mainCommands from './mainCommands'

//
//

const composer = new Composer()

composer.use(mainCommands)

export default composer
