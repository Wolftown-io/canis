import {
  Component,
  Show,
  For,
  createEffect,
  createSignal,
  onMount,
  onCleanup,
} from "solid-js";
import { Portal } from "solid-js/web";
import {
  X,
  Minimize2,
  Maximize2,
  Volume2,
  VolumeX,
  Play,
  LayoutGrid,
  Maximize,
} from "lucide-solid";
import {
  viewerState,
  stopViewing,
  setViewMode,
  setScreenVolume,
  toggleMute,
  swapPrimary,
  setLayoutMode,
  addToGrid,
  getAvailableSharers,
  type ViewMode,
  type LayoutMode,
} from "@/stores/screenShareViewer";
import { voiceState } from "@/stores/voice";

/**
 * Screen share viewer overlay.
 * Displays the currently viewed screen share with controls.
 */
const ScreenShareViewer: Component = () => {
  let videoRef: HTMLVideoElement | undefined;
  const [autoplayBlocked, setAutoplayBlocked] = createSignal(false);

  // Attach video track to video element when it changes
  createEffect(() => {
    const track = viewerState.videoTrack;
    if (track && videoRef) {
      const stream = new MediaStream([track]);
      videoRef.srcObject = stream;
      setAutoplayBlocked(false);
      videoRef.play().catch((err) => {
        console.warn("[ScreenShareViewer] Autoplay blocked:", err);
        setAutoplayBlocked(true);
      });
    }
  });

  // Handle manual play when autoplay is blocked
  const handleClickToPlay = () => {
    if (videoRef) {
      videoRef
        .play()
        .then(() => {
          setAutoplayBlocked(false);
        })
        .catch(console.error);
    }
  };

  // Apply volume to video element when it changes
  createEffect(() => {
    if (videoRef) {
      videoRef.volume = viewerState.screenVolume / 100;
    }
  });

  // Cleanup on unmount
  onCleanup(() => {
    if (videoRef) {
      videoRef.srcObject = null;
    }
  });

  const sharerName = () => {
    const streamId = viewerState.viewingStreamId;
    if (!streamId) return "Unknown";
    const trackInfo = viewerState.availableTracks.get(streamId);
    if (!trackInfo) return "Unknown";
    const participant = voiceState.participants[trackInfo.userId];
    const name =
      participant?.display_name ||
      participant?.username ||
      trackInfo.username ||
      trackInfo.userId.slice(0, 8);
    // Include source label if available and not just "Screen"
    if (trackInfo.sourceLabel && trackInfo.sourceLabel !== "Screen") {
      return `${name} — ${trackInfo.sourceLabel}`;
    }
    return name;
  };

  const handleClose = () => {
    stopViewing();
  };

  const cycleViewMode = () => {
    // When in grid mode, cycling view mode switches back to focus mode first
    if (viewerState.layoutMode === "grid") {
      setLayoutMode("focus");
      return;
    }
    const modes: ViewMode[] = ["spotlight", "pip", "theater"];
    const currentIndex = modes.indexOf(viewerState.viewMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setViewMode(modes[nextIndex]);
  };

  /** Toggle between focus and grid layout modes */
  const toggleLayoutMode = () => {
    if (viewerState.layoutMode === "grid") {
      setLayoutMode("focus");
    } else {
      // Auto-populate grid with available streams if empty
      if (viewerState.gridStreamIds.length === 0) {
        const sharers = getAvailableSharers();
        for (const sharer of sharers.slice(0, 4)) {
          addToGrid(sharer.streamId);
        }
      }
      setLayoutMode("grid");
    }
  };

  // Keyboard shortcuts (only active when viewing a screen share)
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!viewerState.viewingStreamId) return;

    // Ignore when typing in input elements
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        stopViewing();
        break;
      case "v":
      case "V":
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          cycleViewMode();
        }
        break;
      case "m":
      case "M":
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          toggleMute();
        }
        break;
      case "f":
      case "F":
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          setLayoutMode("focus");
          setViewMode("spotlight");
        }
        break;
    }
  };

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <Show when={viewerState.viewingStreamId && viewerState.videoTrack}>
      <Portal>
        <Show when={viewerState.viewMode === "spotlight"}>
          <SpotlightView
            videoRef={(el) => (videoRef = el)}
            sharerName={sharerName()}
            onClose={handleClose}
            onCycleMode={cycleViewMode}
            onToggleLayout={toggleLayoutMode}
            autoplayBlocked={autoplayBlocked()}
            onClickToPlay={handleClickToPlay}
          />
        </Show>
        <Show when={viewerState.viewMode === "pip"}>
          <PipView
            videoRef={(el) => (videoRef = el)}
            sharerName={sharerName()}
            onClose={handleClose}
            onCycleMode={cycleViewMode}
            autoplayBlocked={autoplayBlocked()}
            onClickToPlay={handleClickToPlay}
          />
        </Show>
        <Show when={viewerState.viewMode === "theater"}>
          <TheaterView
            videoRef={(el) => (videoRef = el)}
            sharerName={sharerName()}
            onClose={handleClose}
            onCycleMode={cycleViewMode}
            onToggleLayout={toggleLayoutMode}
            autoplayBlocked={autoplayBlocked()}
            onClickToPlay={handleClickToPlay}
          />
        </Show>
      </Portal>
    </Show>
  );
};

