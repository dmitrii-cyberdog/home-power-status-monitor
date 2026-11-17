export default (log, homeMonitor) => async () =>
  homeMonitor.check({ onlyIfStale: true })
