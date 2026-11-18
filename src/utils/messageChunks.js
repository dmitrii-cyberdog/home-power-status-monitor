import { escapeHtmlText } from './common'

export const splitPlainText = (text, limit) => {
  const messages = []

  while (text.length > limit) {
    const end = /[\uD800-\uDBFF]/.test(text[limit - 1]) ? limit - 1 : limit

    messages.push(text.slice(0, end))
    text = text.slice(end)
  }

  if (text) {
    messages.push(text)
  }

  return messages
}

//
//

export const chunkHtmlLines = (lines, limit) => {
  const messages = []

  let message = ''

  for (const [text, tag] of lines) {
    const open = tag ? `<${tag}>` : ''
    const close = tag ? `</${tag}>` : ''

    const chunks = []

    let chunk = ''

    for (const character of text) {
      const escaped = escapeHtmlText(character)

      if (open.length + chunk.length + escaped.length + close.length > limit) {
        chunks.push(`${open}${chunk}${close}`)
        chunk = ''
      }

      chunk += escaped
    }

    chunks.push(`${open}${chunk}${close}`)

    for (const part of chunks) {
      if (message && message.length + 1 + part.length > limit) {
        messages.push(message)
        message = ''
      }

      message += `${message ? '\n' : ''}${part}`
    }
  }

  if (message) {
    messages.push(message)
  }

  return messages
}
