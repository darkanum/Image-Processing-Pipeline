import type { WatermarkSpec, WatermarkKind, WatermarkPosition } from "../types/job";
import { POSITION_GRID } from "../types/job";
import { NumberField, Slider } from "./controls";

interface WatermarkSectionProps {
  value: WatermarkSpec;
  onChange: (next: WatermarkSpec) => void;
}

export const WatermarkSection = ({ value, onChange }: WatermarkSectionProps): JSX.Element => {
  const update = (patch: Partial<WatermarkSpec>): void => {
    onChange({ ...value, ...patch });
  };

  return (
    <div className="watermark-grid">
      <div className="wm-type-row">
        <label className={`wm-type ${value.kind === "text" ? "active" : ""}`}>
          <input
            type="radio"
            name="wm-kind"
            checked={value.kind === "text"}
            onChange={() => update({ kind: "text" as WatermarkKind })}
          />
          Text
        </label>
        <label className={`wm-type ${value.kind === "image" ? "active" : ""}`}>
          <input
            type="radio"
            name="wm-kind"
            checked={value.kind === "image"}
            onChange={() => update({ kind: "image" as WatermarkKind })}
          />
          Image URL
        </label>
      </div>

      {value.kind === "text" ? (
        <label className="text-field">
          <span>Watermark text</span>
          <input
            type="text"
            value={value.text ?? ""}
            onChange={(e) => update({ text: e.target.value })}
            placeholder="e.g. Mavis Pipeline"
            maxLength={512}
          />
        </label>
      ) : (
        <label className="text-field">
          <span>Image URL</span>
          <input
            type="url"
            value={value.imageUrl ?? ""}
            onChange={(e) => update({ imageUrl: e.target.value })}
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
              aria-checked={value.position === cell.value}
              className={`wm-cell ${value.position === cell.value ? "active" : ""}`}
              onClick={() => update({ position: cell.value as WatermarkPosition })}
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
          value={value.margin}
          onChange={(n) => update({ margin: n ?? 0 })}
          min={0}
          max={500}
          suffix="px"
        />
        <NumberField
          label={value.kind === "text" ? "Font size" : "Image width"}
          value={value.size}
          onChange={(n) => update({ size: n ?? 24 })}
          min={8}
          max={2000}
          suffix="px"
        />
      </div>

      <Slider
        label="Watermark opacity"
        value={value.opacity}
        onChange={(n) => update({ opacity: n })}
        min={0}
        max={100}
        unit="%"
      />
    </div>
  );
};
