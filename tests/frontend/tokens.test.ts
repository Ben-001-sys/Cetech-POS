import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const tokens = readFileSync(resolve(repoRoot, "apps/pos-web/src/ui/tokens.css"), "utf8");
const shell = readFileSync(resolve(repoRoot, "apps/pos-web/src/ui/shell/shell.css"), "utf8");

function luminance(hex: string): number {
  const channels = hex.replace("#", "").match(/.{2}/g);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported color ${hex}`);
  const [red, green, blue] = channels.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function palette(block: string): Map<string, string> {
  return new Map([...block.matchAll(/(--color-[\w-]+):\s*(#[\da-f]{6});/g)].map((match) => [match[1], match[2]]));
}

describe("FE-02 design tokens and shell CSS", () => {
  test("defines the approved semantic color, space, radius, and touch tokens", () => {
    for (const token of [
      "--color-bg:",
      "--color-surface:",
      "--color-surface-2:",
      "--color-surface-3:",
      "--color-text:",
      "--color-text-muted:",
      "--color-border:",
      "--color-primary:",
      "--color-success:",
      "--color-warning:",
      "--color-danger:",
      "--color-info:",
      "--space-1: 4px",
      "--radius-sm: 8px",
      "--radius-md: 12px",
      "--radius-lg: 18px",
      "--touch: 44px",
    ]) {
      expect(tokens).toContain(token);
    }
    expect(tokens).toContain("--color-primary: #1d56b3");
    expect(tokens).toContain("min-height: 54px");
    expect(tokens).toContain("outline: 3px solid");
    expect(tokens).toContain("outline-offset: 2px");
    expect(tokens).toContain("prefers-reduced-motion: reduce");
    expect(tokens).toContain("animation-duration: 0.001ms");
    expect(tokens).toContain("transition-duration: 0.001ms");
  });

  test("defines approved responsive breakpoints and phone bottom navigation", () => {
    expect(shell).toContain("@media (max-width: 1050px)");
    expect(shell).toContain("@media (max-width: 820px)");
    expect(shell).toContain("@media (max-width: 480px)");
    expect(shell).toContain("bottom: 0");
    expect(shell).toContain("padding-bottom: calc(68px + env(safe-area-inset-bottom, 0px))");
    expect(shell).not.toContain("demo-fab");
    expect(shell).not.toContain("Demo controls");
  });

  test("keeps readable semantic text contrast in light and dark palettes", () => {
    const light = palette(tokens.match(/:root\s*\{([^}]+)\}/)?.[1] ?? "");
    const dark = palette(tokens.match(/html\[data-theme="dark"\]\s*\{([^}]+)\}/)?.[1] ?? "");
    for (const theme of [light, dark]) {
      for (const [text, surface] of [
        ["--color-text", "--color-surface"],
        ["--color-text-muted", "--color-surface"],
        ["--color-primary", "--color-primary-soft"],
        ["--color-danger", "--color-danger-soft"],
        ["--color-warning", "--color-warning-soft"],
      ]) {
        expect(contrast(theme.get(text) ?? "", theme.get(surface) ?? "")).toBeGreaterThanOrEqual(4.5);
      }
    }
    const darkButtonText = tokens.match(/html\[data-theme="dark"\] \.btn\.primary\s*\{\s*color:\s*(#[\da-f]{6});/)?.[1] ?? "";
    expect(contrast("#ffffff", light.get("--color-primary") ?? "")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkButtonText, dark.get("--color-primary") ?? "")).toBeGreaterThanOrEqual(4.5);
  });
});
