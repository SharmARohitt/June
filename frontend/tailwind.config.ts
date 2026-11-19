import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        obsidian: {
          950: "#080B10",
          900: "#0B0F15",
          850: "#10151D",
          800: "#171F29",
          700: "#1C2632",
          600: "#243040",
          500: "#2E3C4E",
        },
        lime: {
          DEFAULT: "#D6FF76",
          soft: "#E6FFAC",
          dim: "#A9CC5C",
        },
        cyan: {
          DEFAULT: "#67D9E8",
          dim: "#3DA6B5",
        },
        ink: {
          DEFAULT: "#F4F5F7",
          muted: "#AAB4C0",
          faint: "#6C7887",
        },
        signal: {
          red: "#FF6B81",
          amber: "#FFB86B",
          violet: "#B69CFF",
          green: "#8BE28B",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular"],
      },
      borderRadius: {
        xl: "16px",
        "2xl": "22px",
        "3xl": "30px",
      },
      boxShadow: {
        lift: "0 24px 60px -30px rgba(0,0,0,0.85)",
        glow: "0 0 0 1px rgba(214,255,118,0.18), 0 18px 60px -24px rgba(214,255,118,0.35)",
        inset: "inset 0 1px 0 rgba(255,255,255,0.04)",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px)",
        "radial-glow":
          "radial-gradient(60% 60% at 50% 0%, rgba(103,217,232,0.12), transparent 70%)",
      },
      animation: {
        "pulse-dot": "pulseDot 2s ease-in-out infinite",
        shimmer: "shimmer 2.4s linear infinite",
        float: "float 7s ease-in-out infinite",
        "spin-slow": "spin 14s linear infinite",
        "scan-line": "scanLine 6s linear infinite",
      },
      keyframes: {
        pulseDot: {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.35", transform: "scale(0.82)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-700px 0" },
          "100%": { backgroundPosition: "700px 0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-9px)" },
        },
        scanLine: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(500%)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
