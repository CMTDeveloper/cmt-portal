interface SetuAvatarProps {
  name?: string;
  size?: number;
  src?: string;
}

export function SetuAvatar({ name = 'A', size = 36, src }: SetuAvatarProps) {
  const initials =
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0])
      .join('')
      .toUpperCase() || 'A';

  // hue derived from name so it stays stable across renders
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  const bg = `oklch(0.88 0.06 ${h})`;
  const fg = `oklch(0.32 0.07 ${h})`;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: src ? 'transparent' : bg,
        color: fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.36,
        fontWeight: 600,
        fontFamily: 'var(--font-sans)',
        letterSpacing: '.02em',
        backgroundImage: src ? `url(${src})` : undefined,
        backgroundSize: 'cover',
        flex: '0 0 auto',
      }}
    >
      {!src && initials}
    </div>
  );
}
