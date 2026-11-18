import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const sourceDirectory = fileURLToPath(new URL('../../src/', import.meta.url))

process.chdir(sourceDirectory)
process.env.DEFAULT_LOCALE = 'en'

const { detectTextLanguage, normalizeLanguageCode } =
  await import('../../src/utils/index.js')

test('detectTextLanguage recognizes English and Russian text', () => {
  assert.equal(detectTextLanguage('Is this my menu? 🍉'), 'en')
  assert.equal(detectTextLanguage('Где моё меню? 🍉'), 'ru')
  assert.equal(detectTextLanguage('Ёжик'), 'ru')
})

test('detectTextLanguage ignores characters that are not letters', () => {
  assert.equal(detectTextLanguage('Help 24/7 ❓'), 'en')
  assert.equal(detectTextLanguage('Меню 24/7 ❓'), 'ru')
})

test('detectTextLanguage rejects ambiguous or unsupported text', () => {
  assert.equal(detectTextLanguage('Hello, мир'), null)
  assert.equal(detectTextLanguage('Grüße aus Köln!'), null)
  assert.equal(detectTextLanguage('Привіт'), null)
  assert.equal(detectTextLanguage('Γειά'), null)
  assert.equal(detectTextLanguage('123?! 🍉'), null)
  assert.equal(detectTextLanguage(''), null)
  assert.equal(detectTextLanguage(null), null)
})

test('normalizeLanguageCode preserves absent language values', () => {
  assert.equal(normalizeLanguageCode(), null)
  assert.equal(normalizeLanguageCode(null), null)
  assert.equal(normalizeLanguageCode('  '), null)
})

test('normalizeLanguageCode maps supported regional tags to primary codes', () => {
  assert.equal(normalizeLanguageCode('en-US'), 'en')
  assert.equal(normalizeLanguageCode('RU_ru'), 'ru')
})

test('normalizeLanguageCode uses the default for unsupported languages', () => {
  assert.equal(normalizeLanguageCode('fr-FR'), 'en')
})
