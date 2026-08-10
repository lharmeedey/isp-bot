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
        // Quickxilver brand system — black-dominant, gold-forward, deep-teal as a
        // whisper accent (70% black / 15% gold / 10% ivory / 5% teal). `brand` is the
        // GOLD ramp so every existing brand-* class reskins to gold automatically;
        // `accent` is deep teal (the 5% secondary); `slate` is overridden to a warm
        // obsidian↔ivory neutral so surfaces/borders/text warm in one shot.
        brand: {
          50:  '#FBF6E9',
          100: '#F6E7C2',
          200: '#EED79B',
          300: '#E6C46E',
          400: '#DDAE49',
          500: '#D9A441', // Rich Gold — strong accent
          600: '#B4831F',
          700: '#9A681F', // Bronze Gold — secondary gold
          800: '#6E4C18',
          900: '#5A4018', // Dark Gold — gradient shadow
          champagne: '#F1C77D', // primary gold / highlights
          bright:    '#FFD45A', // high-energy highlights
        },
        accent: {
          50:  '#E7F2EE',
          100: '#C4E0D8',
          400: '#2FA98C',
          500: '#0E7C63',
          600: '#0A5E4B',
          900: '#033128', // Deep Teal
        },
        // Warm neutral ramp (overrides Tailwind's cool default slate). Luminance
        // order preserved rung-for-rung so every slate-*/dark:slate-* usage keeps its
        // contrast relationships while shifting from cool grey to warm obsidian/ivory.
        slate: {
          50:  '#F7F5EA', // Ivory White — main text (on dark) / page bg (on light)
          100: '#E8E8E4', // Soft White — secondary text
          200: '#DCDAD0',
          300: '#C4C2B8',
          400: '#A6A49A',
          500: '#8D908B', // Muted Gray — supporting text
          600: '#5F615C',
          700: '#3A3C39',
          800: '#1B1C1A',
          900: '#111111', // Carbon Black — cards / panels
          950: '#050505', // Obsidian Black — main background
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow:  '0 10px 40px -12px rgba(217, 164, 65, 0.40)',
        card:  '0 1px 3px rgba(5, 5, 5, 0.06), 0 8px 24px -12px rgba(5, 5, 5, 0.14)',
        float: '0 20px 50px -20px rgba(154, 104, 31, 0.35)',
      },
      backgroundImage: {
        // Champagne → Rich → Bronze gold. The signature Quickxilver gradient, used on
        // every large brand surface (auth asides, hero, buttons). Carries near-black text.
        'brand-gradient':  'linear-gradient(135deg, #F1C77D 0%, #D9A441 55%, #9A681F 100%)',
        'brand-radial':    'radial-gradient(1200px circle at 0% 0%, rgba(217,164,65,0.12), transparent 40%), radial-gradient(1000px circle at 100% 0%, rgba(154,104,31,0.10), transparent 45%)',
        'mesh':            'radial-gradient(at 20% 20%, rgba(241,199,125,0.16) 0px, transparent 50%), radial-gradient(at 80% 0%, rgba(217,164,65,0.12) 0px, transparent 50%), radial-gradient(at 100% 80%, rgba(3,49,40,0.10) 0px, transparent 50%)',
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
