import { Component, For, Show, createSignal } from "solid-js";
import { ChevronDown, Plus, Mic } from "lucide-solid";
import {
  channelsState,
  textChannels,
  voiceChannels,
  selectChannel,
  createChannel,
} from "@/stores/channels";
import { joinVoice, leaveVoice, isInChannel } from "@/stores/voice";
import ChannelItem from "./ChannelItem";
import MicrophoneTest from "../voice/MicrophoneTest";
import VoiceParticipants from "../voice/VoiceParticipants";

const ChannelList: Component = () => {
  const [showMicTest, setShowMicTest] = createSignal(false);

  const handleVoiceChannelClick = async (channelId: string) => {
    if (isInChannel(channelId)) {
      // Already in this channel, leave it
      await leaveVoice();
    } else {
      // Join the voice channel
      try {
        await joinVoice(channelId);
      } catch (err) {
        console.error("Failed to join voice:", err);
      }
    }
  };

  const handleCreateChannel = async (type: "text" | "voice") => {
    const name = prompt(`Enter ${type} channel name:`);
    if (!name || !name.trim()) return;

    try {
      const channel = await createChannel(name.trim(), type);
      if (type === "text") {
        selectChannel(channel.id);
      }
    } catch (err) {
      console.error("Failed to create channel:", err);
      alert("Failed to create channel: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <nav class="flex-1 overflow-y-auto px-2 py-2">
      {/* Text Channels */}
      <div class="mb-4">
        <div class="flex items-center justify-between px-2 py-1 mb-1 rounded-lg hover:bg-white/5 transition-colors group">
          <div class="flex items-center gap-1.5">
            <ChevronDown class="w-3 h-3 text-text-secondary transition-transform duration-200 group-hover:text-text-primary" />
            <span class="text-xs font-bold text-text-secondary uppercase tracking-wider group-hover:text-text-primary transition-colors">
              Text Channels
            </span>
          </div>
          <button
            class="p-1 text-text-secondary hover:text-text-primary rounded-lg hover:bg-white/10 transition-all duration-200 opacity-0 group-hover:opacity-100"
            title="Create Text Channel"
            onClick={() => handleCreateChannel("text")}
          >
            <Plus class="w-4 h-4" />
          </button>
        </div>
        <div class="space-y-0.5">
          <For each={textChannels()}>
            {(channel) => (
              <ChannelItem
                channel={channel}
                isSelected={channelsState.selectedChannelId === channel.id}
                onClick={() => selectChannel(channel.id)}
              />
            )}
          </For>
        </div>
      </div>

      {/* Voice Channels */}
      <div class="mb-4">
        <div class="flex items-center justify-between px-2 py-1 mb-1 rounded-lg hover:bg-white/5 transition-colors group">
          <div class="flex items-center gap-1.5">
            <ChevronDown class="w-3 h-3 text-text-secondary transition-transform duration-200 group-hover:text-text-primary" />
            <span class="text-xs font-bold text-text-secondary uppercase tracking-wider group-hover:text-text-primary transition-colors">
              Voice Channels
            </span>
          </div>
          <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              class="p-1 text-text-secondary hover:text-accent-primary rounded-lg hover:bg-white/10 transition-all duration-200"
              title="Test Microphone"
              onClick={() => setShowMicTest(true)}
            >
              <Mic class="w-4 h-4" />
            </button>
            <button
              class="p-1 text-text-secondary hover:text-text-primary rounded-lg hover:bg-white/10 transition-all duration-200"
              title="Create Voice Channel"
              onClick={() => handleCreateChannel("voice")}
            >
              <Plus class="w-4 h-4" />
            </button>
          </div>
        </div>
        <div class="space-y-0.5">
          <For each={voiceChannels()}>
            {(channel) => (
              <div>
                <ChannelItem
                  channel={channel}
                  isSelected={false}
                  onClick={() => handleVoiceChannelClick(channel.id)}
                />
                <VoiceParticipants channelId={channel.id} />
              </div>
            )}
          </For>
        </div>
      </div>

      {/* Empty state */}
      <Show
        when={
          !channelsState.isLoading &&
          channelsState.channels.length === 0 &&
          !channelsState.error
        }
      >
        <div class="px-2 py-4 text-center text-text-secondary text-sm">
          No channels yet
        </div>
      </Show>

      {/* Error state */}
      <Show when={channelsState.error}>
        <div class="px-2 py-4 text-center text-accent-danger text-sm">
          {channelsState.error}
        </div>
      </Show>

      {/* Microphone Test Modal */}
      <Show when={showMicTest()}>
        <MicrophoneTest onClose={() => setShowMicTest(false)} />
      </Show>
    </nav>
  );
};

export default ChannelList;
