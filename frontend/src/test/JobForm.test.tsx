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
});
