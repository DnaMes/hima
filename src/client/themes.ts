export const THEME_STORAGE_KEY = "himalaya-web-theme-v1";

export const SEMANTIC_THEME_KEYS = [
  "page",
  "panel",
  "field",
  "border",
  "text",
  "mutedText",
  "accent",
  "accentContrast",
  "selected",
  "success",
  "warning",
  "error",
  "focus",
  "areaAccounts",
  "areaList",
  "areaReader",
  "titleAccounts",
  "titleList",
  "titleReader",
] as const;

export type ThemeColorKey = typeof SEMANTIC_THEME_KEYS[number];
export type ThemeName = "midnight" | "vscode-dark" | "catppuccin-mocha" | "catppuccin-latte" | "nord" | "tokyo-night";

export type AccountHues = readonly [string, string, string, string, string, string, string, string];

export type ThemeDefinition = {
  label: string;
  colors: Record<ThemeColorKey, string>;
  accountHues: AccountHues;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const THEMES = {
  midnight: {
    label: "Midnight",
    colors: {
      page: "#17131f",
      panel: "#211b2b",
      field: "#2a2337",
      border: "#4c415e",
      text: "#f4efff",
      mutedText: "#b9adc9",
      accent: "#9d7cff",
      accentContrast: "#17131f",
      selected: "#3e2f61",
      success: "#66d1ad",
      warning: "#f0bf68",
      error: "#f28ca8",
      focus: "#c8b8ff",
      areaAccounts: "#150f24",
      areaList: "#172232",
      areaReader: "#262034",
      titleAccounts: "#9d7cff",
      titleList: "#90c4ea",
      titleReader: "#66d1ad",
    },
    accountHues: ["#ab90ea", "#90eacc", "#eacc90", "#ea90ae", "#90c4ea", "#eab190", "#c4ea90", "#ea90ea"],
  },
  "vscode-dark": {
    label: "VS Code Dark",
    colors: {
      page: "#1e1e1e",
      panel: "#252526",
      field: "#313131",
      border: "#454545",
      text: "#d4d4d4",
      mutedText: "#9da0a6",
      accent: "#569cd6",
      accentContrast: "#0b1f33",
      selected: "#264f78",
      success: "#89d185",
      warning: "#cca700",
      error: "#f48771",
      focus: "#75beff",
      areaAccounts: "#141c28",
      areaList: "#1f1f22",
      areaReader: "#2c2c30",
      titleAccounts: "#569cd6",
      titleList: "#90c4ea",
      titleReader: "#89d185",
    },
    accountHues: ["#b49cec", "#90eacc", "#eacc90", "#ea90ae", "#90c4ea", "#eab190", "#c4ea90", "#ea90ea"],
  },
  "catppuccin-mocha": {
    label: "Catppuccin Mocha",
    colors: {
      page: "#1e1e2e",
      panel: "#181825",
      field: "#313244",
      border: "#45475a",
      text: "#cdd6f4",
      mutedText: "#a6adc8",
      accent: "#cba6f7",
      accentContrast: "#1e1e2e",
      selected: "#45475a",
      success: "#a6e3a1",
      warning: "#f9e2af",
      error: "#f38ba8",
      focus: "#f5c2e7",
      areaAccounts: "#11111b",
      areaList: "#1a1a28",
      areaReader: "#262738",
      titleAccounts: "#cba6f7",
      titleList: "#90c4ea",
      titleReader: "#a6e3a1",
    },
    accountHues: ["#b096eb", "#90eacc", "#eacc90", "#ea90ae", "#90c4ea", "#eab190", "#c4ea90", "#ea90ea"],
  },
  "catppuccin-latte": {
    label: "Catppuccin Latte",
    colors: {
      page: "#eff1f5",
      panel: "#e6e9ef",
      field: "#dce0e8",
      border: "#bcc0cc",
      text: "#4c4f69",
      mutedText: "#5c5f77",
      accent: "#8839ef",
      accentContrast: "#ffffff",
      selected: "#dce0e8",
      success: "#40a02b",
      warning: "#df8e1d",
      error: "#d20f39",
      focus: "#1e66f5",
      areaAccounts: "#e6e9f1",
      areaList: "#f0f1f6",
      areaReader: "#fbfbfd",
      titleAccounts: "#7a2fe0",
      titleList: "#205d88",
      titleReader: "#2c6f1e",
    },
    accountHues: ["#5129ae", "#17634a", "#70531a", "#a1264f", "#205d88", "#884620", "#446317", "#952395"],
  },
  nord: {
    label: "Nord",
    colors: {
      page: "#2e3440",
      panel: "#3b4252",
      field: "#3e4658",
      border: "#4c566a",
      text: "#eceff4",
      mutedText: "#d8dee9",
      accent: "#88c0d0",
      accentContrast: "#2e3440",
      selected: "#4c566a",
      success: "#a3be8c",
      warning: "#ebcb8b",
      error: "#bf616a",
      focus: "#8fbcbb",
      areaAccounts: "#2b303b",
      areaList: "#343a49",
      areaReader: "#3e4658",
      titleAccounts: "#88c0d0",
      titleList: "#b6d9f1",
      titleReader: "#a3be8c",
    },
    accountHues: ["#dbd0f6", "#90eacc", "#ebcf96", "#f4c3d3", "#b6d9f1", "#f1ccb6", "#c4ea90", "#f4c3f4"],
  },
  "tokyo-night": {
    label: "Tokyo Night",
    colors: {
      page: "#16161e",
      panel: "#1a1b26",
      field: "#1f2338",
      border: "#3b4261",
      text: "#c0caf5",
      mutedText: "#a9b1d6",
      accent: "#7aa2f7",
      accentContrast: "#16161e",
      selected: "#2f3b62",
      success: "#9ece6a",
      warning: "#e0af68",
      error: "#f7768e",
      focus: "#bb9af7",
      areaAccounts: "#12131b",
      areaList: "#171a2b",
      areaReader: "#1f2338",
      titleAccounts: "#7aa2f7",
      titleList: "#90c4ea",
      titleReader: "#9ece6a",
    },
    accountHues: ["#ab90ea", "#90eacc", "#eacc90", "#ea90ae", "#90c4ea", "#eab190", "#c4ea90", "#ea90ea"],
  },
} satisfies Record<ThemeName, ThemeDefinition>;

function cssVariableName(key: ThemeColorKey): string {
  return `--${key.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)}`;
}

export function resolveTheme(value: unknown): ThemeName {
  return typeof value === "string" && Object.hasOwn(THEMES, value) ? value as ThemeName : "midnight";
}

export function readStoredTheme(storage: StorageLike): ThemeName {
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    const theme = resolveTheme(stored);
    if (stored !== theme) storage.setItem(THEME_STORAGE_KEY, theme);
    return theme;
  } catch {
    return "midnight";
  }
}

export function persistTheme(storage: StorageLike, theme: ThemeName): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, resolveTheme(theme));
  } catch {
    // Browser storage can be unavailable; the in-memory theme still applies.
  }
}

export function applyTheme(root: HTMLElement, theme: ThemeName): void {
  root.dataset.theme = theme;
  for (const key of SEMANTIC_THEME_KEYS) root.style.setProperty(cssVariableName(key), THEMES[theme].colors[key]);
  THEMES[theme].accountHues.forEach((hue, index) => root.style.setProperty(`--account-hue-${index}`, hue));
}
