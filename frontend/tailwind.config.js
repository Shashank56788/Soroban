/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#060814',
          card: '#121424',
          primary: '#6366F1', // Indigo
          accent: '#A855F7', // Purple
          success: '#10B981', // Emerald
          warning: '#F59E0B', // Amber
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
