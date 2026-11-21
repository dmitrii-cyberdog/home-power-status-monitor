export const reduceHomeObservation = (
  record,
  observation,
  { runId, intervalSeconds, continuityGraceMs, recipients },
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
  next.sample = {
    status, // Inferred electricity state, including unknown.
    observedAt, // UTC observation time used for freshness and accounting.
    runId, // Worker run that recorded the observation.
  }

  if (status !== 'unknown') {
    const baseline = record.lastDecisiveStatus === 'unknown'

    const changed = record.lastDecisiveStatus !== status

    // Restarts and unknown samples are bridged when a decisive state follows the last one in time.
    const bridged =
      record.lastDecisiveAt !== null &&
      time >= highWater &&
      time - Date.parse(record.lastDecisiveAt) <= continuityGraceMs

    next.continuous = record.continuous && bridged

    if (changed) {
      next.stateSince = observedAt
      next.continuous = !baseline && next.continuous
      next[status === 'on' ? 'lastOn' : 'lastOff'] = {
        detectedAt: observedAt, // UTC time the episode was first observed.
        baseline, // True when no earlier decisive observation exists.
      }

      if (status === 'off') {
        next.stats.outageCount++
      }

      if (status === 'off' || !baseline) {
        const precedingStateMs = time - Date.parse(record.stateSince)

        const history = {
          previousOnAt: record.lastOn?.detectedAt ?? null,
          previousOffAt: record.lastOff?.detectedAt ?? null,
          precedingStateMs:
            next.continuous && time >= highWater && precedingStateMs >= 0
              ? precedingStateMs
              : null,
        }

        next.eventSequence++

        for (const recipient of recipients) {
          if (next.pendingDeliveries.length >= 1000) {
            next.droppedAlerts++
            continue
          }

          next.pendingDeliveries.push({
            eventId: `${record.id}:${next.eventSequence}`, // Home ID and sequence, shared by recipients.
            sequence: next.eventSequence, // Sorts deliveries for one home and chat.
            state: status, // Off for an outage or on for a restoration.
            detectedAt: observedAt, // UTC time the event was detected.
            baseline, // True for an outage on the first decisive observation.
            uncertain: !next.continuous, // Whether sampling could establish continuity at detection.
            history,
            ...recipient, // Chat ID, access generation, subscription ID and legacy locale snapshot.
          })
        }
      }

      // A newly detected episode starts continuity unless its timestamp moved backward.
      next.continuous = time >= highWater
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
    timeZone: home.timeZone,
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
