-- Rename camelCase JSONB keys to snake_case in user_preferences.
-- This is a data migration — no schema changes.

CREATE OR REPLACE FUNCTION _migrate_prefs_snake_case(prefs jsonb) RETURNS jsonb AS $$
DECLARE
  result jsonb := prefs;
  display jsonb;
  sound jsonb;
  qh jsonb;
  conn jsonb;
  sidebar jsonb;
  collapsed jsonb;
  focus jsonb;
  modes jsonb;
  new_modes jsonb;
  mode_item jsonb;
  i int;
BEGIN
  -- ── display ──────────────────────────────────────────────────────────
  IF result ? 'display' THEN
    display := result->'display';
    IF display ? 'indicatorMode' THEN
      display := display - 'indicatorMode'
        || jsonb_build_object('indicator_mode', display->'indicatorMode');
    END IF;
    IF display ? 'showLatencyNumbers' THEN
      display := display - 'showLatencyNumbers'
        || jsonb_build_object('show_latency_numbers', display->'showLatencyNumbers');
    END IF;
    IF display ? 'reactionStyle' THEN
      display := display - 'reactionStyle'
        || jsonb_build_object('reaction_style', display->'reactionStyle');
    END IF;
    IF display ? 'idleTimeoutMinutes' THEN
      display := display - 'idleTimeoutMinutes'
        || jsonb_build_object('idle_timeout_minutes', display->'idleTimeoutMinutes');
    END IF;
    result := jsonb_set(result, '{display}', display);
  END IF;

  -- ── sound ────────────────────────────────────────────────────────────
  IF result ? 'sound' THEN
    sound := result->'sound';
    IF sound ? 'soundType' THEN
      sound := sound - 'soundType'
        || jsonb_build_object('sound_type', sound->'soundType');
    END IF;
    IF sound ? 'quietHours' THEN
      qh := sound->'quietHours';
      IF qh ? 'startTime' THEN
        qh := qh - 'startTime'
          || jsonb_build_object('start_time', qh->'startTime');
      END IF;
      IF qh ? 'endTime' THEN
        qh := qh - 'endTime'
          || jsonb_build_object('end_time', qh->'endTime');
      END IF;
      sound := sound - 'quietHours'
        || jsonb_build_object('quiet_hours', qh);
    END IF;
    result := jsonb_set(result, '{sound}', sound);
  END IF;

  -- ── connection ───────────────────────────────────────────────────────
  IF result ? 'connection' THEN
    conn := result->'connection';
    IF conn ? 'displayMode' THEN
      conn := conn - 'displayMode'
        || jsonb_build_object('display_mode', conn->'displayMode');
    END IF;
    IF conn ? 'showNotifications' THEN
      conn := conn - 'showNotifications'
        || jsonb_build_object('show_notifications', conn->'showNotifications');
    END IF;
    result := jsonb_set(result, '{connection}', conn);
  END IF;

  -- ── channelNotifications → channel_notifications ─────────────────────
  IF result ? 'channelNotifications' THEN
    result := result - 'channelNotifications'
      || jsonb_build_object('channel_notifications', result->'channelNotifications');
  END IF;

  -- ── homeSidebar → home_sidebar (+ nested activeNow) ──────────────────
  IF result ? 'homeSidebar' THEN
    sidebar := result->'homeSidebar';
    IF sidebar ? 'collapsed' THEN
      collapsed := sidebar->'collapsed';
      IF collapsed ? 'activeNow' THEN
        collapsed := collapsed - 'activeNow'
          || jsonb_build_object('active_now', collapsed->'activeNow');
        sidebar := jsonb_set(sidebar, '{collapsed}', collapsed);
      END IF;
    END IF;
    result := result - 'homeSidebar'
      || jsonb_build_object('home_sidebar', sidebar);
  END IF;

  -- ── focus ────────────────────────────────────────────────────────────
  IF result ? 'focus' THEN
    focus := result->'focus';
    IF focus ? 'autoActivateGlobal' THEN
      focus := focus - 'autoActivateGlobal'
        || jsonb_build_object('auto_activate_global', focus->'autoActivateGlobal');
    END IF;

    IF focus ? 'modes' AND jsonb_typeof(focus->'modes') = 'array' THEN
      modes := focus->'modes';
      new_modes := '[]'::jsonb;
      FOR i IN 0 .. jsonb_array_length(modes) - 1 LOOP
        mode_item := modes->i;
        IF mode_item ? 'triggerCategories' THEN
          mode_item := mode_item - 'triggerCategories'
            || jsonb_build_object('trigger_categories', mode_item->'triggerCategories');
        END IF;
        IF mode_item ? 'autoActivateEnabled' THEN
          mode_item := mode_item - 'autoActivateEnabled'
            || jsonb_build_object('auto_activate_enabled', mode_item->'autoActivateEnabled');
        END IF;
        IF mode_item ? 'suppressionLevel' THEN
          mode_item := mode_item - 'suppressionLevel'
            || jsonb_build_object('suppression_level', mode_item->'suppressionLevel');
        END IF;
        IF mode_item ? 'vipUserIds' THEN
          mode_item := mode_item - 'vipUserIds'
            || jsonb_build_object('vip_user_ids', mode_item->'vipUserIds');
        END IF;
        IF mode_item ? 'vipChannelIds' THEN
          mode_item := mode_item - 'vipChannelIds'
            || jsonb_build_object('vip_channel_ids', mode_item->'vipChannelIds');
        END IF;
        IF mode_item ? 'emergencyKeywords' THEN
          mode_item := mode_item - 'emergencyKeywords'
            || jsonb_build_object('emergency_keywords', mode_item->'emergencyKeywords');
        END IF;
        new_modes := new_modes || jsonb_build_array(mode_item);
      END LOOP;
      focus := jsonb_set(focus, '{modes}', new_modes);
    END IF;

    result := jsonb_set(result, '{focus}', focus);
  END IF;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

UPDATE user_preferences
SET preferences = _migrate_prefs_snake_case(preferences)
WHERE preferences != '{}'::jsonb;

DROP FUNCTION _migrate_prefs_snake_case(jsonb);
