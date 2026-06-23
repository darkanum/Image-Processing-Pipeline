import type { Rotation, TransformSpec } from "../types/job";

interface RotateFlipProps {
  transform: TransformSpec;
  onChange: (next: TransformSpec) => void;
}

const RotateButton = ({
  label,
  active,
  onClick,
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  title: string;
}): JSX.Element => (
  <button
    type="button"
    className={`rot-btn ${active ? "active" : ""}`}
    onClick={onClick}
    title={title}
    aria-pressed={active}
  >
    {label}
  </button>
);

export const RotateFlipSection = ({ transform, onChange }: RotateFlipProps): JSX.Element => {
  const update = (patch: Partial<TransformSpec>): void => {
    onChange({ ...transform, ...patch });
  };
  return (
    <div className="rot-grid">
      <RotateButton
        label="↺ Left"
        active={transform.rotation === 270}
        onClick={() => update({ rotation: 270 as Rotation })}
        title="Rotate 90° counter-clockwise"
      />
      <RotateButton
        label="↻ Right"
        active={transform.rotation === 90}
        onClick={() => update({ rotation: 90 as Rotation })}
        title="Rotate 90° clockwise"
      />
      <RotateButton
        label="180°"
        active={transform.rotation === 180}
        onClick={() => update({ rotation: 180 as Rotation })}
        title="Rotate 180°"
      />
      <RotateButton
        label="0°"
        active={transform.rotation === 0}
        onClick={() => update({ rotation: 0 as Rotation })}
        title="Reset rotation"
      />
      <RotateButton
        label="⇋ Flip H"
        active={transform.flipHorizontal}
        onClick={() => update({ flipHorizontal: !transform.flipHorizontal })}
        title="Flip horizontally (mirror left-right)"
      />
      <RotateButton
        label="⇅ Flip V"
        active={transform.flipVertical}
        onClick={() => update({ flipVertical: !transform.flipVertical })}
        title="Flip vertically (mirror top-bottom)"
      />
    </div>
  );
};
