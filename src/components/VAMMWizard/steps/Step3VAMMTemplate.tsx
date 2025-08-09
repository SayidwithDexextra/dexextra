'use client';

import React, { useEffect } from 'react';
import { StepProps } from '../types';
import styles from '../VAMMWizard.module.css';

const PRESET_TEMPLATES = [
  {
    id: 'conservative',
    name: 'Conservative',
    description: 'Lower leverage with higher fees. Ideal for stable metrics like economic indicators.',
    maxLeverage: '20',
    tradingFee: '50', // 0.5%
    liquidationFee: '500', // 5%
    maintenanceMargin: '500', // 5%
    initialReserves: '10000',
    volumeScale: '1000',
    startPrice: '1' // $1 default
  },
  {
    id: 'standard',
    name: 'Standard',
    description: 'Balanced parameters suitable for most metric types.',
    maxLeverage: '50',
    tradingFee: '30', // 0.3%
    liquidationFee: '500', // 5%
    maintenanceMargin: '500', // 5%
    initialReserves: '10000',
    volumeScale: '1000',
    startPrice: '1' // $1 default
  },
  {
    id: 'aggressive',
    name: 'Aggressive',
    description: 'High leverage with lower fees. Best for volatile metrics like weather or sports.',
    maxLeverage: '100',
    tradingFee: '20', // 0.2%
    liquidationFee: '500', // 5%
    maintenanceMargin: '800', // 8%
    initialReserves: '50000',
    volumeScale: '500',
    startPrice: '1' // $1 default
  }
];

