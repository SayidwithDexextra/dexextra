'use client';

import { useState, useEffect } from 'react';
import { useMockUSDC, useCoreVault, useAluminumOrderBook } from '@/hooks/useContract';
import { DEXETRAV5_CONFIG, getAllContractAddresses } from '@/lib/contractConfig';

/**
 * Test component to verify contract loading from Dexetrav5 config
 */
export default function ContractConfigTest() {
  const [allAddresses, setAllAddresses] = useState<Record<string, string>>({});
  const [networkInfo, setNetworkInfo] = useState<any>(null);
  const [marketInfo, setMarketInfo] = useState<any>(null);

  // Test contract hooks
  const mockUSDC = useMockUSDC();
  const coreVault = useCoreVault();
  const aluminumOrderBook = useAluminumOrderBook();

  // Load configuration on mount
  useEffect(() => {
    // Get all contract addresses
    const addresses = getAllContractAddresses();
    setAllAddresses(addresses);

    // Get network configuration
    const network = DEXETRAV5_CONFIG.getNetworkConfig();
    setNetworkInfo(network);

    // Get market information
    const markets = DEXETRAV5_CONFIG.getMarketInfo();
    setMarketInfo(markets);
  }, []);

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Dexetrav5 Contract Configuration Test</h1>
      
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-2">Network Configuration</h2>
        <div className="bg-gray-100 p-4 rounded">
          {networkInfo ? (
            <pre className="whitespace-pre-wrap">
              {JSON.stringify(networkInfo, null, 2)}
            </pre>
          ) : (
            <p>Loading network information...</p>
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-2">Contract Addresses</h2>
        <div className="bg-gray-100 p-4 rounded">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left">Contract Key</th>
                <th className="text-left">Address</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(allAddresses).map(([key, address]) => (
                <tr key={key}>
                  <td className="pr-4">{key}</td>
                  <td className="font-mono">{address}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-2">Market Information</h2>
        <div className="bg-gray-100 p-4 rounded">
          {marketInfo ? (
            <pre className="whitespace-pre-wrap">
              {JSON.stringify(marketInfo, null, 2)}
            </pre>
          ) : (
            <p>Loading market information...</p>
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-2">Contract Hooks Test</h2>
        <div className="space-y-4">
          <div className="bg-gray-100 p-4 rounded">
            <h3 className="font-semibold">MockUSDC Contract</h3>
            <p>Loading: {mockUSDC.isLoading ? 'Yes' : 'No'}</p>
            <p>Error: {mockUSDC.error ? mockUSDC.error.message : 'None'}</p>
            <p>Address: {mockUSDC.address || 'Not available'}</p>
          </div>

          <div className="bg-gray-100 p-4 rounded">
            <h3 className="font-semibold">CoreVault Contract</h3>
            <p>Loading: {coreVault.isLoading ? 'Yes' : 'No'}</p>
            <p>Error: {coreVault.error ? coreVault.error.message : 'None'}</p>
            <p>Address: {coreVault.address || 'Not available'}</p>
          </div>

          <div className="bg-gray-100 p-4 rounded">
            <h3 className="font-semibold">AluminumOrderBook Contract</h3>
            <p>Loading: {aluminumOrderBook.isLoading ? 'Yes' : 'No'}</p>
            <p>Error: {aluminumOrderBook.error ? aluminumOrderBook.error.message : 'None'}</p>
            <p>Address: {aluminumOrderBook.address || 'Not available'}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
