import type { ReactNode } from 'react';

export const metadata = {
  title: 'Dexextra Metric AI Worker',
  description: 'Background AI metric analysis service',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}


