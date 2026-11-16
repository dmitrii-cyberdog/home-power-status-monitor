import path from 'node:path'

import dotenvFlow from 'dotenv-flow'

import { supportedLocales } from './constants'

const envName = process.env.NODE_ENV || 'development'
const environment = envName === 'production' ? 'prod' : 'dev'

if (envName !== 'test') {
  dotenvFlow.config({
    files: ['.env', `.env.${environment}`, '.env.local'].map(filename =>
      path.join(process.cwd(), filename),
    ),
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
  envName,
  isDebug: envName === 'development',
  logs: {
    info: {
      name: 'Home Power Status Monitor',
      cat: 'home-power-status-monitor',
    },
    telegram: {
      isEnabled: false,
    },
  },
  generalSettings: {
    storageFolder,
    externalStorageFolder: path.resolve(process.cwd(), '../volume'),
    defaultLocale,
  },
  cron: {
    checkPowerStatus: {
      isEnabled: process.env.CRON_CHECK_POWER_STATUS_IS_ENABLED === '1',
      startTemplate:
        process.env.CRON_CHECK_POWER_STATUS_TEMPLATE || '* * * * *',
    },
  },
  botSettings: {
    token: process.env.TG_BOT_TOKEN || '',
    i18nSettings: {
      defaultLocale,
      directory: path.join(storageFolder, 'locales/bot'),
      useSession: false,
    },
  },
}