/** Click-to-play overlay for autoplay blocked videos */
const ClickToPlayOverlay: Component<{
  onClickToPlay: () => void;
}> = (props) => (
  <div
    class="absolute inset-0 flex items-center justify-center bg-black/60 cursor-pointer z-10"
    onClick={props.onClickToPlay}
  >
    <div class="flex flex-col items-center gap-2 text-white">
      <div class="p-4 rounded-full bg-white/20 hover:bg-white/30 transition-colors">
        <Play class="w-12 h-12" />
      </div>
      <span class="text-sm">Click to play</span>
    </div>
  </div>
);

/** Spotlight mode - full screen overlay */
const SpotlightView: Component<{
  videoRef: (el: HTMLVideoElement) => void;
  sharerName: string;
  onClose: () => void;
  onCycleMode: () => void;
  onToggleLayout: () => void;
  autoplayBlocked: boolean;
  onClickToPlay: () => void;
}> = (props) => {
  return (
    <div class="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header bar */}
      <div class="flex items-center justify-between p-4 bg-black/50">
        <div class="flex items-center gap-2">
          <span class="text-white font-medium">
            {props.sharerName}'s Screen
          </span>
        </div>
        <div class="flex items-center gap-2">
          <VolumeControl />
          <LayoutToggleButton
            layoutMode={viewerState.layoutMode}
            onToggle={props.onToggleLayout}
          />
          <button
            onClick={props.onCycleMode}
            class="p-2 text-white/70 hover:text-white transition-colors"
            title="Change view mode"
          >
            <Minimize2 class="w-5 h-5" />
          </button>
          <button
            onClick={props.onClose}
            class="p-2 text-white/70 hover:text-white transition-colors"
            title="Close"
          >
            <X class="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Video container */}
      <div class="flex-1 flex items-center justify-center p-4 relative">
        <video
          ref={props.videoRef}
          autoplay
          playsinline
          class="max-w-full max-h-full object-contain"
        />
        <Show when={props.autoplayBlocked}>
          <ClickToPlayOverlay onClickToPlay={props.onClickToPlay} />
        </Show>
      </div>

      {/* Thumbnail strip for other available streams */}
      <ThumbnailStrip />
    </div>
  );
};

/** PiP mode - small draggable window */
const PipView: Component<{
  videoRef: (el: HTMLVideoElement) => void;
  sharerName: string;
  onClose: () => void;
  onCycleMode: () => void;
  autoplayBlocked: boolean;
  onClickToPlay: () => void;
}> = (props) => {
  return (
    <div
      class="fixed z-50 bg-black rounded-lg shadow-2xl overflow-hidden"
      style={{
        right: `${viewerState.pipPosition.x}px`,
        bottom: `${viewerState.pipPosition.y}px`,
        width: `${viewerState.pipSize.width}px`,
        height: `${viewerState.pipSize.height}px`,
      }}
    >
      {/* Header */}
      <div class="absolute top-0 left-0 right-0 flex items-center justify-between p-2 bg-gradient-to-b from-black/80 to-transparent z-20">
        <span class="text-white text-xs truncate">{props.sharerName}</span>
        <div class="flex items-center gap-1">
          <button
            onClick={props.onCycleMode}
            class="p-1 text-white/70 hover:text-white transition-colors"
            title="Expand"
          >
            <Maximize2 class="w-4 h-4" />
          </button>
          <button
            onClick={props.onClose}
            class="p-1 text-white/70 hover:text-white transition-colors"
            title="Close"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Video */}
      <video
        ref={props.videoRef}
        autoplay
        playsinline
        class="w-full h-full object-contain"
      />
      <Show when={props.autoplayBlocked}>
        <ClickToPlayOverlay onClickToPlay={props.onClickToPlay} />
      </Show>
    </div>
  );
};

