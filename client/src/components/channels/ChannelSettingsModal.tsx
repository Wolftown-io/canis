/**
 * ChannelSettingsModal - Channel settings with permissions tab
 */

import { Component, createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { X, Hash, Settings, Shield } from "lucide-solid";
import { channelsState } from "@/stores/channels";
import { memberHasPermission } from "@/stores/permissions";
import { authState } from "@/stores/auth";
import { isGuildOwner } from "@/stores/guilds";
import { PermissionBits } from "@/lib/permissionConstants";
import ChannelPermissions from "./ChannelPermissions";

interface ChannelSettingsModalProps {
  channelId: string;
  guildId: string;
  onClose: () => void;
}

type TabId = "overview" | "permissions";

const ChannelSettingsModal: Component<ChannelSettingsModalProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<TabId>("overview");

  const channel = () =>
    channelsState.channels.find((c) => c.id === props.channelId);

  const isOwner = () => isGuildOwner(props.guildId, authState.user?.id || "");

  const canManageChannel = () =>
    isOwner() ||
    memberHasPermission(
      props.guildId,
      authState.user?.id || "",
      isOwner(),
      PermissionBits.MANAGE_CHANNELS
    );

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      props.onClose();
    }
  };

  return (
    <Portal>
      <div
        class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
        onClick={handleBackdropClick}
      >
        <div
          class="border border-white/10 rounded-2xl w-[550px] max-h-[80vh] flex flex-col shadow-2xl"
          style="background-color: var(--color-surface-base)"
        >
          {/* Header */}
          <div class="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <div class="flex items-center gap-3">
              <Hash class="w-5 h-5 text-text-secondary" />
              <div>
                <h2 class="text-lg font-bold text-text-primary">{channel()?.name}</h2>
                <p class="text-sm text-text-secondary">Channel Settings</p>
              </div>
            </div>
            <button
              onClick={props.onClose}
              class="p-1.5 text-text-secondary hover:text-text-primary hover:bg-white/10 rounded-lg transition-colors"
            >
              <X class="w-5 h-5" />
            </button>
          </div>

          {/* Tabs */}
          <div class="flex border-b border-white/10">
            <button
              onClick={() => setActiveTab("overview")}
              class="flex items-center gap-2 px-6 py-3 font-medium transition-colors"
              classList={{
                "text-accent-primary border-b-2 border-accent-primary": activeTab() === "overview",
                "text-text-secondary hover:text-text-primary": activeTab() !== "overview",
              }}
            >
              <Settings class="w-4 h-4" />
              Overview
            </button>
            <Show when={canManageChannel()}>
              <button
                onClick={() => setActiveTab("permissions")}
                class="flex items-center gap-2 px-6 py-3 font-medium transition-colors"
                classList={{
                  "text-accent-primary border-b-2 border-accent-primary": activeTab() === "permissions",
                  "text-text-secondary hover:text-text-primary": activeTab() !== "permissions",
                }}
              >
                <Shield class="w-4 h-4" />
                Permissions
              </button>
            </Show>
          </div>

          {/* Content */}
          <div class="flex-1 overflow-y-auto">
            <Show when={activeTab() === "overview"}>
              <div class="p-6">
                <div class="space-y-4">
                  <div>
                    <label class="block text-sm font-medium text-text-secondary mb-2">
                      Channel Name
                    </label>
                    <div class="px-3 py-2 rounded-lg border border-white/10 text-text-primary" style="background-color: var(--color-surface-layer1)">
                      {channel()?.name}
                    </div>
                  </div>
                  <div class="text-sm text-text-secondary">
                    More channel settings coming soon...
                  </div>
                </div>
              </div>
            </Show>
            <Show when={activeTab() === "permissions" && canManageChannel()}>
              <ChannelPermissions
                channelId={props.channelId}
                guildId={props.guildId}
              />
            </Show>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default ChannelSettingsModal;
