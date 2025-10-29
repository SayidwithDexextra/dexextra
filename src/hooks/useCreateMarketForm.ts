'use client';

import { useState } from 'react';
import { ethers } from 'ethers';

export interface MarketFormData {
  symbol: string;
  metricUrl: string;
  startPrice: string;
  dataSource: string;
  tags: string[];
  marginBps: number;
  feeBps: number;
  treasury: string;
  disableLeverage: boolean;
  metric: string;
  metricDescription: string;
  iconImageFile?: File | null;
  iconImagePreview?: string;
}

const DEFAULT_MARGIN_BPS = 10000; // 100%
const DEFAULT_FEE_BPS = 0;

export const useCreateMarketForm = () => {
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
    metric: '',
    metricDescription: '',
    iconImageFile: null,
    iconImagePreview: '',
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

  const validateForm = () => {
    if (!formData.symbol) throw new Error('Symbol is required');
    if (!formData.metricUrl) throw new Error('Metric URL is required (use AI assistant)');
    if (!formData.startPrice || isNaN(Number(formData.startPrice))) {
      throw new Error('Valid start price is required');
    }
    if (!formData.dataSource) throw new Error('Data source is required (use AI assistant)');
    if (!ethers.isAddress(formData.treasury)) {
      throw new Error('Valid treasury address is required');
    }
  };

  return {
    formData,
    tagInput,
    error,
    setError,
    handleInputChange,
    handleTagAdd,
    handleTagRemove,
    setTagInput,
    validateForm,
    setFormData,
  };
};

