import { useId, type JSX, type SVGProps } from "react";

export type ProviderId =
  | "gmail"
  | "icloud"
  | "goneo"
  | "lima-city"
  | "outlook"
  | "fastmail"
  | "proton"
  | "gmx"
  | "webde"
  | "posteo"
  | "mailboxorg"
  | "strato"
  | "hetzner"
  | "ionos"
  | "custom"
  | string;

export type ProviderLogoProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
};

export function LogoGmail({ size = 20, ...props }: ProviderLogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Gmail Logo" {...props}>
      <rect width="24" height="24" rx="6" fill="#ffffff" />
      <g transform="translate(2.5, 4.2) scale(0.2159) translate(-52, -42)">
        <path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
        <path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
        <path fill="#fbbc04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
        <path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92" />
        <path fill="#c5221f" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2" />
      </g>
    </svg>
  );
}

export function LogoiCloud({ size = 20, ...props }: ProviderLogoProps): JSX.Element {
  const gradId = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Apple iCloud Logo" {...props}>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="50%" stopColor="#0284c7" />
          <stop offset="100%" stopColor="#0369a1" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="6" fill="#f8fafc" />
      <path
        d="M13.762 6.29a4.88 4.88 0 0 0-4.25 2.5 2.68 2.68 0 0 0-1.17-.27 2.68 2.68 0 0 0-2.64 2.25A3.69 3.69 0 0 0 3 14.17a3.69 3.69 0 0 0 3.69 3.68h10.82c1.73-.2 3.03-1.69 3.03-3.44a3.45 3.45 0 0 0-2.8-3.38 4.88 4.88 0 0 0-3.98-4.74z"
        fill={`url(#${gradId})`}
      />
    </svg>
  );
}

export function LogoGoneo({ size = 20, ...props }: ProviderLogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="goneo Logo" {...props}>
      <rect width="24" height="24" rx="6" fill="#003865" />
      <g transform="translate(6, 1.2) scale(0.4144)">
        <path
          d="M24.785,8.7h3.351V28.993a24,24,0,0,1-.953,7.852,10.415,10.415,0,0,1-4.566,5.421A15.484,15.484,0,0,1,14.8,44.171a18.053,18.053,0,0,1-6.012-.92,12.056,12.056,0,0,1-4.337-2.5,15.116,15.116,0,0,1-3.088-4.566H5.008a9.558,9.558,0,0,0,3.844,3.745,12.482,12.482,0,0,0,5.815,1.216A12.334,12.334,0,0,0,20.449,39.9,7.469,7.469,0,0,0,23.8,36.746a13.845,13.845,0,0,0,1.018-6.11V29.321A12.417,12.417,0,0,1,20.186,32.9,14.088,14.088,0,0,1,7.6,32.409a12.486,12.486,0,0,1-4.9-4.7A12.663,12.663,0,0,1,1,21.207a12.644,12.644,0,0,1,1.807-6.6A12.979,12.979,0,0,1,7.768,9.774,13.461,13.461,0,0,1,14.469,8a12.715,12.715,0,0,1,5.454,1.183,14.915,14.915,0,0,1,4.862,3.909V8.7ZM14.9,11.2a10.823,10.823,0,0,0-5.289,1.347,9.988,9.988,0,0,0-5.224,8.87,9.216,9.216,0,0,0,2.858,6.932A10.282,10.282,0,0,0,14.7,31.073a10.287,10.287,0,0,0,7.425-2.727,9.5,9.5,0,0,0,2.825-7.129,10.144,10.144,0,0,0-1.281-5.125,9.2,9.2,0,0,0-3.679-3.581A10.232,10.232,0,0,0,14.9,11.2Z"
          fill="#ffffff"
        />
      </g>
      <circle cx="17.2" cy="7" r="2.8" fill="#78be20" />
    </svg>
  );
}

