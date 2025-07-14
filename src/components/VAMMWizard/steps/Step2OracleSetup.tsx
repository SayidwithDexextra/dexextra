'use client';

import React from 'react';
import { StepProps } from '../types';
import styles from '../VAMMWizard.module.css';

const COMMON_ORACLES = [
  { value: '', label: 'Enter custom oracle address' },
  { value: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', label: 'Chainlink ETH/USD (Mainnet)' },
  { value: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c', label: 'Chainlink BTC/USD (Mainnet)' },
  { value: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6', label: 'Chainlink USDC/USD (Mainnet)' },
  { value: '0x773616E4d11A78F511299002da57A0a94577F1f4', label: 'Chainlink DAI/USD (Mainnet)' }
];

const PRICE_DECIMALS_OPTIONS = [
  { value: 8, label: '8 decimals (Standard for USD pairs)' },
  { value: 18, label: '18 decimals (Standard for tokens)' },
  { value: 6, label: '6 decimals (USDC standard)' },
  { value: 12, label: '12 decimals (Custom)' }
];

interface Step2Props extends StepProps {
  defaultOracle?: string;
}

export default function Step2OracleSetup({ formData, updateFormData, onNext, onPrevious, errors, defaultOracle }: Step2Props) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext();
  };

  const handleOracleSelect = (value: string) => {
    updateFormData({ oracleAddress: value });
  };

  // Create enhanced oracle options with default oracle if provided
  const oracleOptions = React.useMemo(() => {
    const options = [...COMMON_ORACLES];
    
    if (defaultOracle && !options.some(opt => opt.value === defaultOracle)) {
      options.splice(1, 0, {
        value: defaultOracle,
        label: `Deployed Mock Oracle (${defaultOracle.slice(0, 8)}...)`
      });
    }
    
    return options;
  }, [defaultOracle]);

  return (
    <form onSubmit={handleSubmit} className={styles.formSection}>
      <div className={styles.stepHeader}>
        <div className={styles.stepNumber}>02.</div>
        <h1 className={styles.pageTitle}>Oracle</h1>
      </div>

      {/* Oracle Address */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Price Oracle</div>
          <div className={styles.fieldDescription}>
            Configure the price oracle that will provide external price data for your vAMM. This is crucial for accurate pricing and liquidations.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>ORACLE ADDRESS (*)</div>
          <select
            value={formData.oracleAddress}
            onChange={(e) => handleOracleSelect(e.target.value)}
            className={styles.select}
          >
            {oracleOptions.map((oracle) => (
              <option key={oracle.value} value={oracle.value}>
                {oracle.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={formData.oracleAddress}
            onChange={(e) => updateFormData({ oracleAddress: e.target.value })}
            placeholder="0x..."
            className={`${styles.input} ${errors.oracleAddress ? styles.inputError : ''}`}
            style={{ marginTop: '16px' }}
          />
          {errors.oracleAddress && <div className={styles.errorText}>{errors.oracleAddress}</div>}
          <div className={styles.helpText}>
            Select a pre-configured oracle or enter a custom contract address
            {defaultOracle && (
              <><br />💡 Tip: We've pre-selected the deployed Mock Oracle for testing</>
            )}
          </div>
        </div>
      </div>

      {/* Initial Price */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Initial Price</div>
          <div className={styles.fieldDescription}>
            Set the starting price for your market. This will be used as the initial reference point for all trading activities.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>PRICE (*)</div>
          <input
            type="number"
            step="0.000001"
            min="0"
            value={formData.initialPrice}
            onChange={(e) => updateFormData({ initialPrice: e.target.value })}
            placeholder=""
            className={`${styles.input} ${errors.initialPrice ? styles.inputError : ''}`}
          />
          {errors.initialPrice && <div className={styles.errorText}>{errors.initialPrice}</div>}
          <div className={styles.helpText}>
            Enter the starting price for the market
          </div>
        </div>
      </div>

      {/* Price Decimals */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Precision</div>
          <div className={styles.fieldDescription}>
            Choose the decimal precision for prices in your market. This affects how precise price movements can be.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>DECIMALS (*)</div>
          <select
            value={formData.priceDecimals}
            onChange={(e) => updateFormData({ priceDecimals: parseInt(e.target.value) })}
            className={`${styles.select} ${errors.priceDecimals ? styles.inputError : ''}`}
          >
            {PRICE_DECIMALS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {errors.priceDecimals && <div className={styles.errorText}>{errors.priceDecimals}</div>}
          
          {/* Price Preview */}
          {formData.initialPrice && (
            <div className={styles.previewBox}>
              <div className={styles.previewTitle}>Price Preview</div>
              <div className={styles.previewItem}>
                <span className={styles.previewLabel}>Raw Value:</span>
                <span className={styles.previewValue}>
                  {(parseFloat(formData.initialPrice) * Math.pow(10, formData.priceDecimals)).toLocaleString()}
                </span>
              </div>
              <div className={styles.previewItem}>
                <span className={styles.previewLabel}>Display:</span>
                <span className={styles.previewValue}>
                  {parseFloat(formData.initialPrice).toFixed(Math.min(formData.priceDecimals, 6))}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </form>
  );
} 