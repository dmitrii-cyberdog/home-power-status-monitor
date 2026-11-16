process.on('message', message => {
  if (message === 'stop') {
    process.emit('SIGTERM')
  }
})

await import('../../src/app.js')
