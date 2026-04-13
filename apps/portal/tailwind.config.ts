import type { Config } from 'tailwindcss';
import preset from '@cmt/config/tailwind';

const config: Config = {
  presets: [preset as Config],
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/features/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
};

export default config;
