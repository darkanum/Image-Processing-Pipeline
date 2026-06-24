import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme, readStoredTheme } from "../hooks/useTheme";

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset matchMedia default
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to system mode when no stored value", () => {
    expect(readStoredTheme()).toBe("system");
  });

  it("reads an explicitly stored mode", () => {
    localStorage.setItem("ipp.theme", "dark");
    expect(readStoredTheme()).toBe("dark");
  });

  it("falls back to system for invalid stored values", () => {
    localStorage.setItem("ipp.theme", "not-a-mode");
    expect(readStoredTheme()).toBe("system");
  });

  it("resolves to light when mode=light, even if OS prefers dark", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: true, // OS prefers dark
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    localStorage.setItem("ipp.theme", "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe("light");
    expect(result.current.resolved).toBe("light");
  });

  it("resolves to dark when mode=dark", () => {
    localStorage.setItem("ipp.theme", "dark");
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe("dark");
  });

  it("resolves to dark when mode=system and OS prefers dark", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe("dark");
  });

  it("setMode persists to localStorage and updates state", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode("dark"));
    expect(result.current.mode).toBe("dark");
    expect(result.current.resolved).toBe("dark");
    expect(localStorage.getItem("ipp.theme")).toBe("dark");
  });

  it("cycle advances through system → light → dark → system", () => {
    localStorage.setItem("ipp.theme", "system");
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe("system");
    act(() => result.current.cycle());
    expect(result.current.mode).toBe("light");
    act(() => result.current.cycle());
    expect(result.current.mode).toBe("dark");
    act(() => result.current.cycle());
    expect(result.current.mode).toBe("system");
  });

  it("applies data-theme attribute to <html> on mount and on change", () => {
    localStorage.setItem("ipp.theme", "dark");
    const { result } = renderHook(() => useTheme());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    act(() => result.current.setMode("light"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("handles missing matchMedia gracefully (defaults to light)", () => {
    // Simulate the unsafe environment case without using @ts-expect-error
    // (the global is part of the lib.dom types in some configs).
    const w = window as unknown as { matchMedia?: unknown };
    const original = w.matchMedia;
    w.matchMedia = undefined;
    try {
      const { result } = renderHook(() => useTheme());
      expect(result.current.resolved).toBe("light");
    } finally {
      w.matchMedia = original;
    }
  });

  it("subscribes to OS color-scheme changes when mode=system", () => {
    const addEventListener = vi.fn();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener,
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    renderHook(() => useTheme());
    expect(addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });
});
