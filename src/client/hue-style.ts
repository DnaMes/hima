// SPDX-License-Identifier: MIT
// Copyright (C) 2026 erdlabs
import type { CSSProperties } from "react";

export function hueStyle(index: number): CSSProperties {
  return { "--c": `var(--account-hue-${index})` } as CSSProperties;
}
