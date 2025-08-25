'use client';

import React from 'react';
import { StepProps, MARKET_CATEGORIES } from '../types';
import styles from '../MarketWizard.module.css';
import AIAssistant from '../AIAssistant';

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
    updateFormData({ category: categoryValue });
  };

  const handleMetricIdChange = (value: string) => {
    // Auto-format metric ID: uppercase, alphanumeric + underscores only
    const formatted = value.toUpperCase().replace(/[^A-Z0-9_]/g, '');
    updateFormData({ metricId: formatted });
  };

  const metricIdCharacterCount = 50 - formData.metricId.length;
  const descriptionCharacterCount = 500 - formData.description.length;

  return (
    <form onSubmit={handleSubmit} className={styles.formSection}>
      <div className={styles.stepHeader}>
        <div className={styles.stepNumber}>01.</div>
        <h1 className={styles.pageTitle}>Market Information</h1>
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

      {/* Metric ID */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Metric ID</div>
          <div className={styles.fieldDescription}>
            Unique identifier for your metric. This will be used throughout the orderbook system and UMA oracle integration. Use uppercase letters, numbers, and underscores only.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>METRIC ID (*)</div>
          <input
            type="text"
            value={formData.metricId}
            onChange={(e) => handleMetricIdChange(e.target.value)}
            placeholder=""
            className={`${styles.input} ${errors.metricId ? styles.inputError : ''}`}
            maxLength={50}
          />
          {errors.metricId && <div className={styles.errorText}>{errors.metricId}</div>}
          <div className={styles.helpText}>
            {metricIdCharacterCount} characters remaining. Examples: WORLD_POPULATION_2024, BTC_HASH_RATE_DEC
          </div>
        </div>
      </div>

      {/* Description */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Description</div>
          <div className={styles.fieldDescription}>
            Detailed description of the metric being tracked. Explain what data will be measured, how it will be determined at settlement, and any important details traders should know.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>MARKET DESCRIPTION (*)</div>
          <textarea
            value={formData.description}
            onChange={(e) => updateFormData({ description: e.target.value })}
            placeholder=""
            className={`${styles.textarea} ${errors.description ? styles.inputError : ''}`}
            maxLength={500}
            rows={4}
          />
          {errors.description && <div className={styles.errorText}>{errors.description}</div>}
          <div className={styles.helpText}>
            {descriptionCharacterCount} characters remaining. Include settlement criteria and data sources.
          </div>
        </div>
      </div>

      {/* Category */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Category</div>
          <div className={styles.fieldDescription}>
            Choose the category that best describes your metric. This helps users discover your market and determines which oracle providers are most suitable.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>MARKET CATEGORY (*)</div>
          <div className={styles.categoryTags}>
            {MARKET_CATEGORIES.map((category) => (
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
            Select the category that best fits your metric for optimal discoverability
          </div>
        </div>
      </div>

      {/* AI Assistant - Only show if metric ID is provided */}
      {formData.metricId.trim() && (
        <div className={styles.fieldRow}>
          <div>
            <div className={styles.fieldLabel}>AI Data Validation</div>
            <div className={styles.fieldDescription}>
              Use our AI assistant to analyze online sources and validate your metric data. Provide URLs for comprehensive analysis.
            </div>
          </div>
          <div className={styles.fieldInput}>
            <AIAssistant 
              metricName={formData.metricId} 
              formData={formData}
              updateFormData={updateFormData}
            />
            {errors.metricResolution && <div className={styles.errorText}>{errors.metricResolution}</div>}
          </div>
        </div>
      )}
    </form>
  );
}