export default function Step3VAMMTemplate({ formData, updateFormData, onNext, errors }: StepProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext();
  };

  const handleTemplateTypeChange = (type: 'preset' | 'custom') => {
    updateFormData({ templateType: type });
  };

  const handlePresetSelect = (templateId: string) => {
    updateFormData({ presetTemplate: templateId });
  };

  const handleCustomTemplateChange = (field: string, value: string) => {
    updateFormData({
      customTemplate: {
        ...formData.customTemplate,
        [field]: value
      }
    });
  };

  // Auto-populate start price from AI metric resolution
  useEffect(() => {
    const metricResolution = formData.metricResolution;
    if (metricResolution && 
        metricResolution.status === 'completed' && 
        metricResolution.asset_price_suggestion &&
        metricResolution.asset_price_suggestion !== '0' &&
        (!formData.customTemplate.startPrice || formData.customTemplate.startPrice === '1')) {
      
      // Extract numeric value from asset price suggestion (remove $ and other characters)
      const suggestedPrice = metricResolution.asset_price_suggestion.replace(/[^0-9.]/g, '');
      
      if (suggestedPrice && !isNaN(parseFloat(suggestedPrice))) {
        console.log('🤖 Auto-populating start price from AI suggestion:', suggestedPrice);
        handleCustomTemplateChange('startPrice', suggestedPrice);
      }
    }
  }, [formData.metricResolution, formData.customTemplate.startPrice]);

  const selectedPreset = PRESET_TEMPLATES.find(t => t.id === formData.presetTemplate);

  return (
    <form onSubmit={handleSubmit} className={styles.formSection}>
      <div className={styles.stepHeader}>
        <div className={styles.stepNumber}>03.</div>
        <h1 className={styles.pageTitle}>VAMM Template</h1>
      </div>

      {/* Template Type Selection */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Template Type</div>
          <div className={styles.fieldDescription}>
            Choose between preset templates optimized for different risk profiles, or create a custom template with your own parameters.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>TEMPLATE TYPE (*)</div>
          <div className={styles.categoryTags}>
            <button
              type="button"
              onClick={() => handleTemplateTypeChange('preset')}
              className={`${styles.categoryTag} ${
                formData.templateType === 'preset' ? styles.categoryTagSelected : ''
              }`}
            >
              Preset Template
            </button>
            <button
              type="button"
              onClick={() => handleTemplateTypeChange('custom')}
              className={`${styles.categoryTag} ${
                formData.templateType === 'custom' ? styles.categoryTagSelected : ''
              }`}
            >
              Custom Template
            </button>
          </div>
          {errors.templateType && <div className={styles.errorText}>{errors.templateType}</div>}
          <div className={styles.helpText}>
            Preset templates are pre-configured for common use cases
          </div>
        </div>
      </div>

      {/* Preset Template Selection */}
      {formData.templateType === 'preset' && (
        <div className={styles.fieldRow}>
          <div>
            <div className={styles.fieldLabel}>Preset Templates</div>
            <div className={styles.fieldDescription}>
              Choose from factory-tested templates optimized for different metric categories and risk tolerances.
            </div>
          </div>
          <div className={styles.fieldInput}>
            <div className={styles.inputLabel}>PRESET TEMPLATE (*)</div>
            <div style={{ display: 'grid', gap: '12px' }}>
              {PRESET_TEMPLATES.map((template) => (
                <div
                  key={template.id}
                  onClick={() => handlePresetSelect(template.id)}
                  style={{
                    border: `1px solid ${formData.presetTemplate === template.id ? '#ffffff' : 'rgba(255, 255, 255, 0.2)'}`,
                    borderRadius: '8px',
                    padding: '16px',
                    cursor: 'pointer',
                    backgroundColor: formData.presetTemplate === template.id ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div style={{ fontSize: '16px', fontWeight: '600', color: '#ffffff', marginBottom: '4px' }}>
                    {template.name}
                  </div>
                  <div style={{ fontSize: '13px', color: '#9CA3AF', marginBottom: '8px', lineHeight: '1.4' }}>
                    {template.description}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px' }}>
                    <div style={{ color: '#9CA3AF' }}>Max Leverage: <span style={{ color: '#ffffff' }}>{template.maxLeverage}x</span></div>
                    <div style={{ color: '#9CA3AF' }}>Trading Fee: <span style={{ color: '#ffffff' }}>{(parseInt(template.tradingFee) / 100).toFixed(2)}%</span></div>
                    <div style={{ color: '#9CA3AF' }}>Liquidation Fee: <span style={{ color: '#ffffff' }}>{(parseInt(template.liquidationFee) / 100).toFixed(1)}%</span></div>
                    <div style={{ color: '#9CA3AF' }}>Maintenance Margin: <span style={{ color: '#ffffff' }}>{(parseInt(template.maintenanceMargin) / 100).toFixed(1)}%</span></div>
                  </div>
                </div>
              ))}
            </div>
            {errors.presetTemplate && <div className={styles.errorText}>{errors.presetTemplate}</div>}
            <div className={styles.helpText}>
              Click to select a preset template that matches your risk profile
            </div>
          </div>
        </div>
      )}

      {/* Custom Start Price - Available for both preset and custom templates */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Starting Price</div>
          <div className={styles.fieldDescription}>
            Set the initial price at which your asset will start trading. This determines the baseline value for your market. 
            {formData.metricResolution?.asset_price_suggestion && (
              <span style={{ color: '#10B981', marginLeft: '8px' }}>
                💡 AI suggested: ${formData.metricResolution.asset_price_suggestion.replace(/[^0-9.]/g, '')}
              </span>
            )}
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>
            START PRICE (USD) (*)
            {formData.metricResolution?.asset_price_suggestion && 
             formData.customTemplate.startPrice === formData.metricResolution.asset_price_suggestion.replace(/[^0-9.]/g, '') && (
              <span style={{ color: '#10B981', fontSize: '11px', marginLeft: '8px' }}>
                🤖 AI Auto-filled
              </span>
            )}
          </div>
          <input
            type="number"
            value={formData.templateType === 'preset' 
              ? formData.customTemplate.startPrice 
              : formData.customTemplate.startPrice}
            onChange={(e) => handleCustomTemplateChange('startPrice', e.target.value)}
            placeholder="10"
            min="0.01"
            step="0.01"
            className={`${styles.input} ${errors.startPrice ? styles.inputError : ''}`}
            style={{
              borderColor: formData.metricResolution?.asset_price_suggestion && 
                          formData.customTemplate.startPrice === formData.metricResolution.asset_price_suggestion.replace(/[^0-9.]/g, '') 
                          ? '#10B981' : undefined
            }}
          />
          {formData.metricResolution?.asset_price_suggestion && 
           formData.customTemplate.startPrice !== formData.metricResolution.asset_price_suggestion.replace(/[^0-9.]/g, '') && (
            <button
              type="button"
              onClick={() => {
                const suggestedPrice = formData.metricResolution!.asset_price_suggestion.replace(/[^0-9.]/g, '');
                handleCustomTemplateChange('startPrice', suggestedPrice);
              }}
              style={{
                marginTop: '8px',
                padding: '6px 12px',
                backgroundColor: '#10B981',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              🤖 Use AI Suggestion (${formData.metricResolution.asset_price_suggestion.replace(/[^0-9.]/g, '')})
            </button>
          )}
          {errors.startPrice && <div className={styles.errorText}>{errors.startPrice}</div>}
          <div className={styles.helpText}>
            Starting price in USD (e.g., 88 for $88.00, 10 for $10.00)
            {formData.metricResolution?.asset_price_suggestion && (
              <span style={{ color: '#10B981', display: 'block', marginTop: '4px' }}>
                💡 AI analysis suggests ${formData.metricResolution.asset_price_suggestion.replace(/[^0-9.]/g, '')} based on your metric data
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Custom Template Configuration */}
      {formData.templateType === 'custom' && (
        <>
          {/* Max Leverage */}
          <div className={styles.fieldRow}>
            <div>
              <div className={styles.fieldLabel}>Maximum Leverage</div>
              <div className={styles.fieldDescription}>
                The highest leverage multiplier users can select. Higher leverage increases profit potential but also liquidation risk.
              </div>
            </div>
            <div className={styles.fieldInput}>
              <div className={styles.inputLabel}>MAX LEVERAGE (1-100) (*)</div>
              <input
                type="number"
                value={formData.customTemplate.maxLeverage}
                onChange={(e) => handleCustomTemplateChange('maxLeverage', e.target.value)}
                placeholder="50"
                min="1"
                max="100"
                className={`${styles.input} ${errors.maxLeverage ? styles.inputError : ''}`}
              />
              {errors.maxLeverage && <div className={styles.errorText}>{errors.maxLeverage}</div>}
              <div className={styles.helpText}>
                Leverage between 1x and 100x (e.g., 50 = 50x leverage)
              </div>
            </div>
          </div>

          {/* Trading Fee Rate */}
          <div className={styles.fieldRow}>
            <div>
              <div className={styles.fieldLabel}>Trading Fee Rate</div>
              <div className={styles.fieldDescription}>
                Fee charged on each trade as a percentage of the position size. Lower fees attract more traders.
              </div>
            </div>
            <div className={styles.fieldInput}>
              <div className={styles.inputLabel}>TRADING FEE (BASIS POINTS) (*)</div>
              <input
                type="number"
                value={formData.customTemplate.tradingFeeRate}
                onChange={(e) => handleCustomTemplateChange('tradingFeeRate', e.target.value)}
                placeholder="30"
                min="0"
                max="1000"
                className={`${styles.input} ${errors.tradingFeeRate ? styles.inputError : ''}`}
              />
              {errors.tradingFeeRate && <div className={styles.errorText}>{errors.tradingFeeRate}</div>}
              <div className={styles.helpText}>
                Fee in basis points (30 = 0.3%, 100 = 1%, max 1000 = 10%)
              </div>
            </div>
          </div>

          {/* Liquidation Fee Rate */}
          <div className={styles.fieldRow}>
            <div>
              <div className={styles.fieldLabel}>Liquidation Fee Rate</div>
              <div className={styles.fieldDescription}>
                Fee charged when positions are liquidated due to insufficient margin. Compensates liquidators and protects the system.
              </div>
            </div>
            <div className={styles.fieldInput}>
              <div className={styles.inputLabel}>LIQUIDATION FEE (BASIS POINTS) (*)</div>
              <input
                type="number"
                value={formData.customTemplate.liquidationFeeRate}
                onChange={(e) => handleCustomTemplateChange('liquidationFeeRate', e.target.value)}
                placeholder="500"
                min="0"
                max="2000"
                className={`${styles.input} ${errors.liquidationFeeRate ? styles.inputError : ''}`}
              />
              {errors.liquidationFeeRate && <div className={styles.errorText}>{errors.liquidationFeeRate}</div>}
              <div className={styles.helpText}>
                Fee in basis points (500 = 5%, max 2000 = 20%)
              </div>
            </div>
          </div>

          {/* Maintenance Margin Ratio */}
          <div className={styles.fieldRow}>
            <div>
              <div className={styles.fieldLabel}>Maintenance Margin</div>
              <div className={styles.fieldDescription}>
                Minimum margin ratio required to avoid liquidation. Higher ratios provide more safety buffer.
              </div>
            </div>
            <div className={styles.fieldInput}>
              <div className={styles.inputLabel}>MAINTENANCE MARGIN (BASIS POINTS) (*)</div>
              <input
                type="number"
                value={formData.customTemplate.maintenanceMarginRatio}
                onChange={(e) => handleCustomTemplateChange('maintenanceMarginRatio', e.target.value)}
                placeholder="500"
                min="100"
                max="5000"
                className={`${styles.input} ${errors.maintenanceMarginRatio ? styles.inputError : ''}`}
              />
              {errors.maintenanceMarginRatio && <div className={styles.errorText}>{errors.maintenanceMarginRatio}</div>}
              <div className={styles.helpText}>
                Margin ratio in basis points (500 = 5%, min 100 = 1%)
              </div>
            </div>
          </div>

          {/* Initial Reserves */}
          <div className={styles.fieldRow}>
            <div>
              <div className={styles.fieldLabel}>Initial Reserves</div>
              <div className={styles.fieldDescription}>
                Starting virtual liquidity for the AMM. Higher reserves provide better price stability for larger trades.
              </div>
            </div>
            <div className={styles.fieldInput}>
              <div className={styles.inputLabel}>INITIAL RESERVES (*)</div>
              <input
                type="number"
                value={formData.customTemplate.initialReserves}
                onChange={(e) => handleCustomTemplateChange('initialReserves', e.target.value)}
                placeholder="10000"
                min="1000"
                className={`${styles.input} ${errors.initialReserves ? styles.inputError : ''}`}
              />
              {errors.initialReserves && <div className={styles.errorText}>{errors.initialReserves}</div>}
              <div className={styles.helpText}>
                Virtual reserves for AMM pricing (e.g., 10000)
              </div>
            </div>
          </div>

          {/* Volume Scale Factor */}
          <div className={styles.fieldRow}>
            <div>
              <div className={styles.fieldLabel}>Volume Scale Factor</div>
              <div className={styles.fieldDescription}>
                How reserves scale with trading volume. Higher factors make reserves grow faster with activity.
              </div>
            </div>
            <div className={styles.fieldInput}>
              <div className={styles.inputLabel}>VOLUME SCALE FACTOR (*)</div>
              <input
                type="number"
                value={formData.customTemplate.volumeScaleFactor}
                onChange={(e) => handleCustomTemplateChange('volumeScaleFactor', e.target.value)}
                placeholder="1000"
                min="100"
                max="10000"
                className={`${styles.input} ${errors.volumeScaleFactor ? styles.inputError : ''}`}
              />
              {errors.volumeScaleFactor && <div className={styles.errorText}>{errors.volumeScaleFactor}</div>}
              <div className={styles.helpText}>
                Scaling factor for reserve growth (e.g., 1000)
              </div>
            </div>
          </div>
        </>
      )}

      {/* Template Preview */}
      {formData.templateType === 'preset' && selectedPreset && (
        <div className={styles.fieldRow}>
          <div>
            <div className={styles.fieldLabel}>Template Preview</div>
            <div className={styles.fieldDescription}>
              Review the parameters of your selected preset template with your custom start price.
            </div>
          </div>
          <div className={styles.fieldInput}>
            <div style={{ 
              background: 'rgba(255, 255, 255, 0.05)', 
              border: '1px solid rgba(255, 255, 255, 0.1)', 
              borderRadius: '8px', 
              padding: '16px' 
            }}>
              <div style={{ fontSize: '14px', fontWeight: '600', color: '#ffffff', marginBottom: '12px' }}>
                {selectedPreset.name} Template
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                <div style={{ color: '#9CA3AF' }}>Max Leverage: <span style={{ color: '#ffffff' }}>{selectedPreset.maxLeverage}x</span></div>
                <div style={{ color: '#9CA3AF' }}>Trading Fee: <span style={{ color: '#ffffff' }}>{(parseInt(selectedPreset.tradingFee) / 100).toFixed(2)}%</span></div>
                <div style={{ color: '#9CA3AF' }}>Liquidation Fee: <span style={{ color: '#ffffff' }}>{(parseInt(selectedPreset.liquidationFee) / 100).toFixed(1)}%</span></div>
                <div style={{ color: '#9CA3AF' }}>Maintenance Margin: <span style={{ color: '#ffffff' }}>{(parseInt(selectedPreset.maintenanceMargin) / 100).toFixed(1)}%</span></div>
                <div style={{ color: '#9CA3AF' }}>Initial Reserves: <span style={{ color: '#ffffff' }}>{parseInt(selectedPreset.initialReserves).toLocaleString()}</span></div>
                <div style={{ color: '#9CA3AF' }}>Volume Scale: <span style={{ color: '#ffffff' }}>{selectedPreset.volumeScale}</span></div>
                <div style={{ color: '#9CA3AF' }}>Start Price: <span style={{ color: '#ffffff' }}>${formData.customTemplate.startPrice || '1.00'}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </form>
  );
} 