start = 👋 Home Power Status Monitor is ready. Use /help.
help =
    📋 Commands

    ⚡ /status [home name] — brief power status
    📊 /status_full [home name] — detailed status and history
    🔔 /on_notification <home name> — enable notifications
    🔕 /off_notification <home name> — disable notifications
    ⏱ /notification_interval <minutes|default|0> [home name] — set recurring status interval
    🌐 /en or /ru — change this chat’s language
help_private_access =
    🏠 Home Power Status Monitor

    🔑 Send /secret <value> here to authorize this private chat.
    👥 To approve a group, a configured bot admin sends /authorize_group <chat_id> here. Run { $helpCommand } in the group to get its chat ID.

    🛠 Bot admins can use /admin for admin commands.
help_group_access =
    🏠 Home Power Status Monitor

    🔑 Use /secret only in a private chat. A configured bot admin can approve this group by sending the command below in a private chat with the bot.
help_group_commands = 💡 In groups, address commands to this bot by username, for example { $helpCommand } or { $statusCommand }.
language_selected = 🌐 Chat language: English.
general_error = ⚠️ Operation failed. Please try again later.
pending_request_exists = ⏳ Your previous requests are still processing. Please wait a moment.
access_denied = 🔒 Authorize this chat with /secret <value> first.
access_denied_group = 🔒 This group is not authorized. Ask a bot admin to approve it from a private chat.
access_group_secret_rejected = 🚫 Secrets cannot be used in groups. Ask a bot admin to approve this group from a private chat.
access_authorized = ✅ Chat authorized.
access_invalid = ❌ Invalid secret.
access_disabled = 🚫 Protected access is disabled.
access_rate_limited = ⏳ Too many attempts. Try again in a minute.
admin_access_denied = 🔒 Admin access required.
admin_help =
    🛠 Bot administration

    👥 /authorize_group <chat_id> — approve a group. Send { $helpCommand } in the group to get its negative chat ID.

    🧹 /clear_chats <chat_id> — remove one chat’s access and notification subscriptions.
    🧹 /clear_chats all — remove access and notification subscriptions for every chat.

    ⚠️ Cleared chats must authorize again and re-enable notifications.
admin_clear_usage = ℹ️ Use /clear_chats <chat_id> or /clear_chats all.
admin_authorize_group_usage = ℹ️ Use /authorize_group <chat_id> with a negative group chat ID.
admin_group_authorized = ✅ Group authorized.
admin_chat_not_found = 🔍 Chat record not found.
admin_chats_cleared = 🧹 Chat records removed: { $count }.
subscription_enabled = 🔔 Notifications enabled.
subscription_already_enabled = 🔔 Notifications already enabled.
subscription_disabled = 🔕 Notifications disabled.
subscription_already_disabled = 🔕 Notifications already disabled.
interval_set = ⏱ Recurring status for { $home }: every { $minutes } min.
interval_off = ⏱ Recurring status updates for { $home } are off.
interval_reset = ⏱ Recurring status for { $home } reset to default: every { $minutes } min.
interval_reset_off = ⏱ Recurring status for { $home } reset to default: recurring updates are off.
interval_usage =ℹ️ Use /notification_interval <minutes|default> [home name]. Minutes: 5 to 10080, or 0 to turn recurring updates off. The home name can be omitted when only one home is configured.
subscription_button_enable =🔔 Enable notifications
subscription_button_disable = 🔕 Disable notifications
monitor_none = No observation
monitor_baseline = Initial baseline; actual start unknown
monitor_on = Power on
monitor_off = Power off
monitor_unknown = Unknown
monitor_stale = Stale observation
monitor_observed = Last observation
monitor_last_on = Last power on
monitor_last_off = Last power off
monitor_duration = Estimated seconds since detection
monitor_uncertain = Uncertain continuity
monitor_since = Detected
monitor_detected_off = Power outage detected at
monitor_detected_on = Power return detected at
monitor_before_on = Before that, power came on at
monitor_before_off = Before that, power went off at
monitor_totals = Cumulative sampled estimates
monitor_seconds = seconds
monitor_outages = Detected outages
monitor_unknown_time = Time with unknown power status
monitor_tail = Time since the end of the measured period
monitor_empty = 🏠 No homes configured.
monitor_not_found = 🔍 Home not found.
subscription_prompt_on_notification = 🔔 Reply with the home name to enable notifications.
subscription_prompt_off_notification = 🔕 Reply with the home name to disable notifications.
monitor_outage = Power outage detected
monitor_restored = Power restored
monitor_outage_detected_at = Outage detected at
monitor_observed_uptime = Observed time with power
monitor_observed_downtime = Observed time without power
monitor_previous_outage = Previous outage detected at
monitor_between_outages = Time between outage detections
monitor_not_observed = Not observed
monitor_status_unknown = Power status unknown
monitor_last_confirmed = Last check
monitor_last_known = Last known state
monitor_check_inconclusive = The current state could not be confirmed.
monitor_ezviz_now = Device { $device } (EZVIZ) now
monitor_offline_checks = { $count } of { $total } { $total ->
    [one] check
   *[other] checks
    }
monitor_continuity_unknown = Continuous duration unknown
monitor_power_for = For { $duration } (since detection)
monitor_local_time = local time
monitor_less_minute = less than a minute
monitor_minutes = { $count } { $count ->
    [one] minute
   *[other] minutes
    }
monitor_hours = { $count } { $count ->
    [one] hour
   *[other] hours
    }
monitor_days = { $count } { $count ->
    [one] day
   *[other] days
    }
monitor_devices = Devices
monitor_device_online = Online
monitor_device_offline = Offline
monitor_device_unknown = Unknown
monitor_offline_streak = Consecutive offline checks
monitor_diagnostic = Diagnostic
