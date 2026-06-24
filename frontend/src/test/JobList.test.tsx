import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// Mock the firebase module BEFORE the JobList import so it picks up the mock.
const mockOnSnapshot = vi.fn();
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  orderBy: vi.fn(),
  query: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("../lib/firebase", () => ({
  getDb: vi.fn(() => ({})),
}));

import { JobList } from "../components/JobList";

const seedJobs = (statuses: string[]): void => {
  // The onSnapshot callback receives a querySnapshot-like with forEach().
  // We capture it so the test can call it with fake jobs.
  const callback = mockOnSnapshot.mock.calls[0]?.[0] as
    | ((snap: { forEach: (cb: (d: { id: string; data: () => object }) => void) => void }) => void)
    | undefined;
  if (!callback) throw new Error("onSnapshot not registered");
  callback({
    forEach(cb: (d: { id: string; data: () => object }) => void) {
      for (let i = 0; i < statuses.length; i++) {
        const s = statuses[i]!;
        cb({
          id: `job-${i}`,
          data: () => ({
            status: s,
            progress: 0,
            currentStep: "queued",
            url: "https://example.com/cat.png",
            createdAt: 0,
            updatedAt: 0,
            finishedAt: null,
            resultUrl: null,
            errorMessage: null,
            transform: null,
            metadata: {},
          }),
        });
      }
    },
  });
};

describe("JobList — layout", () => {
  beforeEach(() => {
    mockOnSnapshot.mockReset();
    mockOnSnapshot.mockImplementation((_q, onNext) => {
      // capture for later seedJobs() invocation
      mockOnSnapshot.mock.calls[0]![0] = onNext;
      return () => undefined;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders the always-visible Queue and Executing columns", () => {
    render(<JobList refreshSignal={0} />);
    expect(screen.getByText("Queue")).toBeTruthy();
    expect(screen.getByText("Executing")).toBeTruthy();
  });

  it("renders the Completed and Failed archive tabs", () => {
    render(<JobList refreshSignal={0} />);
    expect(screen.getByRole("tab", { name: /completed/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /failed/i })).toBeTruthy();
  });

  it("shows the Queue count when there are pending jobs", async () => {
    render(<JobList refreshSignal={0} />);
    act(() => seedJobs(["pending", "pending"]));
    await waitFor(() => {
      const counts = document.querySelectorAll(".in-progress-count");
      expect(counts[0]?.textContent).toBe("2"); // Queue
    });
  });

  it("shows the Executing count when there are in-flight jobs", async () => {
    render(<JobList refreshSignal={0} />);
    act(() => seedJobs(["processing", "downloading", "uploading"]));
    await waitFor(() => {
      const counts = document.querySelectorAll(".in-progress-count");
      expect(counts[1]?.textContent).toBe("3"); // Executing
    });
  });

  it("Completed tab is the default archive view", () => {
    render(<JobList refreshSignal={0} />);
    expect(
      screen.getByRole("tab", { name: /completed/i }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("clicking Failed tab switches the archive view", async () => {
    render(<JobList refreshSignal={0} />);
    fireEvent.click(screen.getByRole("tab", { name: /failed/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: /failed/i }).getAttribute("aria-selected"),
      ).toBe("true"),
    );
  });
});
