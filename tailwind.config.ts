import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#fdf3f4",
          100: "#fbe1e3",
          200: "#f5bdc1",
          300: "#ed8d93",
          400: "#dc5f66",
          500: "#c03d44",
          600: "#A4262C",
          700: "#8a1f24",
          800: "#6f1a1f",
          900: "#4d1216",
        },
        accent: {
          50:  "#fdf8ec",
          100: "#fbeec6",
          400: "#e6b430",
          500: "#d4a017",
          600: "#b88712",
        },
        canvas: "#F8FAFC",
      },
      boxShadow: {
        card:      "0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)",
        cardHover: "0 4px 12px rgba(15, 23, 42, 0.08)",
      },
    },
  },
  plugins: [],
};
export default config;
