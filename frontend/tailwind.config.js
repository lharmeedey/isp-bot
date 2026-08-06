/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Vibrant telecom palette. `brand` is teal so every existing brand-*
        // class reskins automatically; `accent` is a warm amber highlight.
        brand: {
          50:  '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
        },
        accent: {
          50:  '#fffbeb',
          100: '#fef3c7',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow:  '0 10px 40px -12px rgba(13, 148, 136, 0.45)',
        card:  '0 1px 3px rgba(15, 23, 42, 0.06), 0 8px 24px -12px rgba(15, 23, 42, 0.12)',
        float: '0 20px 50px -20px rgba(13, 148, 136, 0.35)',
      },
      backgroundImage: {
        'brand-gradient':  'linear-gradient(135deg, #0d9488 0%, #10b981 100%)',
        'brand-radial':    'radial-gradient(1200px circle at 0% 0%, rgba(13,148,136,0.12), transparent 40%), radial-gradient(1000px circle at 100% 0%, rgba(16,185,129,0.10), transparent 45%)',
        'mesh':            'radial-gradient(at 20% 20%, rgba(20,184,166,0.18) 0px, transparent 50%), radial-gradient(at 80% 0%, rgba(16,185,129,0.14) 0px, transparent 50%), radial-gradient(at 100% 80%, rgba(245,158,11,0.10) 0px, transparent 50%)',
      },
      keyframes: {
        'fade-up':  { '0%': { opacity: '0', transform: 'translateY(12px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        shimmer:    { '100%': { transform: 'translateX(100%)' } },
        float:      { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-8px)' } },
      },
      animation: {
        'fade-up': 'fade-up 0.5s ease-out both',
        float:     'float 6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
