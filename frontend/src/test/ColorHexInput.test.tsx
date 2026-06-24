import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColorHexInput } from "../components/ColorHexInput";

describe("ColorHexInput", () => {
  it("renders the current value", () => {
    render(<ColorHexInput value="#ff0000" onChange={() => undefined} aria-label="Color" />);
    const input = screen.getByLabelText("Color") as HTMLInputElement;
    expect(input.value).toBe("#ff0000");
  });

  it("does NOT call onChange for partial hex (1-5 chars after #)", () => {
    const onChange = vi.fn();
    render(<ColorHexInput value="#ff0000" onChange={onChange} aria-label="Color" />);
    const input = screen.getByLabelText("Color") as HTMLInputElement;

    // Simulate user typing "#abc" — partial, invalid
    fireEvent.change(input, { target: { value: "#abc" } });
    expect(onChange).not.toHaveBeenCalled();

    // Now type the full 6-char hex
    fireEvent.change(input, { target: { value: "#abcdef" } });
    expect(onChange).toHaveBeenCalledWith("#abcdef");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("auto-prepends # if the user types without it", () => {
    const onChange = vi.fn();
    render(<ColorHexInput value="#ff0000" onChange={onChange} aria-label="Color" />);
    const input = screen.getByLabelText("Color") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "abcdef" } });
    expect(input.value).toBe("#abcdef");
    expect(onChange).toHaveBeenCalledWith("#abcdef");
  });

  it("rejects non-hex characters", () => {
    const onChange = vi.fn();
    render(<ColorHexInput value="#ff0000" onChange={onChange} aria-label="Color" />);
    const input = screen.getByLabelText("Color") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "#xyz123" } });
    // Value shouldn't have changed
    expect(input.value).toBe("#ff0000");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("snaps back to parent value on blur if the draft is invalid", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ColorHexInput value="#ff0000" onChange={onChange} aria-label="Color" />,
    );
    const input = screen.getByLabelText("Color") as HTMLInputElement;

    // Type a partial value
    fireEvent.change(input, { target: { value: "#abc" } });
    // Parent's value is still #ff0000, but the draft is now #abc
    expect(input.value).toBe("#abc");

    // Blur
    fireEvent.blur(input);
    // Should snap back to parent's value
    expect(input.value).toBe("#ff0000");
  });

  it("keeps a complete hex value on blur", () => {
    const onChange = vi.fn();
    render(<ColorHexInput value="#ff0000" onChange={onChange} aria-label="Color" />);
    const input = screen.getByLabelText("Color") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "#00ff00" } });
    fireEvent.blur(input);
    expect(input.value).toBe("#00ff00");
  });

  it("syncs the draft when the parent value changes externally", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ColorHexInput value="#ff0000" onChange={onChange} aria-label="Color" />,
    );
    // User starts typing a new color
    const input = screen.getByLabelText("Color") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#abc" } });
    expect(input.value).toBe("#abc");

    // Parent updates the value (e.g. user clicked a preset pill)
    rerender(<ColorHexInput value="#3b82f6" onChange={onChange} aria-label="Color" />);
    expect(input.value).toBe("#3b82f6");
  });
});
