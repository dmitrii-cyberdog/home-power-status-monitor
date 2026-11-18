export const isUtcTimestamp = value =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value

export const isNonnegativeInteger = value =>
  Number.isSafeInteger(value) && value >= 0

export const isNonemptyString = value =>
  typeof value === 'string' && value.length > 0

export const isObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

//
//

export const nullable = validate => value => value === null || validate(value)

export const strictShape = fields => {
  const entries = Object.entries(fields)

  return value =>
    isObject(value) &&
    Object.keys(value).length === entries.length &&
    entries.every(
      ([key, validate]) => Object.hasOwn(value, key) && validate(value[key]),
    )
}
