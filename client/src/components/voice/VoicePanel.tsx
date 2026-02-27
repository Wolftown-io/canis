import { Component, Show, For } from "solid-js";
import { PhoneOff, Signal, MonitorUp } from "lucide-solid";
import { voiceState, leaveVoice, getParticipants } from "@/stores/voice";
import { getChannel } from "@/stores/channels";
import { viewUserShare } from "@/stores/screenShareViewer";
import VoiceControls from "./VoiceControls";

/**
 * Voice panel shown when connected to a voice channel.
 * Displays current channel, participants, and controls.
 */
const VoicePanel: Component = () => {
  const channel = () => {
    if (!voiceState.channelId) return null;
    return getChannel(voiceState.channelId);
  };

  const participants = () => getParticipants();

  const handleDisconnect = () => {
    leaveVoice();
  };

  return (
    <Show when={voiceState.state === "connected" && channel()}>
      <div class="bg-surface-base/50 border-t border-white/10 relative">
        {/* Connection info */}
        <div class="px-3 py-2 flex items-center justify-between">
          <div class="flex items-center gap-2 min-w-0">
            <Signal class="w-4 h-4 text-success flex-shrink-0" />
            <div class="min-w-0">
              <div class="text-xs font-semibold text-accent-success">
                Voice Connected
              </div>
              <div class="text-xs text-text-secondary truncate">
                {channel()?.name}
              </div>
            </div>
          </div>
          <button
            onClick={handleDisconnect}
            class="p-1.5 text-text-secondary hover:text-accent-danger hover:bg-white/10 rounded transition-colors"
            title="Disconnect"
          >
            <PhoneOff class="w-4 h-4" />
          </button>
        </div>

        {/* Participants list */}
        <Show when={participants().length > 0}>
          <div class="px-3 pb-2">
            <div class="flex flex-wrap gap-1">
              <For each={participants()}>
                {(participant) => (
                  <div
                    class={`flex items-center gap-1 px-2 py-1 rounded text-xs ${participant.speaking
                        ? "bg-accent-success/20 text-accent-success border border-accent-success/30 shadow-[0_0_8px_rgba(163,190,140,0.3)]"
                        : "bg-white/5 text-text-secondary border border-transparent"
                      } ${participant.muted ? "opacity-50" : "transition-all duration-200"}`}
                    title={participant.muted ? "Muted" : undefined}
                  >
                    <div class="w-4 h-4 rounded-full bg-accent-primary/20 flex items-center justify-center text-accent-primary">
                      {/* Using first letter as avatar fallback for simplicity */}
                      {participant.user_id.charAt(0).toUpperCase()}
                    </div>
                    <span class="truncate max-w-20">
                      {participant.user_id.slice(0, 8)}
                    </span>
                    {participant.screen_sharing && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          viewUserShare(participant.user_id);
                        }}
                        class="p-0.5 hover:bg-accent-success/30 rounded transition-colors"
                        title="View screen share"
                      >
                        <MonitorUp class="w-3 h-3 text-accent-success" />
                      </button>
                    )}
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Active screen shares */}
        <Show when={voiceState.screenShares.length > 0}>
          <div class="px-3 pb-2 border-t border-white/5 pt-2">
            <div class="text-xs text-text-secondary/70 mb-1">Screen Shares</div>
            <For each={voiceState.screenShares}>
              {(share) => (
                <div
                  class="flex items-center gap-2 px-2 py-1.5 rounded bg-white/5 hover:bg-white/10 cursor-pointer transition-colors"
                  onClick={() => viewUserShare(share.user_id)}
                >
                  <MonitorUp class="w-4 h-4 text-accent-success" />
                  <div class="flex-1 min-w-0">
                    <div class="text-sm text-text-primary font-medium truncate">
                      {share.username || share.user_id.slice(0, 8)}
                    </div>
                    <div class="text-xs text-text-secondary">
                      {share.quality} •{" "}
                      {share.has_audio ? "With audio" : "No audio"}
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Voice controls */}
        <VoiceControls />
      </div>
    </Show>
  );
};

export default VoicePanel;
