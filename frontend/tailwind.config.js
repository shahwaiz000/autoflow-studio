export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter Variable", "system-ui", "sans-serif"] },
      colors: {
        navy: { 900: "#0a1030", 800: "#101a45", 700: "#18245a" },
        brand: { DEFAULT: "#5b5ff0", dark: "#4549d6", soft: "#eef0ff" },
      },
    },
  },
  plugins: [],
};
