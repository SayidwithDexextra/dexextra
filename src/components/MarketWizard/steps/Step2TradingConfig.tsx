'use client';

import React from 'react';
import { StepProps } from '../types';
import styles from '../MarketWizard.module.css';

export default function Step2TradingConfig({ formData, updateFormData, onNext, errors }: StepProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext();
  };

  const handleDecimalsChange = (value: string) => {
    const decimals = parseInt(value);
    if (!isNaN(decimals) && decimals >= 1 && decimals <= 18) {
      updateFormData({ decimals });
    }
  };

  // Calculate example values based on current inputs
  const getExampleMinOrder = () => {
    if (!formData.minimumOrderSize) return '';
    const minOrder = parseFloat(formData.minimumOrderSize);
    return minOrder ? `Minimum order: ${minOrder} units` : '';
  };

  // Tick size is now fixed at 0.01 - no longer user configurable

  return (
    <form onSubmit={handleSubmit} className={styles.formSection}>
      <div className={styles.stepHeader}>
        <div className={styles.stepNumber}>02.</div>
        <h1 className={styles.pageTitle}>Trading Configuration</h1>
      </div>

      {/* Decimals */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Decimal Precision</div>
          <div className={styles.fieldDescription}>
            Number of decimal places for the metric value. This determines the precision of pricing and order quantities in the orderbook. Most metrics use 8 decimals.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>DECIMALS (*)</div>
          <select
            value={formData.decimals}
            onChange={(e) => handleDecimalsChange(e.target.value)}
            className={`${styles.input} ${errors.decimals ? styles.inputError : ''}`}
          >
            <option value="">Select decimals</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 18].map(num => (
              <option key={num} value={num}>{num} decimals</option>
            ))}
          </select>
          {errors.decimals && <div className={styles.errorText}>{errors.decimals}</div>}
          <div className={styles.helpText}>
            8 decimals is standard for most metrics (allows values like 123.45678901)
          </div>
        </div>
      </div>

      {/* Minimum Order Size */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Minimum Order Size</div>
          <div className={styles.fieldDescription}>
            Smallest order quantity that can be placed in the orderbook. This prevents spam orders and ensures meaningful trading activity. Set based on your metric's typical values.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>MINIMUM ORDER SIZE (*)</div>
          <input
            type="text"
            value={formData.minimumOrderSize}
            onChange={(e) => updateFormData({ minimumOrderSize: e.target.value })}
            placeholder="1.0"
            className={`${styles.input} ${errors.minimumOrderSize ? styles.inputError : ''}`}
          />
          {errors.minimumOrderSize && <div className={styles.errorText}>{errors.minimumOrderSize}</div>}
          <div className={styles.helpText}>
            {getExampleMinOrder() || 'Enter a positive number (e.g., 1.0 for population metrics)'}
          </div>
        </div>
      </div>

      {/* Tick Size - Fixed at 0.01 */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Tick Size</div>
          <div className={styles.fieldDescription}>
            All markets use a standardized tick size of 0.01 for consistent cent-level precision across the platform. This ensures uniform price increments and reduces complexity.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>TICK SIZE (FIXED)</div>
          <div className={styles.fixedValue}>
            0.01
          </div>
          <div className={styles.helpText}>
            Fixed at 0.01 for all markets - provides cent-level precision
          </div>
        </div>
      </div>

      {/* KYC Requirement */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>KYC Requirement</div>
          <div className={styles.fieldDescription}>
            Whether this market requires Know Your Customer (KYC) verification for traders. Enable this for markets dealing with sensitive data or higher-value metrics.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>KYC REQUIRED</div>
          <div className={styles.checkboxWrapper}>
            <input
              type="checkbox"
              id="requiresKYC"
              checked={formData.requiresKYC}
              onChange={(e) => updateFormData({ requiresKYC: e.target.checked })}
              className={styles.checkbox}
            />
            <label htmlFor="requiresKYC" className={styles.checkboxLabel}>
              Require KYC verification for all traders
            </label>
          </div>
          <div className={styles.helpText}>
            {formData.requiresKYC 
              ? 'Only KYC-verified users can trade in this market' 
              : 'Open to all users without KYC requirements'
            }
          </div>
        </div>
      </div>
    </form>
  );
}
