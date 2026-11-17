# Persistent home monitor and Telegram access

Design baseline: 2026-11-17. This document records the original design; the
implementation and current command behavior are documented in
[monitor operations](../../monitor-design.md).

## Intent and agreed requirements

Extend the [EZVIZ implementation plan](../plans/2026-11-16-ezviz-monitor.md)
into a usable monitor: one Telegram bot serves all environment-configured homes,
retains home information across restarts, answers status requests, and sends
power-off and power-restored alerts to subscribed chats.

The user confirmed:

- Home data should be readable JSON text in `volume`, including last off/on
  information, elapsed duration and statistics.
- `/status` lists all homes; `/status home_name` selects one home.
- Commands work in direct chats and when addressed to the bot in private groups.
- `/on_notification home_name` and `/off_notification home_name` control the
  current chat's subscription to a home.
- `/secret <value>` authenticates each chat against a secret configured in env.
  Every incoming protected request must check authorization.
- Ordinary restarts preserve authorization. Changing the configured secret
  invalidates it. Both outage and restoration alerts are required.

The following implementation details were included in the approved design.

## Existing foundation and scope

The worker currently has start/help commands, metadata-only update logging,
Telegram queuing/retries, a bounded shutdown, and a placeholder monitoring task.
There is no implemented home discovery, provider polling or storage service.

Retain the original plan's per-home EZVIZ client, exact device-name selection,
optional serial cross-check, complete account-list validation, offline streaks,
recovery thresholds, non-overlapping interval polling and UTC timestamps.
Provider errors remain unknown observations, never evidence of electricity loss.
Device-offline evidence is assumed power loss, as agreed in the earlier plan; it
does not distinguish a home internet outage from an electrical outage.

This design replaces the old plan's exclusions for persistence, notifications
and group commands. Inference streaks still reset on restart; durable home
history and chat authorization do not. The implementation plan incorporates this
approved expansion before execution. Its unchecked tasks remain unimplemented.

No HTTP server, database service, new provider, dashboard, natural-language
queries, per-user roles or live deployment is included. Keep Node.js 24, native
ESM, the `src` working directory and the existing dependencies where possible.
Do not modify private env files or start real Telegram/provider traffic during
implementation checks.

## Approaches

The approved approach is one JSON file per stable home ID and one chat registry.
It directly follows the requested text-file storage and keeps a home record
independent of chat authorization. JSON is plain text; use the `.json` suffix.

A single JSON document for all homes and chats would simplify atomic updates
across entities, but rewrites unrelated home histories on every update. SQLite
would provide transactions and historical queries, but adds a database format
outside the requested small readable files. Neither is needed for this scope.

Relevant specialist guidance: `ecc-backend:backend-patterns`, read for service
boundaries, storage ownership, background jobs and error handling. There is no
frontend component. Superpowers owns design, planning and implementation.

## Storage and ownership

- `volume/homes/<numeric-id>.json`: version, home ID, latest observation, last
  decisive state/time, last detected on/off times, current state-run metadata,
  cumulative statistics, transition sequence and pending deliveries.
- `volume/chats.json`: version, secret verification metadata, authorization
  generation, and chat records containing authorization and home subscriptions.
- Names come from current env configuration. Storage paths use validated numeric
  IDs, never display names. Credentials and provider tokens are not persisted.

Use a single store service to serialize mutations. Write a temporary file in the
same directory and atomically replace the target before reporting success.
Validate schema and IDs when reading. Missing files represent a fresh store;
malformed or unreadable existing files must produce a clear startup failure,
without silently resetting or overwriting history or authorization.

One process owns a storage directory. An exclusive ownership mechanism must
reject a second worker or manual writer; a stale ownership record must not be
silently stolen. Document recovery after verifying the original process is gone.
Keep each home update and its pending alerts in the same atomic write. A failed
write must not publish the new state or send its alerts; report the storage
failure and preserve the previous durable record.

Removed homes are omitted from queries and polling; leave their files intact. Do
not reuse a home ID for a different physical home. Changing a display name
preserves history and subscriptions. Drain accepted writes within the existing
shutdown deadline; do not promise survival of disk failure or every abrupt kill.

## State, duration and statistics

Keep the latest observation (`on`, `off`, `unknown`) separate from the last
decisive state. A transition occurs when a decisive state differs from the last
decisive state; repeated equal states do not change transition timestamps.
Unknown observations preserve historical state without claiming it is current.

Persist UTC detection timestamps, not purported physical switching times. On
first observation, establish a baseline with an unknown actual start time.
Record when on/off was first detected, but label that initial record as a
baseline rather than a known transition. A first confirmed off baseline sends an
outage alert; a first on baseline does not send a restoration alert.

On restart, load historical state, timestamps and counters, but expose the
current observation as unknown until polling succeeds. Reset device streaks. The
next decisive result equal to the stored state produces no duplicate alert; the
opposite result produces a transition detected now, with the intervening gap
marked uncertain. Do not backdate it to shutdown or the first failed poll.

Keep the record compact using cumulative counters rather than an unbounded
sample log. Initial statistics are since tracking began: sampled on duration,
sampled off duration, unobserved/uncertain duration, and detected outage count.
Calendar reports and arbitrary history ranges are out of scope for this version.

Duration accounting is an estimate from samples. Attribute the interval between
two decisive, equal-state samples to that state only if both belong to the same
process run and their gap is at most twice the configured polling interval.
Intervals with different/unknown states, larger gaps or a restart are uncertain.
Use nonnegative elapsed time; clock reversal must not subtract from counters.
Count each newly detected off episode once, including an initial off baseline.
Do not count uncertainty itself as an outage.

