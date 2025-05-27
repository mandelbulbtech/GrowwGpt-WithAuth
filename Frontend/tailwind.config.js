/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        groww: {
          green: '#00d09c',
          blue: '#5367ff',
          black: '#44475b',
          gray: '#b5b5b5',
          background: '#f9f9f9',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        soehne: ['Soehne', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
} 