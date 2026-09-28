/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F8FAFC',
        brand: {
          50: '#EEF4FF',
          100: '#DCE7FE',
          200: '#BFD3FE',
          300: '#93B4FD',
          400: '#6090FA',
          500: '#3B6DF6',
          600: '#2551EB',
          700: '#1D3FD8',
          800: '#1E35AF',
          900: '#1E318A',
        },
        up: { DEFAULT: '#10B981', soft: '#ECFDF5', deep: '#047857' },
        down: { DEFAULT: '#F43F5E', soft: '#FFF1F2', deep: '#BE123C' },
      },
      fontFamily: {
        // System stack on purpose: no external font requests, so the UI renders
        // identically offline, in previews, and in production.
        sans: [
          'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto',
          'Helvetica Neue', 'Arial', 'Noto Sans', 'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px -4px rgba(15,23,42,0.06)',
        lift: '0 4px 12px rgba(15,23,42,0.06), 0 16px 40px -12px rgba(15,23,42,0.14)',
        glass: '0 8px 32px rgba(15,23,42,0.08)',
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem', '3xl': '1.5rem' },
      spacing: {
        // The default scale has no 4.5 or 13, and both are used in the UI kit.
        // Without these the classes silently generate nothing and icons blow up.
        4.5: '1.125rem',
        13: '3.25rem',
        18: '4.5rem',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'slide-up': { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        'scale-in': { from: { opacity: 0, transform: 'scale(0.97)' }, to: { opacity: 1, transform: 'scale(1)' } },
        'pulse-soft': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.55 } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out both',
        'slide-up': 'slide-up 0.32s cubic-bezier(0.22,1,0.36,1) both',
        'scale-in': 'scale-in 0.18s ease-out both',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
