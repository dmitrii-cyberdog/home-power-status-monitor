export const reduceHomeObservation = (
  record,
  observation,
  { runId, intervalSeconds, recipients },
) => {
  const next = structuredClone(record)

  const { status, observedAt } = observation

  const time = Date.parse(observedAt)

  const previous = record.sample

  const highWater =
    record.accountedAt === null ? time : Date.parse(record.accountedAt)

  const elapsed = Math.max(0, time - highWater)

  const sameRun = previous?.runId === runId

  const gap = previous ? time - Date.parse(previous.observedAt) : 0

  const supported =
    previous &&
    sameRun &&
    gap >= 0 &&
    time >= highWater &&
    gap <= intervalSeconds * 2000 &&
    previous.status === status &&
    status !== 'unknown'

  if (record.accountedAt !== null) {
    next.stats[supported ? `${status}Ms` : 'uncertainMs'] += elapsed
  }

  next.trackingSince ??= observedAt
  next.accountedAt = new Date(Math.max(time, highWater)).toISOString()
  next.sample = { status, observedAt, runId }

  if (previous && !supported) {
    next.continuous = false
  }

  if (status !== 'unknown') {
    const baseline = record.lastDecisiveStatus === 'unknown'

    const changed = record.lastDecisiveStatus !== status

    if (changed) {
      next.stateSince = observedAt
      next.continuous =
        !baseline &&
        sameRun &&
        gap >= 0 &&
        gap <= intervalSeconds * 2000 &&
        previous.status !== 'unknown' &&
        record.continuous
      next[status === 'on' ? 'lastOn' : 'lastOff'] = {
        detectedAt: observedAt,
        baseline,
      }

      if (status === 'off') {
        next.stats.outageCount++
      }

      if (status === 'off' || !baseline) {
        next.eventSequence++

        for (const recipient of recipients) {
          if (next.pendingDeliveries.length >= 1000) {
            next.droppedAlerts++
            continue
          }

          next.pendingDeliveries.push({
            eventId: `${record.id}:${next.eventSequence}`,
            sequence: next.eventSequence,
            state: status,
            detectedAt: observedAt,
            baseline,
            uncertain: !next.continuous,
            ...recipient,
          })
        }
      }

      // A newly detected episode starts continuity; the event retains gap evidence.
      next.continuous = true
    }

    next.lastDecisiveStatus = status
    next.lastDecisiveAt = observedAt
  }

  return next
}

export const projectHomeStatus = (
  record,
  { home, runId, now, intervalSeconds },
) => {
  const age = record.sample
    ? Math.max(0, now - Date.parse(record.sample.observedAt))
    : 0

  const stale = Boolean(record.sample && age > intervalSeconds * 2000)

  const current = record.sample?.runId === runId

  const uncertain =
    !current ||
    stale ||
    !record.continuous ||
    record.sample?.status === 'unknown'

  return structuredClone({
    id: home.id,
    name: home.name,
    status: current && !stale ? record.sample.status : 'unknown',
    stale,
    observedAt: record.sample?.observedAt ?? null,
    lastInferredStatus: record.lastDecisiveStatus,
    lastInferredAt: record.lastDecisiveAt,
    lastOn: record.lastOn,
    lastOff: record.lastOff,
    stateSince: record.stateSince,
    durationMs:
      uncertain || !record.stateSince
        ? null
        : Math.max(0, now - Date.parse(record.stateSince)),
    uncertain,
    stats: record.stats,
    unobservedTailMs: record.accountedAt
      ? Math.max(0, now - Date.parse(record.accountedAt))
      : 0,
  })
}
