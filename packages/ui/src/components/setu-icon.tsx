import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export const SetuIcon = {
  chevron: (p: IconProps) => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...base} {...p}>
      <polyline points="9 6 15 12 9 18" />
    </svg>
  ),
  back: (p: IconProps) => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  ),
  plus: (p: IconProps) => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...base} strokeLinejoin={undefined} {...p}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  check: (p: IconProps) => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...base} strokeWidth={2.4} {...p}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  x: (p: IconProps) => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...base} strokeLinejoin={undefined} {...p}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  search: (p: IconProps) => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...base} {...p}>
      <circle cx="11" cy="11" r="7" />
      <line x1="20" y1="20" x2="16.65" y2="16.65" />
    </svg>
  ),
  bell: (p: IconProps) => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...base} {...p}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </svg>
  ),
  home: (p: IconProps) => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
      <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />
    </svg>
  ),
  people: (p: IconProps) => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="10" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  heart: (p: IconProps) => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  calendar: (p: IconProps) => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  user: (p: IconProps) => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  receipt: (p: IconProps) => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...base} {...p}>
      <path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="13" x2="16" y2="13" />
    </svg>
  ),
  shield: (p: IconProps) => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...base} {...p}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  warn: (p: IconProps) => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...base} {...p}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  info: (p: IconProps) => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...base} {...p}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  dots: (p: IconProps) => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </svg>
  ),
  edit: (p: IconProps) => (
    <svg width="14" height="14" viewBox="0 0 24 24" {...base} {...p}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  mail: (p: IconProps) => (
    <svg width="14" height="14" viewBox="0 0 24 24" {...base} {...p}>
      <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  phone: (p: IconProps) => (
    <svg width="14" height="14" viewBox="0 0 24 24" {...base} {...p}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
  card: (p: IconProps) => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...base} {...p}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  ),
  dl: (p: IconProps) => (
    <svg width="14" height="14" viewBox="0 0 24 24" {...base} {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
};
