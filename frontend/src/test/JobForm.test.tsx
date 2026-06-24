import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JobForm } from "../components/JobForm";

describe("JobForm", () => {
  beforeEach(() => {
    // reset fetch mock between tests
    global.fetch = vi.fn();
  });

  it("renders the URL input and the process button", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    expect(screen.getByLabelText(/image url/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /process image/i })).toBeTruthy();
  });

  it("shows URL validation error for an invalid URL", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    const input = screen.getByLabelText(/image url/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "not a url" } });
    expect(screen.getByText(/not a valid url/i)).toBeTruthy();
  });

  it("rejects non-http(s) protocol", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    const input = screen.getByLabelText(/image url/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ftp://example.com/x.png" } });
    expect(screen.getByText(/not allowed/i)).toBeTruthy();
  });

  it("shows 'will fetch from' for a valid http URL", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    const input = screen.getByLabelText(/image url/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "https://example.com/cat.png" } });
    expect(screen.getByText(/will fetch from example.com/i)).toBeTruthy();
  });

  it("clicking a quick-pick fills the URL", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /picsum 800.*600/i }));
    const input = screen.getByLabelText(/image url/i) as HTMLInputElement;
    expect(input.value).toContain("picsum.photos");
  });

  it("disables submit when URL is empty", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    const input = screen.getByLabelText(/image url/i) as HTMLInputElement;
    const submit = screen.getByRole("button", { name: /process image/i }) as HTMLButtonElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "https://example.com/x.png" } });
    expect(submit.disabled).toBe(false);
  });

  it("shows the 4 resize mode radio buttons", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    expect(screen.getByRole("radio", { name: /^off/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /^fit/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /^fill/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /^pad/i })).toBeTruthy();
  });

  it("clicking a resize mode toggles the size inputs", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    // Default is "Off" — width/height inputs should not be present.
    expect(screen.queryByLabelText(/^width$/i)).toBeNull();
    // Click Fit
    fireEvent.click(screen.getByRole("radio", { name: /^fit/i }));
    expect(screen.getByLabelText(/^width$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^height$/i)).toBeTruthy();
  });

  it("the watermark checkbox toggles the watermark section", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    const cb = screen.getByRole("checkbox", { name: /^watermark$/i });
    // Default unchecked — text input not present
    expect(screen.queryByPlaceholderText(/watermark text/i)).toBeNull();
    // Toggle on
    fireEvent.click(cb);
    expect(screen.getByPlaceholderText(/watermark text/i)).toBeTruthy();
    // Toggle off
    fireEvent.click(cb);
    expect(screen.queryByPlaceholderText(/watermark text/i)).toBeNull();
  });

  it("shows the live result dimensions in the resize header", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    // Default URL is https://picsum.photos/800/600, mode is Off → result = 800×600.
    // The result lives in the resize header's <b> tag.
    const result = screen.getByText(/Result:/);
    expect(result.textContent).toContain("800");
    expect(result.textContent).toContain("600");
  });

  it("enables the watermark and shows the backing toggle", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /^watermark$/i }));
    // The backing rectangle toggle should be visible now.
    expect(screen.getByRole("checkbox", { name: /add backing rectangle/i })).toBeTruthy();
  });

  it("toggling the watermark backing hides the color pickers", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /^watermark$/i }));
    // Default backing is enabled → the swatch picker is present
    expect(screen.getByLabelText("Backing color")).toBeTruthy();
    // Toggle off
    fireEvent.click(screen.getByRole("checkbox", { name: /add backing rectangle/i }));
    expect(screen.queryByLabelText("Backing color")).toBeNull();
  });

  it("fit mode shows the pad background color picker", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    fireEvent.click(screen.getByRole("radio", { name: /^fit/i }));
    // Now there should be a color input labelled "Padding background color"
    expect(screen.getByLabelText(/padding background color/i)).toBeTruthy();
  });

  it("pad mode shows the pad background color picker", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    fireEvent.click(screen.getByRole("radio", { name: /^pad/i }));
    expect(screen.getByLabelText(/padding background color/i)).toBeTruthy();
  });

  it("off mode hides the pad background color picker", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    // Default is Off
    expect(screen.queryByLabelText(/padding background color/i)).toBeNull();
  });

  it("shows the image opacity slider with the default 100%", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    const slider = screen.getByLabelText(/image opacity/i) as HTMLInputElement;
    expect(slider).toBeTruthy();
    expect(slider.type).toBe("range");
    expect(slider.value).toBe("100");
  });

  it("image opacity slider updates the visible value", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    const slider = screen.getByLabelText(/image opacity/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "42" } });
    // The percentage label updates
    expect(screen.getByText("42%")).toBeTruthy();
  });

  it("watermark text color picker is shown when watermark is enabled and kind=text", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /^watermark$/i }));
    // Kind defaults to "text", so the color picker should be present.
    expect(screen.getByLabelText("Watermark text color")).toBeTruthy();
    expect(screen.getByLabelText("Watermark text color hex")).toBeTruthy();
  });

  it("custom rotation input accepts any angle", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    const customInput = screen.getByLabelText(/custom rotation angle/i) as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: "37" } });
    expect((screen.getByLabelText(/custom rotation angle/i) as HTMLInputElement).value).toBe("37");
  });

  it("custom rotation input clamps to [-180, 180]", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    const customInput = screen.getByLabelText(/custom rotation angle/i) as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: "999" } });
    // 999 should be clamped to 180
    expect((screen.getByLabelText(/custom rotation angle/i) as HTMLInputElement).value).toBe("180");
  });

  it("color filter chips toggle B&W and Invert", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    const bwChip = screen.getByRole("checkbox", { name: /B&/i }) as HTMLInputElement;
    const invertChip = screen.getByRole("checkbox", { name: /invert/i }) as HTMLInputElement;
    expect(bwChip).toBeTruthy();
    expect(invertChip).toBeTruthy();
    expect(bwChip.checked).toBe(false);
    fireEvent.click(bwChip);
    expect(bwChip.checked).toBe(true);
  });

  it("image opacity slider is hidden when output format is jpeg", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    // Default is "original" so the slider is visible.
    expect(screen.getByLabelText(/image opacity/i)).toBeTruthy();
    // Switch to JPEG — slider should disappear.
    const formatSelect = screen.getByLabelText(/^format$/i) as HTMLSelectElement;
    fireEvent.change(formatSelect, { target: { value: "jpeg" } });
    expect(screen.queryByLabelText(/image opacity/i)).toBeNull();
  });

  it("image opacity slider returns when output format is png", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    const formatSelect = screen.getByLabelText(/^format$/i) as HTMLSelectElement;
    fireEvent.change(formatSelect, { target: { value: "jpeg" } });
    expect(screen.queryByLabelText(/image opacity/i)).toBeNull();
    fireEvent.change(formatSelect, { target: { value: "png" } });
    expect(screen.getByLabelText(/image opacity/i)).toBeTruthy();
  });

  it("watermark placement toggle is hidden when rotation is 0", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    // Enable watermark
    fireEvent.click(screen.getByRole("checkbox", { name: /^watermark$/i }));
    // The placement radiogroup should not exist because rotation is 0.
    expect(screen.queryByRole("radiogroup", { name: /watermark placement/i })).toBeNull();
  });

  it("watermark placement toggle appears when rotation is non-zero and defaults to 'pre-rotation'", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    // Enable watermark
    fireEvent.click(screen.getByRole("checkbox", { name: /^watermark$/i }));
    // Set a custom rotation
    const customInput = screen.getByLabelText(/custom rotation angle/i) as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: "30" } });
    // The placement radiogroup should now be visible
    const group = screen.getByRole("radiogroup", { name: /watermark placement/i });
    expect(group).toBeTruthy();
    // The "Before rotation" button should be the default (active)
    const beforeBtn = screen.getByRole("button", { name: /before rotation/i }) as HTMLButtonElement;
    const afterBtn = screen.getByRole("button", { name: /after rotation/i }) as HTMLButtonElement;
    expect(beforeBtn.getAttribute("aria-pressed")).toBe("true");
    expect(afterBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking 'After rotation' toggles the placement to post-rotation", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /^watermark$/i }));
    const customInput = screen.getByLabelText(/custom rotation angle/i) as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: "45" } });
    const beforeBtn = screen.getByRole("button", { name: /before rotation/i }) as HTMLButtonElement;
    const afterBtn = screen.getByRole("button", { name: /after rotation/i }) as HTMLButtonElement;
    expect(beforeBtn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(afterBtn);
    expect(afterBtn.getAttribute("aria-pressed")).toBe("true");
    expect(beforeBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("setting rotation back to 0 hides the placement toggle but keeps the chosen value", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /^watermark$/i }));
    const customInput = screen.getByLabelText(/custom rotation angle/i) as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /after rotation/i }));
    // The toggle is visible at 30°
    expect(screen.queryByRole("radiogroup", { name: /watermark placement/i })).toBeTruthy();
    // Setting rotation back to 0 hides the toggle (it's irrelevant)
    fireEvent.change(customInput, { target: { value: "0" } });
    expect(screen.queryByRole("radiogroup", { name: /watermark placement/i })).toBeNull();
    // Re-enabling rotation reveals the toggle again with the same selection
    fireEvent.change(customInput, { target: { value: "60" } });
    const afterBtn = screen.getByRole("button", { name: /after rotation/i }) as HTMLButtonElement;
    expect(afterBtn.getAttribute("aria-pressed")).toBe("true");
  });
});
