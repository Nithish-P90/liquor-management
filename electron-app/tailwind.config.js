/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'slate-750': '#1e293b',
        'slate-850': '#0f172a',
      },
    },
  },
  plugins: [],
}
