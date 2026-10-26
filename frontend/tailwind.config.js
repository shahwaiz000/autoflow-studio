export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter Variable", "system-ui", "sans-serif"] },
      colors: {
        navy: { 900: "#0a1030", 800: "#101a45", 700: "#18245a" },
        brand: { DEFAULT: "#5b5ff0", dark: "#4549d6", soft: "#eef0ff" },
        canvas: "#f3f4fa",
        mint: { DEFAULT: "#14b88a", dark: "#0b8f69", soft: "#e4f7f0" },
        coral: { DEFAULT: "#ee5a5f", dark: "#c93c41", soft: "#fdeced" },
        sun: { DEFAULT: "#f4a62a", dark: "#b56f00", soft: "#fff3dc" },
      },
      boxShadow: {
        card: "0 1px 2px rgba(10, 16, 48, 0.04), 0 4px 16px -8px rgba(10, 16, 48, 0.10)",
        lift: "0 2px 4px rgba(10, 16, 48, 0.05), 0 12px 28px -12px rgba(10, 16, 48, 0.18)",
      },
      keyframes: {
        ring: { from: { strokeDashoffset: "var(--ring-len)" }, to: { strokeDashoffset: "0" } },
        pulseDot: { "0%,100%": { opacity: "1", transform: "scale(1)" }, "50%": { opacity: ".45", transform: "scale(1.5)" } },
        slideIn: { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(0)" } },
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
      },
      animation: {
        ring: "ring 1.1s cubic-bezier(.22,.8,.3,1) both",
        pulseDot: "pulseDot 1.6s ease-in-out infinite",
        slideIn: "slideIn .22s ease-out both",
        fadeIn: "fadeIn .4s ease-out .9s both",
      },
    },
  },
  plugins: [],
};
