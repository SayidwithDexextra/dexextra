'use client';

import React, { useState } from 'react';
import { StepProps } from '../types';
import styles from '../VAMMWizard.module.css';

export default function Step4MarketImages({ formData, updateFormData, onNext, errors }: StepProps) {
  const [uploading, setUploading] = useState<{ [key: string]: boolean }>({});
  const [uploadProgress, setUploadProgress] = useState<{ [key: string]: number }>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext();
  };

  // Create a preview URL for the file
  const createPreviewUrl = (file: File): string => {
    return URL.createObjectURL(file);
  };

  const handleImageUpload = async (
    file: File,
    type: 'banner' | 'icon' | 'supporting',
    index?: number
  ) => {
    const uploadKey = type === 'supporting' ? `supporting-${index}` : type;
    
    try {
      setUploading(prev => ({ ...prev, [uploadKey]: true }));
      setUploadProgress(prev => ({ ...prev, [uploadKey]: 10 }));

      // Basic file validation
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
      if (!validTypes.includes(file.type)) {
        throw new Error('Invalid file type. Please upload JPEG, PNG, WebP, or GIF images.');
      }

      // Size validation
      const maxSizes = {
        banner: 5 * 1024 * 1024, // 5MB
        icon: 2 * 1024 * 1024,   // 2MB
        supporting: 3 * 1024 * 1024 // 3MB
      };
      
      if (file.size > maxSizes[type]) {
        const maxSizeMB = maxSizes[type] / (1024 * 1024);
        throw new Error(`File too large. Maximum size for ${type} images is ${maxSizeMB}MB.`);
      }

      // Simulate upload progress
      setUploadProgress(prev => ({ ...prev, [uploadKey]: 50 }));
      
      // Create preview URL for immediate display
      const previewUrl = createPreviewUrl(file);
      
      setUploadProgress(prev => ({ ...prev, [uploadKey]: 100 }));

      // Store file and preview URL in form data
      if (type === 'banner') {
        updateFormData({
          bannerImage: file,
          bannerImageUrl: previewUrl
        });
      } else if (type === 'icon') {
        updateFormData({
          iconImage: file,
          iconImageUrl: previewUrl
        });
      } else if (type === 'supporting' && index !== undefined) {
        const newSupportingPhotos = [...formData.supportingPhotos];
        const newSupportingPhotoUrls = [...formData.supportingPhotoUrls];
        
        newSupportingPhotos[index] = file;
        newSupportingPhotoUrls[index] = previewUrl;
        
        updateFormData({
          supportingPhotos: newSupportingPhotos,
          supportingPhotoUrls: newSupportingPhotoUrls
        });
      }

      // Clear progress after a delay
      setTimeout(() => {
        setUploadProgress(prev => {
          const newProgress = { ...prev };
          delete newProgress[uploadKey];
          return newProgress;
        });
      }, 1000);

    } catch (error) {
      console.error('File validation failed:', error);
      alert(error instanceof Error ? error.message : 'File upload failed');
    } finally {
      setUploading(prev => ({ ...prev, [uploadKey]: false }));
    }
  };

  const handleFileSelect = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'banner' | 'icon' | 'supporting',
    index?: number
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageUpload(file, type, index);
    }
  };

  const handleImageRemove = (type: 'banner' | 'icon' | 'supporting', index?: number) => {
    if (type === 'banner') {
      // Cleanup preview URL
      if (formData.bannerImageUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(formData.bannerImageUrl);
      }
      updateFormData({
        bannerImage: undefined,
        bannerImageUrl: ''
      });
    } else if (type === 'icon') {
      // Cleanup preview URL
      if (formData.iconImageUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(formData.iconImageUrl);
      }
      updateFormData({
        iconImage: undefined,
        iconImageUrl: ''
      });
    } else if (type === 'supporting' && index !== undefined) {
      const newSupportingPhotos = [...formData.supportingPhotos];
      const newSupportingPhotoUrls = [...formData.supportingPhotoUrls];
      
      // Cleanup preview URL
      if (newSupportingPhotoUrls[index]?.startsWith('blob:')) {
        URL.revokeObjectURL(newSupportingPhotoUrls[index]);
      }
      
      newSupportingPhotos[index] = null;
      newSupportingPhotoUrls[index] = '';
      
      updateFormData({
        supportingPhotos: newSupportingPhotos,
        supportingPhotoUrls: newSupportingPhotoUrls
      });
    }
  };

  const addSupportingPhoto = () => {
    if (formData.supportingPhotos.length < 4) {
      updateFormData({
        supportingPhotos: [...formData.supportingPhotos, null as any],
        supportingPhotoUrls: [...formData.supportingPhotoUrls, '']
      });
    }
  };

  const removeSupportingPhoto = (index: number) => {
    const newSupportingPhotos = formData.supportingPhotos.filter((_, i) => i !== index);
    const newSupportingPhotoUrls = formData.supportingPhotoUrls.filter((_, i) => i !== index);
    
    updateFormData({
      supportingPhotos: newSupportingPhotos,
      supportingPhotoUrls: newSupportingPhotoUrls
    });
  };

  return (
    <form onSubmit={handleSubmit} className={styles.formSection}>
      <div className={styles.stepHeader}>
        <div className={styles.stepNumber}>04.</div>
        <h1 className={styles.pageTitle}>Market Images</h1>
      </div>

      {/* Banner Image */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Banner Image</div>
          <div className={styles.fieldDescription}>
            Upload a banner image for your market. This will be displayed prominently on your market page.
            Recommended size: 1200x400px. Maximum file size: 5MB. Supports JPEG, PNG, WebP, and GIF formats.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>BANNER IMAGE (*)</div>
          <div className={styles.imageUploadContainer}>
            <input
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
              onChange={(e) => handleFileSelect(e, 'banner')}
              className={styles.fileInput}
              id="banner-upload"
              style={{ display: 'none' }}
            />
            <label htmlFor="banner-upload" className={styles.uploadButton}>
              <div className={styles.uploadButtonContent}>
                <svg className={styles.uploadIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                <span>Choose Banner Image</span>
              </div>
            </label>
            
            {formData.bannerImageUrl && (
              <div className={styles.imagePreview}>
                <img
                  src={formData.bannerImageUrl}
                  alt="Banner preview"
                  className={styles.previewImage}
                />
                <button
                  type="button"
                  onClick={() => handleImageRemove('banner')}
                  className={styles.removePhotoButton}
                >
                  ×
                </button>
              </div>
            )}
            
            {uploading.banner && (
              <div className={styles.uploadProgress}>
                <div className={styles.progressBar}>
                  <div 
                    className={styles.progressFill} 
                    style={{ width: `${uploadProgress.banner || 0}%` }}
                  />
                </div>
                <span className={styles.progressText}>Uploading...</span>
              </div>
            )}
            
            {errors.bannerImage && <div className={styles.errorText}>{errors.bannerImage}</div>}
          </div>
        </div>
      </div>

      {/* Icon Image */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Icon Image</div>
          <div className={styles.fieldDescription}>
            Upload an icon for your market. This will be used as the market's logo.
            Recommended size: 200x200px. Maximum file size: 2MB. Supports JPEG, PNG, WebP, and GIF formats.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>ICON IMAGE (*)</div>
          <div className={styles.imageUploadContainer}>
            <input
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
              onChange={(e) => handleFileSelect(e, 'icon')}
              className={styles.fileInput}
              id="icon-upload"
              style={{ display: 'none' }}
            />
            <label htmlFor="icon-upload" className={styles.uploadButton}>
              <div className={styles.uploadButtonContent}>
                <svg className={styles.uploadIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                <span>Choose Icon Image</span>
              </div>
            </label>
            
            {formData.iconImageUrl && (
              <div className={styles.imagePreview}>
                <img
                  src={formData.iconImageUrl}
                  alt="Icon preview"
                  className={styles.iconPreview}
                />
                <button
                  type="button"
                  onClick={() => handleImageRemove('icon')}
                  className={styles.removePhotoButton}
                >
                  ×
                </button>
              </div>
            )}
            
            {uploading.icon && (
              <div className={styles.uploadProgress}>
                <div className={styles.progressBar}>
                  <div 
                    className={styles.progressFill} 
                    style={{ width: `${uploadProgress.icon || 0}%` }}
                  />
                </div>
                <span className={styles.progressText}>Uploading...</span>
              </div>
            )}
            
            {errors.iconImage && <div className={styles.errorText}>{errors.iconImage}</div>}
          </div>
        </div>
      </div>

      {/* Supporting Photos */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Supporting Photos</div>
          <div className={styles.fieldDescription}>
            Upload up to 4 supporting photos to showcase your market. These will be displayed in the market gallery.
            Maximum file size: 3MB each. Supports JPEG, PNG, WebP, and GIF formats.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>SUPPORTING PHOTOS (Optional)</div>
          
          <div className={styles.supportingPhotosContainer}>
            {formData.supportingPhotos.map((photo, index) => (
              <div key={index} className={styles.supportingPhotoItem}>
                <input
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                  onChange={(e) => handleFileSelect(e, 'supporting', index)}
                  className={styles.fileInput}
                  id={`supporting-upload-${index}`}
                  style={{ display: 'none' }}
                />
                
                {formData.supportingPhotoUrls[index] ? (
                  <div className={styles.supportingPhotoPreview}>
                    <img
                      src={formData.supportingPhotoUrls[index]}
                      alt={`Supporting photo ${index + 1}`}
                      width={120}
                      height={120}
                      className={styles.supportingImage}
                    />
                    <button
                      type="button"
                      onClick={() => removeSupportingPhoto(index)}
                      className={styles.removePhotoButton}
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <label htmlFor={`supporting-upload-${index}`} className={styles.supportingPhotoUpload}>
                    <div className={styles.uploadButtonContent}>
                      <svg className={styles.uploadIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      <span>Photo {index + 1}</span>
                    </div>
                  </label>
                )}
                
                {uploading[`supporting-${index}`] && (
                  <div className={styles.uploadProgress}>
                    <div className={styles.progressBar}>
                      <div 
                        className={styles.progressFill} 
                        style={{ width: `${uploadProgress[`supporting-${index}`] || 0}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
            
            {formData.supportingPhotos.length < 4 && (
              <button
                type="button"
                onClick={addSupportingPhoto}
                className={styles.addPhotoButton}
              >
                <div className={styles.uploadButtonContent}>
                  <svg className={styles.uploadIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  <span>Add Photo</span>
                </div>
              </button>
            )}
          </div>
          
          {errors.supportingPhotos && <div className={styles.errorText}>{errors.supportingPhotos}</div>}
          
          <div className={styles.helpText}>
            {formData.supportingPhotos.length}/4 photos uploaded
          </div>
        </div>
      </div>
    </form>
  );
} 