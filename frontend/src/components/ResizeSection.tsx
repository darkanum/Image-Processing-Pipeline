import type { ResizeSpec, ResizeMode } from "../types/job";
import { ASPECT_RATIOS, RESOLUTION_PRESETS, type AspectRatioKey, type ResolutionPresetKey } from "../types/job";
import { NumberField, ToggleRow } from "./controls";

interface ResizeSectionProps {
  value: ResizeSpec;
  onChange: (next: ResizeSpec) => void;
}

export const ResizeSection = ({ value, onChange }: ResizeSectionProps): JSX.Element => {
  const update = (patch: Partial<ResizeSpec>): void => {
    onChange({ ...value, ...patch });
  };

  const handlePreset = (key: string): void => {
    if (key === "__none__") {
      onChange({ ...value, preset: undefined, width: undefined, height: undefined, mode: "fit" });
      return;
    }
    const preset = RESOLUTION_PRESETS[key as ResolutionPresetKey];
    if (!preset) return;
    onChange({
      ...value,
      preset: key,
      width: preset.width,
      height: preset.height,
      aspectRatio: undefined,
      mode: "fit",
      lockAspectRatio: true,
    });
  };

  const handleAspect = (key: string): void => {
    if (key === "__none__") {
      onChange({ ...value, aspectRatio: undefined });
      return;
    }
    onChange({ ...value, aspectRatio: key });
  };

  return (
    <div className="resize-grid">
      <label className="select">
        <span>Mode</span>
        <select
          value={value.mode}
          onChange={(e) => update({ mode: e.target.value as ResizeMode })}
        >
          <option value="none">No resize</option>
          <option value="fit">Fit (preserve aspect, may pad/crop)</option>
          <option value="crop">Crop to exact size</option>
          <option value="pad">Pad to exact size</option>
        </select>
      </label>

      <label className="select">
        <span>Resolution preset</span>
        <select
          value={value.preset ?? "__none__"}
          onChange={(e) => handlePreset(e.target.value)}
        >
          <option value="__none__">— Custom —</option>
          {Object.keys(RESOLUTION_PRESETS).map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </label>

      <label className="select">
        <span>Aspect ratio</span>
        <select
          value={value.aspectRatio ?? "__none__"}
          onChange={(e) => handleAspect(e.target.value)}
        >
          <option value="__none__">— Custom —</option>
          {Object.keys(ASPECT_RATIOS).map((k) => (
            <option key={k} value={ASPECT_RATIOS[k as AspectRatioKey]}>{k}</option>
          ))}
        </select>
      </label>

      <div className="dim-row">
        <NumberField
          label="Width"
          value={value.width}
          onChange={(n) => update({ width: n, preset: undefined })}
          min={1}
          max={20000}
          suffix="px"
          placeholder="auto"
        />
        <NumberField
          label="Height"
          value={value.height}
          onChange={(n) => update({ height: n, preset: undefined })}
          min={1}
          max={20000}
          suffix="px"
          placeholder="auto"
        />
      </div>

      <ToggleRow
        label="Lock aspect ratio"
        checked={value.lockAspectRatio}
        onChange={(b) => update({ lockAspectRatio: b })}
        hint="— derive height from width (or vice versa)"
      />

      {(value.mode === "fit" || value.mode === "pad") && (
        <div className="pad-bg-block">
          <div className="pad-bg-head">
            <span className="pad-bg-title">Padding background</span>
            <span className="pad-bg-hint">
              {value.mode === "fit"
                ? "Used when the source aspect ratio doesn't match the target box."
                : "Fills the area around the scaled-down image."}
            </span>
          </div>
          <div className="pad-bg-row">
            <input
              type="color"
              value={value.padBackground ?? "#ffffff"}
              onChange={(e) => update({ padBackground: e.target.value })}
              aria-label="Padding background color"
            />
            <input
              type="text"
              className="form-input color-hex"
              value={value.padBackground ?? "#ffffff"}
              onChange={(e) => {
                const v = e.target.value;
                if (/^#[0-9a-fA-F]{0,6}$/.test(v)) {
                  update({ padBackground: v });
                }
              }}
              maxLength={7}
              spellCheck={false}
            />
            <div className="pad-bg-presets">
              {[
                { label: "White", value: "#ffffff" },
                { label: "Black", value: "#000000" },
                { label: "Transparent", value: "#000000" }, // PNG only; visually a flat color
              ].map((p) => (
                <button
                  key={p.value + p.label}
                  type="button"
                  className={`preset-pill ${value.padBackground === p.value ? "active" : ""}`}
                  onClick={() => update({ padBackground: p.value })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
