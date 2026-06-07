import { createHash } from 'crypto';

export const PITCH_COOKIE = 'pitch_deck_auth';

/**
 * The deck password. Override in `.env.local` with `PITCH_DECK_PASSWORD`.
 * Falls back to a default so the gate works out of the box in dev.
 */
export function getPitchPassword(): string {
  return process.env.PITCH_DECK_PASSWORD || '1234';
}

/**
 * Hash a candidate password the same way for both the submitted value and the
 * stored cookie token. The raw password is never placed in the cookie.
 */
export function hashPitchPassword(password: string): string {
  return createHash('sha256').update(`${password}::dexetera-pitch-deck`).digest('hex');
}

/** The token we expect the auth cookie to contain when access is granted. */
export function expectedPitchToken(): string {
  return hashPitchPassword(getPitchPassword());
}
