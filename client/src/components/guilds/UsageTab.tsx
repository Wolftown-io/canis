/**
 * UsageTab - Guild resource usage display
 *
 * Shows current usage vs limits for members, channels, roles, emojis, and bots.
 */

import { Component, createSignal, onMount, For } from "solid-js";
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

function percentage(current: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((current / limit) * 100));
}

function barColor(pct: number): string {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-yellow-500";
  return "bg-emerald-500";
}

const UsageTab: Component<UsageTabProps> = (props) => {
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [stats, setStats] = createSignal<GuildUsageStats | null>(null);

  onMount(async () => {
    try {
      const data = await getGuildUsage(props.guildId);
      setStats(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load usage stats");
    } finally {
      setLoading(false);
    }
  });

  const rows = (): UsageRow[] => {
    const s = stats();
    if (!s) return [];
    return [
      { label: "Members", current: s.members.current, limit: s.members.limit },
      { label: "Channels", current: s.channels.current, limit: s.channels.limit },
      { label: "Roles", current: s.roles.current, limit: s.roles.limit },
      { label: "Emojis", current: s.emojis.current, limit: s.emojis.limit },
      { label: "Bots", current: s.bots.current, limit: s.bots.limit },
      { label: "Pages", current: s.pages.current, limit: s.pages.limit },
    ];
  };

  return (
    <div class="p-6 space-y-6">
      {/* Plan Badge */}
      <div class="flex items-center gap-3">
        <span class="px-3 py-1 rounded-full text-sm font-medium bg-white/10 text-text-secondary capitalize">
          {stats()?.plan ?? "—"} Plan
        </span>
      </div>

      {loading() && (
        <div class="flex items-center justify-center py-12 text-text-secondary">
          Loading usage stats...
        </div>
      )}

      {error() && (
        <div class="text-red-400 text-sm">{error()}</div>
      )}

      {!loading() && !error() && (
        <div class="space-y-4">
          <For each={rows()}>
            {(row) => {
              const pct = () => percentage(row.current, row.limit);
              return (
                <div class="space-y-1.5">
                  <div class="flex items-center justify-between text-sm">
                    <span class="text-text-primary font-medium">{row.label}</span>
                    <span class="text-text-secondary">
                      {row.current} / {row.limit}
                      <span class="ml-1.5 text-xs">({pct()}%)</span>
                    </span>
                  </div>
                  <div class="h-2 rounded-full bg-white/10 overflow-hidden">
                    <div
                      class={`h-full rounded-full transition-all ${barColor(pct())}`}
                      style={{ width: `${pct()}%` }}
                    />
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      )}
    </div>
  );
};

export default UsageTab;
