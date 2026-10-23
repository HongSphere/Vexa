import React from "react";

interface VexaLogoProps {
  className?: string;
  size?: number | string;
  withText?: boolean;
  textClassName?: string;
}

export const VexaLogo: React.FC<VexaLogoProps> = ({
  className = "w-8 h-8",
  size,
  withText = false,
  textClassName = "text-base font-bold tracking-tight",
}) => {
  const icon = (
    <svg
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={size ? { width: size, height: size } : undefined}
    >
      <defs>
        {/* Luminous Pearl White/Silver Gradient */}
        <linearGradient id="vexa-clean-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="35%" stopColor="#f8fafc" />
          <stop offset="70%" stopColor="#e2e8f0" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </linearGradient>

        {/* Top Bevel & Subtle Inset Border */}
        <linearGradient id="vexa-clean-border" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(14, 165, 233, 0.5)" />
          <stop offset="50%" stopColor="rgba(15, 23, 42, 0.25)" />
          <stop offset="100%" stopColor="rgba(15, 23, 42, 0.4)" />
        </linearGradient>

        <filter id="vexa-clean-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="8" stdDeviation="12" floodColor="#0f172a" floodOpacity="0.14" />
        </filter>
      </defs>

      {/* Luminous Pearl Canvas with Crisp App Icon Border */}
      <rect
        x="20"
        y="20"
        width="472"
        height="472"
        rx="112"
        fill="url(#vexa-clean-bg)"
        stroke="url(#vexa-clean-border)"
        strokeWidth="16"
      />

      {/* Centered Pure Vexa Content */}
      <g filter="url(#vexa-clean-shadow)">
        {/* Cyan Neon Accent Dot */}
        <circle cx="388" cy="192" r="10" fill="#0284c7" />
        <circle cx="388" cy="192" r="20" fill="#38bdf8" opacity="0.32" />

        {/* High-Contrast Obsidian Slate Vexa (Centered) */}
        <text
          x="256"
          y="302"
          fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Montserrat', Arial, sans-serif"
          fontSize="136"
          fontWeight="900"
          letterSpacing="-3"
          textAnchor="middle"
          fill="#0f172a"
        >
          Vexa
        </text>

        {/* Sleek Dual-Tone Dynamic Accent Line */}
        <g transform="translate(256, 345)">
          <rect x="-70" y="-2" width="140" height="5" rx="2.5" fill="#cbd5e1" />
          <rect x="-28" y="-2" width="56" height="5" rx="2.5" fill="#0284c7" />
        </g>
      </g>
    </svg>
  );

  if (!withText) return icon;

  return (
    <div className="flex items-center gap-2.5">
      {icon}
      <span className={textClassName}>Vexa</span>
    </div>
  );
};
