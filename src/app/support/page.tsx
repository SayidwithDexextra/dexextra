export const dynamic = 'force-static';

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-black text-white px-5 py-10 sm:py-14">
      <div className="mx-auto max-w-[900px]">
        <h1 className="text-center text-[2.5rem] leading-tight font-semibold mb-10">
          Support
        </h1>

        {/* Section 1: Documentation */}
        <section className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl p-8 mb-6 text-center">
          <h2 className="text-2xl font-medium mb-4 text-white">📚 Documentation</h2>
          <p className="text-[#b4b4b4] text-[1.1rem] leading-relaxed mb-6">
            Find guides, API reference, and troubleshooting for deployments, trading, deposits, and settlements.
          </p>
          <a
            href="https://doc.dexetera.win/docs/intro"
            target="_blank"
            rel="noreferrer"
            className="inline-block bg-white text-black py-3.5 px-8 rounded-[10px] text-[1.1rem] font-semibold no-underline transition-colors hover:bg-[#e0e0e0] m-2"
          >
            View Documentation
          </a>
        </section>

        {/* Section 2: Contact Support */}
        <section className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl p-8 mb-6 text-center">
          <h2 className="text-2xl font-medium mb-4 text-white">💬 Need Help?</h2>
          <p className="text-[#b4b4b4] text-[1.1rem] leading-relaxed mb-6">
            Can’t find what you need? Contact our support team with your market symbol and error details.
          </p>

          <a
            href="mailto:support@dexetera.xyz"
            className="inline-block bg-white text-black py-3.5 px-8 rounded-[10px] text-[1.1rem] font-semibold no-underline transition-colors hover:bg-[#e0e0e0] m-2"
          >
            Email Support
          </a>

          <div className="mt-3">
            <span className="inline-block font-mono text-[1.2rem] text-white bg-[#1a1a1a] py-3 px-6 rounded-lg">
              support@dexetera.xyz
            </span>
          </div>

          <div className="bg-[#111111] rounded-xl p-6 mt-5 text-left">
            <h3 className="text-[1.1rem] mb-3 text-white">Include these details:</h3>
            <ul className="list-none p-0 m-0">
              <li className="text-[#b4b4b4] mb-2 pl-5 relative before:content-['•'] before:absolute before:left-0 before:text-[#b4b4b4]">
                Full error message and request URL/status code
              </li>
              <li className="text-[#b4b4b4] mb-2 pl-5 relative before:content-['•'] before:absolute before:left-0 before:text-[#b4b4b4]">
                Pipeline ID (if shown for “Create Market” issues)
              </li>
              <li className="text-[#b4b4b4] mb-2 pl-5 relative before:content-['•'] before:absolute before:left-0 before:text-[#b4b4b4]">
                Screenshot of console/API errors
              </li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}








