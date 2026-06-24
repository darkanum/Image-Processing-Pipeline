import { useApiHealth } from "../hooks/useApiHealth";

/**
 * A tiny status pill for the header. The intent is "is the system
 * alive?" — degraded + unknown are the actionable states.
 */
export const HealthIndicator = (): JSX.Element => {
  const { status, latencyMs, checkedAt } = useApiHealth();

  const colorMap: Record<typeof status, string> = {
    ok: "var(--success, #16a34a)",
    degraded: "#d97706",
    unknown: "#9ca3af",
  };
  const labelMap: Record<typeof status, string> = {
    ok: "API ready",
    degraded: "API degraded",
    unknown: "API checking…",
  };

  const tooltip = [
    labelMap[status],
    latencyMs != null ? `${latencyMs}ms` : null,
    checkedAt != null ? new Date(checkedAt).toLocaleTimeString() : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="health-indicator"
      role="status"
      aria-live="polite"
      aria-label={`Backend ${labelMap[status]}`}
      title={tooltip}
    >
      <span
        className="health-dot"
        style={{ background: colorMap[status] }}
        aria-hidden="true"
      />
      <span className="health-label">{labelMap[status]}</span>
    </div>
  );
};
