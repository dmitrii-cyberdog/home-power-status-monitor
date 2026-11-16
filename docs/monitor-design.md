# Planned home electricity monitor

This document describes future development. The current bootstrap does not poll
devices, persist homes, or send outage notifications.

## Purpose

Track evidence of electricity availability at named homes through external
devices such as smart cameras and routers. Save detected off/on transitions and
answer Telegram group queries by home name.

## Environment configuration

Homes use stable numeric IDs, without requiring contiguous numbering:

```dotenv
HOME_1_NAME=Apartment
HOME_1_EZVIZ=provider-specific-settings
HOME_1_XIAOMI_SMART=provider-specific-settings

HOME_3_NAME=Parents
HOME_3_EZVIZ=provider-specific-settings
```

These are illustrative placeholders, not accepted provider credential formats.
Research official APIs and authentication requirements before implementing each
adapter. A missing provider setting skips that provider. A configured provider
without an implemented adapter should produce a clear configuration error.

Configuration must define duplicate names and case-insensitive lookup behavior.
Use numeric IDs for storage paths; never construct paths from home display
names.

## Observation and power inference

Provider adapters should return timestamped online/offline observations or an
unknown/error result. Invalid credentials, timeouts, vendor outages and stale
data are not evidence that home electricity is off.

Device reachability alone cannot distinguish electricity loss from home internet
failure. A router or camera may also remain online on a UPS. Define aggregation
across devices/providers, confirmation windows, recovery rules and flapping
suppression before labeling a home as power-off or power-on.

Run the monitor outside the home's power/network failure domain if alerts must
continue during outages. Report observation timestamps and uncertainty; exact
physical transition times cannot be inferred between polls or while the monitor
was stopped.

## Local JSON storage

Use `volume/homes/<stable-id>.json` for each home's latest state and transition
history, with UTC timestamps. Retain the directory across restarts and
deployment.

The storage implementation should serialize writes, replace files atomically,
and flush accepted changes during shutdown. Define backup/recovery behavior for
corrupted JSON and failed writes. Run a single writer against each directory.
Restart persistence does not eliminate disk-failure or abrupt-power-loss risk.

## Telegram behavior

Users add the bot to an allowed group and mention it with a home name. The bot
should return current state, last successful observation, last off/on
transition, and stale/unknown information. Ignore unrelated group messages.

Define the exact mention/command grammar and document Telegram privacy-mode
requirements when this is implemented. Plain name lookup does not need an AI
provider.

Before allowing queries or notifications, define explicit chat-to-home access
and destinations. Adding the bot to a group must not automatically expose every
configured home. Decide whether mappings are static env settings or persisted
registrations.

Send confirmed transitions once, with a defined retry and deduplication policy
across restarts. Choose display timezone behavior separately from UTC
persistence.

## Next development decisions

1. First provider, account region, supported API, auth and device identifiers.
2. Multi-device evidence rules, polling cadence, confirmation and stale
   timeouts.
3. Chat authorization, notification destinations, and group-query grammar.
4. JSON schema, corruption recovery, history retention and notification delivery
   state.
5. Deployment host, persistent directory, timezone display and live acceptance
   checks using real devices.

Local tests can verify logic and mocked transports. Actual provider
connectivity, Telegram group behavior and outage inference require separate live
acceptance.
