import type { JSX, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
};

const defaultProps = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function IconCompose({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

export function IconRefresh({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <path d="M21.5 2v6h-6" />
      <path d="M2.5 22v-6h6" />
      <path d="M19.5 15.5A9 9 0 0 1 5.7 18.3L2.5 16" />
      <path d="M4.5 8.5A9 9 0 0 1 18.3 5.7L21.5 8" />
    </svg>
  );
}

export function IconSearch({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

export function IconFilter({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

export function IconInbox({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

export function IconFolder({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
  );
}

export function IconSettings({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function IconStar({ size = 16, filled = false, ...props }: IconProps & { filled?: boolean }): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} fill={filled ? "currentColor" : "none"} {...props}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

export function IconFlag({ size = 16, filled = false, ...props }: IconProps & { filled?: boolean }): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} fill={filled ? "currentColor" : "none"} {...props}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

export function IconTrash({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

export function IconMove({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <polyline points="12 11 16 15 12 19" />
      <line x1="8" y1="15" x2="16" y2="15" />
    </svg>
  );
}

export function IconReply({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <polyline points="9 17 4 12 9 7" />
      <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
    </svg>
  );
}

export function IconReplyAll({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <polyline points="7 17 2 12 7 7" />
      <polyline points="12 17 7 12 12 7" />
      <path d="M22 18v-2a4 4 0 0 0-4-4H7" />
    </svg>
  );
}

export function IconForward({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <polyline points="15 17 20 12 15 7" />
      <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
    </svg>
  );
}

export function IconSnooze({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function IconTag({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

export function IconSparkles({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  );
}

export function IconPaperclip({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function IconShield({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

export function IconAlertTriangle({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function IconCheck({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function IconCheckSquare({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

export function IconSquare({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    </svg>
  );
}

export function IconChevronDown({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function IconChevronRight({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function IconChevronLeft({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export function IconClose({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function IconCommand({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
    </svg>
  );
}

export function IconKeyboard({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
      <line x1="6" y1="8" x2="6.01" y2="8" />
      <line x1="10" y1="8" x2="10.01" y2="8" />
      <line x1="14" y1="8" x2="14.01" y2="8" />
      <line x1="18" y1="8" x2="18.01" y2="8" />
      <line x1="6" y1="12" x2="6.01" y2="12" />
      <line x1="18" y1="12" x2="18.01" y2="12" />
      <line x1="7" y1="16" x2="17" y2="16" />
    </svg>
  );
}

export function IconRules({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <path d="m9 11 3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

export function IconTheme({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

export function IconDensityCompact({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

export function IconDensityComfortable({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <rect x="3" y="4" width="18" height="6" rx="1" />
      <rect x="3" y="14" width="18" height="6" rx="1" />
    </svg>
  );
}

export function IconPrinter({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

export function IconCopy({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function IconEye({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconEyeOff({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export function IconArrowUp({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

export function IconArrowDown({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  );
}

export function IconMail({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

export function IconArchive({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

export function IconSidebar({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

export function IconTabs({ size = 16, ...props }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} {...defaultProps} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 3v6" />
      <path d="M15 3v6" />
    </svg>
  );
}

