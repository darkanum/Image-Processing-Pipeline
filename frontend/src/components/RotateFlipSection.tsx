import type { Rotation, TransformSpec } from "../types/job";

interface RotateFlipProps {
  transform: TransformSpec;
  onChange: (next: TransformSpec) => void;
}

/**
 * Single rotate button. Clicking an active rotation deselects it
 * (sets rotation back to 0). Clicking an inactive one applies that
 * rotation.
 */
const RotateButton = ({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
}): JSX.Element => (
  <button
    type="button"
    className={`rot-btn ${active ? "active" : ""}`}
    onClick={onClick}
    title={title}
    aria-pressed={active}
  >
    {children}
  </button>
);

/** Independent flip toggle (no mutual exclusion). */
const FlipButton = ({
  active,
  onClick,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title: string;
}): JSX.Element => (
  <button
    type="button"
    className={`rot-btn flip ${active ? "active" : ""}`}
    onClick={onClick}
    title={title}
    aria-pressed={active}
  >
    {label}
  </button>
);

export const RotateFlipSection = ({ transform, onChange }: RotateFlipProps): JSX.Element => {
  const toggleRotation = (next: Rotation): void => {
    onChange({ ...transform, rotation: transform.rotation === next ? 0 : next });
  };

  return (
    <div className="rot-grid">
      <RotateButton
        active={transform.rotation === 270}
        onClick={() => toggleRotation(270)}
        title="Rotate 90° counter-clockwise (click again to reset)"
      >
        <span className="rot-icon">↺</span>
        <span className="rot-label">Left</span>
      </RotateButton>
      <RotateButton
        active={transform.rotation === 90}
        onClick={() => toggleRotation(90)}
        title="Rotate 90° clockwise (click again to reset)"
      >
        <span className="rot-icon">↻</span>
        <span className="rot-label">Right</span>
      </RotateButton>
      <RotateButton
        active={transform.rotation === 180}
        onClick={() => toggleRotation(180)}
        title="Rotate 180° (click again to reset)"
      >
        <span className="rot-icon">⟳</span>
        <span className="rot-label">180°</span>
      </RotateButton>

      <FlipButton
        active={transform.flipHorizontal}
        onClick={() => onChange({ ...transform, flipHorizontal: !transform.flipHorizontal })}
        label="Flip H"
        title="Flip horizontally (mirror left-right) — independent toggle"
      />
      <FlipButton
        active={transform.flipVertical}
        onClick={() => onChange({ ...transform, flipVertical: !transform.flipVertical })}
        label="Flip V"
        title="Flip vertically (mirror top-bottom) — independent toggle"
      />
      <RotateButton
        active={transform.rotation === 0 && !transform.flipHorizontal && !transform.flipVertical}
        onClick={() => onChange({ ...transform, rotation: 0, flipHorizontal: false, flipVertical: false })}
        title="Reset rotation and flips"
      >
        <span className="rot-icon">○</span>
        <span className="rot-label">Reset</span>
      </RotateButton>
    </div>
  );
};
