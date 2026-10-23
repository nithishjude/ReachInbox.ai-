/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Semantic tokens: values live in index.css and flip for dark mode.
        canvas: v("canvas"),
        surface: v("surface"),
        subtle: v("subtle"),
        line: v("line"),
        fg: { DEFAULT: v("fg"), muted: v("fg-muted"), subtle: v("fg-subtle") },
        brand: {
          // Figma palette
          50: "#eaf6ee",
          100: "#d4f0dd",
          300: "#7fd39b",
          400: "#2fbf63",
          500: "#00b043",
          600: "#00a63e",
          700: "#008a34",
          900: "#004d1d",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        pixel: ["Silkscreen", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgb(16 24 40 / 0.04), 0 1px 3px rgb(16 24 40 / 0.06)",
        pop: "0 12px 32px -8px rgb(16 24 40 / 0.18), 0 4px 8px -4px rgb(16 24 40 / 0.08)",
      },
      keyframes: {
        "fade-in": { from: { opacity: 0 }, to: { opacity: 1 } },
        "slide-up": { from: { opacity: 0, transform: "translateY(8px)" }, to: { opacity: 1, transform: "translateY(0)" } },
        "slide-in-right": { from: { transform: "translateX(100%)" }, to: { transform: "translateX(0)" } },
        "scale-in": { from: { opacity: 0, transform: "scale(.97)" }, to: { opacity: 1, transform: "scale(1)" } },
      },
      animation: {
        "fade-in": "fade-in .15s ease-out",
        "slide-up": "slide-up .2s ease-out",
        "slide-in-right": "slide-in-right .25s cubic-bezier(.2,.8,.2,1)",
        "scale-in": "scale-in .15s ease-out",
      },
    },
  },
  plugins: [],
};
