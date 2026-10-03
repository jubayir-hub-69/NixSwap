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
        void: "var(--void)",
        ink: "var(--ink)",
        panel: "var(--panel)",
        mist: "var(--mist)",
        frost: "var(--frost)",
        "cyan-glow": "var(--cyan-glow)",
        "cyan-deep": "var(--cyan-deep)",
        violet: "var(--violet)",
      },
      boxShadow: {
        glow: "0 0 36px rgba(62, 240, 255, 0.38)",
        card: "0 30px 80px rgba(2, 6, 18, 0.45)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
    },
  },
};

export default config;
