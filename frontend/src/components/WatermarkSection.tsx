import type { WatermarkSpec, WatermarkKind, WatermarkPosition } from "../types/job";
import { DEFAULT_WATERMARK_BACKGROUND, POSITION_GRID } from "../types/job";
import { NumberField, Slider, ToggleRow } from "./controls";

interface WatermarkSectionProps {
  /**
   * `null` means the user has not enabled a watermark. Editing a control
   * in the section flips it on with a default spec.
   */
  value: WatermarkSpec | null;
  onChange: (next: WatermarkSpec | null) => void;
}

/** A safe default to start from when the user first touches a control. */
const FALLBACK: WatermarkSpec = {
  kind: "text",
  text: "watermark",
  position: "bottom-right",
  margin: 24,
  opacity: 70,
  size: 32,
  background: { ...DEFAULT_WATERMARK_BACKGROUND },
};

/** Read a background field, falling back to the default if missing. */
const readBg = (spec: WatermarkSpec) => spec.background ?? DEFAULT_WATERMARK_BACKGROUND;

export const WatermarkSection = ({ value, onChange }: WatermarkSectionProps): JSX.Element => {
  const enabled = value !== null;
  const v: WatermarkSpec = value ?? FALLBACK;
  const bg = readBg(v);

  /** Apply a patch. If the section is currently disabled, enabling it
   * implicitly — the user is now actively editing. */
  const apply = (patch: Partial<WatermarkSpec>): void => {
    if (!enabled) onChange({ ...FALLBACK, ...patch });
    else onChange({ ...v, ...patch });
  };

  /** Apply a patch to the background sub-spec, preserving all other fields. */
  const applyBg = (patch: Partial<NonNullable<WatermarkSpec["background"]>>): void => {
    apply({ background: { ...bg, ...patch } });
  };

  const setEnabled = (on: boolean): void => {
    onChange(on ? { ...FALLBACK } : null);
  };

  // When the user toggles between text/image kind, swap the size default to
  // a sensible value for that kind — text wants a modest font (24-64px),
  // image wants a much bigger overlay (120-300px). Keeps the existing
  // size if the user has already tweaked it within a sensible band.
  const handleKind = (kind: WatermarkKind): void => {
    const next: Partial<WatermarkSpec> = { kind };
    if (kind === "image" && v.size < 80) next.size = 200;
    if (kind === "text" && v.size > 80) next.size = 32;
    apply(next);
  };

  return (
    <div className="watermark-grid">
      <div className="wm-enable-row">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Add a watermark
        </label>
      </div>

      <fieldset className="wm-controls" disabled={!enabled} aria-disabled={!enabled}>
        <div className="wm-type-row">
          <label className={`wm-type ${v.kind === "text" ? "active" : ""}`}>
            <input
              type="radio"
              name="wm-kind"
              checked={v.kind === "text"}
              onChange={() => handleKind("text")}
            />
            Text
          </label>
          <label className={`wm-type ${v.kind === "image" ? "active" : ""}`}>
            <input
              type="radio"
              name="wm-kind"
              checked={v.kind === "image"}
              onChange={() => handleKind("image")}
            />
            Image URL
          </label>
        </div>

        {v.kind === "text" ? (
          <label className="text-field">
            <span>Watermark text</span>
            <input
              type="text"
              value={v.text ?? ""}
              onChange={(e) => apply({ text: e.target.value })}
              placeholder="e.g. Mavis Pipeline"
              maxLength={512}
            />
          </label>
        ) : (
          <label className="text-field">
            <span>Image URL</span>
            <input
              type="url"
              value={v.imageUrl ?? ""}
              onChange={(e) => apply({ imageUrl: e.target.value })}
              placeholder="https://example.com/logo.png"
            />
          </label>
        )}

        <div className="wm-position-block">
          <span className="wm-position-label">Position</span>
          <div className="wm-grid" role="radiogroup" aria-label="Watermark position">
            {POSITION_GRID.map((cell) => (
              <button
                key={cell.value}
                type="button"
                role="radio"
                aria-checked={v.position === cell.value}
                className={`wm-cell ${v.position === cell.value ? "active" : ""}`}
                onClick={() => apply({ position: cell.value as WatermarkPosition })}
                title={cell.value}
              >
                {cell.label}
              </button>
            ))}
          </div>
        </div>

        <div className="dim-row">
          <NumberField
            label="Margin"
            value={v.margin}
            onChange={(n) => apply({ margin: n ?? 0 })}
            min={0}
            max={500}
            suffix="px"
          />
          <NumberField
            label={v.kind === "text" ? "Font size" : "Image width"}
            value={v.size}
            onChange={(n) => apply({ size: n ?? 24 })}
            min={v.kind === "text" ? 8 : 24}
            max={v.kind === "text" ? 200 : 2000}
            suffix="px"
          />
        </div>
        <div className="hint">
          {v.kind === "text"
            ? "Tip: 24-48 px reads well on most photos."
            : "Tip: 150-300 px makes the watermark clearly visible on photos ≥ 1000 px wide."}
        </div>

        <Slider
          label="Watermark opacity"
          value={v.opacity}
          onChange={(n) => apply({ opacity: n })}
          min={0}
          max={100}
          unit="%"
        />

        {/* ── Background controls ─────────────────────────────────── */}
        <div className="wm-bg-block">
          <div className="wm-bg-head">
            <span className="wm-bg-title">Backing rectangle</span>
            <span className="wm-bg-hint">
              Optional fill behind the watermark for legibility on busy backgrounds.
            </span>
          </div>
          <ToggleRow
            label="Add backing rectangle"
            checked={bg.enabled}
            onChange={(b) => applyBg({ enabled: b })}
            hint={bg.enabled ? "On" : "Off — watermark only, transparent around it"}
          />
          {bg.enabled && (
            <div className="wm-bg-controls">
              <label className="color-field">
                <span>Backing color</span>
                <div className="color-row">
                  <input
                    type="color"
                    value={bg.color}
                    onChange={(e) => applyBg({ color: e.target.value })}
                    aria-label="Backing color"
                  />
                  <input
                    type="text"
                    className="form-input color-hex"
                    value={bg.color}
                    onChange={(e) => {
                      const v = e.target.value;
                      // Only accept 7-char hex strings
                      if (/^#[0-9a-fA-F]{6}$/.test(v)) applyBg({ color: v });
                      else if (/^#[0-9a-fA-F]{0,6}$/.test(v)) applyBg({ color: v });
                    }}
                    maxLength={7}
                    spellCheck={false}
                  />
                </div>
              </label>
              <Slider
                label="Backing opacity"
                value={bg.opacity}
                onChange={(n) => applyBg({ opacity: n })}
                min={0}
                max={100}
                unit="%"
              />
              <Slider
                label="Backing padding"
                value={bg.padding}
                onChange={(n) => applyBg({ padding: n })}
                min={0}
                max={64}
                unit="px"
              />
            </div>
          )}
        </div>
      </fieldset>
    </div>
  );
};
