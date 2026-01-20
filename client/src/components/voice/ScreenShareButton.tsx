import { Component, Show, createSignal } from "solid-js";
import { MonitorUp, MonitorOff } from "lucide-solid";
import { voiceState, stopScreenShare } from "@/stores/voice";

interface ScreenShareButtonProps {
  onShowQualityPicker?: () => void;
}

/**
 * Screen share toggle button.
 */
const ScreenShareButton: Component<ScreenShareButtonProps> = (props) => {
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const handleClick = async () => {
    setError(null);

    if (voiceState.screenSharing) {
      // Stop sharing
      setLoading(true);
      try {
        await stopScreenShare();
      } finally {
        setLoading(false);
      }
    } else {
      // Show quality picker before starting
      props.onShowQualityPicker?.();
    }
  };

  return (
    <div class="relative">
      <button
        onClick={handleClick}
        disabled={voiceState.state !== "connected" || loading()}
        class={`p-2 rounded-full transition-colors ${
          voiceState.screenSharing
            ? "bg-success/20 text-success hover:bg-danger/20 hover:text-danger"
            : "bg-background-secondary text-text-secondary hover:bg-background-primary hover:text-text-primary"
        } ${loading() ? "opacity-50 cursor-wait" : ""}`}
        title={voiceState.screenSharing ? "Stop Sharing" : "Share Screen"}
      >
        {voiceState.screenSharing ? (
          <MonitorOff class="w-5 h-5" />
        ) : (
          <MonitorUp class="w-5 h-5" />
        )}
      </button>

      <Show when={error()}>
        <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-danger text-white text-xs rounded whitespace-nowrap">
          {error()}
        </div>
      </Show>
    </div>
  );
};

export default ScreenShareButton;
