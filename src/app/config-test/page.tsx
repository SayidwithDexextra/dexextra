import ContractConfigTest from '@/components/ContractConfigTest';

export const metadata = {
  title: 'Dexetrav5 Contract Configuration Test',
  description: 'Test page for verifying Dexetrav5 contract configuration',
};

export default function ConfigTestPage() {
  return (
    <main className="min-h-screen p-4">
      <ContractConfigTest />
    </main>
  );
}