export function LogoLimaCity({ size = 20, ...props }: ProviderLogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="lima-city Logo" {...props}>
      <rect width="24" height="24" rx="6" fill="#0f172a" />
      <g transform="translate(3, 3.35) scale(0.16886)">
        {/* Cyan circuit rack slots */}
        <path
          d="M64.3 61.3c-.7 0-1.3-.4-1.6-1-.4-.9 0-1.8.9-2.2l7.1-3c.9-.4 1.9 0 2.2.9.4.9 0 1.9-.9 2.2l-7.1 3c-.2.1-.4.1-.6.1M64.3 68.1c-.7 0-1.3-.4-1.6-1-.4-.9 0-1.8.9-2.2l7.1-3c.9-.4 1.9 0 2.2.9.4.9 0 1.9-.9 2.2l-7.1 3c-.2 0-.4.1-.6.1M64.3 74.8c-.7 0-1.3-.4-1.6-1-.4-.9 0-1.9.9-2.2l7.1-3c.9-.4 1.9 0 2.2.9.4.9 0 1.8-.9 2.2l-7.1 3c-.2 0-.4.1-.6.1M64.3 81.5c-.7 0-1.3-.4-1.6-1-.4-.9 0-1.9.9-2.2l7.1-3c.9-.4 1.9 0 2.2.9.4.9 0 1.9-.9 2.2l-7.1 3c-.2.1-.4.1-.6.1M82.3 61.3c-.2 0-.4 0-.7-.1l-7.1-3c-.9-.4-1.3-1.4-.9-2.2.4-.9 1.4-1.3 2.2-.9l7.1 3c.9.4 1.3 1.4.9 2.2-.2.7-.8 1-1.5 1M82.3 68.1c-.2 0-.4 0-.7-.1l-7.1-3c-.9-.4-1.3-1.4-.9-2.2.4-.9 1.4-1.3 2.2-.9l7.1 3c.9.4 1.3 1.4.9 2.2-.2.6-.8 1-1.5 1M82.3 74.8c-.2 0-.4 0-.7-.1l-7.1-3c-.9-.4-1.3-1.4-.9-2.2.4-.9 1.4-1.3 2.2-.9l7.1 3c.9.4 1.3 1.4.9 2.2-.2.6-.8 1-1.5 1M82.3 81.5c-.2 0-.4 0-.7-.1l-7.1-3c-.9-.4-1.3-1.4-.9-2.2.4-.9 1.4-1.3 2.2-.9l7.1 3c.9.4 1.3 1.4.9 2.2-.2.6-.8 1-1.5 1"
          fill="#38bdf8"
        />
        {/* Lima-city Arch */}
        <path
          d="M2.9 58.6c0 9.4 2.6 18.2 7 25.7C3.7 75.6 0 64.9 0 53.3 0 23.9 23.9 0 53.3 0c29.5 0 53.3 23.9 53.3 53.3 0 11.6-3.7 22.3-9.9 31 4.5-7.5 7-16.3 7-25.7 0-27.9-22.6-50.4-50.4-50.4S2.9 30.8 2.9 58.6"
          fill="#ffffff"
        />
        <path
          d="M25.5 37.4c-1.1 0-2.2-.6-2.6-1.7-.6-1.5.1-3.1 1.5-3.8l12-5.2c1.5-.6 3.1.1 3.8 1.5.6 1.5-.1 3.1-1.5 3.8l-12 5.1q-.6.3-1.2.3M25.5 48.8c-1.1 0-2.2-.7-2.6-1.7-.6-1.5.1-3.1 1.5-3.8l12-5.1c1.5-.6 3.1.1 3.8 1.5.6 1.5-.1 3.1-1.5 3.8l-12 5.1c-.4.1-.8.2-1.2.2M25.5 60.2c-1.1 0-2.2-.7-2.6-1.7-.6-1.5.1-3.1 1.5-3.8l12-5.1c1.5-.6 3.1.1 3.8 1.5.6 1.5-.1 3.1-1.5 3.8l-12 5.1c-.4.1-.8.2-1.2.2M25.5 71.5c-1.1 0-2.2-.6-2.6-1.7-.6-1.5.1-3.1 1.5-3.8l12-5.1c1.5-.6 3.1.1 3.8 1.5.6 1.5-.1 3.1-1.5 3.8l-12 5.1c-.4.1-.8.2-1.2.2M56.1 37.4c-.4 0-.8-.1-1.1-.2l-12-5.1c-1.5-.6-2.1-2.3-1.5-3.8s2.3-2.1 3.8-1.5l12 5.2c1.5.6 2.1 2.3 1.5 3.8-.6 1-1.6 1.6-2.7 1.6M56.1 48.8c-.4 0-.8-.1-1.1-.2l-12-5.1c-1.5-.6-2.1-2.3-1.5-3.8s2.3-2.1 3.8-1.5l12 5.1c1.5.6 2.1 2.3 1.5 3.8-.6 1-1.6 1.7-2.7 1.7M56.1 60.2c-.4 0-.8-.1-1.1-.2l-12-5.1c-1.5-.6-2.1-2.3-1.5-3.8s2.3-2.1 3.8-1.5l12 5.1c1.5.6 2.1 2.3 1.5 3.8-.6 1-1.6 1.7-2.7 1.7M56.1 71.5c-.4 0-.8-.1-1.1-.2l-12-5.1c-1.5-.6-2.1-2.3-1.5-3.8s2.3-2.1 3.8-1.5l12 5.1c1.5.6 2.1 2.3 1.5 3.8-.6 1.1-1.6 1.7-2.7 1.7M25.5 81.9c-1.1 0-2.2-.6-2.6-1.7-.6-1.5.1-3.1 1.5-3.8l12-5.1c1.5-.6 3.1 0 3.8 1.5.6 1.5-.1 3.1-1.5 3.8l-12 5.1c-.4.1-.8.2-1.2.2M56.1 81.9c-.4 0-.8-.1-1.1-.2l-12-5.1c-1.5-.6-2.1-2.3-1.5-3.8s2.3-2.1 3.8-1.5l12 5.1c1.5.6 2.1 2.3 1.5 3.8-.6 1-1.6 1.7-2.7 1.7M75.6 25c-.3 0-.6-.1-.9-.2l-10-4.3c-1.2-.5-1.8-1.9-1.2-3.1.5-1.2 1.9-1.8 3.1-1.2l10 4.3c1.2.5 1.8 1.9 1.2 3.1-.4.9-1.2 1.4-2.2 1.4M75.6 34.4c-.3 0-.6-.1-.9-.2l-10-4.3c-1.2-.5-1.8-1.9-1.2-3.1.5-1.2 1.9-1.8 3.1-1.2l10 4.3c1.2.5 1.8 1.9 1.2 3.1-.4.9-1.2 1.4-2.2 1.4M50 25c.3 0 .6-.1.9-.2l10-4.3c1.2-.5 1.8-1.9 1.2-3.1-.5-1.2-1.9-1.8-3.1-1.2l-10 4.3c-1.2.5-1.8 1.9-1.2 3.1.4.9 1.3 1.4 2.2 1.4M75.6 43.9c-.3 0-.6-.1-.9-.2l-10-4.3c-1.2-.5-1.8-1.9-1.2-3.1.5-1.2 1.9-1.8 3.1-1.2l10 4.3c1.2.5 1.8 1.9 1.2 3.1-.4.8-1.2 1.4-2.2 1.4M75.6 53.3c-.3 0-.6-.1-.9-.2l-10-4.3c-1.2-.5-1.8-1.9-1.2-3.1.5-1.2 1.9-1.8 3.1-1.2l10 4.3c1.2.5 1.8 1.9 1.2 3.1-.4.9-1.2 1.4-2.2 1.4"
          fill="#22d3ee"
        />
        <path
          d="M95.3 102.4c-11.4-2.6-25.9-4.6-41.8-5.5-15.9-1-30.5-.7-42.2.4 9.1-3.3 24.7-4.8 42.4-3.8 17.7 1.1 33 4.6 41.6 8.9"
          fill="#ffffff"
        />
      </g>
    </svg>
  );
}

