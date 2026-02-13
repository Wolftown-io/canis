/**
 * GeneralTab - General guild settings (thread toggle, etc.)
 */

import { Component, createSignal, onMount } from "solid-js";
import { getGuildSettings, updateGuildSettings } from "@/lib/tauri";
import { showToast } from "@/components/ui/Toast";

interface GeneralTabProps {
  guildId: string;
}

const GeneralTab: Component<GeneralTabProps> = (props) => {
  const [threadsEnabled, setThreadsEnabled] = createSignal(true);
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);

  onMount(async () => {
    try {
      const settings = await getGuildSettings(props.guildId);
      setThreadsEnabled(settings.threads_enabled);
    } catch (err) {
      console.error("Failed to load guild settings:", err);
      showToast({ type: "error", title: "Settings Error", message: "Could not load guild settings." });
    } finally {
      setLoading(false);
    }
  });

  const handleToggleThreads = async () => {
    const newValue = !threadsEnabled();
    setSaving(true);
    try {
      await updateGuildSettings(props.guildId, { threads_enabled: newValue });
      setThreadsEnabled(newValue);
    } catch (err) {
      console.error("Failed to update guild settings:", err);
      showToast({ type: "error", title: "Update Failed", message: "Could not update thread settings." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="p-6 space-y-6">
      <div>
        <h3 class="text-sm font-semibold text-text-primary uppercase tracking-wide mb-4">
          General
        </h3>

        <div class="flex items-center justify-between p-4 bg-surface-layer2 rounded-xl border border-white/5">
          <div class="flex-1 mr-4">
            <div class="text-sm font-medium text-text-primary">
              Enable Message Threads
            </div>
            <div class="text-xs text-text-secondary mt-1">
              Allow members to create threaded replies on messages. Disabling this hides the "Reply in Thread" option but keeps existing threads readable.
            </div>
          </div>
          <button
            onClick={handleToggleThreads}
            disabled={loading() || saving()}
            class="relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-accent-primary/50 disabled:opacity-50"
            classList={{
              "bg-accent-primary": threadsEnabled(),
              "bg-white/20": !threadsEnabled(),
            }}
            role="switch"
            aria-checked={threadsEnabled()}
            aria-label="Enable Message Threads"
          >
            <span
              class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200"
              classList={{
                "translate-x-5": threadsEnabled(),
                "translate-x-0": !threadsEnabled(),
              }}
            />
          </button>
        </div>
      </div>
    </div>
  );
};

export default GeneralTab;
