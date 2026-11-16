const activeOperations = new Set()

export const cron = {
  run(log, taskName, operation) {
    const task = Promise.resolve()
      .then(operation)
      .catch(error => {
        log.error('Cron task failed', { taskName, error })

        throw error
      })
      .finally(() => {
        activeOperations.delete(task)
      })

    activeOperations.add(task)

    return task
  },
  async drain() {
    await Promise.allSettled([...activeOperations])
  },
}
