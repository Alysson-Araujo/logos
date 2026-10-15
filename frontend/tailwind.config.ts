import type { Config } from 'tailwindcss';

import animate from 'tailwindcss-animate';

/**
 * Tokens declarados em `src/styles/tokens.css` (custom properties).
 * Nenhum componente usa cor literal: tudo passa por estas classes semânticas.
 */
const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: {
          DEFAULT: 'var(--color-surface)',
          raised: 'var(--color-surface-raised)',
          sunken: 'var(--color-surface-sunken)',
        },
        border: {
          DEFAULT: 'var(--color-border)',
          strong: 'var(--color-border-strong)',
        },
        fg: {
          DEFAULT: 'var(--color-fg)',
          muted: 'var(--color-fg-muted)',
          subtle: 'var(--color-fg-subtle)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          fg: 'var(--color-accent-fg)',
        },
        overlay: 'var(--color-overlay)',
        danger: {
          DEFAULT: 'var(--color-danger)',
          soft: 'var(--color-danger-soft)',
          text: 'var(--color-danger-text)',
          fg: 'var(--color-danger-fg)',
        },
        success: {
          DEFAULT: 'var(--color-success)',
          soft: 'var(--color-success-soft)',
          text: 'var(--color-success-text)',
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          soft: 'var(--color-warning-soft)',
          text: 'var(--color-warning-text)',
        },
        info: {
          DEFAULT: 'var(--color-info)',
          soft: 'var(--color-info-soft)',
          text: 'var(--color-info-text)',
        },
        'crit-alta': 'var(--color-crit-alta)',
        'crit-alta-soft': 'var(--color-crit-alta-soft)',
        'crit-alta-text': 'var(--color-crit-alta-text)',
        'crit-media': 'var(--color-crit-media)',
        'crit-media-soft': 'var(--color-crit-media-soft)',
        'crit-media-text': 'var(--color-crit-media-text)',
        'crit-baixa': 'var(--color-crit-baixa)',
        'crit-baixa-soft': 'var(--color-crit-baixa-soft)',
        'crit-baixa-text': 'var(--color-crit-baixa-text)',
        'status-aberto': 'var(--color-status-aberto)',
        'status-aberto-soft': 'var(--color-status-aberto-soft)',
        'status-aberto-text': 'var(--color-status-aberto-text)',
        'status-investigacao': 'var(--color-status-investigacao)',
        'status-investigacao-soft': 'var(--color-status-investigacao-soft)',
        'status-investigacao-text': 'var(--color-status-investigacao-text)',
        'status-fechado': 'var(--color-status-fechado)',
        'status-fechado-soft': 'var(--color-status-fechado-soft)',
        'status-fechado-text': 'var(--color-status-fechado-text)',
        'status-inconclusivo': 'var(--color-status-inconclusivo)',
        'status-inconclusivo-soft': 'var(--color-status-inconclusivo-soft)',
        'status-inconclusivo-text': 'var(--color-status-inconclusivo-text)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      // Escala tipográfica do plano: 12 / 13 / 14 / 16 / 20 / 24 / 32.
      fontSize: {
        '2xs': ['12px', { lineHeight: '16px' }],
        xs: ['13px', { lineHeight: '18px' }],
        sm: ['14px', { lineHeight: '20px' }],
        base: ['16px', { lineHeight: '24px' }],
        lg: ['20px', { lineHeight: '28px' }],
        xl: ['24px', { lineHeight: '32px' }],
        '2xl': ['32px', { lineHeight: '40px' }],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        e1: 'var(--shadow-e1)',
        e2: 'var(--shadow-e2)',
        e3: 'var(--shadow-e3)',
      },
      transitionTimingFunction: {
        panel: 'var(--motion-ease)',
      },
      transitionDuration: {
        hover: 'var(--motion-hover)',
        panel: 'var(--motion-panel)',
      },
      keyframes: {
        'row-flash': {
          '0%': { backgroundColor: 'var(--color-success-soft)' },
          '100%': { backgroundColor: 'transparent' },
        },
        'bar-slide': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'row-flash': 'row-flash 1200ms var(--motion-ease)',
        'bar-slide': 'bar-slide 1200ms linear infinite',
      },
    },
  },
  plugins: [animate],
};

export default config;
