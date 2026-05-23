interface RosetteProps {
  size?: number;
  color?: string;
  opacity?: number;
  stroke?: number;
}

export function Rosette({
  size = 16,
  color = 'currentColor',
  opacity = 1,
  stroke = 1.4,
}: RosetteProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ opacity, display: 'block' }}
      aria-hidden="true"
    >
      <g fill="none" stroke={color} strokeWidth={stroke}>
        <circle cx="12" cy="6" r="3.2" />
        <circle cx="18" cy="12" r="3.2" />
        <circle cx="12" cy="18" r="3.2" />
        <circle cx="6" cy="12" r="3.2" />
        <circle cx="12" cy="12" r="1.2" fill={color} />
      </g>
    </svg>
  );
}
