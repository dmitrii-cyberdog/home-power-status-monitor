# Home Power Status Monitor service review

**Goal** — Preserve polling, inference, persisted records, and Telegram command
contracts while closing gaps found in the service review.

**Scope** — Follow the runtime and storage contracts in
[the monitor design](../../monitor-design.md). Use Node.js 24 and Yarn 4.18.0.
Use fake provider and Telegram responses and temporary stores for verification.

## Implementation plan

1. Exercise response logging using test configuration and a loopback HTTP
   fixture. Allow structured JSON response data in local mode with credential
   fields redacted. The caller must still receive the original body.
2. Validate verifier field types and require an authorization generation for a
   persisted verifier. Cover malformed and uninitialized registries alongside
   the existing legacy record tests.
3. In the notification dispatcher, remember a full alert tick that arrives
   during a periodic-only pass. Coalesce overlapping ticks, finish accepted
   sends before draining, and preserve the existing retry cadence. Use a held
   fake send to exercise the overlap deterministically.
4. Skip the preliminary status projection when no home filter was supplied. Keep
   unknown-home rejection before provider refresh. Remove the unused scheduler
   dependency and verify the immutable install and cron tests.
5. Distinguish time of unknown power state from time since the end of the
   measured period in both locales. Correct repository deployment guidance
   against the workflow. Let Prettier accept the checkout's line endings and
   retain the editor's existing defaults for new files.
6. Run focused tests, the full suite, lint, formatting, syntax checks, and the
   recursive dependency audit. Document larger changes separately.

## Implemented follow-up

- Short intervals use the 60-second floor for polling, freshness and new
  sampled-duration calculations. The brief reply includes the detection
  timestamp. An inconclusive check leads with the last known state when
  available and identifies the inconclusive result.
- Single-chat authorization, locale and delivery guards read the current
  committed chat and generation. Secret verification reads only its verifier.
  Recipient enumeration still uses a consistent registry snapshot.
- Upgraded `qs` to 6.17.1, `p-queue` to 10.0.0 and `eslint-plugin-jsdoc` to
  65.5.0. The pinned `qs` resolution matches the direct dependency.

### Authorization benchmark

Node.js 24.19.0, synthetic grants with one subscription each. Each time is the
median of five batches of 1,000 successful `isAuthorized` calls. Times exclude
setup, writes, secret hashing, and transport. The old path made 1,000
full-registry copies per batch. The new path made zero.

| Registered chats |    Before |   After |
| ---------------: | --------: | ------: |
|                1 |   1.99 ms | 1.16 ms |
|              100 |  82.92 ms | 1.26 ms |
|            1,000 | 801.77 ms | 1.26 ms |

See [development checks](../../development.md#validation) for the benchmark
command.

## Remaining decisions

- **High impact, low effort.** Pin the deployment SSH host key after verifying
  it through an independent channel. Provision the verified key and document
  rotation before changing deployment.
- **Medium impact at scale, medium effort.** Each delivery acknowledgement
  rewrites its home's JSON. Measure a representative backlog before changing
  write behavior. Batching acknowledgements increases the number of alerts that
  may replay after a crash.

The generic request transport exposes file, proxy and multipart methods in
addition to the form POST used by EZVIZ. Removing that surface could simplify
the worker but would change its exported API. The existing storage, coordination
and inference boundaries support the fixes above without a storage migration or
service rewrite.
