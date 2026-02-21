export const dynamic = 'force-static';

export default function SupportPage() {
  return (
    <main className="h-screen overflow-hidden bg-black text-white px-5 py-10 sm:py-14">
      <div className="mx-auto max-w-[900px]">
        <h1 className="text-center text-sm font-medium text-[#9CA3AF] uppercase tracking-wide mb-8">
          Support
        </h1>

        {/* Section 1: Documentation */}
        <section className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 p-6 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
            <h2 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
              Documentation
            </h2>
          </div>
          <p className="text-[11px] text-[#808080] leading-relaxed mb-4">
            Find guides, API reference, and troubleshooting for deployments, trading, deposits, and settlements.
          </p>
          <a
            href="https://doc.dexetera.win/docs/intro"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 bg-[#1A1A1A] hover:bg-[#2A2A2A] text-white py-2 px-4 rounded-md text-[11px] font-medium transition-all duration-200 border border-[#333333] hover:border-[#444444]"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            View Documentation
          </a>
          
          <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
            <div className="pt-3 border-t border-[#1A1A1A] mt-4">
              <span className="text-[9px] text-[#606060]">Comprehensive guides for deployments, trading, and API integration</span>
            </div>
          </div>
        </section>

        {/* Section 2: Contact Support */}
        <section className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 p-6 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
            <h2 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
              Contact Support
            </h2>
          </div>
          <p className="text-[11px] text-[#808080] leading-relaxed mb-4">
            Can't find what you need? Contact our support team with your market symbol and error details.
          </p>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <a
              href="https://mail.google.com/mail/?view=cm&fs=1&to=support@dexetera.xyz&su=Dexetera%20Support%20Request&body=Please%20describe%20your%20issue%20below%3A%0A%0A---%0AInclude%20the%20following%20details%3A%0A-%20Full%20error%20message%20and%20request%20URL%2Fstatus%20code%0A-%20Pipeline%20ID%20(if%20applicable)%0A-%20Screenshot%20of%20console%2FAPI%20errors"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 bg-[#1A1A1A] hover:bg-[#2A2A2A] text-white py-2 px-4 rounded-md text-[11px] font-medium transition-all duration-200 border border-[#333333] hover:border-[#444444]"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Email Support
            </a>
            <span className="text-[10px] text-white font-mono bg-[#1A1A1A] px-2.5 py-1.5 rounded border border-[#222222]">
              support@dexetera.xyz
            </span>
          </div>

          <div className="bg-[#0F0F0F] border border-[#1A1A1A] rounded-md p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-yellow-400" />
              <h3 className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Include these details</h3>
            </div>
            <ul className="space-y-2">
              <li className="flex items-start gap-2">
                <div className="w-1 h-1 rounded-full bg-[#404040] mt-1.5 flex-shrink-0" />
                <span className="text-[10px] text-[#808080]">Full error message and request URL/status code</span>
              </li>
              <li className="flex items-start gap-2">
                <div className="w-1 h-1 rounded-full bg-[#404040] mt-1.5 flex-shrink-0" />
                <span className="text-[10px] text-[#808080]">Pipeline ID (if shown for "Create Market" issues)</span>
              </li>
              <li className="flex items-start gap-2">
                <div className="w-1 h-1 rounded-full bg-[#404040] mt-1.5 flex-shrink-0" />
                <span className="text-[10px] text-[#808080]">Screenshot of console/API errors</span>
              </li>
            </ul>
          </div>

          <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
            <div className="pt-3 border-t border-[#1A1A1A] mt-4">
              <span className="text-[9px] text-[#606060]">Response time: typically within 24 hours</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
