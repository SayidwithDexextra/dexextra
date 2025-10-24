import ContractConfigTest from '@/components/ContractConfigTest';

export const metadata = {
  title: 'Dexeterav5 Contract Configuration Test',
  description: 'Test page for verifying Dexeterav5 contract configuration',
};

export default function ConfigTestPage() {
  return (
    <main className="min-h-screen p-4">
      <ContractConfigTest />
    </main>
  );
}
