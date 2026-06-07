import { cookies } from 'next/headers';
import { PITCH_COOKIE, expectedPitchToken } from '@/lib/pitchAuth';
import PitchGate from './PitchGate';
import PitchDeck from './PitchDeck';

export const dynamic = 'force-dynamic';

export default async function PitchDeckPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(PITCH_COOKIE)?.value;
  const authorized = !!token && token === expectedPitchToken();

  if (!authorized) {
    return <PitchGate />;
  }

  return <PitchDeck />;
}
