export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["IBM Plex Sans Variable", "system-ui", "sans-serif"] },
      colors: {
        navy: { 950: "#07121e", 900: "#0b1a2b", 800: "#13263d", 700: "#1d3552" },
        brand: { DEFAULT: "#2b50d8", dark: "#1e3db0", soft: "#edf1fd" },
        canvas: "#f3f5f7",
        mint: { DEFAULT: "#12a37f", dark: "#0a7c60", soft: "#e3f5ee" },
        coral: { DEFAULT: "#e5484d", dark: "#b8292e", soft: "#fdecec" },
        sun: { DEFAULT: "#e8930c", dark: "#945700", soft: "#fff2d9" },
      },
      boxShadow: {
        card: "0 0 0 1px rgba(11, 26, 43, 0.06), 0 1px 2px rgba(11, 26, 43, 0.04), 0 10px 24px -14px rgba(11, 26, 43, 0.14)",
        lift: "0 0 0 1px rgba(11, 26, 43, 0.06), 0 2px 4px rgba(11, 26, 43, 0.05), 0 14px 30px -12px rgba(11, 26, 43, 0.22)",
      },
      keyframes: {
        ring: { from: { strokeDashoffset: "var(--ring-len)" }, to: { strokeDashoffset: "0" } },
        pulseDot: { "0%,100%": { opacity: "1", transform: "scale(1)" }, "50%": { opacity: ".45", transform: "scale(1.5)" } },
        slideIn: { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(0)" } },
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        tickIn: { from: { transform: "scaleY(0.15)", opacity: "0" }, to: { transform: "scaleY(1)", opacity: "1" } },
      },
      animation: {
        ring: "ring 1.1s cubic-bezier(.22,.8,.3,1) both",
        pulseDot: "pulseDot 1.6s ease-in-out infinite",
        slideIn: "slideIn .22s ease-out both",
        fadeIn: "fadeIn .4s ease-out .9s both",
        tickIn: "tickIn .45s cubic-bezier(.2,.8,.3,1) both",
      },
    },
  },
  plugins: [],
};
