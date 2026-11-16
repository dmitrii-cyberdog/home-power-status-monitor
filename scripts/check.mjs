import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

const collectFiles = directory => {
  const files = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...collectFiles(filename))
    } else if (['.js', '.mjs'].includes(path.extname(filename))) {
      files.push(filename)
    }
  }

  return files
}

//
//

const files = ['src', 'tests', 'scripts'].flatMap(directory =>
  collectFiles(path.join(root, directory)),
)

files.push(path.join(root, 'eslint.config.mjs'))

for (const filename of files) {
  execFileSync(process.execPath, ['--check', filename], { stdio: 'inherit' })
}

console.log(`Syntax checks passed for ${files.length} files.`)
