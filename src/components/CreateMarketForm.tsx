import { useState } from 'react';
import { ethers } from 'ethers';

interface CreateMarketFormProps {
  onSubmit: (marketData: MarketFormData) => Promise<void>;
  isLoading?: boolean;
}

interface MarketFormData {
  symbol: string;
  metricUrl: string;
  startPrice: string;
  dataSource: string;
  tags: string[];
  marginBps: number;
  feeBps: number;
  treasury: string;
  disableLeverage: boolean;
}

const DEFAULT_MARGIN_BPS = 10000; // 100%
const DEFAULT_FEE_BPS = 0;

export const CreateMarketForm = ({ onSubmit, isLoading }: CreateMarketFormProps) => {
  const [formData, setFormData] = useState<MarketFormData>({
    symbol: '',
    metricUrl: '',
    startPrice: '1',
    dataSource: '',
    tags: [],
    marginBps: DEFAULT_MARGIN_BPS,
    feeBps: DEFAULT_FEE_BPS,
    treasury: '',
    disableLeverage: true,
  });

  const [tagInput, setTagInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleTagAdd = () => {
    if (tagInput && !formData.tags.includes(tagInput.toUpperCase())) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, tagInput.toUpperCase()]
      }));
      setTagInput('');
    }
  };

  const handleTagRemove = (tag: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(t => t !== tag)
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      // Basic validation
      if (!formData.symbol) throw new Error('Symbol is required');
      if (!formData.metricUrl) throw new Error('Metric URL is required');
      if (!formData.startPrice || isNaN(Number(formData.startPrice))) {
        throw new Error('Valid start price is required');
      }
      if (!formData.dataSource) throw new Error('Data source is required');
      if (!ethers.isAddress(formData.treasury)) {
        throw new Error('Valid treasury address is required');
      }

      await onSubmit(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
            Create New Market
          </h4>
          <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
            {formData.tags.length} Tags
          </div>
        </div>

        {/* Main Form Container */}
        <div className="bg-[#0F0F0F] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
          <div className="p-4 space-y-4">
            {/* Symbol & Start Price Row */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-[11px] font-medium text-[#808080] mb-1">
                  Market Symbol
                </label>
                <input
                  type="text"
                  name="symbol"
                  value={formData.symbol}
                  onChange={handleInputChange}
                  placeholder="e.g. ALU-USD"
                  className="w-full bg-[#1A1A1A] border border-[#222222] rounded px-3 py-2 text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none transition-colors"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-medium text-[#808080] mb-1">
                  Start Price (USD)
                </label>
                <input
                  type="text"
                  name="startPrice"
                  value={formData.startPrice}
                  onChange={handleInputChange}
                  placeholder="1.00"
                  className="w-full bg-[#1A1A1A] border border-[#222222] rounded px-3 py-2 text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none transition-colors"
                />
              </div>
            </div>

            {/* Metric URL */}
            <div>
              <label className="block text-[11px] font-medium text-[#808080] mb-1">
                Metric URL
              </label>
              <input
                type="url"
                name="metricUrl"
                value={formData.metricUrl}
                onChange={handleInputChange}
                placeholder="https://example.com/metric"
                className="w-full bg-[#1A1A1A] border border-[#222222] rounded px-3 py-2 text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none transition-colors"
              />
            </div>

            {/* Data Source */}
            <div>
              <label className="block text-[11px] font-medium text-[#808080] mb-1">
                Data Source
              </label>
              <input
                type="text"
                name="dataSource"
                value={formData.dataSource}
                onChange={handleInputChange}
                placeholder="e.g. CoinGecko API"
                className="w-full bg-[#1A1A1A] border border-[#222222] rounded px-3 py-2 text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none transition-colors"
              />
            </div>

            {/* Tags Section */}
            <div>
              <label className="block text-[11px] font-medium text-[#808080] mb-1">
                Market Tags
              </label>
              <div className="flex gap-2 flex-wrap mb-2">
                {formData.tags.map(tag => (
                  <div
                    key={tag}
                    className="bg-[#1A1A1A] text-[10px] text-white px-2 py-1 rounded-full flex items-center gap-1"
                  >
                    <span>{tag}</span>
                    <button
                      type="button"
                      onClick={() => handleTagRemove(tag)}
                      className="text-[#606060] hover:text-red-400 transition-colors"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="Add tag (press Enter)"
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleTagAdd())}
                  className="flex-1 bg-[#1A1A1A] border border-[#222222] rounded px-3 py-2 text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={handleTagAdd}
                  className="px-3 py-2 bg-[#1A1A1A] border border-[#222222] rounded text-[11px] text-[#808080] hover:border-[#333333] transition-colors"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Treasury Address */}
            <div>
              <label className="block text-[11px] font-medium text-[#808080] mb-1">
                Treasury Address
              </label>
              <input
                type="text"
                name="treasury"
                value={formData.treasury}
                onChange={handleInputChange}
                placeholder="0x..."
                className="w-full bg-[#1A1A1A] border border-[#222222] rounded px-3 py-2 text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none transition-colors font-mono"
              />
            </div>

            {/* Advanced Settings */}
            <div className="pt-4 border-t border-[#1A1A1A]">
              <h5 className="text-[11px] font-medium text-[#808080] mb-3">
                Advanced Settings
              </h5>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-[#808080]">
                    Margin (basis points)
                  </label>
                  <input
                    type="number"
                    name="marginBps"
                    value={formData.marginBps}
                    onChange={handleInputChange}
                    className="w-24 bg-[#1A1A1A] border border-[#222222] rounded px-2 py-1 text-[11px] text-white text-right"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-[#808080]">
                    Fee (basis points)
                  </label>
                  <input
                    type="number"
                    name="feeBps"
                    value={formData.feeBps}
                    onChange={handleInputChange}
                    className="w-24 bg-[#1A1A1A] border border-[#222222] rounded px-2 py-1 text-[11px] text-white text-right"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-[#808080]">
                    Disable Leverage
                  </label>
                  <input
                    type="checkbox"
                    name="disableLeverage"
                    checked={formData.disableLeverage}
                    onChange={(e) => setFormData(prev => ({ ...prev, disableLeverage: e.target.checked }))}
                    className="w-4 h-4 bg-[#1A1A1A] border border-[#222222] rounded text-blue-400 focus:ring-0 focus:ring-offset-0"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="text-[11px] text-red-400 mt-2">
            {error}
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading}
          className={`w-full py-2 px-4 rounded-md text-[11px] font-medium transition-all duration-200 ${
            isLoading
              ? 'bg-[#1A1A1A] text-[#606060] cursor-not-allowed'
              : 'bg-blue-500 hover:bg-blue-600 text-white'
          }`}
        >
          {isLoading ? 'Creating Market...' : 'Create Market'}
        </button>
      </form>
    </div>
  );
};