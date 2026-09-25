// Same palette as `app/globals.css`. `@config` in that file loads this module.
const config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./hooks/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        void: "#05060a",
        ink: "#090d14",
        panel: "#121a24",
        mist: "#93a4b8",
        frost: "#e8f4fb",
        "cyan-glow": "#3ef0ff",
        "cyan-deep": "#0e7490",
        violet: "#7c5cff",
      },
      boxShadow: {
        glow: "0 0 48px rgba(62, 240, 255, 0.18)",
        card: "0 30px 80px rgba(0, 0, 0, 0.45)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
    },
  },
};

export default config;