/** Theater mode - wide view with sidebar space */
const TheaterView: Component<{
  videoRef: (el: HTMLVideoElement) => void;
  sharerName: string;
  onClose: () => void;
  onCycleMode: () => void;
  onToggleLayout: () => void;
  autoplayBlocked: boolean;
  onClickToPlay: () => void;
}> = (props) => {
  return (
    <div class="fixed top-0 left-[calc(72px+240px)] right-0 bottom-0 z-40 bg-black/95 flex flex-col">
      {/* Header bar */}
      <div class="flex items-center justify-between p-3 bg-black/50">
        <span class="text-white font-medium text-sm">
          {props.sharerName}'s Screen
        </span>
        <div class="flex items-center gap-2">
          <VolumeControl />
          <LayoutToggleButton
            layoutMode={viewerState.layoutMode}
            onToggle={props.onToggleLayout}
          />
          <button
            onClick={props.onCycleMode}
            class="p-1.5 text-white/70 hover:text-white transition-colors"
            title="Change view mode"
          >
            <Minimize2 class="w-4 h-4" />
          </button>
          <button
            onClick={props.onClose}
            class="p-1.5 text-white/70 hover:text-white transition-colors"
            title="Close"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Video container */}
      <div class="flex-1 flex items-center justify-center p-2 relative">
        <video
          ref={props.videoRef}
          autoplay
          playsinline
          class="max-w-full max-h-full object-contain"
        />
        <Show when={props.autoplayBlocked}>
          <ClickToPlayOverlay onClickToPlay={props.onClickToPlay} />
        </Show>
      </div>

      {/* Thumbnail strip for other available streams */}
      <ThumbnailStrip />
    </div>
  );
};

/** Thumbnail strip showing other available streams below the primary video */
const ThumbnailStrip: Component = () => {
  const sharers = () => getAvailableSharers();
  const others = () =>
    sharers().filter((s) => s.streamId !== viewerState.viewingStreamId);

  return (
    <Show when={others().length > 0}>
      <div class="flex gap-2 p-2 bg-zinc-900/90 overflow-x-auto">
        <For each={others()}>
          {(sharer) => {
            const sharerDisplayName = () => {
              const participant = voiceState.participants[sharer.userId];
              return (
                participant?.display_name ||
                participant?.username ||
                sharer.username ||
                sharer.userId.slice(0, 8)
              );
            };

            const label = () => {
              if (sharer.sourceLabel && sharer.sourceLabel !== "Screen") {
                return `${sharerDisplayName()} — ${sharer.sourceLabel}`;
              }
              return sharerDisplayName();
            };

            return (
              <button
                class="flex-shrink-0 w-40 h-24 rounded border border-zinc-700 hover:border-blue-500 relative overflow-hidden bg-black transition-colors"
                onClick={() => swapPrimary(sharer.streamId)}
                title={`Switch to ${label()}`}
              >
                <video
                  ref={(el) => {
                    const info = viewerState.availableTracks.get(
                      sharer.streamId,
                    );
                    if (info && el) {
                      const stream = new MediaStream([info.track]);
                      el.srcObject = stream;
                    }
                  }}
                  autoplay
                  muted
                  playsinline
                  class="w-full h-full object-contain"
                />
                <div class="absolute bottom-0 left-0 right-0 bg-black/70 text-xs px-1 py-0.5 truncate text-white">
                  {label()}
                </div>
              </button>
            );
          }}
        </For>
      </div>
    </Show>
  );
};

/** Layout toggle button — switches between focus and grid modes */
const LayoutToggleButton: Component<{
  layoutMode: LayoutMode;
  onToggle: () => void;
}> = (props) => {
  return (
    <button
      onClick={props.onToggle}
      class="p-2 text-white/70 hover:text-white transition-colors"
      title={
        props.layoutMode === "focus"
          ? "Switch to grid view (G)"
          : "Switch to focus view (G)"
      }
    >
      {props.layoutMode === "focus" ? (
        <LayoutGrid class="w-5 h-5" />
      ) : (
        <Maximize class="w-5 h-5" />
      )}
    </button>
  );
};

/** Volume control component */
const VolumeControl: Component = () => {
  const isMuted = () => viewerState.screenVolume === 0;

  return (
    <div class="flex items-center gap-2">
      <button
        onClick={toggleMute}
        class="p-1.5 text-white/70 hover:text-white transition-colors"
        title={isMuted() ? "Unmute" : "Mute"}
      >
        {isMuted() ? <VolumeX class="w-4 h-4" /> : <Volume2 class="w-4 h-4" />}
      </button>
      <input
        type="range"
        min="0"
        max="100"
        value={viewerState.screenVolume}
        onInput={(e) => setScreenVolume(parseInt(e.currentTarget.value))}
        class="w-20 h-1 bg-white/30 rounded-full appearance-none cursor-pointer
               [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
               [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
               [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform
               [&::-webkit-slider-thumb]:hover:scale-125
               [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full
               [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0"
      />
    </div>
  );
};

export default ScreenShareViewer;
