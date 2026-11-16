import config, { supportedLocales } from '../config'

//
//

const englishLetters = /^[a-z]+$/i
const russianLetters = /^[а-яё]+$/i

export const detectTextLanguage = text => {
  if (typeof text !== 'string') {
    return null
  }

  const letters = text.normalize('NFKC').match(/\p{L}/gu)?.join('')

  if (!letters) {
    return null
  }

  if (englishLetters.test(letters)) {
    return 'en'
  }

  if (russianLetters.test(letters)) {
    return 'ru'
  }

  return null
}

//
//

const getDefaultLocale = () => {
  const defaultLocale = String(config.generalSettings.defaultLocale ?? '')
    .trim()
    .toLowerCase()
    .split(/[-_]/, 1)[0]

  return supportedLocales.includes(defaultLocale)
    ? defaultLocale
    : supportedLocales[0]
}

export const normalizeLanguageCode = rawLanguageCode => {
  if (rawLanguageCode === null || typeof rawLanguageCode === 'undefined') {
    return null
  }

  const languageCode = String(rawLanguageCode).trim().toLowerCase()

  if (!languageCode) {
    return null
  }

  const [primaryLanguageCode] = languageCode.split(/[-_]/, 1)

  return supportedLocales.includes(primaryLanguageCode)
    ? primaryLanguageCode
    : getDefaultLocale()
}
