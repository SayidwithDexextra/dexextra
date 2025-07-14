import { VAMMFormData, FormErrors, ValidationResult } from './types';

export const validateStep1 = (formData: VAMMFormData): ValidationResult => {
  const errors: FormErrors = {};
  
  if (!formData.symbol.trim()) {
    errors.symbol = 'Title is required';
  }
  
  if (!formData.description.trim()) {
    errors.description = 'Description is required';
  }
  
  if (formData.category.length === 0) {
    errors.category = 'At least one category is required';
  }
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

export const validateStep2 = (formData: VAMMFormData): ValidationResult => {
  const errors: FormErrors = {};
  
  if (!formData.oracleAddress.trim()) {
    errors.oracleAddress = 'Oracle address is required';
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

export const validateStep3 = (formData: VAMMFormData): ValidationResult => {
  const errors: FormErrors = {};
  
  if (!formData.bannerImage && !formData.bannerImageUrl) {
    errors.bannerImage = 'Banner image is required';
  }
  
  if (!formData.iconImage && !formData.iconImageUrl) {
    errors.iconImage = 'Icon image is required';
  }
  
  // Validate file types if files are present
  if (formData.bannerImage) {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!validTypes.includes(formData.bannerImage.type)) {
      errors.bannerImage = 'Banner image must be JPEG, PNG, or WebP format';
    }
    
    // Check file size (max 5MB)
    if (formData.bannerImage.size > 5 * 1024 * 1024) {
      errors.bannerImage = 'Banner image must be smaller than 5MB';
    }
  }
  
  if (formData.iconImage) {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!validTypes.includes(formData.iconImage.type)) {
      errors.iconImage = 'Icon image must be JPEG, PNG, or WebP format';
    }
    
    // Check file size (max 2MB for icon)
    if (formData.iconImage.size > 2 * 1024 * 1024) {
      errors.iconImage = 'Icon image must be smaller than 2MB';
    }
  }
  
  // Validate supporting photos
  if (formData.supportingPhotos.length > 4) {
    errors.supportingPhotos = 'Maximum 4 supporting photos allowed';
  }
  
  formData.supportingPhotos.forEach((photo, index) => {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!validTypes.includes(photo.type)) {
      errors.supportingPhotos = `Supporting photo ${index + 1} must be JPEG, PNG, or WebP format`;
    }
    
    // Check file size (max 3MB per photo)
    if (photo.size > 3 * 1024 * 1024) {
      errors.supportingPhotos = `Supporting photo ${index + 1} must be smaller than 3MB`;
    }
  });
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

export const validateStep4 = (formData: VAMMFormData): ValidationResult => {
  const errors: FormErrors = {};
  
  if (!formData.deploymentFee.trim()) {
    errors.deploymentFee = 'Deployment fee is required';
  }
  
  const fee = parseFloat(formData.deploymentFee);
  if (isNaN(fee) || fee < 0) {
    errors.deploymentFee = 'Deployment fee must be a valid positive number';
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
  
  return {
    isValid: step1.isValid && step2.isValid && step3.isValid && step4.isValid,
    errors: {
      ...step1.errors,
      ...step2.errors,
      ...step3.errors,
      ...step4.errors
    }
  };
}; 