export function LogoOutlook({ size = 20, ...props }: ProviderLogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Outlook Logo" {...props}>
      <rect width="24" height="24" rx="6" fill="#0078d4" />
      <rect x="5" y="6" width="14" height="12" rx="2" fill="#106ebe" />
      <path d="M5 8l7 5 7-5" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="3.5" y="7" width="9" height="10" rx="2" fill="#004c87" />
      <circle cx="8" cy="12" r="2.6" fill="none" stroke="#ffffff" strokeWidth="1.4" />
    </svg>
  );
}

export function LogoFastmail({ size = 20, ...props }: ProviderLogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Fastmail Logo" {...props}>
      <rect width="24" height="24" rx="6" fill="#0c4075" />
      <path d="m3.5 12 16.5-7.5-6.5 16-3-5.5-7-3z" fill="#38a3ff" />
      <path d="m10.5 15 9.5-10.5-6.5 16-3-5.5z" fill="#ffffff" />
    </svg>
  );
}

export function LogoProton({ size = 20, ...props }: ProviderLogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Proton Mail Logo" {...props}>
      <rect width="24" height="24" rx="6" fill="#1b1335" />
      <path
        d="M4 16.5V21h3.3v-4.48c0-.44.17-.85.48-1.16a1.65 1.65 0 0 1 1.17-.48h3.38a5.97 5.97 0 0 0 4.21-1.74 5.93 5.93 0 0 0 1.74-4.2 5.93 5.93 0 0 0-1.74-4.2A5.97 5.97 0 0 0 12.33 3H4v5.86h3.3V6.1h4.81c.75 0 1.46.3 1.99.82.53.53.83 1.24.83 1.99a2.8 2.8 0 0 1-.83 1.99 2.82 2.82 0 0 1-1.99.82H8.61a4.62 4.62 0 0 0-3.26 1.35A4.6 4.6 0 0 0 4 16.5Z"
        fill="#6d4aff"
      />
    </svg>
  );
}

