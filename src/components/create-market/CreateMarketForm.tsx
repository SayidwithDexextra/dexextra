'use client';

import { useRef, useState } from 'react';
import { useCreateMarketForm, MarketFormData } from '@/hooks/useCreateMarketForm';
import { MarketAIAssistant, MarketAIAssistantHandle } from './MarketAIAssistant';

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
    setFormData
  } = useCreateMarketForm();

  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const iconInputRef = useRef<HTMLInputElement | null>(null);
  const [highlightMetric, setHighlightMetric] = useState(false);
  const [highlightDescription, setHighlightDescription] = useState(false);
  const assistantRef = useRef<MarketAIAssistantHandle | null>(null);
  const [autoSubmitOnResolution, setAutoSubmitOnResolution] = useState(false);

  const handleIconPick = () => iconInputRef.current?.click();
  const handleIconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (file) {
      const previewUrl = URL.createObjectURL(file);
      setFormData(prev => ({ ...prev, iconImageFile: file, iconImagePreview: previewUrl }));
    }
  };
  const handleIconRemove = () => {
    setFormData(prev => ({ ...prev, iconImageFile: null, iconImagePreview: '' }));
    if (iconInputRef.current) iconInputRef.current.value = '';
  };

  const handleRequireInputs = () => {
    // restart animation reliably by toggling off → on on the next frame
    setHighlightMetric(false);
    setHighlightDescription(false);
    requestAnimationFrame(() => {
      setHighlightMetric(true);
      setHighlightDescription(true);
      setTimeout(() => {
        setHighlightMetric(false);
        setHighlightDescription(false);
      }, 1200);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      validateForm();
      await onSubmit(formData);
    } catch (err) {
      const message = err instanceof Error ? err.message : (typeof err === 'string' ? err : 'An error occurred');
      // If missing AI-resolved fields, trigger AI flow instead of showing error
      if (message.includes('Metric URL is required') || message.includes('Data source is required')) {
        setAutoSubmitOnResolution(true);
        assistantRef.current?.startAnalysis();
        return;
      }
      setError(message);
    }
  };

  const handleMetricResolution = (data: { metricUrl: string; dataSource: string; startPrice: string }) => {
    const updated = {
      ...formData,
      metricUrl: data.metricUrl,
      dataSource: data.dataSource,
      startPrice: data.startPrice
    };
    setFormData(updated);

    if (autoSubmitOnResolution) {
      setAutoSubmitOnResolution(false);
      // Proceed to submit with updated data
      void (async () => {
        try {
          await onSubmit(updated);
        } catch (submitErr) {
          setError(submitErr instanceof Error ? submitErr.message : 'An error occurred');
        }
      })();
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      <form onSubmit={handleSubmit} className="space-y-4">
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
          <div className="p-4 space-y-4">
            {/* Symbol, Start Price, Treasury Row */}
            <div className="grid grid-cols-3 gap-4">
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
                  className="w-full bg-[#1A1A1A] border border-[#222222] rounded px-3 py-2 text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none transition-colors"
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
                  className="w-full bg-[#1A1A1A] border border-[#222222] rounded px-3 py-2 text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none transition-colors"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-medium text-[#808080] mb-2">
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
            </div>

            {/* Metric and Description for AI */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex-1">
                <label className="block text-[11px] font-medium text-[#808080] mb-2">
                  Metric to Resolve
                </label>
                <div className="relative">
                  <input
                    type="text"
                    name="metric"
                    value={formData.metric}
                    onChange={handleInputChange}
                    placeholder="e.g. Aluminum spot price (USD/ton)"
                    className={`w-full bg-[#1A1A1A] border ${highlightMetric ? 'border-red-500 ring-2 ring-red-500' : 'border-[#222222]'} rounded px-3 py-2 text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none transition-colors`}
                  />
                  {highlightMetric && (
                    <span className="pointer-events-none absolute -right-1 -top-1 inline-flex h-3 w-3">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-red-500/70 animate-[ping_0.6s_ease-out_2]"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                    </span>
                  )}
                </div>
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-medium text-[#808080] mb-2">
                  Description/Context
                </label>
                <div className="relative">
                  <input
                    type="text"
                    name="metricDescription"
                    value={formData.metricDescription}
                    onChange={handleInputChange}
                    placeholder="e.g. Use trusted sources, latest daily price"
                    className={`w-full bg-[#1A1A1A] border ${highlightDescription ? 'border-red-500 ring-2 ring-red-500' : 'border-[#222222]'} rounded px-3 py-2 text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none transition-colors`}
                  />
                  {highlightDescription && (
                    <span className="pointer-events-none absolute -right-1 -top-1 inline-flex h-3 w-3">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-red-500/70 animate-[ping_0.6s_ease-out_2]"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* AI Assistant for Metric URL */}
            <div>
              <label className="block text-[11px] font-medium text-[#808080] mb-2">
                Market Data Source
              </label>
              <MarketAIAssistant
                ref={assistantRef}
                metric={formData.metric}
                description={formData.metricDescription}
                compact
                onMetricResolution={handleMetricResolution}
                onRequireInputs={handleRequireInputs}
              />
              {/* Hidden input to store metricUrl value */}
              <input type="hidden" name="metricUrl" value={formData.metricUrl} />
            </div>

            {/* Data Source (inline) */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center justify-between text-[11px] text-[#808080]">
                <span className="truncate">Resolved Source</span>
                <span className="text-white truncate max-w-[65%] text-right">{formData.dataSource || '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#808080]">Market Icon</span>
                <div className="flex items-center gap-2 flex-wrap">
                  {(formData.iconImagePreview || formData.iconUrl) ? (
                    <img src={formData.iconImagePreview || formData.iconUrl} alt="Market Icon" className="w-6 h-6 rounded" />
                  ) : (
                    <div className="w-6 h-6 rounded bg-[#1A1A1A] border border-[#222222]" />
                  )}
                  <button
                    type="button"
                    onClick={handleIconPick}
                    className="px-2 py-1 bg-[#1A1A1A] border border-[#222222] rounded text-[11px] text-[#808080] hover:border-[#333333]"
                  >
                    Upload
                  </button>
                  {formData.iconImagePreview && (
                    <button
                      type="button"
                      onClick={handleIconRemove}
                      className="px-2 py-1 bg-transparent border border-[#222222] rounded text-[11px] text-[#808080] hover:text-red-400 hover:border-[#333333]"
                    >
                      Remove
                    </button>
                  )}
                  <input
                    type="url"
                    name="iconUrl"
                    value={formData.iconUrl || ''}
                    onChange={handleInputChange}
                    placeholder="Icon URL (https://...)"
                    className="w-56 bg-[#1A1A1A] border border-[#222222] rounded px-2 py-1 text-[11px] text-white placeholder-[#404040] focus:border-[#333333] focus:outline-none"
                  />
                  <input
                    ref={iconInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleIconChange}
                  />
                </div>
              </div>
            </div>

            {/* Tags Section */}
            <div>
              <label className="block text-[11px] font-medium text-[#808080] mb-2">
                Market Tags
              </label>
              <div className="flex gap-2 flex-wrap mb-2">
                {formData.tags.slice(0, 3).map(tag => (
                  <div
                    key={`tag-${tag}`}
                    className="bg-[#1A1A1A] text-[10px] text-white px-2 py-0.5 rounded-full flex items-center gap-1.5"
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
                {formData.tags.length > 3 && (
                  <div className="text-[10px] text-[#808080] bg-[#1A1A1A] px-2 py-0.5 rounded-full">
                    +{formData.tags.length - 3} more
                  </div>
                )}
              </div>
              <div className="flex gap-3">
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
            {/* Advanced Settings */}
            <div className="pt-4 border-t border-[#1A1A1A]">
              <div className="flex items-center justify-between mb-2">
                <h5 className="text-[11px] font-medium text-[#808080]">
                  Advanced Settings
                </h5>
                <button
                  type="button"
                  onClick={() => setIsAdvancedOpen(v => !v)}
                  className="text-[11px] text-[#808080] hover:text-white"
                >
                  {isAdvancedOpen ? 'Hide' : 'Show'}
                </button>
              </div>
              {isAdvancedOpen && (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] text-[#808080] mb-2">
                    Margin (bps)
                  </label>
                  <input
                    type="number"
                    name="marginBps"
                    value={formData.marginBps}
                    onChange={handleInputChange}
                    className="w-full bg-[#1A1A1A] border border-[#222222] rounded px-3 py-2 text-[11px] text-white text-right"
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
                    className="w-full bg-[#1A1A1A] border border-[#222222] rounded px-3 py-2 text-[11px] text-white text-right"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#808080] mb-2">
                    Disable Leverage
                  </label>
                  <div className="flex h-[34px] items-center justify-end">
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
              )}
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
          className={`w-full py-2.5 px-4 rounded-md text-[11px] font-medium transition-all duration-200 ${
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