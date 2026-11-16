# EZVIZ integration research

Researched on 2026-11-16 for an EZVIZ account registered in Czechia, Europe.
This is research and a proposed configuration contract, not an implemented
integration. Account evidence supplied by the user is distinguished below from
checks performed by the agent.

## Current project

`src/config/config.js` loads environment files but does not discover homes or
devices. `src/cron/checkPowerStatus/fn.js` is a placeholder. The old
`HOME_1_EZVIZ` and `HOME_1_XIAOMI_SMART` entries exist only as documentation
examples. There is no existing provider implementation to migrate.

The existing request service supports form-encoded POST requests through
`Request.postXwwwForm`. Provider transport can reuse it; power inference belongs
in a separate service. Keep the existing shutdown and non-overlap guarantees.

## Official API findings

The supplied [page 2035](https://open.ys7.com/help/en/2035) documents the UIKit
video player. Video playback, streaming URLs and the player SDK are unnecessary
for this worker. Use the HTTP API instead.

The [international token API](https://open.ys7.com/help/en/473) documents:

- `POST https://open.ezvizlife.com/api/lapp/token/get`.
- Form body containing `appKey` and `appSecret`.
- A successful JSON envelope with `code: "200"` and `data.accessToken`,
  `data.expireTime` and `data.areaDomain`.
- `expireTime` is a Unix timestamp in milliseconds.
- The token is valid only for the region identified by `areaDomain`.

For this European account, use the returned regional domain for device calls. Do
not copy the Singapore host shown in device examples or assume that the Chinese
`open.ys7.com` API hosts the account. Validate the returned HTTPS origin against
supported EZVIZ regional origins before sending the token to it. Cache the token
until shortly before its returned expiry; refresh once and retry once on
application code `10002`. Share token acquisition between requests using the
same credentials. Do not fetch a new token for every device check.

### Europe endpoint and user-provided verification

Save `https://ieuopen.ezvizlife.com` as **EZVIZ Europe**. The private
environment setting is `HOME_1_EZVIZ_API_BASE_URL` for home 1; each home has its
own credentials and regional API origin without an endpoint path. Runtime
support for these settings is not implemented yet. When token acquisition
supplies `areaDomain`, verify that it matches this configured region before
using the token.

On 2026-11-16, the user supplied a successful response from
`https://ieuopen.ezvizlife.com/api/lapp/device/list`: application code `200`,
three devices, two with `status: 0` and one with `status: 1`. The user confirmed
that both devices reporting `0` were offline. This supports the offline mapping
and demonstrates account-list access through the European endpoint. Device names
and serials remain private and are intentionally omitted here.

This evidence was supplied by the user, not obtained through an agent API call.
It does not yet verify token renewal, multi-page polling, power inference or
physical electricity state. The response's `updateTime` fields have no
documented timezone or status-freshness guarantee here; do not treat them as
electrical transition timestamps.

The [device query API](https://open.ys7.com/help/en/476) provides:

| Purpose                   | Request                                  | Form fields                                     |
| ------------------------- | ---------------------------------------- | ----------------------------------------------- |
| Check selected device     | `POST {areaDomain}/api/lapp/device/info` | `accessToken`, `deviceSerial`                   |
| Enumerate account devices | `POST {areaDomain}/api/lapp/device/list` | `accessToken`, optional `pageStart`, `pageSize` |

The list endpoint uses zero-based pages and supports at most 50 entries per
page. Its status table defines `0` as offline and `1` as online. The
single-device table contains an apparent translation error, calling both values
online; verify the mapping against a deliberately disconnected real device
before live acceptance. Treat missing or unexpected values as unknown. Do not
apply the different status encodings from native SDK examples to this HTTP API.

Inspect the JSON application code as well as HTTP success. Device-not-found,
invalid identifiers and permission errors are configuration/access failures, not
offline observations. The richer `/device/status/get` endpoint is not needed for
the basic reachability check.

The [HTTP interface rules](https://open.ys7.com/help/en/472) require
`application/x-www-form-urlencoded` POST bodies and document quota exhaustion
(`10007`) and frequency limits (`10029`). These produce unknown observations,
not power-off evidence. Account-specific quotas and costs remain unverified.

## Access prerequisites and remaining uncertainty

Obtain developer application credentials through the
[international developer platform](https://isaopen.ezviz.com/), selecting the
appropriate region. Confirm that its authorized account can see each selected
camera. The token endpoint is documented for administrator access; ordinary
consumer login credentials are not a replacement for application credentials.

Whether the existing consumer account's cameras are directly available to that
application, or need an additional authorization/linking step, requires account
verification for the implementation's token flow. The user's successful list
response confirms access with the credentials/token they used, but does not
establish how that token was acquired. Do not automatically unbind, rebind or
add cameras. The agent has not performed account login, device changes or live
API calls.

The English documentation requires JavaScript. Its relevant pages were rendered
with Playwright; Context7's available EZVIZ documentation did not cover the
international authentication flow sufficiently.

## Proposed configuration contract

Keep numeric home IDs. Scope each device ID to its home; IDs need not be
contiguous. The tuple `(homeId, deviceId)` identifies a device independently of
its display name. Multiple devices may use the same provider.

Select monitored devices explicitly through their device environment entries.
`NAME` selects the exact EZVIZ `deviceName` and is also the display label.
Matching is case-sensitive. `SERIAL` is optional: when supplied it must also
match, and may disambiguate equal camera names. It never overrides a mismatched
name. A renamed camera requires a configuration update; missing or ambiguous
matches remain unknown. Account devices absent from configuration do not
participate in power inference. The current private setup selects one camera
only; its identity stays in `.env.local`.

```dotenv
HOME_1_NAME=Apartment
HOME_1_EZVIZ_API_APP_KEY=
HOME_1_EZVIZ_API_SECRET=
HOME_1_EZVIZ_API_BASE_URL=https://ieuopen.ezvizlife.com

DEVICE_1_HOME_1_TYPE=ezviz
DEVICE_1_HOME_1_NAME=Hall camera
# Optional identity cross-check:
DEVICE_1_HOME_1_SERIAL=replace-with-device-serial

DEVICE_2_HOME_1_TYPE=ezviz
DEVICE_2_HOME_1_NAME=Kitchen camera
DEVICE_2_HOME_1_SERIAL=replace-with-another-device-serial

# Illustrative future provider; Xiaomi access has not been researched.
# DEVICE_3_HOME_1_TYPE=xiaomi
# DEVICE_3_HOME_1_NAME=Smart plug

POWER_CHECK_INTERVAL_SECONDS=60
POWER_OFF_FAILED_CHECKS=3
HOME_1_POWER_OFF_OFFLINE_DEVICE_COUNT=1
```

The interval and confirmation defaults above are proposals. The offline-device
count defaults to `1`, as requested. Set it to a positive count or `-1` for all
configured devices in that home. Keep this setting per home so homes with
different device counts can choose different rules.

Each home supplies its own `HOME_<id>_EZVIZ_API_APP_KEY`,
`HOME_<id>_EZVIZ_API_SECRET` and `HOME_<id>_EZVIZ_API_BASE_URL`. All EZVIZ
devices within that home use those settings. Resolve credentials from the
device's home; do not fall back to global EZVIZ credentials. Keep token
acquisition and caching scoped to that home's account and regional origin so one
home's token cannot overwrite another's. Each home's token response must match
its configured region.

Multiple provider types are supported by the device model; a working Xiaomi
adapter is outside this research. An explicitly configured unsupported provider
must fail clearly rather than be silently skipped.

Validate configuration at startup: required names/type/credentials, optional
serial cross-checks, existing home references, positive integer interval and
failed-check count, and an offline count of `-1` or `1..deviceCount` for
nonempty homes. A home with no devices may retain default `1` or explicit `-1`,
requires no provider credentials, and always remains unknown without making
requests. Reject the obsolete home/provider entries with a migration message if
supplied; they were never a supported credential format.

The new interval should be the single polling cadence, replacing the old cron
expression setting for this monitor. Ignore the retired cron-template key so
existing private overlays do not block startup; it no longer controls cadence.
Keep polling disabled by default, skip scheduled ticks while a round is active,
and coalesce concurrent manual calls within a process. Shutdown drains accepted
checks within the existing deadline; a slow round can be cut short.

## Proposed inference rules

These are application decisions, not guarantees supplied by EZVIZ.

1. Poll only the devices explicitly configured for each home. Every poll returns
   `online`, `offline` or `unknown`, with an observation timestamp.
2. Count consecutive explicit offline observations separately for each device.
   `POWER_OFF_FAILED_CHECKS=3` means three completed polling rounds reporting
   that device offline, not three retries within one round. Online or unknown
   resets the streak, so interrupted evidence is not consecutive. With name-only
   selection, a changed matched serial also resets the streak before counting
   the new observation, preventing replacement cameras from inheriting previous
   evidence.
3. A device qualifies as offline once its streak reaches the configured count.
   Count only devices qualifying in the current round.
4. Infer power off when at least the home's configured count qualifies. With
   `-1`, every configured device must qualify; an unknown device blocks that
   conclusion. With a positive count, other online devices do not override a
   threshold already met.
5. For recovery, let the required offline count be `K` and total devices be `N`.
   Infer power on after a round has at least `N - K + 1` explicit online
   observations. This makes the off condition impossible even if every unknown
   device is offline. For `-1`, one online device is sufficient; for `K=1`,
   every device must be online. Recovery uses one round unless another
   confirmation rule is requested.
6. Otherwise report the current result as unknown and retain the last inferred
   state separately. Do not overwrite a previous state with a claim of recovery
   merely because a request failed. Keep the last decisive observation time
   alongside the historical state. State starts unknown before the first check;
   the first online round can infer on immediately, while an offline round must
   satisfy the confirmation count.

Example: with three devices and an offline count of two, two qualifying offline
devices mean inferred power off. Two online devices mean inferred power on. One
online, one offline and one unknown is insufficient either way.

At a 60-second interval, three offline samples normally take roughly 2–3 minutes
after loss, plus request duration and the vendor's own status delay. This is not
an exact electrical transition time. Internet loss also makes devices offline;
the user explicitly accepts treating confirmed device-offline evidence as
assumed power loss. Battery or UPS-backed devices may behave differently.

State and streaks live only in memory. A one-shot manual run starts fresh;
repeated separate launches cannot accumulate confirmation samples.

## Integration approaches

The user selected name-based matching, with serial as an optional cross-check.
Use account-list polling for this requirement.

- **Direct selected-device polling (not selected):** one information request per
  configured EZVIZ device per round. Simple selection and independent errors;
  request volume grows with the monitored devices. It requires a serial and
  cannot resolve a name-only configuration.
- **Account-list polling (selected):** fetch all pages once per account per
  round, then match configured names and optional serials. Require a complete
  validated list before matching. Missing or ambiguous matches are unknown, not
  offline. A later-page failure, changing total or duplicate serial across pages
  makes the round unknown instead of producing partial outage evidence.

At 60 seconds and up to 50 account devices, listing costs approximately 1,440
requests per home per day, excluding token refreshes and retries. More devices
require more pages per round. Homes fetch separately even if credentials happen
to be shared. Confirm account quota before choosing a live interval. No webhook
is needed, preserving the project's worker-only architecture.

Relevant specialist guidance: `ecc-backend:backend-patterns` for
provider/service separation, token caching, background work and error
boundaries.

## Verification needed during implementation

Use local fixtures or mocked transport only for automated tests. Cover multiple
same-provider devices, sparse IDs, env precedence, validation, token reuse and
regional routing, expired tokens, response parsing, unknown observations,
consecutive failures, count/all aggregation, recovery, non-overlap and shutdown.

Live acceptance is separate: verify European account access, actual online and
offline values, cloud reporting delay, quota behavior and a controlled device
disconnect/reconnect. JSON history, Telegram status commands and notifications
remain separate work unless explicitly included in the implementation scope.