export function LogoGmx({ size = 20, ...props }: ProviderLogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="GMX Logo" {...props}>
      <rect width="24" height="24" rx="6" fill="#1c449c" />
      <g transform="translate(2, 7.8) scale(0.051)">
        <path
          d="M 64.67 0.01 C 32.8 -0.61 3.87 22.29 0.41 55.79 C -2.79 85.22 12.86 113.54 41.08 123.88 C 81.55 138.41 125.01 112.14 124.88 67.66 C 124.88 60.47 119.04 54.63 111.84 54.65 L 62.45 54.65 C 55.25 54.65 49.41 60.49 49.41 67.7 C 49.41 74.91 55.25 80.75 62.45 80.75 L 96.5 80.75 C 89.25 100.06 65.06 106.6 47.17 98.18 C 41.5 95.53 36.56 91.39 32.99 86.25 C 26.28 76.61 24.45 63.71 27.53 52.38 C 29.21 46.37 32.47 40.87 36.98 36.57 C 50.71 23.33 74.17 22.4 87.61 35.37 C 99.53 47.9 118.08 31.6 107.19 18.13 C 106.42 17.26 105.56 16.43 104.73 15.66 C 97.3 8.88 88.18 4.14 78.44 1.76 C 73.83 0.67 69.22 0.1 64.67 0.01 z M 289.82 2.2 C 280.08 2.23 271.83 14.04 280.09 24.03 L 316.86 65.1 L 280.09 106.17 C 269.06 119.55 287.49 136 299.5 123.59 L 334.35 84.65 L 369.2 123.59 C 381.28 136.04 399.63 119.49 388.61 106.17 L 351.84 65.1 L 388.62 24.03 C 399.65 10.65 381.22 -5.8 369.21 6.61 L 334.35 45.54 L 299.5 6.61 C 296.48 3.49 293.07 2.19 289.82 2.2 z M 149.44 2.26 C 142.24 2.26 136.4 8.1 136.4 15.31 L 136.4 114.79 C 136.4 122 142.24 127.85 149.44 127.85 C 156.64 127.85 162.48 122 162.48 114.79 L 162.48 56 L 188.88 100.45 C 189.95 102.24 191.5 103.86 193.42 105 C 199.61 108.68 207.6 106.65 211.28 100.44 L 237.55 56.17 L 237.55 114.81 C 238.25 132.13 262.94 132.1 263.62 114.81 L 263.62 15.32 C 263.62 8.11 257.78 2.27 250.58 2.27 L 246.65 2.27 C 242.21 2.28 237.87 4.56 235.45 8.65 L 200.08 68.23 L 164.67 8.63 C 162.39 4.82 158.22 2.26 153.47 2.26 L 149.44 2.26 z"
          fill="#ffffff"
        />
      </g>
    </svg>
  );
}

