import { Component, For, Show, createSignal, onMount } from "solid-js";

import { getGuildUsage } from "@/lib/tauri";
import type { GuildUsageStats } from "@/lib/types";

interface UsageTabProps {
  guildId: string;
}

interface UsageRow {
  label: string;
  current: number;
  limit: number;
}

const UsageTab: Component<UsageTabProps> = (props) => {
  const [stats, setStats] = createSignal<GuildUsageStats | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    setLoading(true);
    setError(null);
    try {
      const usage = await getGuildUsage(props.guildId);
      setStats(usage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load usage stats");
    } finally {
      setLoading(false);
    }
  });

  const usageRows = (): UsageRow[] => {
    const value = stats();
    if (!value) {
      return [];
    }

    return [
      {
        label: "Members",
        current: value.members.current,
        limit: value.members.limit,
      },
      {
        label: "Channels",
        current: value.channels.current,
        limit: value.channels.limit,
      },
      {
        label: "Roles",
        current: value.roles.current,
        limit: value.roles.limit,
      },
      {
        label: "Emojis",
        current: value.emojis.current,
        limit: value.emojis.limit,
      },
      {
        label: "Bots",
        current: value.bots.current,
        limit: value.bots.limit,
      },
      {
        label: "Pages",
        current: value.pages.current,
        limit: value.pages.limit,
      },
    ];
  };

  const progressPercent = (row: UsageRow): number => {
    if (row.limit <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((row.current / row.limit) * 100));
  };

  return (
    <div class="p-6 space-y-4">
      <div>
        <h3 class="text-sm font-semibold text-text-primary uppercase tracking-wide">Usage</h3>
        <p class="text-xs text-text-secondary mt-1">Current usage against your guild plan.</p>
      </div>

      <Show when={loading()}>
        <div class="text-sm text-text-secondary">Loading usage stats...</div>
      </Show>

      <Show when={!loading() && error()}>
        <div class="text-sm text-red-400">{error()}</div>
      </Show>

      <Show when={!loading() && !error() && stats()}>
        <div class="space-y-3">
          <div class="text-xs text-text-secondary">
            Plan: <span class="text-text-primary font-medium">{stats()?.plan ?? "unknown"}</span>
          </div>

          <For each={usageRows()}>
            {(row) => (
              <div class="p-3 rounded-xl border border-white/10 bg-surface-layer2">
                <div class="flex items-center justify-between text-sm mb-2">
                  <span class="text-text-primary font-medium">{row.label}</span>
                  <span class="text-text-secondary">
                    {row.current} / {row.limit}
                  </span>
                </div>
                <div class="h-2 rounded-full bg-white/10 overflow-hidden">
                  <div
                    class="h-2 rounded-full bg-accent-primary"
                    style={{ width: `${progressPercent(row)}%` }}
                  />
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default UsageTab;
