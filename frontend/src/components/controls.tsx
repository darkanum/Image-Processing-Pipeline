import type { ChangeEvent } from "react";

/** Tiny labeled number input with min/max/step. */
export const NumberField = ({
  label,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  suffix,
}: {
  label: string;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  suffix?: string;
}): JSX.Element => {
  const handle = (e: ChangeEvent<HTMLInputElement>): void => {
    const raw = e.target.value;
    if (raw === "") {
      onChange(undefined);
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) onChange(n);
  };
  return (
    <label className="num-field">
      <span className="num-label">{label}</span>
      <span className="num-input-wrap">
        <input
          type="number"
          value={value === undefined ? "" : value}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          onChange={handle}
        />
        {suffix && <span className="num-suffix">{suffix}</span>}
      </span>
    </label>
  );
};

/** Checkbox row with a label. */
export const ToggleRow = ({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (b: boolean) => void;
  hint?: string;
}): JSX.Element => (
  <label className="toggle-row">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span className="toggle-label">{label}</span>
    {hint && <span className="toggle-hint">{hint}</span>}
  </label>
);

/** Section wrapper with collapsible body. */
export const Section = ({
  title,
  open,
  onToggle,
  children,
  badge,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  badge?: string;
}): JSX.Element => (
  <div className={`section ${open ? "section-open" : ""}`}>
    <button type="button" className="section-head" onClick={onToggle}>
      <span className="section-title">{title}</span>
      {badge && <span className="section-badge">{badge}</span>}
      <span className="section-caret">{open ? "▾" : "▸"}</span>
    </button>
    {open && <div className="section-body">{children}</div>}
  </div>
);

/** Range slider with current value readout. */
/**
 * Update the inline `--range-fill` CSS variable on a range input so the
 * filled portion of the track is colored. Called from `onInput` (every
 * change, not just committed changes) so the fill animates with the thumb.
 */
const setRangeFill = (el: HTMLInputElement): void => {
  const min = Number(el.min) || 0;
  const max = Number(el.max) || 100;
  const val = Number(el.value);
  const pct = max === min ? 50 : ((val - min) / (max - min)) * 100;
  el.style.setProperty("--range-fill", `${Math.max(0, Math.min(100, pct))}%`);
};

export const Slider = ({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit = "",
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}): JSX.Element => {
  const pct = max === min ? 50 : ((value - min) / (max - min)) * 100;
  return (
    <label className="slider">
      <span className="slider-label">
        {label} <span className="slider-value">{value}{unit}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        style={{ ["--range-fill" as string]: `${Math.max(0, Math.min(100, pct))}%` }}
        onInput={(e) => setRangeFill(e.currentTarget)}
        onChange={(e) => {
          setRangeFill(e.currentTarget);
          onChange(Number(e.target.value));
        }}
      />
    </label>
  );
};
