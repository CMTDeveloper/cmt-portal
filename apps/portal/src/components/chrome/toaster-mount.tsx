'use client';

import { Toaster } from '@cmt/ui';

export function ToasterMount() {
  return (
    <Toaster
      position="top-center"
      duration={4000}
      closeButton
    />
  );
}
