/**
 * DMConversation Component
 *
 * Displays a DM conversation in the Home view.
 */

import { Component, Show, onCleanup, createEffect, createSignal } from "solid-js";
import { Phone, Lock, Unlock } from "lucide-solid";
import { e2eeStatus } from "@/stores/e2ee";
import { getSelectedDM, markDMAsRead } from "@/stores/dms";
import { currentUser } from "@/stores/auth";
import MessageList from "@/components/messages/MessageList";
import MessageInput from "@/components/messages/MessageInput";
import TypingIndicator from "@/components/messages/TypingIndicator";
import { CallBanner } from "@/components/call";
import { callState, startCall, isInCallForChannel } from "@/stores/call";
import { startDMCall, joinVoice } from "@/lib/tauri";

const DMConversation: Component = () => {
  const dm = () => getSelectedDM();
  const [isStartingCall, setIsStartingCall] = createSignal(false);
  const [showEncryptionTooltip, setShowEncryptionTooltip] = createSignal(false);

  // E2EE status for encryption indicator
  const isEncrypted = () => e2eeStatus().initialized;

  const handleStartCall = async () => {
    const currentDM = dm();
    if (!currentDM) return;

    setIsStartingCall(true);
    try {
      await startDMCall(currentDM.id);
      startCall(currentDM.id);
      // Start voice connection immediately as the initiator
      await joinVoice(currentDM.id);
    } catch (err) {
      console.error("Failed to start call:", err);
    } finally {
      setIsStartingCall(false);
    }
  };

  const canStartCall = () => {
    const currentDM = dm();
    if (!currentDM) return false;
    // Can't start a call if already in one for this channel
    if (isInCallForChannel(currentDM.id)) return false;
    // Can't start a call if in any call state except idle
    if (callState.currentCall.status !== "idle") return false;
    return true;
  };

  // Mark as read when viewing
  createEffect(() => {
    const currentDM = dm();
    if (currentDM && currentDM.unread_count > 0) {
      // Debounce: wait 1 second before marking as read
      const timer = setTimeout(() => {
        markDMAsRead(currentDM.id);
      }, 1000);
      onCleanup(() => clearTimeout(timer));
    }
  });

  const otherParticipants = () => {
    const currentDM = dm();
    if (!currentDM) return [];
    const me = currentUser();
    return currentDM.participants.filter(p => p.user_id !== me?.id);
  };

  const displayName = () => {
    const currentDM = dm();
    if (!currentDM) return "";
    const others = otherParticipants();
    if (others.length === 0) {
      return currentDM.participants[0]?.display_name ?? "Unknown";
    }
    return currentDM.name || others.map(p => p.display_name).join(", ");
  };

  const isGroupDM = () => otherParticipants().length > 1;

  return (
    <Show
      when={dm()}
      fallback={
        <div class="flex-1 flex items-center justify-center bg-surface-layer1">
          <p class="text-text-secondary">Select a conversation</p>
        </div>
      }
    >
      <div class="flex-1 flex flex-col bg-surface-layer1">
        {/* Header */}
        <header class="h-12 px-4 flex items-center gap-3 border-b border-white/5 bg-surface-layer1 shadow-sm">
          <Show
            when={isGroupDM()}
            fallback={
              <div class="w-8 h-8 rounded-full bg-accent-primary flex items-center justify-center">
                <span class="text-sm font-semibold text-surface-base">
                  {otherParticipants()[0]?.display_name?.charAt(0).toUpperCase()}
                </span>
              </div>
            }
          >
            <div class="w-8 h-8 rounded-full bg-surface-layer2 flex items-center justify-center">
              <svg class="w-4 h-4 text-text-secondary" fill="currentColor" viewBox="0 0 20 20">
                <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z" />
              </svg>
            </div>
          </Show>
          <span class="font-semibold text-text-primary">{displayName()}</span>

          {/* Encryption Indicator */}
          <div
            class="relative"
            onMouseEnter={() => setShowEncryptionTooltip(true)}
            onMouseLeave={() => setShowEncryptionTooltip(false)}
          >
            <Show
              when={isEncrypted()}
              fallback={
                <Unlock
                  class="w-4 h-4 text-text-muted cursor-help"
                  aria-label="End-to-end encryption not active"
                />
              }
            >
              <Lock
                class="w-4 h-4 text-accent-primary cursor-help"
                aria-label="End-to-end encryption active"
              />
            </Show>

            {/* Encryption Status Tooltip */}
            <Show when={showEncryptionTooltip()}>
              <div class="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 px-3 py-2 bg-surface-base border border-white/10 rounded-lg shadow-xl min-w-[200px] text-center">
                <Show
                  when={isEncrypted()}
                  fallback={
                    <>
                      <p class="text-sm font-medium text-text-secondary">
                        Not Encrypted
                      </p>
                      <p class="text-xs text-text-muted mt-1">
                        E2EE is not set up. Messages are not end-to-end encrypted.
                      </p>
                    </>
                  }
                >
                  <p class="text-sm font-medium text-accent-primary">
                    End-to-End Encrypted
                  </p>
                  <p class="text-xs text-text-muted mt-1">
                    Messages are secured with end-to-end encryption. Only you and the recipient can read them.
                  </p>
                </Show>
              </div>
            </Show>
          </div>

          <Show when={isGroupDM()}>
            <span class="text-sm text-text-secondary">
              {dm()?.participants.length} members
            </span>
          </Show>

          {/* Spacer */}
          <div class="flex-1" />

          {/* Call Button */}
          <button
            onClick={handleStartCall}
            disabled={!canStartCall() || isStartingCall()}
            title={canStartCall() ? "Start voice call" : "Call in progress"}
            aria-label={canStartCall() ? "Start voice call" : "Call in progress"}
            class="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-layer2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Phone class="w-5 h-5" />
          </button>
        </header>

        {/* Call Banner */}
        <CallBanner channelId={dm()!.id} />

        {/* Messages */}
        <MessageList channelId={dm()!.id} />

        {/* Typing Indicator */}
        <TypingIndicator channelId={dm()!.id} />

        {/* Message Input */}
        <MessageInput channelId={dm()!.id} channelName={displayName()} />
      </div>
    </Show>
  );
};

export default DMConversation;
