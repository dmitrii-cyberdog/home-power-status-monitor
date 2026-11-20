start = 👋 Home Power Status Monitor готов. Используйте /help.
help =
    📋 Команды

    ⚡ /status [название дома] — краткая сводка об электричестве
    📊 /status_full [название дома] — подробная сводка и история
    🔔 /on_notification <название дома> — включить уведомления
    🔕 /off_notification <название дома> — выключить уведомления
    🌐 /en или /ru — сменить язык чата
help_private_access =
    🏠 Home Power Status Monitor

    🔑 Отправьте сюда /secret <значение>, чтобы авторизовать этот личный чат.
    👥 Чтобы авторизовать группу, администратор бота отправляет сюда /authorize_group <chat_id>. Чтобы узнать ID чата, отправьте { $helpCommand } в группе.

    🛠 Администраторы бота могут посмотреть список команд через /admin.
help_group_access =
    🏠 Home Power Status Monitor

    🔑 Используйте /secret только в личном чате. Чтобы авторизовать группу, администратор бота отправляет команду ниже в личном чате с ботом.
help_group_commands = 💡 В группе добавляйте имя бота к командам, например { $helpCommand } или { $statusCommand }.
language_selected = 🌐 Язык чата: русский.
general_error = ⚠️ Операция не выполнена. Попробуйте позже.
pending_request_exists = ⏳ Предыдущие запросы ещё обрабатываются. Подождите немного.
access_denied = 🔒 Сначала авторизуйте чат: /secret <значение>.
access_denied_group = 🔒 Эта группа не авторизована. Попросите администратора бота одобрить её из личного чата.
access_group_secret_rejected = 🚫 Секреты нельзя использовать в группах. Попросите администратора бота одобрить эту группу из личного чата.
access_authorized = ✅ Чат авторизован.
access_invalid = ❌ Неверный секрет.
access_disabled = 🚫 Доступ отключён.
access_rate_limited = ⏳ Слишком много попыток. Подождите минуту.
admin_access_denied = 🔒 Требуются права администратора.
admin_help =
    🛠 Управление ботом

    👥 /authorize_group <chat_id> — авторизовать группу. Отправьте { $helpCommand } в группе, чтобы узнать её отрицательный ID.

    🧹 /clear_chats <chat_id> — удалить доступ и подписки на уведомления для одного чата.
    🧹 /clear_chats all — удалить доступ и подписки на уведомления для всех чатов.

    ⚠️ После очистки нужно заново авторизовать чат и включить уведомления.
admin_clear_usage = ℹ️ Используйте /clear_chats <chat_id> или /clear_chats all.
admin_authorize_group_usage = ℹ️ Используйте /authorize_group <chat_id> с отрицательным ID группового чата.
admin_group_authorized = ✅ Группа авторизована.
admin_chat_not_found = 🔍 Запись чата не найдена.
admin_chats_cleared = 🧹 Удалено записей чатов: { $count }.
subscription_enabled = 🔔 Уведомления включены.
subscription_already_enabled = 🔔 Уведомления уже включены.
subscription_disabled = 🔕 Уведомления отключены.
subscription_already_disabled = 🔕 Уведомления уже отключены.
subscription_button_enable = 🔔 Включить уведомления
subscription_button_disable = 🔕 Отключить уведомления
monitor_none = Нет наблюдений
monitor_baseline = Первое наблюдение; фактическое начало неизвестно
monitor_on = Электричество есть
monitor_off = Электричества нет
monitor_unknown = Неизвестно
monitor_stale = Устаревшее наблюдение
monitor_observed = Последнее наблюдение
monitor_last_on = Последнее включение
monitor_last_off = Последнее отключение
monitor_duration = Оценка секунд с обнаружения
monitor_uncertain = Непрерывность неизвестна
monitor_since = Обнаружено
monitor_totals = Накопленные оценки по наблюдениям
monitor_seconds = секунд
monitor_outages = Обнаружено отключений
monitor_unknown_time = Время с неизвестным состоянием электроснабжения
monitor_tail = Время с конца учтённого периода
monitor_empty = 🏠 Дома не настроены.
monitor_not_found = 🔍 Дом не найден.
subscription_prompt_on_notification = 🔔 Ответьте названием дома, чтобы включить уведомления.
subscription_prompt_off_notification = 🔕 Ответьте названием дома, чтобы отключить уведомления.
monitor_outage = Обнаружено отключение электричества
monitor_restored = Электричество восстановлено
monitor_outage_detected_at = Отключение обнаружено
monitor_observed_uptime = Время с электричеством по наблюдениям
monitor_observed_downtime = Время без электричества по наблюдениям
monitor_previous_outage = Предыдущее отключение обнаружено
monitor_between_outages = Между обнаружениями отключений
monitor_not_observed = Нет наблюдений
monitor_status_unknown = Состояние электричества неизвестно
monitor_last_confirmed = Последняя проверка
monitor_last_known = По последним данным
monitor_check_inconclusive = Подтвердить текущее состояние не удалось.
monitor_ezviz_now = Устройство { $device } (EZVIZ) сейчас
monitor_offline_checks = { $count } из { $total } { $total ->
    [one] проверки
   *[other] проверок
    }
monitor_continuity_unknown = Непрерывная длительность неизвестна
monitor_power_for = Уже { $duration } (с момента обнаружения)
monitor_local_time = местн. вр.
monitor_less_minute = меньше минуты
monitor_minutes = { $count } { $count ->
    [one] минуту
    [few] минуты
   *[other] минут
    }
monitor_hours = { $count } { $count ->
    [one] час
    [few] часа
   *[other] часов
    }
monitor_days = { $count } { $count ->
    [one] день
    [few] дня
   *[other] дней
    }
monitor_devices = Устройства
monitor_device_online = В сети
monitor_device_offline = Не в сети
monitor_device_unknown = Неизвестно
monitor_offline_streak = Проверок подряд не в сети
monitor_diagnostic = Диагностика
