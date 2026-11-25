start = 👋 Home Power Status Monitor is ready. Use /help.
help =
    <b>📋 Commands</b>

    ⚡ /status [home name] — brief power status
    📊 /status_full [home name] — detailed status and history
    🔔 /on_notification &lt;home name&gt; — enable notifications
    🔕 /off_notification &lt;home name&gt; — disable notifications
    ⏱ /notification_interval &lt;minutes|default|0&gt; [home name] — set recurring status interval
    🌐 /en or /ru — change this chat’s language
help_private_access =
    <b>🏠 Home Power Status Monitor</b>

    🔑 Send /secret &lt;value&gt; here to authorize this private chat.
    👥 To approve a group, a configured bot admin sends /authorize_group &lt;chat_id&gt; here. Run { $helpCommand } in the group to get its chat ID.

    <i>🛠 Bot admins can use /admin for admin commands.</i>
help_group_access =
    <b>🏠 Home Power Status Monitor</b>

    🔑 Use /secret only in a private chat. A configured bot admin can approve this group by sending the command below in a private chat with the bot.
help_group_commands = <i>💡 In groups, address commands to this bot by username, for example { $helpCommand } or { $statusCommand }.</i>
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
    <b>🛠 Bot administration</b>

    👥 /authorize_group &lt;chat_id&gt; — approve a group. Send { $helpCommand } in the group to get its negative chat ID.

    📋 /groups — list connected groups with notification and delete buttons.
    🔔 /group_on &lt;chat_id&gt; [home name] — enable a group’s notifications.
    🔕 /group_off &lt;chat_id&gt; [home name] — disable a group’s notifications.
    ⏱ /group_interval &lt;chat_id&gt; &lt;minutes|default|0&gt; [home name] — set a group’s recurring status interval.
    <i>🤫 Without a home name these commands change every home. Nothing is posted to the group.</i>

    🧹 /clear_chats &lt;chat_id&gt; — remove one chat’s access and notification subscriptions.
    🧹 /clear_chats all — remove access and notification subscriptions for every chat.

    <i>⚠️ Cleared chats must authorize again and re-enable notifications.</i>
admin_clear_usage = ℹ️ Use /clear_chats <chat_id> or /clear_chats all.
admin_authorize_group_usage = ℹ️ Use /authorize_group <chat_id> with a negative group chat ID.
admin_group_authorized = ✅ Group authorized.
admin_chat_not_found = 🔍 Chat record not found.
admin_chats_cleared = 🧹 Chat records removed: { $count }.
admin_groups_none = 👥 No connected groups.
admin_groups_title = 👥 { $title } ({ $chatId })
admin_groups_title_unavailable = 👥 { $chatId } (title unavailable)
admin_groups_home_on = 🏠 { $home }: 🔔 notifications on, { $interval }
admin_groups_home_off = 🏠 { $home }: 🔕 notifications off, { $interval }
admin_groups_interval = ⏱ every { $minutes } min
admin_groups_interval_off = ⏱ no recurring updates
admin_groups_button_enable = 🔔 Enable: { $home }
admin_groups_button_disable = 🔕 Disable: { $home }
admin_groups_button_delete = 🗑 Delete group
admin_groups_delete_confirm = 🗑 Delete this group? It loses access, notification subscriptions and interval settings. The bot stays in the group and posts nothing there.
admin_groups_button_confirm = ✅ Yes, delete
admin_groups_button_cancel = ↩️ Cancel
admin_groups_deleted = 🗑 Group deleted. The bot stays in the group; approve it again with /authorize_group to restore access.
admin_groups_not_found = 🔍 Group not found.
admin_group_home_result = 🏠 { $home }: { $result }
admin_group_toggle_usage = ℹ️ Use /group_on <chat_id> [home name] or /group_off <chat_id> [home name] with a negative group chat ID. Without a home name, every home changes.
admin_group_interval_usage = ℹ️ Use /group_interval <chat_id> <minutes|default> [home name] with a negative group chat ID. Minutes: 5 to 10080, or 0 to turn recurring updates off. Without a home name, every home changes.
subscription_enabled = 🔔 Notifications enabled.
subscription_already_enabled = 🔔 Notifications already enabled.
subscription_disabled = 🔕 Notifications disabled.
subscription_already_disabled = 🔕 Notifications already disabled.
interval_set = ⏱ Recurring status for { $home }: every { $minutes } min.
interval_off = ⏱ Recurring status updates for { $home } are off.
interval_reset = ⏱ Recurring status for { $home } reset to default: every { $minutes } min.
interval_reset_off = ⏱ Recurring status for { $home } reset to default: recurring updates are off.
interval_usage = ℹ️ Use /notification_interval <minutes|default> [home name]. Minutes: 5 to 10080, or 0 to turn recurring updates off. The home name can be omitted when only one home is configured.
subscription_button_enable = 🔔 Enable notifications
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
monitor_restored_off_at = Power went off at
monitor_observed_uptime = With power
monitor_restored_downtime = Power was out for
monitor_previous_outage = Detected at
monitor_between_outages = Previous outage was: { $duration } ago
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
