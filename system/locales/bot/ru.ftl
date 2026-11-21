start = 👋 Home Power Status Monitor готов. Используйте /help.
help =
    📋 Команды

    ⚡ /status [название дома] — краткая сводка об электричестве
    📊 /status_full [название дома] — подробная сводка и история
    🔔 /on_notification <название дома> — включить уведомления
    🔕 /off_notification <название дома> — выключить уведомления
    ⏱ /notification_interval <минуты|default|0> [название дома] — задать интервал регулярных сводок
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

    📋 /groups — список подключённых групп с кнопками уведомлений и удаления.
    🔔 /group_on <chat_id> [название дома] — включить уведомления группы.
    🔕 /group_off <chat_id> [название дома] — отключить уведомления группы.
    ⏱ /group_interval <chat_id> <минуты|default|0> [название дома] — задать интервал регулярных сводок группы.
    🤫 Без названия дома эти команды меняют все дома. В группу ничего не отправляется.

    🧹 /clear_chats <chat_id> — удалить доступ и подписки на уведомления для одного чата.
    🧹 /clear_chats all — удалить доступ и подписки на уведомления для всех чатов.

    ⚠️ После очистки нужно заново авторизовать чат и включить уведомления.
admin_clear_usage = ℹ️ Используйте /clear_chats <chat_id> или /clear_chats all.
admin_authorize_group_usage = ℹ️ Используйте /authorize_group <chat_id> с отрицательным ID группового чата.
admin_group_authorized = ✅ Группа авторизована.
admin_chat_not_found = 🔍 Запись чата не найдена.
admin_chats_cleared = 🧹 Удалено записей чатов: { $count }.
admin_groups_none = 👥 Нет подключённых групп.
admin_groups_title = 👥 { $title } ({ $chatId })
admin_groups_title_unavailable = 👥 { $chatId } (название недоступно)
admin_groups_home_on = 🏠 { $home }: 🔔 уведомления включены, { $interval }
admin_groups_home_off = 🏠 { $home }: 🔕 уведомления отключены, { $interval }
admin_groups_interval = ⏱ каждые { $minutes } мин
admin_groups_interval_off = ⏱ без регулярных сводок
admin_groups_button_enable = 🔔 Включить: { $home }
admin_groups_button_disable = 🔕 Отключить: { $home }
admin_groups_button_delete = 🗑 Удалить группу
admin_groups_delete_confirm = 🗑 Удалить эту группу? Она потеряет доступ, подписки на уведомления и настройки интервала. Бот останется в группе и ничего туда не отправит.
admin_groups_button_confirm = ✅ Да, удалить
admin_groups_button_cancel = ↩️ Отмена
admin_groups_deleted = 🗑 Группа удалена. Бот остаётся в группе; чтобы вернуть доступ, снова авторизуйте её через /authorize_group.
admin_groups_not_found = 🔍 Группа не найдена.
admin_group_home_result = 🏠 { $home }: { $result }
admin_group_toggle_usage = ℹ️ Используйте /group_on <chat_id> [название дома] или /group_off <chat_id> [название дома] с отрицательным ID группового чата. Без названия дома меняются все дома.
admin_group_interval_usage = ℹ️ Используйте /group_interval <chat_id> <минуты|default> [название дома] с отрицательным ID группового чата. Минуты: от 5 до 10080, или 0, чтобы отключить регулярные сводки. Без названия дома меняются все дома.
subscription_enabled = 🔔 Уведомления включены.
subscription_already_enabled = 🔔 Уведомления уже включены.
subscription_disabled = 🔕 Уведомления отключены.
subscription_already_disabled = 🔕 Уведомления уже отключены.
interval_set = ⏱ Регулярная сводка для { $home }: каждые { $minutes } мин.
interval_off = ⏱ Регулярные сводки для { $home } отключены.
interval_reset = ⏱ Регулярная сводка для { $home } сброшена на значение по умолчанию: каждые { $minutes } мин.
interval_reset_off = ⏱ Регулярная сводка для { $home } сброшена на значение по умолчанию: регулярные сводки отключены.
interval_usage = ℹ️ Используйте /notification_interval <минуты|default> [название дома]. Минуты: от 5 до 10080, или 0, чтобы отключить регулярные сводки. Название дома можно не указывать, если настроен только один дом.
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
monitor_detected_off = Отключение света обнаружено в
monitor_detected_on = Включение света обнаружено в
monitor_before_on = До этого свет включали
monitor_before_off = До этого свет отключали
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
