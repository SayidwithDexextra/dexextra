import { redirect } from 'next/navigation';

export default function MarketsPage() {
  // Canonical list page lives at /explore (avoid 404s from prefetch/footer links).
  redirect('/explore');
}



