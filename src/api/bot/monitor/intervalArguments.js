import { monitorValidation } from '../../../services'

export const parseIntervalArguments = (text, homes) => {
  const [value, ...rest] = text.trim().split(/\s+/)

  let minutes = null

  if (value?.toLowerCase() !== 'default') {
    minutes = /^\d+$/.test(value ?? '') ? Number(value) : undefined

    if (!monitorValidation.isIntervalMinutes(minutes)) {
      return { error: 'usage' }
    }
  }

  const name = rest.join(' ').toLowerCase()

  if (!name) {
    return homes.length === 1 ? { minutes, home: homes[0] } : { error: 'usage' }
  }

  const home = homes.find(candidate => candidate.name.toLowerCase() === name)

  return home ? { minutes, home } : { error: 'not_found' }
}
