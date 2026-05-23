import { Rosette } from './rosette';

interface LogoProps {
  size?: number;
  mono?: boolean;
}

export function SetuLogo({ size = 18, mono = false }: LogoProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        color: 'var(--setu-ink)',
      }}
    >
      <Rosette
        size={size + 4}
        color={mono ? 'currentColor' : 'var(--setu-accent)'}
        stroke={1.5}
      />
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: size,
          fontWeight: 600,
          letterSpacing: '0.01em',
        }}
      >
        Setu
      </span>
    </span>
  );
}
