import type { Config } from 'tailwindcss';

// Flyover design tokens — taken from the product roadmap document.
// navy  #17324D  primary brand colour (headings, primary actions, nav)
// brick #B13A3E  accent (highlights, sub-headings, destructive emphasis)
// mist  #F5F8FA  page background / callout fill
// line  #D9E2EA  borders and dividers
// slate #67798A  muted text
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#EEF3F7',
          100: '#D6E1EB',
          200: '#AEC3D6',
          300: '#7F9DB9',
          400: '#4E7396',
          500: '#2C5276',
          600: '#1F4263',
          700: '#17324D',
          800: '#11263B',
          900: '#0B1A29',
        },
        brick: {
          50: '#FBEFEF',
          100: '#F4D6D7',
          200: '#E7ACAE',
          400: '#C8585C',
          500: '#B13A3E',
          600: '#962F33',
          700: '#7A2529',
        },
        mist: '#F5F8FA',
        line: '#D9E2EA',
        slate: { DEFAULT: '#67798A', light: '#8895A3' },
        success: { 50: '#ECF7F1', 600: '#1E7A4C', 700: '#17623D' },
        warning: { 50: '#FDF6E7', 600: '#9A6A0B', 700: '#7C5508' },
        info: { 50: '#EDF4FB', 600: '#2563A6' },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem' },
      boxShadow: {
        card: '0 1px 2px rgba(23,50,77,0.06), 0 1px 3px rgba(23,50,77,0.04)',
        pop: '0 12px 32px -8px rgba(23,50,77,0.25)',
      },
    },
  },
  plugins: [],
};
export default config;
