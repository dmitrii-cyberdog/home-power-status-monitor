import dayjs from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

import { escapeHtml } from './common'
// import relativeTime from 'dayjs/plugin/relativeTime'

//

dayjs.extend(utc)
dayjs.extend(timezone)

dayjs.extend(isBetween)
dayjs.extend(isSameOrBefore)
dayjs.extend(isSameOrAfter)
// dayjs.extend(relativeTime)

//

export const getDayJs = () => dayjs.utc.bind()

export const getDayJsWithUtcOffset = (
  offsetMinutes,
  date,
  keepLocalTime = false,
) => {
  // Day.js treats numeric offsets within +/-16 as hours.
  const dayJsOffset =
    Math.abs(offsetMinutes) <= 16 ? offsetMinutes / 60 : offsetMinutes
  const utcDate = dayjs.utc(date)
  const offsetDate = utcDate.utcOffset(dayJsOffset)

  if (!keepLocalTime) {
    return offsetDate
  }

  // Preserve the received wall-clock components without inheriting the server timezone.
  return offsetDate
    .date(1)
    .year(utcDate.year())
    .month(utcDate.month())
    .date(utcDate.date())
    .hour(utcDate.hour())
    .minute(utcDate.minute())
    .second(utcDate.second())
    .millisecond(utcDate.millisecond())
}

//

export const getMidnightTime = date =>
  dayjs(date)
    .utc()
    .date(dayjs(date).date())
    .month(dayjs(date).month())
    .year(dayjs(date).year())
    .hour(0)
    .minute(0)
    .second(0)
    .format()

/**
 *
 * @param {*} date
 * @param {string} [type=hours] `hours`, `days` and so on
 * @returns
 */

export const getCurrentTimeDiff = (date, type = 'hours') =>
  dayjs().utc().diff(dayjs(date).utc(), type)

//

export const convertDateToSqlFormat = dayjs =>
  dayjs.format('YYYY-MM-DD HH:mm:ss')
export const convertDateToSqlFormatShort = dayjs => dayjs.format('YYYY-MM-DD')

//

export const getTodayDates = () => {
  const todayStart = dayjs().utc().startOf('day').format()
  const todayEnd = dayjs().utc().endOf('day').format()

  return {
    todayStart,
    todayEnd,
    //
    toEndOfTodaySeconds: dayjs()
      .utc()
      .endOf('day')
      .diff(dayjs().utc(), 'seconds'),
  }
}

/**
 *
 * @param {number} offset offset in minutes, e.g. -60 for UTC-1, 120 for UTC+2
 * @returns
 */

export const getTodayDatesWithOffset = offset => {
  const localToday = getDayJsWithUtcOffset(offset)

  const todayStart = localToday.startOf('day').utc().format()
  const todayEnd = localToday.endOf('day').utc().format()

  return {
    todayStart,
    todayEnd,
  }
}

export const formatTimeOffsetMinutes = timeOffsetMinutes => {
  const sign = timeOffsetMinutes < 0 ? '-' : '+'
  const absoluteMinutes = Math.abs(timeOffsetMinutes)
  const hours = Math.floor(absoluteMinutes / 60)
  const minutes = absoluteMinutes % 60
  const minutesText = minutes ? `:${String(minutes).padStart(2, '0')}` : ''

  return `UTC${sign}${hours}${minutesText}`
}

export const parseTimeOffsetMinutes = value => {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim().toUpperCase()

  if (/^[+-]?\d+$/.test(normalizedValue)) {
    const offsetMinutes = Number(normalizedValue)

    return offsetMinutes >= -720 && offsetMinutes <= 840 ? offsetMinutes : null
  }

  const offsetMatch = normalizedValue.match(
    /^(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::([0-5]\d))?$/,
  )

  if (!offsetMatch) {
    return null
  }

  const sign = offsetMatch[1] === '+' ? 1 : -1
  const hours = Number(offsetMatch[2])
  const minutes = Number(offsetMatch[3] || 0)
  const offsetMinutes = sign * (hours * 60 + minutes)

  return offsetMinutes >= -720 && offsetMinutes <= 840 ? offsetMinutes : null
}

export const secondsToTime = seconds => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

export const formatDate = value => {
  if (!value) {
    return '-'
  }

  const date = dayjs(value)

  if (!date.isValid()) {
    return escapeHtml(value)
  }

  return escapeHtml(`${date.format('YYYY-MM-DD HH:mm:ss')} UTC`)
}
