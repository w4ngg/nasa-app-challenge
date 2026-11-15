// Pure Vector SVG Gradient Icons for Deep Space Obsidian Mission & Hardware Telemetry
// (RocketSvg, SatelliteSvg, MoonBaseSvg, MarsBaseSvg, ShieldSvg, ChamberSvg)

export interface SvgIconProps {
  size?: number;
  className?: string;
}

export function RocketSvg({ size = 24, className }: SvgIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="so-rocket" x1="6" y1="4" x2="26" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8FE3FF" />
          <stop offset="55%" stopColor="#4FA8FF" />
          <stop offset="100%" stopColor="#FF7A1A" />
        </linearGradient>
      </defs>
      <path d="M16 3C21 7 23 13 23 20H9C9 13 11 7 16 3Z" stroke="url(#so-rocket)" strokeWidth="2" fill="rgba(79,168,255,0.12)" />
      <circle cx="16" cy="12" r="2.5" fill="#8FE3FF" />
      <path d="M9 17L5 22H9V17ZM23 17L27 22H23V17Z" fill="#4FA8FF" />
      <path d="M13 20L16 29L19 20H13Z" fill="#FF7A1A" />
    </svg>
  );
}

export function SatelliteSvg({ size = 24, className }: SvgIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="so-sat" x1="2" y1="6" x2="30" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8FE3FF" />
          <stop offset="100%" stopColor="#A78BFA" />
        </linearGradient>
      </defs>
      <rect x="12" y="12" width="8" height="8" rx="2" stroke="url(#so-sat)" strokeWidth="2" fill="rgba(167,139,250,0.18)" />
      <rect x="2" y="13" width="8" height="6" rx="1" stroke="#4FA8FF" strokeWidth="1.8" />
      <rect x="22" y="13" width="8" height="6" rx="1" stroke="#4FA8FF" strokeWidth="1.8" />
      <path d="M16 20V26M12 26H20" stroke="#8FE3FF" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function MoonBaseSvg({ size = 24, className }: SvgIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="so-moon" x1="4" y1="8" x2="28" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8FE3FF" />
          <stop offset="100%" stopColor="#4FA8FF" />
        </linearGradient>
      </defs>
      <path d="M6 24C6 16.5 10.5 12 16 12C21.5 12 26 16.5 26 24" stroke="url(#so-moon)" strokeWidth="2" fill="rgba(79,168,255,0.14)" />
      <path d="M3 24H29" stroke="#8FE3FF" strokeWidth="2" strokeLinecap="round" />
      <circle cx="23" cy="7" r="2.5" stroke="#A78BFA" strokeWidth="1.6" />
    </svg>
  );
}

export function MarsBaseSvg({ size = 24, className }: SvgIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="so-mars" x1="4" y1="8" x2="28" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFB347" />
          <stop offset="100%" stopColor="#FF7A1A" />
        </linearGradient>
      </defs>
      <path d="M5 24L11 13H21L27 24H5Z" stroke="url(#so-mars)" strokeWidth="2" fill="rgba(255,122,26,0.16)" />
      <path d="M16 13V8M13 8H19" stroke="#FFB347" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M3 24H29" stroke="#FF7A1A" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ShieldSvg({ size = 24, className }: SvgIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="so-shield" x1="6" y1="4" x2="26" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#10B981" />
          <stop offset="100%" stopColor="#4FA8FF" />
        </linearGradient>
      </defs>
      <path
        d="M16 4L26 8V15.5C26 21.8 21.6 26.4 16 28C10.4 26.4 6 21.8 6 15.5V8L16 4Z"
        stroke="url(#so-shield)"
        strokeWidth="2"
        fill="rgba(16,185,129,0.12)"
      />
      <path d="M12 16.2L14.8 19L20.5 13.3" stroke="#10B981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChamberSvg({ size = 24, className }: SvgIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="so-chamber" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8FE3FF" />
          <stop offset="50%" stopColor="#4FA8FF" />
          <stop offset="100%" stopColor="#A78BFA" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="11" stroke="url(#so-chamber)" strokeWidth="2" fill="rgba(79,168,255,0.1)" />
      <circle cx="16" cy="16" r="5" fill="#8FE3FF" fillOpacity="0.65" />
      <path d="M16 2V5M16 27V30M2 16H5M27 16H30" stroke="#4FA8FF" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

