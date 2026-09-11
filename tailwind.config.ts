import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        solar: "#f5a623",
        grid: "#2b6cb0",
        leaf: "#38a169",
      },
    },
  },
  plugins: [],
};

export default config;
