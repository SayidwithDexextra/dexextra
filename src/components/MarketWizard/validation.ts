import { MarketFormData, ValidationResult } from './types';

// Validation helper functions
const isValidEthereumAddress = (address: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

const isValidMetricId = (metricId: string): boolean => {
  // Metric ID should be alphanumeric with underscores, no spaces
  return /^[A-Z0-9_]+$/.test(metricId) && metricId.length >= 3 && metricId.length <= 50;
};

const isValidTimestamp = (timestamp: string): boolean => {
  const ts = parseInt(timestamp);
  return !isNaN(ts) && ts > Date.now() / 1000; // Must be in the future
};

const isValidDecimalString = (value: string): boolean => {
  return /^\d+(\.\d+)?$/.test(value) && parseFloat(value) > 0;
};

// Step 1: Market Information validation
export const validateStep1 = (formData: MarketFormData): ValidationResult => {
  const errors: Record<string, string> = {};

  // Metric ID validation
  if (!formData.metricId.trim()) {
    errors.metricId = 'Metric ID is required';
  } else if (!isValidMetricId(formData.metricId)) {
    errors.metricId = 'Metric ID must be 3-50 characters, uppercase letters, numbers, and underscores only';
  }

  // Description validation
  if (!formData.description.trim()) {
    errors.description = 'Market description is required';
  } else if (formData.description.length < 20) {
    errors.description = 'Description must be at least 20 characters';
  } else if (formData.description.length > 500) {
    errors.description = 'Description must be less than 500 characters';
  }

  // Category validation
  if (!formData.category.trim()) {
    errors.category = 'Market category is required';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

// Step 2: Trading Configuration validation
export const validateStep2 = (formData: MarketFormData): ValidationResult => {
  const errors: Record<string, string> = {};

  // Decimals validation
  if (formData.decimals < 1 || formData.decimals > 18) {
    errors.decimals = 'Decimals must be between 1 and 18';
  }

  // Minimum order size validation
  if (!formData.minimumOrderSize.trim()) {
    errors.minimumOrderSize = 'Minimum order size is required';
  } else if (!isValidDecimalString(formData.minimumOrderSize)) {
    errors.minimumOrderSize = 'Minimum order size must be a valid positive number';
  }

  // Tick size is fixed at 0.01 - no validation needed

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

// Step 3: Settlement Configuration validation
export const validateStep3 = (formData: MarketFormData): ValidationResult => {
  const errors: Record<string, string> = {};

  // Settlement date validation
  if (!formData.settlementDate.trim()) {
    errors.settlementDate = 'Settlement date is required';
  } else if (!isValidTimestamp(formData.settlementDate)) {
    errors.settlementDate = 'Settlement date must be a valid future timestamp';
  }

  // Trading end date validation
  if (!formData.tradingEndDate.trim()) {
    errors.tradingEndDate = 'Trading end date is required';
  } else if (!isValidTimestamp(formData.tradingEndDate)) {
    errors.tradingEndDate = 'Trading end date must be a valid future timestamp';
  } else {
    // Trading end date must be before settlement date
    const tradingEnd = parseInt(formData.tradingEndDate);
    const settlement = parseInt(formData.settlementDate);
    if (tradingEnd >= settlement) {
      errors.tradingEndDate = 'Trading must end before settlement date';
    }
  }

  // Data request window validation
  if (!formData.dataRequestWindow.trim()) {
    errors.dataRequestWindow = 'Data request window is required';
  } else {
    const window = parseInt(formData.dataRequestWindow);
    if (isNaN(window) || window < 3600 || window > 604800) { // 1 hour to 1 week
      errors.dataRequestWindow = 'Data request window must be between 1 hour and 1 week (in seconds)';
    }
  }

  // Oracle provider validation
  if (!formData.oracleProvider.trim()) {
    errors.oracleProvider = 'Oracle provider is required';
  } else if (!isValidEthereumAddress(formData.oracleProvider)) {
    errors.oracleProvider = 'Oracle provider must be a valid Ethereum address';
  }

  // Initial order validation (if enabled)
  if (formData.initialOrder.enabled) {
    if (!formData.initialOrder.quantity.trim()) {
      errors['initialOrder.quantity'] = 'Initial order quantity is required when enabled';
    } else if (!isValidDecimalString(formData.initialOrder.quantity)) {
      errors['initialOrder.quantity'] = 'Initial order quantity must be a valid positive number';
    }

    if (!formData.initialOrder.price.trim()) {
      errors['initialOrder.price'] = 'Initial order price is required when enabled';
    } else if (!isValidDecimalString(formData.initialOrder.price)) {
      errors['initialOrder.price'] = 'Initial order price must be a valid positive number';
    }

    // GTD orders need expiry time
    if (formData.initialOrder.timeInForce === 'GTD') {
      if (!formData.initialOrder.expiryTime.trim()) {
        errors['initialOrder.expiryTime'] = 'Expiry time is required for GTD orders';
      } else if (!isValidTimestamp(formData.initialOrder.expiryTime)) {
        errors['initialOrder.expiryTime'] = 'Expiry time must be a valid future timestamp';
      } else {
        // Expiry time must be before trading end date
        const expiry = parseInt(formData.initialOrder.expiryTime);
        const tradingEnd = parseInt(formData.tradingEndDate);
        if (expiry > tradingEnd) {
          errors['initialOrder.expiryTime'] = 'Initial order expiry must be before trading end date';
        }
      }
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

// Step 4: Market Images validation (optional)
export const validateStep4 = (formData: MarketFormData): ValidationResult => {
  const errors: Record<string, string> = {};

  // Images are optional, so we just validate file types and sizes if present
  const maxFileSize = 10 * 1024 * 1024; // 10MB
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];

  if (formData.bannerImage) {
    if (formData.bannerImage.size > maxFileSize) {
      errors.bannerImage = 'Banner image must be less than 10MB';
    }
    if (!allowedTypes.includes(formData.bannerImage.type)) {
      errors.bannerImage = 'Banner image must be JPEG, PNG, WebP, or GIF';
    }
  }

  if (formData.iconImage) {
    if (formData.iconImage.size > maxFileSize) {
      errors.iconImage = 'Icon image must be less than 10MB';
    }
    if (!allowedTypes.includes(formData.iconImage.type)) {
      errors.iconImage = 'Icon image must be JPEG, PNG, WebP, or GIF';
    }
  }

  formData.supportingPhotos.forEach((photo, index) => {
    if (photo.size > maxFileSize) {
      errors[`supportingPhoto${index}`] = `Supporting photo ${index + 1} must be less than 10MB`;
    }
    if (!allowedTypes.includes(photo.type)) {
      errors[`supportingPhoto${index}`] = `Supporting photo ${index + 1} must be JPEG, PNG, WebP, or GIF`;
    }
  });

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

// Step 5: Review & Deploy validation
export const validateStep5 = (formData: MarketFormData): ValidationResult => {
  const errors: Record<string, string> = {};

  // Creation fee validation
  if (!formData.creationFee.trim()) {
    errors.creationFee = 'Creation fee is required';
  } else if (!isValidDecimalString(formData.creationFee)) {
    errors.creationFee = 'Creation fee must be a valid positive number';
  }

  // Run all previous validations to ensure everything is still valid
  const step1Result = validateStep1(formData);
  const step2Result = validateStep2(formData);
  const step3Result = validateStep3(formData);
  const step4Result = validateStep4(formData);

  const allErrors = {
    ...errors,
    ...step1Result.errors,
    ...step2Result.errors,
    ...step3Result.errors,
    ...step4Result.errors
  };

  return {
    isValid: Object.keys(allErrors).length === 0,
    errors: allErrors
  };
};

// Utility function to validate all steps
export const validateAllSteps = (formData: MarketFormData): ValidationResult => {
  return validateStep5(formData); // This validates all steps
};

// Utility function to check if a step can proceed
export const canProceedFromStep = (stepNumber: number, formData: MarketFormData): boolean => {
  switch (stepNumber) {
    case 1:
      return validateStep1(formData).isValid;
    case 2:
      return validateStep2(formData).isValid;
    case 3:
      return validateStep3(formData).isValid;
    case 4:
      return validateStep4(formData).isValid;
    case 5:
      return validateStep5(formData).isValid;
    default:
      return false;
  }
};
