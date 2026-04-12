/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#d9e4ff",
          200: "#b8cdff",
          300: "#8daaff",
          400: "#5f80ff",
          500: "#3b5bfd",
          600: "#2940e5",
          700: "#2030b8",
          800: "#1c2a8f",
          900: "#1b2872",
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
