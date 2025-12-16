export const dynamic = 'force-static';

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-black text-white px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Privacy Policy</h1>
        <p className="text-sm text-gray-300">
          We collect the minimum information required to operate the app (for example: wallet addresses, created market
          metadata, and usage telemetry for debugging).
        </p>
        <p className="text-sm text-gray-400">
          Third-party infrastructure may process requests, including RPC providers, hosting, and analytics.
        </p>
        <p className="text-sm text-gray-400">
          Contact <span className="text-gray-200">support@dexetera.xyz</span> for privacy questions or deletion requests.
        </p>
      </div>
    </main>
  );
}


