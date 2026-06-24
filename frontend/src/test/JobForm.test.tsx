import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { JobForm } from "../components/JobForm";

describe("JobForm", () => {
  it("renders the URL input and the process button", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    expect(screen.getByLabelText(/image url/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /process image/i })).toBeTruthy();
  });

  it("shows URL validation error for an invalid URL", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    const input = screen.getByLabelText(/image url/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "not a url" } });
    // Validation line shows "✕" and a reason.
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

  it("disables submit when URL is empty or invalid", () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    const input = screen.getByLabelText(/image url/i) as HTMLInputElement;
    const submit = screen.getByRole("button", { name: /process image/i }) as HTMLButtonElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "https://example.com/x.png" } });
    expect(submit.disabled).toBe(false);
  });

  it("expands the options panel when the toggle is clicked", async () => {
    render(<JobForm apiUrl="" onCreated={undefined} />);
    const toggle = screen.getByRole("button", { name: /transform options/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-expanded")).toBe("true"));
  });
});
