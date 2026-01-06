export const dynamic = 'force-static';

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-black text-white px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Terms of Service</h1>
        <p className="text-sm text-gray-300">
          By using this site you agree that trading involves risk. You are responsible for your own decisions, wallet
          security, and compliance with applicable laws.
        </p>
        <p className="text-sm text-gray-400">
          This product is provided “as is” without warranties. Availability may change and features may be modified over
          time.
        </p>
        <p className="text-sm text-gray-400">
          Questions: <span className="text-gray-200">support@dexetera.xyz</span>
        </p>
      </div>
    </main>
  );
}








