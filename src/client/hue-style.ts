import type { CSSProperties } from "react";

export function hueStyle(index: number): CSSProperties {
  return { "--c": `var(--account-hue-${index})` } as CSSProperties;
}
