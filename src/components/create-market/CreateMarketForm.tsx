'use client';

import { useCreateMarketForm, MarketFormData } from '@/hooks/useCreateMarketForm';

interface CreateMarketFormProps {
  onSubmit: (marketData: MarketFormData) => Promise<void>;
  isLoading?: boolean;
}

export const CreateMarketForm = ({ onSubmit, isLoading }: CreateMarketFormProps) => {
  const {
    formData,
    tagInput,
    error,
    setError,
    handleInputChange,
    handleTagAdd,
    handleTagRemove,
    setTagInput,
    validateForm,
  } = useCreateMarketForm();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      validateForm();
      await onSubmit(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
            Market Details
          </h4>
          <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
            {formData.tags.length} Tags
          </div>
        </div>

        {/* Main Form Container */}
        <div className="bg-[#0F0F0F] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
          <div className="p-6 space-y-6">
            {/* Symbol & Start Price Row */}
            <div className="flex gap-6">
              <div className="flex-1">
                <label className="block text-[11px] font-medium text-[#808080] mb-2">
                  Market Symbol
                </label>
                <input
                  type="text"
                  name="symbol"
                  value={formData.symbol}
                  onChange={handleInputChange}
                  placeholder="e.g. ALU-USD"
                  className="w-full bg-[#1A1A1A] border border-[#222222] rounded px-3 py-2.5 text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none transition-colors"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-medium text-[#808080] mb-2">
                  Start Price (USD)
                </label>
                <input
                  type="text"
                  name="startPrice"
                  value={formData.startPrice}
                  onChange={handleInputChange}
                  placeholder="1.00"
                  className="w-full bg-[#1A1A1A] border border-[#222222] rounded px-3 py-2.5 text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none transition-colors"
                />
              </div>
            </div>

            {/* Metric URL & Data Source Row */}
            <div className="flex gap-6">
              <div className="flex-1">
                <label className="block text-[11px] font-medium text-[#808080] mb-2">
                  Metric URL
                </label>
                <input
                  type="url"
                  name="metricUrl"
                  value={formData.metricUrl}
                  onChange={handleInputChange}
                  placeholder="https://example.com/metric"
                  className="w-full bg-[#1A1A1A] border border-[#222222] rounded px-3 py-2.5 text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none transition-colors"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-medium text-[#808080] mb-2">
                  Data Source
                </label>
                <input
                  type="text"
                  name="dataSource"
                  value={formData.dataSource}
                  onChange={handleInputChange}
                  placeholder="e.g. CoinGecko API"
                  className="w-full bg-[#1A1A1A] border border-[#222222] rounded px-3 py-2.5 text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none transition-colors"
                />
              </div>
            </div>

            {/* Tags Section */}
            <div>
              <label className="block text-[11px] font-medium text-[#808080] mb-2">
                Market Tags
              </label>
              <div className="flex gap-2 flex-wrap mb-3">
                {formData.tags.map(tag => (
                  <div
                    key={`tag-${tag}`}
                    className="bg-[#1A1A1A] text-[10px] text-white px-2.5 py-1 rounded-full flex items-center gap-1.5"
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
              <div className="flex gap-3">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="Add tag (press Enter)"
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleTagAdd())}
                  className="flex-1 bg-[#1A1A1A] border border-[#222222] rounded px-3 py-2.5 text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={handleTagAdd}
                  className="px-4 py-2.5 bg-[#1A1A1A] border border-[#222222] rounded text-[11px] text-[#808080] hover:border-[#333333] transition-colors"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Treasury Address */}
            <div>
              <label className="block text-[11px] font-medium text-[#808080] mb-2">
                Treasury Address
              </label>
              <input
                type="text"
                name="treasury"
                value={formData.treasury}
                onChange={handleInputChange}
                placeholder="0x..."
                className="w-full bg-[#1A1A1A] border border-[#222222] rounded px-3 py-2.5 text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none transition-colors font-mono"
              />
            </div>

            {/* Advanced Settings */}
            <div className="pt-6 border-t border-[#1A1A1A]">
              <h5 className="text-[11px] font-medium text-[#808080] mb-4">
                Advanced Settings
              </h5>
              <div className="grid grid-cols-3 gap-6">
                <div>
                  <label className="block text-[11px] text-[#808080] mb-2">
                    Margin (bps)
                  </label>
                  <input
                    type="number"
                    name="marginBps"
                    value={formData.marginBps}
                    onChange={handleInputChange}
                    className="w-full bg-[#1A1A1A] border border-[#222222] rounded px-3 py-2.5 text-[11px] text-white text-right"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#808080] mb-2">
                    Fee (bps)
                  </label>
                  <input
                    type="number"
                    name="feeBps"
                    value={formData.feeBps}
                    onChange={handleInputChange}
                    className="w-full bg-[#1A1A1A] border border-[#222222] rounded px-3 py-2.5 text-[11px] text-white text-right"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#808080] mb-2">
                    Disable Leverage
                  </label>
                  <div className="flex h-[34px] items-center">
                    <input
                      type="checkbox"
                      name="disableLeverage"
                      checked={formData.disableLeverage}
                      onChange={(e) => handleInputChange({
                        ...e,
                        target: { ...e.target, name: 'disableLeverage', value: e.target.checked }
                      } as any)}
                      className="w-4 h-4 bg-[#1A1A1A] border border-[#222222] rounded text-blue-400 focus:ring-0 focus:ring-offset-0"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="text-[11px] text-red-400">
            {error}
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading}
          className={`w-full py-3 px-4 rounded-md text-[11px] font-medium transition-all duration-200 ${
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