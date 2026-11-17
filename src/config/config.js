import path from 'node:path'

import dotenvFlow from 'dotenv-flow'

import { supportedLocales } from './constants'
import { parseMonitorConfig } from './monitor'

const envName = process.env.NODE_ENV || 'local'

if (!['local', 'dev', 'prod', 'test'].includes(envName)) {
  throw new Error('NODE_ENV must be local, dev, prod or test')
}

if (envName !== 'test') {
  dotenvFlow.config({
    files: [
      '.env',
      ...(['dev', 'prod'].includes(envName) ? [`.env.${envName}`] : []),
      '.env.local',
    ].map(filename => path.join(process.cwd(), filename)),
    silent: true,
  })
}

//
//

const defaultLocale = process.env.DEFAULT_LOCALE || 'en'

if (!supportedLocales.includes(defaultLocale)) {
  throw new Error('DEFAULT_LOCALE must be en or ru')
}

const storageFolder = path.resolve(process.cwd(), '../system')

//
//

export default {
  // Runtime
  //

  envName,
  isDebug: envName === 'local' || envName === 'dev',

  generalSettings: {
    storageFolder,
    externalStorageFolder: path.resolve(process.cwd(), '../volume'),
    defaultLocale,
  },

  // Logging
  //

  logs: {
    info: {
      name: 'Home Power Status Monitor',
      cat: 'home-power-status-monitor',
    },
    telegram: {
      isEnabled: false,
    },
  },
  // Power monitoring
  //

  cron: {
    checkPowerStatus: {
      isEnabled: process.env.CRON_CHECK_POWER_STATUS_IS_ENABLED === '1',
    },
  },

  monitor: parseMonitorConfig(process.env),

  // Telegram
  //

  botSettings: {
    token: process.env.TG_BOT_TOKEN || '',
    accessSecret: process.env.TG_BOT_ACCESS_SECRET || '',

    i18nSettings: {
      defaultLocale,
      directory: path.join(storageFolder, 'locales/bot'),
      useSession: false,
    },
  },
}
