// Persisted timestamps are UTC ISO strings, or null until recorded.
export const createHomeRecord = id => ({
  version: 1, // Home record schema version.
  id, // Configured home ID, also the file name without its extension.
  sample: null, // Latest observation, including unknown, or null before polling.
  lastDecisiveStatus: 'unknown', // Last on/off inference, or unknown before one exists.
  lastDecisiveAt: null, // Observation time of the last decisive inference.
  lastOn: null, // Latest detected on episode, or null before one exists.
  lastOff: null, // Latest detected off episode, or null before one exists.
  stateSince: null, // Detection time of the current decisive episode.
  continuous: false, // Whether the episode can be tracked without a known break.
  trackingSince: null, // First recorded observation time.
  accountedAt: null, // Latest timestamp included in duration accounting.
  stats: {
    onMs: 0, // Milliseconds supported by consecutive on samples.
    offMs: 0, // Milliseconds supported by consecutive off samples.
    uncertainMs: 0, // Elapsed milliseconds without supported continuity.
    outageCount: 0, // Detected off episodes, including an off baseline.
  },
  eventSequence: 0, // Last alert event number for this home, or zero before any.
  pendingDeliveries: [], // Outstanding alert deliveries, one per event and chat.
  droppedAlerts: 0, // Deliveries omitted when the pending queue was full.
})

//
//

export const createChatRegistry = () => ({
  version: 1, // Chat registry schema version.
  verifier: null, // Hex scrypt salt and digest, or null when access is disabled.
  generation: null, // Current access generation, or null before initialization.
  chats: {}, // Chat entries keyed by Telegram chat ID as a decimal string.
})
