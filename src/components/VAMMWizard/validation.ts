import { VAMMFormData, FormErrors, ValidationResult } from './types';

export const validateStep1 = (formData: VAMMFormData): ValidationResult => {
  const errors: FormErrors = {};
  
  if (!formData.symbol.trim()) {
    errors.symbol = 'Market symbol is required';
  }
  
  if (!formData.description.trim()) {
    errors.description = 'Market description is required';
  }
  
  if (!formData.category.trim()) {
    errors.category = 'Market category is required';
  }
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

export const validateStep2 = (formData: VAMMFormData): ValidationResult => {
  const errors: FormErrors = {};
  
  // Always require metric name
  if (!formData.metricName.trim()) {
    errors.metricName = 'Main metric name is required';
  }
  
  // Check AI analysis state
  const hasAIAnalysis = formData.metricResolution && 
                       formData.metricResolution.status === 'completed';
  const isAIProcessing = formData.metricResolution && 
                        formData.metricResolution.status === 'processing';
  
  // Data source validation - require either data source OR AI analysis
  const hasDataSource = formData.metricDataSource.trim() !== '';
  const hasValidAI = hasAIAnalysis || isAIProcessing;
  
  if (!hasDataSource && !hasValidAI) {
    errors.metricDataSource = 'Please select a data source or use AI analysis';
  }
  
  // Settlement period validation
  if (!formData.settlementPeriod.trim()) {
    errors.settlementPeriod = 'Settlement period is required';
  } else {
    const settlementPeriod = parseInt(formData.settlementPeriod);
    if (isNaN(settlementPeriod) || settlementPeriod < 60) {
      errors.settlementPeriod = 'Settlement period must be at least 60 seconds (1 minute)';
    } else if (settlementPeriod > 31536000) { // 1 year in seconds
      errors.settlementPeriod = 'Settlement period cannot exceed 1 year';
    }
  }
  
  const isValid = Object.keys(errors).length === 0;
  
  // Debug logging in development
  if (process.env.NODE_ENV === 'development') {
    console.log('🔍 Step 2 Validation:', {
      metricName: formData.metricName,
      hasDataSource,
      hasAIAnalysis,
      isAIProcessing,
      hasValidAI,
      settlementPeriod: formData.settlementPeriod,
      errors,
      isValid
    });
  }
  
  return {
    isValid,
    errors
  };
};

export const validateStep3 = (formData: VAMMFormData): ValidationResult => {
  const errors: FormErrors = {};
  
  if (formData.templateType === 'preset') {
    if (!formData.presetTemplate.trim()) {
      errors.presetTemplate = 'Please select a preset template';
    }
  } else if (formData.templateType === 'custom') {
    const { customTemplate } = formData;
    
    if (!customTemplate.maxLeverage.trim()) {
      errors.maxLeverage = 'Max leverage is required';
    } else {
      const leverage = parseInt(customTemplate.maxLeverage);
      if (isNaN(leverage) || leverage < 1 || leverage > 100) {
        errors.maxLeverage = 'Max leverage must be between 1 and 100';
      }
    }
    
    if (!customTemplate.tradingFeeRate.trim()) {
      errors.tradingFeeRate = 'Trading fee rate is required';
    } else {
      const fee = parseInt(customTemplate.tradingFeeRate);
      if (isNaN(fee) || fee < 0 || fee > 1000) {
        errors.tradingFeeRate = 'Trading fee must be between 0 and 1000 basis points (10%)';
      }
    }
    
    if (!customTemplate.liquidationFeeRate.trim()) {
      errors.liquidationFeeRate = 'Liquidation fee rate is required';
    } else {
      const fee = parseInt(customTemplate.liquidationFeeRate);
      if (isNaN(fee) || fee < 0 || fee > 2000) {
        errors.liquidationFeeRate = 'Liquidation fee must be between 0 and 2000 basis points (20%)';
      }
    }
    
    if (!customTemplate.maintenanceMarginRatio.trim()) {
      errors.maintenanceMarginRatio = 'Maintenance margin ratio is required';
    } else {
      const ratio = parseInt(customTemplate.maintenanceMarginRatio);
      if (isNaN(ratio) || ratio < 100) {
        errors.maintenanceMarginRatio = 'Maintenance margin must be at least 100 basis points (1%)';
      }
    }
    
    if (!customTemplate.initialReserves.trim()) {
      errors.initialReserves = 'Initial reserves is required';
    } else {
      const reserves = parseFloat(customTemplate.initialReserves);
      if (isNaN(reserves) || reserves <= 0) {
        errors.initialReserves = 'Initial reserves must be greater than 0';
      }
    }
    
    if (!customTemplate.volumeScaleFactor.trim()) {
      errors.volumeScaleFactor = 'Volume scale factor is required';
    } else {
      const factor = parseFloat(customTemplate.volumeScaleFactor);
      if (isNaN(factor) || factor <= 0) {
        errors.volumeScaleFactor = 'Volume scale factor must be greater than 0';
      }
    }
  } else {
    errors.templateType = 'Please select a template type';
  }
  
  // Validate start price (common to both preset and custom templates)
  if (!formData.customTemplate.startPrice.trim()) {
    errors.startPrice = 'Start price is required';
  } else {
    const price = parseFloat(formData.customTemplate.startPrice);
    if (isNaN(price) || price <= 0) {
      errors.startPrice = 'Start price must be greater than 0';
    } else if (price > 1000000) {
      errors.startPrice = 'Start price cannot exceed $1,000,000';
    }
  }
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

export const validateStep4 = (formData: VAMMFormData): ValidationResult => {
  const errors: FormErrors = {};
  
  if (!formData.bannerImage && !formData.bannerImageUrl) {
    errors.bannerImage = 'Banner image is required';
  }
  
  if (!formData.iconImage && !formData.iconImageUrl) {
    errors.iconImage = 'Icon image is required';
  }
  
  // Validate file types if files are present
  if (formData.bannerImage) {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (formData.bannerImage.type && !validTypes.includes(formData.bannerImage.type)) {
      errors.bannerImage = 'Banner image must be JPEG, PNG, WebP, or GIF format';
    }
    
    // Check file size (max 5MB)
    if (formData.bannerImage.size && formData.bannerImage.size > 5 * 1024 * 1024) {
      errors.bannerImage = 'Banner image must be smaller than 5MB';
    }
  }
  
  if (formData.iconImage) {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (formData.iconImage.type && !validTypes.includes(formData.iconImage.type)) {
      errors.iconImage = 'Icon image must be JPEG, PNG, WebP, or GIF format';
    }
    
    // Check file size (max 2MB for icon)
    if (formData.iconImage.size && formData.iconImage.size > 2 * 1024 * 1024) {
      errors.iconImage = 'Icon image must be smaller than 2MB';
    }
  }
  
  // Validate supporting photos
  if (formData.supportingPhotos.length > 4) {
    errors.supportingPhotos = 'Maximum 4 supporting photos allowed';
  }
  
  formData.supportingPhotos.forEach((photo, index) => {
    // Skip null or undefined photos
    if (!photo) {
      return;
    }
    
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (photo.type && !validTypes.includes(photo.type)) {
      errors.supportingPhotos = `Supporting photo ${index + 1} must be JPEG, PNG, WebP, or GIF format`;
    }
    
    // Check file size (max 3MB per photo)
    if (photo.size && photo.size > 3 * 1024 * 1024) {
      errors.supportingPhotos = `Supporting photo ${index + 1} must be smaller than 3MB`;
    }
  });
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

export const validateStep5 = (formData: VAMMFormData): ValidationResult => {
  const errors: FormErrors = {};
  
  if (!formData.deploymentFee.trim()) {
    errors.deploymentFee = 'Deployment fee is required';
  }
  
  const fee = parseFloat(formData.deploymentFee);
  if (isNaN(fee) || fee < 0) {
    errors.deploymentFee = 'Deployment fee must be a valid positive number';
  }
  
  if (formData.templateType === 'custom') {
    if (!formData.customTemplateFee.trim()) {
      errors.customTemplateFee = 'Custom template fee is required';
    }
    
    const customFee = parseFloat(formData.customTemplateFee);
    if (isNaN(customFee) || customFee < 0) {
      errors.customTemplateFee = 'Custom template fee must be a valid positive number';
    }
  }
  
  if (!formData.oracleAddress.trim()) {
    errors.oracleAddress = 'Oracle address is required for metric price feeds';
  }
  
  if (!formData.initialPrice.trim()) {
    errors.initialPrice = 'Initial price is required';
  }
  
  const price = parseFloat(formData.initialPrice);
  if (isNaN(price) || price <= 0) {
    errors.initialPrice = 'Initial price must be a valid positive number';
  }
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

export const validateAllSteps = (formData: VAMMFormData): ValidationResult => {
  const step1 = validateStep1(formData);
  const step2 = validateStep2(formData);
  const step3 = validateStep3(formData);
  const step4 = validateStep4(formData);
  const step5 = validateStep5(formData);
  
  return {
    isValid: step1.isValid && step2.isValid && step3.isValid && step4.isValid && step5.isValid,
    errors: {
      ...step1.errors,
      ...step2.errors,
      ...step3.errors,
      ...step4.errors,
      ...step5.errors
    }
  };
}; 