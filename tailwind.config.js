/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./context/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          page: "var(--color-surface-page)",
          card: "var(--color-surface-card)",
          subtle: "var(--color-surface-subtle)",
          muted: "var(--color-surface-muted)",
          inverse: "var(--color-surface-inverse)",
        },
        fg: {
          primary: "var(--color-text-primary)",
          default: "var(--color-text-default)",
          secondary: "var(--color-text-secondary)",
          disabled: "var(--color-text-disabled)",
          link: "var(--color-text-link)",
          inverse: "var(--color-text-inverse)",
        },
        line: {
          subtle: "var(--color-border-subtle)",
          default: "var(--color-border-default)",
          muted: "var(--color-border-muted)",
          focus: "var(--color-border-focus)",
        },
        primary: {
          DEFAULT: "var(--color-interactive-primary)",
          hover: "var(--color-interactive-primary-hover)",
          pressed: "var(--color-interactive-primary-pressed)",
          fg: "var(--color-interactive-primary-foreground)",
          subtle: "var(--color-interactive-primary-subtle)",
        },
        secondary: {
          DEFAULT: "var(--color-interactive-secondary)",
          hover: "var(--color-interactive-secondary-hover)",
          pressed: "var(--color-interactive-secondary-pressed)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          hover: "var(--color-accent-hover)",
          pressed: "var(--color-accent-pressed)",
          fg: "var(--color-accent-foreground)",
          subtle: "var(--color-accent-subtle)",
        },
        success: { DEFAULT: "var(--color-feedback-success)", bg: "var(--color-feedback-success-bg)" },
        warning: { DEFAULT: "var(--color-feedback-warning)", bg: "var(--color-feedback-warning-bg)" },
        error: { DEFAULT: "var(--color-feedback-error)", bg: "var(--color-feedback-error-bg)" },
        info: { DEFAULT: "var(--color-feedback-info)", bg: "var(--color-feedback-info-bg)" },
      },
      borderRadius: {
        none: "var(--radius-none)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        pill: "var(--radius-pill)",
        full: "var(--radius-full)",
      },
      fontFamily: {
        sans: ["Schibsted Grotesk", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
