# Home electricity monitor

The worker polls the complete paginated EZVIZ account list once per configured
home and round. It selects cameras by exact, case-sensitive NAME, optionally
cross-checking SERIAL. Other account cameras never affect inference. Each home
owns separate credentials and a token cache. Only the verified Europe origin
`https://ieuopen.ezvizlife.com` is supported.

## Configuration and inference

See [the shared defaults and examples](../src/.env). Home/device IDs are stable
positive decimal integers; gaps are allowed. Home names are unique after
trimming and case folding. Device names retain exact spaces and case. Empty
homes are allowed and remain unknown. Credentials are required for homes with
devices. Global EZVIZ credentials and obsolete provider fields are rejected. The
retired `CRON_CHECK_POWER_STATUS_TEMPLATE` is ignored.

Polling defaults to disabled. `POWER_CHECK_INTERVAL_SECONDS=60` controls cadence
when `CRON_CHECK_POWER_STATUS_IS_ENABLED=1` is explicitly configured. Without
scheduled polling, status commands still poll when results are stale and the
manual launcher still checks on demand. Provider failures emit fixed diagnostic
codes with home/device IDs; raw provider responses and credentials are never
included in these diagnostics.

`POWER_OFF_FAILED_CHECKS=3` requires three consecutive offline observations per
selected device. Unknown/online observations reset that streak. A home is off
when K devices qualify, where `HOME_<id>_POWER_OFF_OFFLINE_DEVICE_COUNT`
defaults to 1; -1 means all N devices. Recovery requires N-K+1 online devices.
Insufficient evidence is unknown, preserving the last decisive state separately.
A changed resolved serial resets a name-only selector's streak.
Provider/auth/pagination failures are unknown and never imply an outage or
recovery.

Offline cameras can indicate an internet outage as well as lost electricity.
Timestamps are UTC local detection times; they do not prove the vendor's data
freshness or the physical switching time.

## Persistence and estimates

`volume/homes/<id>.json` retains observations, last on/off detections,
cumulative sampled on/off/uncertain milliseconds, outage count, sequence and
pending alerts. `volume/chats.json` stores a salted scrypt verifier,
authorization generation, chat grants and subscriptions. Credentials and
provider tokens are not stored. Each update uses a same-directory temporary file
and atomic rename before the in-memory snapshot changes. Corrupt records fail
startup without resetting data. Removed home files remain untouched. Renaming a
home preserves its history; never reuse an ID for another physical home.

An initial on/off result is a baseline with unknown actual start. Initial off
sends an outage alert; initial on does not send restoration. Equal decisive
samples in one process run within two intervals contribute to on/off estimates.
Other elapsed intervals count as uncertain. Clock reversal never subtracts or
double-counts time. Restart resets streaks and exposes current state as unknown
until a new sample commits. An unchanged state after restart sends no event.
Unknown gaps interrupt continuous-duration claims until a new episode starts.
Results older than two intervals are stale. Unobserved tail time is displayed
separately; totals stop at the last processed sample. No calendar reports exist.

## Telegram access and delivery

Set `TG_BOT_ACCESS_SECRET` and authenticate each private chat with
`/secret <value>`. The argument is compared exactly, including spaces after the
single command separator. Groups never submit the secret: `/secret` in a group
is refused with a pointer to an admin (the message is still best-effort
deleted). An allowlisted admin approves a group from a private chat with
`/authorize_group <chat_id>`, using a negative ID from a trusted source. It
follows the same serialized grant write as private enrollment, honors disabled
access, preserves subscriptions on repeat and acknowledges only after
persistence. Use `/status` or `/status Family Home`,
`/on_notification Family Home` and `/off_notification Family Home`. Home
arguments are trimmed and matched case-insensitively. An authorized `/status`
requests the shared all-home round under the shared cadence below, waits for
persistence when a round runs, then renders committed results. A named query
filters that snapshot. Concurrent status requests and scheduled checks share the
in-flight round.

`/status [home name]` returns a brief summary: current state, a readable
duration since detection when continuity is supported, and the last
opposite-state detection. For example:

```text
Family Home
Power on for 2 days 3 hours (since detection)
Last power off: 2026-11-17 18:10 UTC
```

Missing history is shown as not observed. An online camera initializes `lastOn`
and the decisive state, not an invented `lastOff`. Unknown results show unknown
current power, with the last confirmed state when available. Gaps and restarts
can leave continuous duration unknown even after a fresh decisive observation.

`/status_full [home name]` uses the same access, refresh and filtering rules. It
adds observation/detection timestamps, baseline and uncertainty notes, sampled
totals, outage count, unobserved tail, and current device statuses, offline
streaks and diagnostic codes. Device details are transient and do not change the
stored record schema. Both replies use escaped Telegram HTML, bold headings,
italic notes, spacing and dividers. Each split message has complete markup.

