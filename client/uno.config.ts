import { defineConfig, presetUno, presetIcons } from "unocss";

export default defineConfig({
  presets: [
    presetUno(),
    presetIcons({
      scale: 1.2,
      cdn: "https://esm.sh/",
    }),
  ],
  theme: {
    colors: {
      // New "Focused Hybrid" Theme - Modern Dark Mode
      surface: {
        base: "#1E1E2E",      // Deepest background (app frame)
        layer1: "#252535",    // Server rail / Message list background
        layer2: "#2A2A3C",    // Sidebar / Panels
        highlight: "#36364D", // Hover states / Active items
      },
      text: {
        primary: "#ECEFF4",   // High readability
        secondary: "#9CA3AF", // Metadata, timestamps
      },
      accent: {
        primary: "#88C0D0",   // Buttons, Active Indicators
        danger: "#BF616A",    // Destructive, Mute/Deafen
      },
      // Legacy compatibility (will be phased out)
      primary: {
        DEFAULT: "#88C0D0",
        hover: "#6FA8B8",
      },
      background: {
        primary: "#252535",
        secondary: "#2A2A3C",
        tertiary: "#1E1E2E",
      },
      success: "#A3BE8C",
      warning: "#EBCB8B",
      danger: "#BF616A",
    },
  },
  shortcuts: {
    // Buttons
    "btn": "px-4 py-2 rounded-xl font-medium transition-all duration-200",
    "btn-primary": "btn bg-accent-primary hover:bg-accent-primary/80 text-surface-base",
    "btn-danger": "btn bg-accent-danger hover:bg-accent-danger/80 text-white",

    // Input fields
    "input-field": "w-full px-3 py-2 bg-surface-layer2 rounded-xl text-text-primary outline-none focus:ring-2 focus:ring-accent-primary/50 border border-white/5",

    // Panels and Cards
    "panel": "bg-surface-layer2 rounded-xl border border-white/5",
    "card": "bg-surface-layer1 rounded-xl p-4 hover:bg-surface-highlight transition-colors",

    // Interactive items
    "item-hover": "rounded-xl px-2 py-1 hover:bg-white/5 transition-colors cursor-pointer",

    // Animations
    "animate-slide-up": "animate-[slideUp_0.2s_ease-out]",
  },
  safelist: ["animate-slide-up"],
  rules: [
    [/^animate-\[slideUp/, () => ({
      "@keyframes slideUp": `{
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }`,
      animation: "slideUp 0.2s ease-out",
    })],
  ],
});
