'use client';

import React from 'react';
import { StepProps } from '../types';
import styles from '../VAMMWizard.module.css';

const CATEGORIES = [
  { value: 'Weather', label: 'Weather Metrics' },
  { value: 'Economic', label: 'Economic Indicators' },
  { value: 'Population', label: 'Population Data' },
  { value: 'Financial', label: 'Financial Markets' },
  { value: 'Sports', label: 'Sports Events' },
  { value: 'Technology', label: 'Technology Metrics' },
  { value: 'Environmental', label: 'Environmental Data' },
  { value: 'Social', label: 'Social Metrics' },
  { value: 'Custom', label: 'Custom Metrics' }
];

export default function Step1MarketInfo({ formData, updateFormData, onNext, errors, onSkipToFinal }: StepProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext();
  };

  const handleSkipClick = () => {
    if (onSkipToFinal) {
      onSkipToFinal();
    }
  };

  const handleCategorySelect = (categoryValue: string) => {
    // Single category selection for DexV2
    updateFormData({ category: categoryValue });
  };

  const symbolCharacterCount = 20 - formData.symbol.length;
  const descriptionCharacterCount = 500 - formData.description.length;

  return (
    <form onSubmit={handleSubmit} className={styles.formSection}>
      <div className={styles.stepHeader}>
        <div className={styles.stepNumber}>01.</div>
        <h1 className={styles.pageTitle}>Market</h1>
        {/* Skip Button */}
        <button
          type="button"
          onClick={handleSkipClick}
          className={styles.skipButton}
          title="Skip to final step with sample data"
        >
          🚀 Skip to Final Step
        </button>
      </div>

      {/* Market Symbol */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Title</div>
          <div className={styles.fieldDescription}>
            Include a unique title for your market. Make it short and memorable, so traders can easily identify your market.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>TITLE (*)</div>
          <input
            type="text"
            value={formData.symbol}
            onChange={(e) => updateFormData({ symbol: e.target.value.toUpperCase() })}
            placeholder=""
            className={`${styles.input} ${errors.symbol ? styles.inputError : ''}`}
            maxLength={20}
          />
          {errors.symbol && <div className={styles.errorText}>{errors.symbol}</div>}
          <div className={styles.helpText}>
            {symbolCharacterCount} characters remaining.
          </div>
        </div>
      </div>

      {/* Description */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Description</div>
          <div className={styles.fieldDescription}>
            Provide a clear description of what this market represents, how prices are determined, and any important details traders should know.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>DESCRIPTION (*)</div>
          <textarea
            value={formData.description}
            onChange={(e) => updateFormData({ description: e.target.value })}
            placeholder=""
            className={`${styles.textarea} ${errors.description ? styles.inputError : ''}`}
            maxLength={500}
          />
          {errors.description && <div className={styles.errorText}>{errors.description}</div>}
          <div className={styles.helpText}>
            {descriptionCharacterCount} characters remaining.
          </div>
        </div>
      </div>

      {/* Category - Single Selection */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Category</div>
          <div className={styles.fieldDescription}>
            Choose the category that best describes your specialized VAMM. This determines which metrics can be traded and the risk parameters applied.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>MARKET CATEGORY (*)</div>
          <div className={styles.categoryTags}>
            {CATEGORIES.map((category) => (
              <button
                key={category.value}
                type="button"
                onClick={() => handleCategorySelect(category.value)}
                className={`${styles.categoryTag} ${
                  formData.category === category.value ? styles.categoryTagSelected : ''
                }`}
              >
                {category.label}
              </button>
            ))}
          </div>
          {errors.category && <div className={styles.errorText}>{errors.category}</div>}
          <div className={styles.helpText}>
            Select the category that best fits your specialized VAMM deployment
          </div>
        </div>
      </div>
    </form>
  );
} 