export function LogoWebde({ size = 20, ...props }: ProviderLogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="WEB.DE Logo" {...props}>
      <rect width="24" height="24" rx="6" fill="#ffd800" />
      <g transform="translate(3, 8) scale(0.088)">
        <path
          d="M41.8 0h-8.47l7.46 38.09h9.8l5.7-25.79 5.75 25.79h9.8l7.83-38.09h-7.94l-4.79 29.14-6.23-29.14h-8.26l-6.34 29.04-4.31-29.04zm66.78 0H84.76v38.09h24.35v-6.39h-16.3v-9.48h13.9v-6.39h-13.9v-9.43h15.77v-6.4zm6.79 0v38.09h14.17c8.95 0 13.21-4.26 13.21-10.65 0-8.15-7.19-9.06-7.19-9.06s5.11-2.18 5.11-8.52c0-6.39-4.1-9.86-12.57-9.86h-12.73zm8.05 16.04V6h2.66c4.74 0 6.66 1.6 6.66 4.95 0 3.41-1.92 5.11-5.86 5.11l-3.46.01zm0 16.09V11.85h4.9c4.1 0 6.34 1.6 6.34 5.01s-2.08 5.27-6.82 5.27h-4.42zm28.6 6.5c2.45 0 4.15-1.71 4.15-4.1 0-2.45-1.7-3.94-4.05-3.94-2.45 0-4.21 1.54-4.21 4.05.01 2.23 1.4 3.99 4.11 3.99zm11.06-38.63v38.09h9.48c13.11 0 19.82-7.46 19.82-19.39 0-11.67-5.91-18.7-19.02-18.7h-10.28zm8.05 31.7V6h2.18c7.35 0 10.92 4.37 10.92 12.84 0 8.42-3.46 12.47-10.87 12.47l-2.23-.01zm51.1-31.7h-23.81v38.09h24.35v-6.39h-16.3v-9.48h13.9v-6.39h-13.9v-9.43h15.77v-6.4z"
          fill="#002d72"
        />
      </g>
    </svg>
  );
}

