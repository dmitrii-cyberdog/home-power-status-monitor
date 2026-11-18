# Public modules and imports

Group related services, routes, and utilities by responsibility. Each group
exposes its supported entry points through its own `index.js`. The parent index
re-exports the parts needed by other groups. Keep implementation helpers
private.

Import across groups through their public entry points. Use a namespace for
related operations so callers can see which module owns them.

```js
import { monitorRecords } from '../../services'

const record = monitorRecords.createHomeRecord(id)
```

Within a group, import siblings directly. Avoid importing from a parent index
that re-exports the current module. Keep public imports free of unexpected
startup work such as opening storage or starting a worker.

Apply the same convention to API routes. Export the route factory from the
feature index and compose it in the parent router.