Scheduled ticks and both status commands share one cadence. The minimum interval
is `max(60, POWER_CHECK_INTERVAL_SECONDS)` seconds. A request first joins any
in-flight round. Before the first round in a process, it polls only when at
least one home's persisted `sample.observedAt` is missing, future-dated or at
least the minimum interval old; recent unknown observations also count as
updates. The persisted timestamp survives restart; a failed write never advances
it. After a round has started in this process, the next round may start once the
minimum interval less one second of scheduler slack has elapsed since the
previous round started, measured with a monotonic clock, so wall-clock jumps and
provider latency neither skip ticks nor shorten the cadence. A round's start
time is recorded before the provider call, so failed provider rounds or writes
still wait out the cooldown instead of retrying in a tight loop. Right after a
restart with fresh persisted samples, status can show unknown power for up to
the minimum interval because those samples belong to the previous run. Other
requests reply from the latest committed results and their existing timestamps
without calling the provider or writing storage, so cached replies never advance
inference or add alerts. Stale status requests still poll when scheduled polling
is disabled. Only the local manual launcher forces a round regardless of
cadence; Telegram commands cannot.

In private groups use `/status@BotUsername Family Home` and corresponding
addressed forms for other commands. Bare protected group commands and unrelated
messages are ignored. Authorization belongs to the whole chat: all members can
query and manage that chat's preferences. A migrated group ID needs its own
grant. Generic start/help remain public and reveal no home information.

Use `/en` or `/ru` to save the language for the whole chat. Language selection
works before authorization and survives restarts. The bot uses the Telegram
account language for replies before a chat has a saved language. First-time
group approval uses the service default when the group has no saved language.
The alert dispatcher reads the recipient's current language before sending the
first chunk, including on delivery retries.

Existing group grants survive routine restarts. If the secret has appeared in a
group, rotate it after rollout and deliberately reapprove trusted groups and
private chats; rotation invalidates all old grants by design.

Grants survive ordinary restarts. Loading a changed or empty secret invalidates
grants before producers start, retaining preferences but suspending delivery.
Changing back does not revive old grants or old-generation pending events. There
are five authentication attempts per chat per minute. Secret messages are
best-effort deleted on success or failure; group permissions may prevent this.
See
[Telegram deletion permissions](https://core.telegram.org/bots/api#deletemessage)
and [addressed commands](https://grammy.dev/guide/commands). Privacy mode need
not be disabled for explicitly addressed commands.

Both outage and restoration detections snapshot authorized subscribers into the
same home commit. Subscribing does not replay old events. Disable/re-enable
creates a new subscription identity, invalidating older pending deliveries.
Before transport submission, access and subscription identity are rechecked. An
already submitted request cannot be recalled.

Delivery is at least once while pending: a crash after send and before saved ack
can duplicate an event with the same event ID. Temporary failures retry on later
notification passes even when provider polling is disabled or unknown. Existing
Telegram transport retries are bounded to three retries and a 30-second maximum
retry delay. Earlier failed events block later events for that home/chat only;
at most four pairs send concurrently. Definite blocked/kicked/deactivated-chat
responses disable that chat's subscriptions; other errors retain pending work.
Each home caps pending deliveries at 1000; new excess deliveries are dropped and
counted in `droppedAlerts`, while state and statistics continue to commit.

## Ownership and shutdown

One process exclusively creates `volume/.monitor.lock`. A second worker/manual
launcher refuses to start; stale locks are never stolen. To recover, first
verify the recorded process is gone and cannot write, then manually remove only
the stale lock. Do not delete home/chat records. Network/shared filesystems with
weak exclusive-create or atomic-rename guarantees are not supported.

On Windows, both PM2 manifests use `shutdown_with_message: true`. The worker
handles the exact IPC `shutdown` message through the same graceful drain as
SIGINT/SIGTERM. Apply the updated manifest to the running PM2 app before relying
on this setting; editing the JSON alone does not update PM2's saved
configuration. The 40-second PM2 kill timeout exceeds the worker's 35-second
hard deadline.

For approved recovery of an existing stale lock:

1. Stop the affected PM2 app with watch disabled
   (`pm2 stop home-power-status-monitor --watch`). Stop any standalone launcher
   too.
2. Read `volume/.monitor.lock`; verify its recorded PID is gone and no other
   worker can write to this storage directory. Do not delete a live owner's
   lock.
3. Remove only that confirmed stale `volume/.monitor.lock`; preserve every home
   and chat JSON record.
4. Start the app using the updated manifest and verify a watch restart drains,
   releases ownership, and reacquires it without repeated startup errors.

Workers with group approval write a `grantId` field into each chat entry of
`volume/chats.json`; older workers reject that field. To roll back, stop the
worker and any launcher, keep storage ownership held so nothing else can write,
and strip `grantId` from the latest valid `chats.json` before starting the older
worker. Do not restore an older snapshot instead: it could revive grants that
were cleared since.

Recovery and live restarts require operator approval. Automatic lock stealing is
deliberately not enabled. A forced termination can still leave a stale lock.

The worker stops producers, drains accepted bot/cron/notification work and ack
writes, drains Telegram, closes storage, then closes HTTP agents and logs. Drain
timeout is 30 seconds with a 35-second hard deadline. A timed-out writer keeps
its ownership lock for manual recovery; it is never released while work can
still write. Disk failures and abrupt kills cannot guarantee every update.

The standalone manual launcher acquires the same lock, checks once and closes.
It never sends Telegram notifications, but may persist events for the worker.
Separate manual runs reset inference streaks, so three separate offline checks
do not satisfy a three-sample streak. Monitoring defaults remain disabled.

Local tests use temporary stores and fake transports. Live EZVIZ connectivity,
physical outage inference, Telegram group privacy/deletion and production
filesystem behavior require separate acceptance. See the [README](../README.md)
for the production deployment workflow.
