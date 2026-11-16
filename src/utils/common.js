import { nanoid } from 'nanoid'

//
//
//

export const clearLink = link =>
  link.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')

export const capitalizeFirstLetter = str =>
  str.charAt(0).toUpperCase() + str.slice(1)

export const unCapitalizeFirstLetter = str =>
  str.charAt(0).toLowerCase() + str.slice(1)

export const getRandomId = (length = 21) => {
  let str = ''

  if (length <= 36) {
    str = nanoid(length)
  } else {
    let lengthSize = length

    do {
      const idLength = lengthSize - 36 >= 0 ? 36 : lengthSize

      str += nanoid(idLength)

      lengthSize -= idLength
    } while (lengthSize !== 0)
  }

  return str
}

export const isError = obj =>
  Object.prototype.toString.call(obj) === '[object Error]'

export const sleep = ms =>
  new Promise(r => {
    setTimeout(r, ms)
  })

export const getRandomInt = (min, max) => {
  const minInt = Math.ceil(min)
  const maxInt = Math.floor(max)

  return Math.floor(Math.random() * (maxInt - minInt + 1)) + minInt
}

export const escapeHtml = value =>
  String(value ?? '-')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
