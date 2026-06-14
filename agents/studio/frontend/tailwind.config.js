/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Vireo design tokens — see docs/DESIGN.md.
        bg: {
          0: '#09090b',
          1: '#111114',
          2: '#18181c',
          3: '#202026',
          4: '#2a2a31',
        },
        border: {
          1: '#1f1f24',
          2: '#2a2a30',
          3: '#3a3a42',
        },
        ink: {
          1: '#fafafa',
          2: '#a1a1aa',
          3: '#6b6b75',
          4: '#4a4a52',
        },
        accent: {
          DEFAULT: '#6366f1',
          h: '#7c7ff5',
        },
        rec: '#ef4444',
        success: '#10b981',
        warn: '#f59e0b',
        danger: '#ef4444',
        info: '#3b82f6',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', 'monospace'],
        display: ['Inter Display', 'Inter', 'system-ui', 'sans-serif'],
      },
      transitionTimingFunction: {
        vireo: 'cubic-bezier(0.2, 0, 0, 1)',
      },
      keyframes: {
        'pulse-rec': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        'msg-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'typing-dot': {
          '0%, 60%, 100%': { opacity: '0.3', transform: 'translateY(0)' },
          '30%': { opacity: '1', transform: 'translateY(-4px)' },
        },
      },
      animation: {
        'pulse-rec': 'pulse-rec 1.4s ease-in-out infinite',
        'msg-in': 'msg-in 320ms cubic-bezier(0.2, 0, 0, 1)',
        'typing-dot': 'typing-dot 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
