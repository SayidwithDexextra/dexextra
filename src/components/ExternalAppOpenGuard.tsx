'use client';

/**
 * The actual guard is installed via an inline <script> in the root layout
 * (src/app/layout.tsx) so it runs before any third-party code.
 * This component exists only as a mounting point for legacy references.
 */
export default function ExternalAppOpenGuard() {
  return null;
}
