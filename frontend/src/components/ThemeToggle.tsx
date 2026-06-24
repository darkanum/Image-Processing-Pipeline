import { useTheme, type ThemeMode } from "../hooks/useTheme";

/** Maps a mode to a short label and icon for the cycle button. */
const MODE_META: Record<ThemeMode, { label: string; icon: JSX.Element }> = {
  system: {
    label: "Auto (system)",
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <rect x="2" y="3" width="12" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5 13h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  light: {
    label: "Light",
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <circle cx="8" cy="8" r="3" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M8 1.5v1.5" />
          <path d="M8 13v1.5" />
          <path d="M1.5 8h1.5" />
          <path d="M13 8h1.5" />
          <path d="M3.3 3.3l1 1" />
          <path d="M11.7 11.7l1 1" />
          <path d="M3.3 12.7l1-1" />
          <path d="M11.7 4.3l1-1" />
        </g>
      </svg>
    ),
  },
  dark: {
    label: "Dark",
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <path
          d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"
          fill="currentColor"
        />
      </svg>
    ),
  },
};

/**
 * Cycle button: clicking steps through system → light → dark → system.
 * Each step persists to localStorage and re-applies the theme to <html>.
 */
export const ThemeToggle = (): JSX.Element => {
  const { mode, cycle } = useTheme();
  const meta = MODE_META[mode];
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      aria-label={`Theme: ${meta.label}. Click to cycle.`}
      title={`Theme: ${meta.label} — click to change`}
    >
      {meta.icon}
      <span className="theme-toggle-label">{meta.label}</span>
    </button>
  );
};
