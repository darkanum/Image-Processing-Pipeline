import type { CropSpec } from "../types/job";
import { ASPECT_RATIOS, type AspectRatioKey } from "../types/job";
import { NumberField } from "./controls";

interface CropSectionProps {
  value: CropSpec;
  onChange: (next: CropSpec) => void;
}

export const CropSection = ({ value, onChange }: CropSectionProps): JSX.Element => {
  const update = (patch: Partial<CropSpec>): void => {
    onChange({ ...value, ...patch });
  };

  const handleAspect = (key: string): void => {
    if (key === "__none__") {
      onChange({ ...value, aspectRatio: undefined });
      return;
    }
    onChange({ ...value, aspectRatio: key });
  };

  return (
    <div className="crop-grid">
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
          onChange={(n) => update({ width: n })}
          min={1}
          max={20000}
          suffix="px"
          placeholder="auto"
        />
        <NumberField
          label="Height"
          value={value.height}
          onChange={(n) => update({ height: n })}
          min={1}
          max={20000}
          suffix="px"
          placeholder="auto"
        />
      </div>

      <label className="select">
        <span>Anchor</span>
        <select
          value={value.anchor ?? "center"}
          onChange={(e) => update({ anchor: e.target.value as NonNullable<CropSpec["anchor"]> })}
        >
          <option value="center">Center (default)</option>
          <option value="top">Top</option>
          <option value="bottom">Bottom</option>
          <option value="left">Left</option>
          <option value="right">Right</option>
          <option value="attention">Attention (smart crop)</option>
        </select>
      </label>
    </div>
  );
};
