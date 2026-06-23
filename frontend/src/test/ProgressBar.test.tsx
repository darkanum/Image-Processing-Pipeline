import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressBar } from "../components/ProgressBar";

describe("ProgressBar", () => {
  it("renders the status label and percentage", () => {
    render(<ProgressBar status="processing" progress={55} />);
    expect(screen.getByText("Processing")).toBeTruthy();
    expect(screen.getByText("55%")).toBeTruthy();
  });

  it("clamps progress to 0..100", () => {
    render(<ProgressBar status="completed" progress={150} />);
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("shows Failed label when status=failed", () => {
    render(<ProgressBar status="failed" progress={0} />);
    expect(screen.getByText("Failed")).toBeTruthy();
  });
});
