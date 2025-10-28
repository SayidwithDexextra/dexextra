export default function MarketsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col bg-[#0F0F0F]">
      {children}
    </main>
  );
}