export function LogoPosteo({ size = 20, ...props }: ProviderLogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Posteo Logo" {...props}>
      <rect width="24" height="24" rx="6" fill="#ffffff" stroke="#5e9e31" strokeWidth="1" />
      <path
        d="M17 6c-6.6 0-10 4.4-10 11 0 .6.4 1 1 1 6.6 0 10-4.4 10-11 0-.6-.4-1-1-1z"
        fill="#5e9e31"
      />
      <path d="M7.5 17.5c2.5-3 5.5-6 9.5-7.5" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function LogoMailboxOrg({ size = 20, ...props }: ProviderLogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="mailbox.org Logo" {...props}>
      <rect width="24" height="24" rx="6" fill="#19353f" />
      <g transform="translate(12, 12) scale(0.35) translate(-55, -51)">
        <path d="M47.99,39.69l10.94,8.28h0c.68.44,1.04.38,1.59-.22.13-.15.25-.29.37-.43.32-.39.5-.64.37-1.1h0c-.01-.06-3.4-10.43-3.4-10.43-.32-1.11-1.11-1.72-2.33-1.74,0,0-5.03,0-5.03,0-.77,0-1.17.16-1.62.68l-1.37,1.82c-.95,1.35-.84,2.07.48,3.15" fill="#38bdf8" />
        <path d="M62.51,47.93l-8.28,10.94h0c-.44.68-.38,1.04.22,1.59.15.13.29.25.43.37.39.32.64.5,1.1.37h0c.06-.01,10.43-3.4,10.43-3.4,1.11-.32,1.72-1.11,1.74-2.33,0,0,0-5.03,0-5.03,0-.77-.16-1.17-.68-1.62l-1.82-1.37c-1.35-.95-2.07-.84-3.15.48" fill="#ffffff" />
        <path d="M39.74,54.19l8.28-10.94h0c.44-.68.38-1.04-.22-1.59-.15-.13-.29-.25-.43-.37-.39-.32-.64-.5-1.1-.37h0c-.06.01-10.43,3.4-10.43,3.4-1.11.32-1.72,1.11-1.74,2.33,0,0,0,5.03,0,5.03,0,.77.16,1.17.68,1.62l1.82,1.37c1.35.95,2.07.84,3.15-.48" fill="#ffffff" />
        <path d="M54.24,62.43l-10.94-8.28h0c-.68-.44-1.04-.38-1.59.22-.13.15-.25.29-.37.43-.32.39-.5.64-.37,1.1h0c.01.06,3.4,10.43,3.4,10.43.32,1.11,1.11,1.72,2.33,1.74,0,0,5.03,0,5.03,0,.77,0,1.17-.16,1.62-.68l1.37-1.82c.95-1.35.84-2.07-.48-3.15" fill="#38bdf8" />
      </g>
    </svg>
  );
}

export function LogoStrato({ size = 20, ...props }: ProviderLogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="STRATO Logo" {...props}>
      <rect width="24" height="24" rx="6" fill="#ff6600" />
      <path
        d="M16.5 8.5c-.8-1-2-1.5-3.5-1.5-2.5 0-4 1.3-4 3.2 0 1.8 1.2 2.6 3.2 3.1l1.5.4c1.4.3 2 .8 2 1.6 0 1-.9 1.7-2.3 1.7-1.6 0-2.6-.7-3.2-1.8l-1.8 1.1c.9 1.6 2.5 2.5 4.9 2.5 2.8 0 4.6-1.5 4.6-3.6 0-1.8-1.2-2.8-3.4-3.3l-1.4-.3c-1.2-.3-1.8-.7-1.8-1.4 0-.9.8-1.5 2-1.5 1.2 0 2 .4 2.6 1.2l1.3-1.2z"
        fill="#ffffff"
      />
    </svg>
  );
}

export function LogoHetzner({ size = 20, ...props }: ProviderLogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Hetzner Logo" {...props}>
      <rect width="24" height="24" rx="6" fill="#d50c10" />
      <path d="M5.5 5.5h2.8v4.8h7.4V5.5h2.8v13h-2.8v-5.2H8.3v5.2H5.5V5.5z" fill="#ffffff" />
    </svg>
  );
}

