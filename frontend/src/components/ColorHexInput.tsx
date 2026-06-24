import { useEffect, useState } from "react";

/** Matches a 6-char hex color like "#ff0000". */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const HEX_PREFIX = "#";

interface ColorHexInputProps {
  /** Current valid color value (e.g. "#ff0000"). Always 7 chars when truthy. */
  value: string;
  /** Called only when the user enters a complete 6-char hex. */
  onChange: (hex: string) => void;
  /** Accessible label for the input. */
  "aria-label"?: string;
  className?: string;
  /** Optional placeholder shown when the field is empty. */
  placeholder?: string;
}

/**
 * A text input that lets users type a hex color, but only commits a value
 * to the parent when it's a complete 6-char hex.
 *
 * Why: the parent value is the source of truth for both the picker swatch
 * and the API submission. If we committed partial values (e.g. "#ab" while
 * the user is still typing "#abcdef"), the picker swatch would jump around
 * and the API would receive an invalid value that silently falls back to
 * white. Instead, we keep a local "draft" that reflects what the user is
 * currently typing, and only push to the parent when the draft is valid.
 *
 * On blur, if the draft is invalid, we snap it back to the parent's value.
 */
export const ColorHexInput = ({
  value,
  onChange,
  "aria-label": ariaLabel,
  className,
  placeholder,
}: ColorHexInputProps): JSX.Element => {
  const [draft, setDraft] = useState<string>(value);

  // Keep the draft in sync if the parent value changes (e.g. user picks a
  // color via the swatch, or a preset pill is clicked).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commitIfValid = (s: string): void => {
    if (HEX_RE.test(s)) onChange(s);
  };

  return (
    <input
      type="text"
      className={className}
      value={draft}
      spellCheck={false}
      autoCapitalize="characters"
      autoComplete="off"
      maxLength={7}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => {
        const raw = e.target.value;
        // Allow the user to type a # even if the rest is incomplete —
        // it's a natural starting character. Lowercase the rest so the
        // display matches the picker.
        const v = raw.startsWith(HEX_PREFIX) ? raw : HEX_PREFIX + raw.replace(HEX_PREFIX, "");
        if (/^#?[0-9a-fA-F]{0,6}$/.test(v)) {
          setDraft(v);
          commitIfValid(v);
        }
        // If the input is invalid (e.g. contains non-hex chars), ignore —
        // the draft stays at the last valid value.
      }}
      onBlur={() => {
        // If the user left an invalid value, snap back to the parent's value.
        if (!HEX_RE.test(draft)) setDraft(value);
      }}
    />
  );
};
