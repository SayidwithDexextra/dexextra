'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { StepProps } from '../types';
import styles from '../VAMMWizard.module.css';
import { supabase } from '../../../lib/supabase';

interface UploadProgress {
  [key: string]: number;
}

export default function Step3MarketImages({ formData, updateFormData, onNext, onPrevious, errors }: StepProps) {
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({});
  const [uploading, setUploading] = useState<{ [key: string]: boolean }>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext();
  };

  const uploadImageToSupabase = async (file: File, path: string): Promise<string> => {
    // Check if Supabase is properly configured
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || supabaseUrl.includes('placeholder') || 
        !supabaseKey || supabaseKey.includes('placeholder')) {
      throw new Error('Supabase is not properly configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.');
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      throw new Error(`File size too large. Maximum size is 5MB, but file is ${(file.size / 1024 / 1024).toFixed(2)}MB.`);
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      throw new Error('Invalid file type. Please upload an image file.');
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
    const filePath = `${path}/${fileName}`;

    try {
      const { data, error } = await supabase.storage
        .from('market-images')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        console.error('Supabase storage error:', error);
        
        // Provide more specific error messages
        if (error.message?.includes('Bucket not found')) {
          throw new Error(`Storage bucket "market-images" not found. 

Setup Options:
1. Via Dashboard: Go to your Supabase project → Storage → Create Bucket → Name it "market-images" → Make it Public
2. Via Script: Run "node scripts/setup-storage.js" from your project root
3. Via SQL: Run the migration in database/migrations/003_create_storage_bucket.sql

Please set up the storage bucket and try again.`);
        }
        if (error.message?.includes('Invalid API key')) {
          throw new Error('Invalid Supabase API key. Please check your environment configuration.');
        }
        if (error.message?.includes('Row level security')) {
          throw new Error('Storage access denied. Please check your Supabase storage policies.');
        }
        
        throw new Error(`Upload failed: ${error.message || 'Unknown storage error'}`);
      }

      const { data: { publicUrl } } = supabase.storage
        .from('market-images')
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (uploadError: any) {
      console.error('Upload error details:', uploadError);
      
      // Re-throw with better error message if it's a network error
      if (uploadError.message?.includes('fetch')) {
        throw new Error('Network error: Unable to connect to storage service. Please check your internet connection.');
      }
      
      throw uploadError;
    }
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

      const path = `markets/${type}`;
      const imageUrl = await uploadImageToSupabase(file, path);
      
      setUploadProgress(prev => ({ ...prev, [uploadKey]: 100 }));

      if (type === 'banner') {
        updateFormData({
          bannerImage: file,
          bannerImageUrl: imageUrl
        });
      } else if (type === 'icon') {
        updateFormData({
          iconImage: file,
          iconImageUrl: imageUrl
        });
      } else if (type === 'supporting' && index !== undefined) {
        const newSupportingPhotos = [...formData.supportingPhotos];
        const newSupportingPhotoUrls = [...formData.supportingPhotoUrls];
        
        newSupportingPhotos[index] = file;
        newSupportingPhotoUrls[index] = imageUrl;
        
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
      console.error('Upload failed:', error);
      // Handle error - could show a toast notification
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
        <div className={styles.stepNumber}>03.</div>
        <h1 className={styles.pageTitle}>Market Images</h1>
      </div>

      {/* Banner Image */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Banner Image</div>
          <div className={styles.fieldDescription}>
            Upload a banner image for your market. This will be displayed prominently on your market page.
            Recommended size: 1200x400px. Maximum file size: 5MB.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>BANNER IMAGE (*)</div>
          <div className={styles.imageUploadContainer}>
            <input
              type="file"
              accept="image/*"
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
                <Image
                  src={formData.bannerImageUrl}
                  alt="Banner preview"
                  width={300}
                  height={100}
                  className={styles.previewImage}
                />
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
            Recommended size: 200x200px. Maximum file size: 2MB.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>ICON IMAGE (*)</div>
          <div className={styles.imageUploadContainer}>
            <input
              type="file"
              accept="image/*"
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
                <Image
                  src={formData.iconImageUrl}
                  alt="Icon preview"
                  width={100}
                  height={100}
                  className={styles.iconPreview}
                />
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
            Maximum file size: 3MB each.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>SUPPORTING PHOTOS (Optional)</div>
          
          <div className={styles.supportingPhotosContainer}>
            {formData.supportingPhotos.map((photo, index) => (
              <div key={index} className={styles.supportingPhotoItem}>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleFileSelect(e, 'supporting', index)}
                  className={styles.fileInput}
                  id={`supporting-upload-${index}`}
                  style={{ display: 'none' }}
                />
                
                {formData.supportingPhotoUrls[index] ? (
                  <div className={styles.supportingPhotoPreview}>
                    <Image
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