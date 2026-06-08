/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "#7132f5",
          dark: "#5741d8",
          deep: "#5b1ecf",
          subtle: "rgba(133, 91, 251, 0.16)",
          foreground: "#ffffff",
        },
        secondary: {
          DEFAULT: "rgba(148, 151, 169, 0.08)",
          foreground: "#101114",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "#9497a9",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        success: {
          DEFAULT: "#149e61",
          subtle: "rgba(20, 158, 97, 0.16)",
          foreground: "#026b3f",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        kraken: {
          purple: "#7132f5",
          "purple-dark": "#5741d8",
          "purple-deep": "#5b1ecf",
          black: "#101114",
          gray: "#686b82",
          silver: "#9497a9",
          border: "#dedee5",
        },
      },
      borderRadius: {
        lg: "12px",
        md: "10px",
        sm: "8px",
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
        display: ["IBM Plex Sans", "Helvetica", "Arial", "sans-serif"],
      },
      boxShadow: {
        subtle: "rgba(0, 0, 0, 0.03) 0px 4px 24px",
        micro: "rgba(16, 24, 40, 0.04) 0px 1px 4px",
      },
    },
  },
  plugins: [],
}
