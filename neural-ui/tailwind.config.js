/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        neural: {
          primary: '#10B981',
          secondary: '#6366F1',
          accent: '#F59E0B',
          danger: '#EF4444',
          success: '#22C55E',
        },
      },
    },
  },
  plugins: [],
};
