import { randomUUID } from 'node:crypto'
import filesystem from 'node:fs/promises'
import path from 'node:path'

import {
  createChatRegistry,
  createHomeRecord,
  validateChatRegistry,
  validateHomeRecord,
} from './monitorRecords'

export const openMonitorStore = async ({
  directory,
  homeIds,
  fs = filesystem,
}) => {
  await fs.mkdir(path.join(directory, 'homes'), { recursive: true })

  const lockPath = path.join(directory, '.monitor.lock')

  const ownership = randomUUID()

  let lock

  try {
    lock = await fs.open(lockPath, 'wx')
  } catch {
    throw new Error(
      'Monitor storage ownership unavailable; check .monitor.lock',
    )
  }

  const release = async () => {
    await lock.close()

    const metadata = JSON.parse(await fs.readFile(lockPath, 'utf8'))

    if (metadata.ownership === ownership) {
      await fs.unlink(lockPath)
    }
  }

  try {
    await lock.writeFile(
      JSON.stringify({
        ownership,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }),
    )

    const read = async (filename, initial, validate) => {
      let raw

      try {
        raw = await fs.readFile(filename, 'utf8')
      } catch (error) {
        if (error.code === 'ENOENT') {
          return initial()
        }

        throw new Error('Cannot read monitor record', { cause: error })
      }

      try {
        return validate(JSON.parse(raw))
      } catch {
        throw new Error('Invalid monitor record')
      }
    }

    const homes = new Map()

    for (const id of homeIds) {
      validateHomeRecord(createHomeRecord(id), id)
      homes.set(
        id,
        await read(
          path.join(directory, 'homes', `${id}.json`),
          () => createHomeRecord(id),
          value => validateHomeRecord(value, id),
        ),
      )
    }

    let chats = await read(
      path.join(directory, 'chats.json'),
      createChatRegistry,
      validateChatRegistry,
    )

    let queue = Promise.resolve()

    let closed = false

    let closing

    const write = async (filename, value) => {
      const temporary = `${filename}.${randomUUID()}.tmp`

      try {
        await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
          flag: 'wx',
          mode: 0o600,
        })
        await fs.rename(temporary, filename)
      } finally {
        await fs.unlink(temporary).catch(error => {
          if (error.code !== 'ENOENT') {
            throw new Error('Cannot clean monitor temporary record')
          }
        })
      }
    }

    const enqueue = operation => {
      if (closed) {
        return Promise.reject(new Error('Monitor store is closed'))
      }

      const accepted = queue.then(operation)

      queue = accepted.catch(() => {})

      return accepted
    }

    return {
      readHome(id) {
        if (!homes.has(id)) {
          throw new Error('Unconfigured home ID')
        }

        return structuredClone(homes.get(id))
      },
      readChats: () => structuredClone(chats),
      updateHome: (id, update) =>
        enqueue(async () => {
          if (!homes.has(id)) {
            throw new Error('Unconfigured home ID')
          }

          const next = validateHomeRecord(
            update(structuredClone(homes.get(id)), structuredClone(chats)),
            id,
          )

          await write(path.join(directory, 'homes', `${id}.json`), next)
          homes.set(id, structuredClone(next))

          return structuredClone(next)
        }),
      updateChats: update =>
        enqueue(async () => {
          const next = validateChatRegistry(update(structuredClone(chats)))

          await write(path.join(directory, 'chats.json'), next)
          chats = structuredClone(next)

          return structuredClone(next)
        }),
      drain: () => queue,
      close() {
        closed = true
        closing ??= queue.then(release)

        return closing
      },
    }
  } catch (error) {
    await release()

    throw error
  }
}