export function LogoIonos({ size = 20, ...props }: ProviderLogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="IONOS Logo" {...props}>
      <rect width="24" height="24" rx="6" fill="#001b44" />
      <g transform="translate(1, 4) scale(0.9)">
        <path
          d="M22.18 15.5a1.76 1.76 0 0 1-.35-.04 1.83 1.83 0 0 1-1.21-.86c-.13-.26-.04-.57.2-.72a.53.53 0 0 1 .73.2.56.56 0 0 0 .15.18.74.74 0 0 0 .35.17.76.76 0 0 0 .6-.14.72.72 0 0 0 .3-.54.74.74 0 0 0-.2-.58l-1.68-1.74a1.96 1.96 0 0 1-.2-.23c-.22-.32-.3-.7-.26-1.07a1.74 1.74 0 0 1 .23-.74 1.88 1.88 0 0 1 .3-.18 1.75 1.75 0 0 1 2.29.7.52.52 0 0 1-.2.73.53.53 0 0 1-.72-.2.7.7 0 0 0-.47-.33.72.72 0 0 0-.56.13.69.69 0 0 0-.27.5.7.7 0 0 0 .2.54l1.63 1.68a1.83 1.83 0 0 1 .5 1.4c-.04.52-.3 1-.71 1.3a1.84 1.84 0 0 1-1.1.37m-5.18 0a1.76 1.76 0 0 0 1.76-1.76v-3.48a1.76 1.76 0 0 0-3.52 0v3.48a1.76 1.76 0 0 0 1.76 1.76m0-5.93c.38 0 .7.32.7.7v3.48a.7.7 0 0 1-1.4 0v-3.48c0-.38.32-.7.7-.7m-7.9.32v5.08a.53.53 0 0 0 1.06 0V12.09zm2.88 2.03V9.03a.53.53 0 0 1 1.06 0v5.09zm1.05 2.94v.11a.53.53 0 0 1-1 .24L9.12 9.15v-.12a.53.53 0 0 1 1.01-.23zm-7.9.65a1.76 1.76 0 0 0 1.75-1.76v-3.48a1.76 1.76 0 0 0-3.51 0v3.48a1.76 1.76 0 0 0 1.76 1.76m0-5.93a.71.71 0 0 1 .7.7v3.48a.7.7 0 1 1-1.4 0v-3.48a.7.7 0 0 1 .7-.7M0 14.91a.58.58 0 1 0 1.16 0V9.08a.58.58 0 0 0-1.16 0z"
          fill="#0083eb"
        />
      </g>
    </svg>
  );
}

export function LogoCustomDomain({ size = 20, ...props }: ProviderLogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Domain Server" {...props}>
      <rect width="24" height="24" rx="6" fill="currentColor" fillOpacity="0.12" />
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" />
      <ellipse cx="12" cy="12" rx="3.5" ry="7" stroke="currentColor" strokeWidth="1.2" />
      <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function providerLabel(provider: string | null | undefined): string {
  switch ((provider ?? "").toLowerCase()) {
    case "gmail":
      return "Google Mail";
    case "icloud":
      return "Apple iCloud";
    case "goneo":
      return "goneo";
    case "lima-city":
      return "lima-city";
    case "outlook":
      return "Outlook / M365";
    case "fastmail":
      return "Fastmail";
    case "proton":
      return "Proton Mail";
    case "gmx":
      return "GMX";
    case "webde":
      return "WEB.DE";
    case "posteo":
      return "Posteo";
    case "mailboxorg":
      return "mailbox.org";
    case "strato":
      return "STRATO";
    case "hetzner":
      return "Hetzner";
    case "ionos":
      return "IONOS";
    default:
      return "IMAP/SMTP Mail";
  }
}

export function ProviderLogo({
  provider,
  size = 20,
  className,
  ...props
}: ProviderLogoProps & { provider: ProviderId | null | undefined }): JSX.Element {
  const norm = (provider ?? "").toLowerCase();
  switch (norm) {
    case "gmail":
      return <LogoGmail size={size} className={className} {...props} />;
    case "icloud":
      return <LogoiCloud size={size} className={className} {...props} />;
    case "goneo":
      return <LogoGoneo size={size} className={className} {...props} />;
    case "lima-city":
      return <LogoLimaCity size={size} className={className} {...props} />;
    case "outlook":
      return <LogoOutlook size={size} className={className} {...props} />;
    case "fastmail":
      return <LogoFastmail size={size} className={className} {...props} />;
    case "proton":
      return <LogoProton size={size} className={className} {...props} />;
    case "gmx":
      return <LogoGmx size={size} className={className} {...props} />;
    case "webde":
      return <LogoWebde size={size} className={className} {...props} />;
    case "posteo":
      return <LogoPosteo size={size} className={className} {...props} />;
    case "mailboxorg":
      return <LogoMailboxOrg size={size} className={className} {...props} />;
    case "strato":
      return <LogoStrato size={size} className={className} {...props} />;
    case "hetzner":
      return <LogoHetzner size={size} className={className} {...props} />;
    case "ionos":
      return <LogoIonos size={size} className={className} {...props} />;
    default:
      return <LogoCustomDomain size={size} className={className} {...props} />;
  }
}