For current duration, display time since detection and label it as an estimate.
If evidence continuity was interrupted, show the historical detection timestamp
and the uncertainty instead of asserting uninterrupted on/off duration. A result
older than twice the interval is stale, including when polling is disabled.
Statistics include intervals through the last processed sample; any tail after
that is unobserved, not automatically added to the on/off total. Display UTC
explicitly; a configurable display timezone is deferred.

## Chat authorization

Add `TG_BOT_ACCESS_SECRET` to the public template with an empty value. Compare
the supplied `/secret` argument exactly, without logging or echoing it. Missing
or empty configuration leaves protected operations inaccessible.

Persist a salted, slow secret verifier and an authorization generation. Derive
and compare the configured secret against this verifier at startup. A matching
secret preserves the generation and every existing grant. A changed secret
creates a new generation and invalidates grants durably before accepting bot
commands or sending alerts. Disabling the secret also invalidates grants.
Changing an env file takes effect when configuration is reloaded by restart; no
file watching is required. A change never loaded by the process cannot be
detected. Restoring an older secret after an observed rotation does not revive
older grants.

Successful `/secret` stores the chat ID and current generation. Invalid attempts
never revoke an already valid grant. Authorization belongs to the chat, so all
members of an authenticated group can query and manage that group's
subscriptions. Each direct chat and group authenticates separately. A migrated
group chat ID must authenticate again; do not automatically grant a new chat
access.

Gate every protected incoming command against the current generation. Only
`/secret` and generic start/help instructions are public; they expose no home
names or status. Ignore unrelated group messages and commands for other bots.
Use a small per-chat attempt limiter for `/secret`; restarting that limiter does
not affect persistent authorization. Keep secrets out of logs and errors,
including errors from attempted deletion of the secret message. Best-effort
deletion may reduce chat history exposure but is not an authorization condition.

After secret rotation, retain subscription preferences but suspend delivery
until that chat authenticates again. Do not replay alerts from the previous
authorization generation. Authorization must also be checked before outbound
notifications, not only when a subscription is created.

## Commands and rendering

In direct chats, support `/status`, `/status home_name`, `/secret <value>`,
`/on_notification home_name`, and `/off_notification home_name`. In groups, use
the explicit form `/status@BotUsername home_name` and corresponding forms for
the other commands. Free-form mentions are not part of this version. Verify the
command/addressing behavior with current grammY/Telegram documentation during
implementation; do not require disabling Telegram privacy mode implicitly.

The remaining command text is the complete home name, including spaces. Trim
outer whitespace and match home names case-insensitively. Reject ambiguous
configured home names at startup. This normalization does not change the
provider's exact, case-sensitive device-name selector.

An authorized `/status` reads committed local snapshots and never triggers a
provider request. List homes in numeric ID order. Include current inferred
status/freshness, last observation, last detected off/on, estimated current
duration or uncertainty, and cumulative statistics. Clearly distinguish first
baselines from subsequent transitions. A named query returns the same details
for one home. Unknown names produce a useful response only after authorization.

Require a home argument for notification commands; do not introduce an implicit
all-homes subscription. Commands are idempotent and acknowledge only after the
subscription is saved. Notifications start with subsequent detections; enabling
a subscription does not replay old events. `/status` shows the current
situation.

Keep English and Russian message keys synchronized. Escape user/configured text
or use plain text, and split long all-home replies within Telegram's limits.
Preserve existing bounded queueing and error handling.

## Notification delivery

When a new off/on event is committed, snapshot currently authorized subscribers
for that home into pending deliveries in that home's record. Include a stable
event ID, event state/time, chat ID, authorization generation and subscription
identity. This ties alerts to durable state without a cross-file transaction.

Before sending, recheck that the home exists, the chat remains authorized in the
same generation, and the same subscription remains active. Disabling and then
re-enabling a subscription creates a new identity, preventing old alerts from
being replayed. Send both off and restored events with detection time and any
gap uncertainty. Preserve event order per home/chat, including after restart.

Use the existing Telegram queue/retry transport. Mark successful deliveries
durably. Temporary failures remain pending for a bounded retry attempt on a
later worker cycle, including while provider observations are unknown. A failed
chat must not block delivery to other chats or block future power polling.
Permanent blocked/removed-chat errors disable its delivery subscriptions. Cap
pending deliveries per home; on saturation retain state/statistics, log the
delivery failure, and record the number of alerts dropped instead of silently
growing the file without limit. The builder may choose the concrete cap.

Delivery is at least once while pending: a crash after Telegram accepts a
message but before the success is saved may duplicate that message. Do not
promise exactly-once delivery. No event is created for repeated polls of the
same state. Revocation prevents unsent work; an already submitted Telegram
request cannot be recalled. No alerts are sent by a competing manual process.

## Verification and handoff

The implementation plan should integrate the provider foundation first, then
storage/statistics, chat authorization/commands, and durable alerts. Keep these
as tasks in one coherent plan; do not implement the old in-memory-only contract
as the final product or mark any task complete before verification.

Tests use temporary storage, controlled time and mocked Telegram/provider
transports. Cover restart persistence, secret rotation and rotation back,
unauthorized incoming/outgoing access, group scope, subscription idempotence,
multiword home names, baseline/transition semantics, uncertain gaps, cumulative
statistics, atomic-write failures, corrupt files, concurrent mutations, second
writer refusal, durable retries, ordering, and the send/ack crash window.

Run focused tests and scoped formatting/lint checks, then required repository
checks. Separate local evidence from live acceptance of EZVIZ access, physical
outages, Telegram group privacy and message deletion permissions. Recommend a
security diff scan after this substantial access/credential change; do not
launch one or contact live services without authorization.

Builder choices: internal module names and schema field names, file-operation
helpers, attempt-limit/cap constants, localized wording and test fixture layout.
Do not expand scope through extra commands, configuration or infrastructure.
