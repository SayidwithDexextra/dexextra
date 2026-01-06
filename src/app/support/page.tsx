export const dynamic = 'force-static';

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-black text-white px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Support</h1>
        <p className="text-sm text-gray-300">
          If you’re running into an issue (deployment, trading, deposits, or settlement), contact us and include your
          market symbol and any console/API error text.
        </p>

        <div className="rounded-xl border border-gray-800 bg-[#0F0F0F] p-4">
          <div className="text-sm text-gray-200">Email</div>
          <div className="mt-1 text-sm text-gray-400">support@dexetera.xyz</div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-[#0F0F0F] p-4">
          <div className="text-sm text-gray-200">Troubleshooting</div>
          <ul className="mt-2 list-disc pl-5 text-sm text-gray-400 space-y-1">
            <li>Include the full error message and the request URL/status code.</li>
            <li>For “Create Market” issues, include the pipeline id if shown.</li>
            <li>If you see repeated 404s during deployment, wait a moment and refresh the token page.</li>
          </ul>
        </div>
      </div>
    </main>
  );
}








