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

describe("JobList — tab behavior", () => {
  beforeEach(() => {
    mockOnSnapshot.mockReset();
    mockOnSnapshot.mockImplementation((_q, onNext) => {
      // capture for later seedJobs() invocation
      mockOnSnapshot.mock.calls[0]![0] = onNext;
      return () => undefined;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders all 4 tabs", async () => {
    render(<JobList refreshSignal={0} />);
    expect(screen.getByRole("tab", { name: /queue/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /executing/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /completed/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /failed/i })).toBeTruthy();
  });

  it("stays on the tab the user clicks, even if it is empty", async () => {
    render(<JobList refreshSignal={0} />);
    // Seed with one completed job (so queue is empty).
    act(() => seedJobs(["completed"]));
    // User explicitly clicks Failed — should stay on Failed even though it's empty.
    const failedTab = screen.getByRole("tab", { name: /failed/i });
    fireEvent.click(failedTab);
    await waitFor(() => expect(failedTab.getAttribute("aria-selected")).toBe("true"));
    // After a re-snapshot (simulate worker progress), the tab should NOT
    // have been forced back to the auto-default.
    act(() => seedJobs(["completed", "completed"]));
    expect(failedTab.getAttribute("aria-selected")).toBe("true");
  });

  it("auto-jumps from empty queue to the first non-empty tab on initial load", async () => {
    render(<JobList refreshSignal={0} />);
    act(() => seedJobs(["completed", "completed"]));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /completed/i }).getAttribute("aria-selected")).toBe("true"),
    );
  });
});
