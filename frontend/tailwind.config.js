/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#ecfdf3",
          100: "#d1fadf",
          500: "#22a45d",
          600: "#1a8a4c",
          700: "#156f3e",
        },
        ink: {
          900: "#111827",
          700: "#374151",
          500: "#6b7280",
          400: "#9ca3af",
          200: "#e5e7eb",
          100: "#f3f4f6",
          50: "#f9fafb",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.10)",
      },
    },
  },
  plugins: [],
};
