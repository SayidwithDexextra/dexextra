'use client';

import React from 'react';
import { StepProps } from '../types';
import styles from '../VAMMWizard.module.css';

const CATEGORIES = [
  { value: 'crypto', label: 'Cryptocurrency' },
  { value: 'forex', label: 'Foreign Exchange' },
  { value: 'commodities', label: 'Commodities' },
  { value: 'stocks', label: 'Stock Markets' },
  { value: 'defi', label: 'DeFi Protocols' },
  { value: 'nft', label: 'NFT Collections' },
  { value: 'gaming', label: 'Gaming Assets' },
  { value: 'music', label: 'Music' },
  { value: 'other', label: 'Other' }
];

export default function Step1MarketInfo({ formData, updateFormData, onNext, errors }: StepProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext();
  };

  const handleCategorySelect = (categoryValue: string) => {
    const currentCategories = formData.category || [];
    const isSelected = currentCategories.includes(categoryValue);
    
    if (isSelected) {
      // Remove the category
      const newCategories = currentCategories.filter(cat => cat !== categoryValue);
      updateFormData({ category: newCategories });
    } else {
      // Add the category
      const newCategories = [...currentCategories, categoryValue];
      updateFormData({ category: newCategories });
    }
  };

  const symbolCharacterCount = 20 - formData.symbol.length;
  const descriptionCharacterCount = 500 - formData.description.length;

  return (
    <form onSubmit={handleSubmit} className={styles.formSection}>
      <div className={styles.stepHeader}>
        <div className={styles.stepNumber}>01.</div>
        <h1 className={styles.pageTitle}>Market</h1>
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

      {/* Category - Tag Interface */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Category</div>
          <div className={styles.fieldDescription}>
            Choose the categories that best describe your market. This helps users discover and filter markets by type.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>CATEGORIES (*)</div>
          <div className={styles.categoryTags}>
            {CATEGORIES.map((category) => (
              <button
                key={category.value}
                type="button"
                onClick={() => handleCategorySelect(category.value)}
                className={`${styles.categoryTag} ${
                  formData.category.includes(category.value) ? styles.categoryTagSelected : ''
                }`}
              >
                {category.label}
              </button>
            ))}
          </div>
          {errors.category && <div className={styles.errorText}>{errors.category}</div>}
          <div className={styles.helpText}>
            Select one or more categories that best fit your market
          </div>
        </div>
      </div>
    </form>
  );
} 