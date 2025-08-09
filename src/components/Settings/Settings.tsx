'use client'

import React, { useState, useEffect } from 'react'
import Image from 'next/image'
import { useWallet } from '@/hooks/useWallet'
import { ProfileApi } from '@/lib/profileApi'
import { formDataToUserProfile, userProfileToFormData } from '@/types/userProfile'

export interface SettingsProps {
  className?: string
}

export default function Settings({ className }: SettingsProps) {
  const { walletData, refreshProfile } = useWallet()
  const [formData, setFormData] = useState({
    username: '',
    name: '',
    bio: '',
    email: '',
    website: '',
    twitter: '',
    discord: '',
    instagram: '',
    youtube: ''
  })

  const [profileImage, setProfileImage] = useState<string | null>(null)
  const [bannerImage, setBannerImage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')

  // Load user profile data when wallet connects or component mounts
  useEffect(() => {
    if (walletData.userProfile) {
      // Convert profile data to form data
      setFormData({
        username: walletData.userProfile.username || '',
        name: walletData.userProfile.display_name || '',
        bio: walletData.userProfile.bio || '',
        email: '', // Not available in public profile
        website: walletData.userProfile.website || '',
        twitter: walletData.userProfile.twitter_url || '',
        discord: walletData.userProfile.discord_url || '',
        instagram: walletData.userProfile.instagram_url || '',
        youtube: walletData.userProfile.youtube_url || '',
      })
      setProfileImage(walletData.userProfile.profile_image_url || null)
      setBannerImage(walletData.userProfile.banner_image_url || null)
    } else if (walletData.isConnected && walletData.address) {
      // If wallet is connected but no profile data, try to refresh it
      refreshProfile()
    }
  }, [walletData.userProfile, walletData.isConnected, walletData.address, refreshProfile])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'profile' | 'banner' = 'profile') => {
    const file = e.target.files?.[0]
    if (!file || !walletData.address) {
      return
    }

    // Validate file immediately
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      alert('Invalid file type. Please select a JPEG, PNG, GIF, or WebP image.')
      return
    }

    const maxSize = 10 * 1024 * 1024 // 10MB
    if (file.size > maxSize) {
      alert('File too large. Please select an image smaller than 10MB.')
      return
    }

    setIsLoading(true)
    
    try {
      // Show preview immediately using FileReader
      const reader = new FileReader()
      reader.onload = (e) => {
        const imageUrl = e.target?.result as string
        if (type === 'profile') {
          setProfileImage(imageUrl)
        } else {
          setBannerImage(imageUrl)
        }
      }
      reader.readAsDataURL(file)

      // Upload to server
      const result = await ProfileApi.uploadImage(walletData.address, file, type)
      
      // Update with actual uploaded URL
      if (type === 'profile') {
        setProfileImage(result.imageUrl)
      } else {
        setBannerImage(result.imageUrl)
      }

      // Refresh profile data
      await refreshProfile()
      
       console.log(`${type} image uploaded successfully:`, result.imageUrl)
    } catch (error) {
      console.error('Error uploading image:', error)
      alert(`Failed to upload ${type} image. Please try again.`)
      
      // Reset to previous state on error
      if (type === 'profile') {
        setProfileImage(walletData.userProfile?.profile_image_url || null)
      } else {
        setBannerImage(walletData.userProfile?.banner_image_url || null)
      }
    } finally {
      setIsLoading(false)
      // Clear the input so the same file can be selected again
      e.target.value = ''
    }
  }

  const handleRemoveImage = async (type: 'profile' | 'banner' = 'profile') => {
    if (!walletData.address) {
      return
    }

    setIsLoading(true)
    
    try {
      await ProfileApi.removeImage(walletData.address, type)
      
      // Update UI
      if (type === 'profile') {
        setProfileImage(null)
      } else {
        setBannerImage(null)
      }

      // Refresh profile data
      await refreshProfile()
      
       console.log(`${type} image removed successfully`)
    } catch (error) {
      console.error('Error removing image:', error)
      alert(`Failed to remove ${type} image. Please try again.`)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    if (!walletData.isConnected || !walletData.address) {
      alert('Please connect your wallet first')
      return
    }

    setSaveStatus('saving')
    setIsLoading(true)

    try {
      // Convert form data to update request format
      const updateData = formDataToUserProfile(
        formData,
        walletData.address,
        profileImage || undefined,
        bannerImage || undefined
      )

      // Update profile via API
      await ProfileApi.updateProfile(walletData.address, updateData)
      
      // Refresh the profile data in wallet context
      await refreshProfile()
      
      setSaveStatus('success')
       console.log('Profile updated successfully!')
      
      // Clear success status after 3 seconds
      setTimeout(() => setSaveStatus('idle'), 3000)
    } catch (error) {
      console.error('Error saving profile:', error)
      setSaveStatus('error')
      alert('Failed to save profile. Please try again.')
      
      // Clear error status after 5 seconds
      setTimeout(() => setSaveStatus('idle'), 5000)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={`settings-container ${className || ''}`}>
      <div className="settings-wrapper">
        <div className="settings-header">
          <div className="header-nav">
            <button className="nav-item active">Dashboard</button>
            <button className="nav-item">Edit Profile</button>
          </div>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <h2 className="section-title">Enter your details</h2>
            
            <div className="profile-banner">
              <div className="banner-background" style={{
                backgroundImage: bannerImage ? `url(${bannerImage})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center'
              }}>
                <input
                  type="file"
                  id="banner-image"
                  accept="image/*"
                  onChange={(e) => handleImageUpload(e, 'banner')}
                  className="upload-input"
                  disabled={isLoading}
                />
                <label 
                  htmlFor="banner-image" 
                  className={`banner-edit-icon ${isLoading ? 'loading' : ''}`}
                  title="Upload banner image"
                >
                  {isLoading ? (
                    <div className="loading-spinner" />
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="white"/>
                    </svg>
                  )}
                </label>
                {bannerImage && (
                  <button 
                    onClick={() => handleRemoveImage('banner')}
                    className="banner-remove-icon"
                    title="Remove banner image"
                    disabled={isLoading}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M12 4L4 12M4 4l8 8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </button>
                )}
              </div>
              <div className="profile-section">
                                  <div className="avatar-wrapper">
                    {profileImage ? (
                      <Image
                        src={profileImage}
                        alt="Profile"
                        width={96}
                        height={96}
                        className="avatar-image"
                      />
                    ) : (
                      <div className="avatar-placeholder">
                        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                          <rect width="40" height="40" rx="8" fill="#00d4aa"/>
                          <rect x="8" y="8" width="6" height="6" fill="#1a1a1a"/>
                          <rect x="16" y="8" width="6" height="6" fill="#1a1a1a"/>
                          <rect x="26" y="8" width="6" height="6" fill="#1a1a1a"/>
                          <rect x="8" y="16" width="6" height="6" fill="#1a1a1a"/>
                          <rect x="26" y="16" width="6" height="6" fill="#1a1a1a"/>
                          <rect x="8" y="26" width="6" height="6" fill="#1a1a1a"/>
                          <rect x="16" y="26" width="6" height="6" fill="#1a1a1a"/>
                          <rect x="26" y="26" width="6" height="6" fill="#1a1a1a"/>
                        </svg>
                      </div>
                    )}
                  </div>
                <div className="profile-info">
                  <h3 className="profile-name">
                    {walletData.userProfile?.display_name || 
                     walletData.userProfile?.username || 
                     (walletData.address ? `${walletData.address.slice(0, 6)}...${walletData.address.slice(-6)}` : 'Not Connected')}
                  </h3>
                  <p className="profile-address">
                    {walletData.address ? `${walletData.address.slice(0, 6)}...${walletData.address.slice(-6)}` : 'Please connect wallet'}
                  </p>
                </div>
              </div>
            </div>

            <div className="form-section">
              <div className="form-group">
                <label htmlFor="username" className="form-label">Username *</label>
                <input
                  type="text"
                  id="username"
                  name="username"
                  value={formData.username}
                  onChange={handleInputChange}
                  placeholder="username..."
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="name" className="form-label">Name</label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="name..."
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="bio" className="form-label">Add a short bio</label>
                <textarea
                  id="bio"
                  name="bio"
                  value={formData.bio}
                  onChange={handleInputChange}
                  placeholder="enter your bio..."
                  rows={4}
                  className="form-textarea"
                />
                <span className="character-count">{formData.bio.length}/180 characters</span>
              </div>
            </div>

            <div className="upload-section">
              <h3 className="upload-title">Upload a profile image</h3>
              <p className="upload-description">Recommended 600px x 600px. JPEG, PNG, GIF, or WebP. Max file size: 10MB</p>
              <div className="upload-area">
                <input
                  type="file"
                  id="profile-image"
                  accept="image/*"
                  onChange={(e) => handleImageUpload(e, 'profile')}
                  className="upload-input"
                  disabled={isLoading}
                />
                <label 
                  htmlFor="profile-image" 
                  className={`upload-button ${isLoading ? 'loading' : ''}`}
                  title="Upload profile image"
                >
                  {isLoading ? (
                    <>
                      <div className="loading-spinner" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M10 4V16M4 10H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                      Choose Media
                    </>
                  )}
                </label>
                {profileImage && (
                  <div className="upload-preview">
                    <Image
                      src={profileImage}
                      alt="Profile preview"
                      width={60}
                      height={60}
                      className="preview-image"
                    />
                    <button 
                      onClick={() => handleRemoveImage('profile')}
                      className="remove-image-button"
                      title="Remove profile image"
                      disabled={isLoading}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="notifications-section">
              <h3 className="section-subtitle">Receive email notifications</h3>
              <p className="section-description">
                Get notifications about your activity on SuperRare in your inbox. We will not
                share your email address with any third party, nor will it be visible on your
                profile.
              </p>
              <div className="form-group">
                <label htmlFor="email" className="form-label">Email Address</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="email..."
                  className="form-input"
                />
              </div>
            </div>

            <div className="social-section">
              <h3 className="section-subtitle">Add web & social links</h3>
              <div className="social-links">
                <div className="form-group">
                  <label htmlFor="website" className="form-label">Website</label>
                  <div className="input-with-icon">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="input-icon">
                      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M8 1a7 7 0 0 0 0 14A7 7 0 0 0 8 1z" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M1 8h14" stroke="currentColor" strokeWidth="1.5"/>
                    </svg>
                    <input
                      type="url"
                      id="website"
                      name="website"
                      value={formData.website}
                      onChange={handleInputChange}
                      placeholder="https://website..."
                      className="form-input with-icon"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="twitter" className="form-label">Twitter</label>
                  <div className="input-with-icon">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="input-icon">
                      <path d="M16 3.037a6.5 6.5 0 0 1-1.885.516 3.28 3.28 0 0 0 1.443-1.816 6.57 6.57 0 0 1-2.085.795 3.28 3.28 0 0 0-5.593 2.99A9.32 9.32 0 0 1 1.114 2.1a3.28 3.28 0 0 0 1.015 4.381A3.28 3.28 0 0 1 .64 6.07v.041a3.28 3.28 0 0 0 2.633 3.218 3.28 3.28 0 0 1-1.482.056 3.28 3.28 0 0 0 3.067 2.277A6.58 6.58 0 0 1 0 13.027a9.29 9.29 0 0 0 5.032 1.475c6.038 0 9.34-5.002 9.34-9.34 0-.142-.003-.284-.009-.425A6.68 6.68 0 0 0 16 3.037z" fill="currentColor"/>
                    </svg>
                    <input
                      type="url"
                      id="twitter"
                      name="twitter"
                      value={formData.twitter}
                      onChange={handleInputChange}
                      placeholder="https://twitter..."
                      className="form-input with-icon"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="discord" className="form-label">Discord</label>
                  <div className="input-with-icon">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="input-icon">
                      <path d="M13.545 2.907a13.2 13.2 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.2 12.2 0 0 0-3.658 0 8 8 0 0 0-.412-.833.05.05 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.04.04 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032c.001.014.01.028.021.037a13.3 13.3 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019c.308-.42.582-.863.818-1.329a.05.05 0 0 0-.01-.059.05.05 0 0 0-.018-.011 8.9 8.9 0 0 1-1.248-.595.05.05 0 0 1-.02-.066.05.05 0 0 1 .015-.019c.084-.063.168-.129.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.05.05 0 0 1 .053.007c.08.066.164.132.248.195a.05.05 0 0 1-.004.085 8.3 8.3 0 0 1-1.249.594.05.05 0 0 0-.03.03.05.05 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.2 13.2 0 0 0 4.001-2.02.05.05 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.03.03 0 0 0-.02-.018" fill="currentColor"/>
                    </svg>
                    <input
                      type="url"
                      id="discord"
                      name="discord"
                      value={formData.discord}
                      onChange={handleInputChange}
                      placeholder="https://discord..."
                      className="form-input with-icon"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="instagram" className="form-label">Instagram</label>
                  <div className="input-with-icon">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="input-icon">
                      <rect x="1" y="1" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.5"/>
                      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/>
                      <circle cx="12" cy="4" r="0.5" fill="currentColor"/>
                    </svg>
                    <input
                      type="url"
                      id="instagram"
                      name="instagram"
                      value={formData.instagram}
                      onChange={handleInputChange}
                      placeholder="https://instagram..."
                      className="form-input with-icon"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="youtube" className="form-label">YouTube</label>
                  <div className="input-with-icon">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="input-icon">
                      <path d="M15.841 4.258S15.692 3.177 15.225 2.687c-.468-.49-1.135-.49-1.394-.49C11.833 2.087 8.002 2.087 8.002 2.087s-3.831 0-5.829.11c-.259 0-.926 0-1.394.49C.312 3.177.163 4.258.163 4.258S.014 5.438.014 6.619v1.142c0 1.181.149 2.361.149 2.361s.149 1.081.616 1.571c.468.49 1.135.49 1.394.49 2.598.11 5.829.11 5.829.11s3.831 0 5.829-.11c.259 0 .926 0 1.394-.49.467-.49.616-1.571.616-1.571s.149-1.18.149-2.361V6.619c0-1.181-.149-2.361-.149-2.361zM6.4 9.6V5.6l4.267 2L6.4 9.6z" fill="currentColor"/>
                    </svg>
                    <input
                      type="url"
                      id="youtube"
                      name="youtube"
                      value={formData.youtube}
                      onChange={handleInputChange}
                      placeholder="https://youtube..."
                      className="form-input with-icon"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="save-section">
              <button 
                onClick={handleSave} 
                disabled={isLoading || !walletData.isConnected}
                className={`save-button ${saveStatus === 'saving' ? 'saving' : ''} ${saveStatus === 'success' ? 'success' : ''} ${saveStatus === 'error' ? 'error' : ''}`}
              >
                {saveStatus === 'saving' && '⏳ Saving...'}
                {saveStatus === 'success' && '✅ Saved!'}
                {saveStatus === 'error' && '❌ Error'}
                {saveStatus === 'idle' && (walletData.isConnected ? 'Save' : 'Connect Wallet')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .settings-container {
          min-height: 100vh;
          background-color: #1a1a1a;
          color: #ffffff;
          font-family: Inter, system-ui, sans-serif;
        }

        .settings-wrapper {
          max-width: 600px;
          margin: 0 auto;
          padding: 1rem;
        }

        .settings-header {
          margin-bottom: 2rem;
        }

        .header-nav {
          display: flex;
          gap: 2rem;
          border-bottom: 1px solid #404040;
          padding-bottom: 1rem;
        }

        .nav-item {
          background: none;
          border: none;
          color: #b3b3b3;
          font-size: 1rem;
          font-weight: 500;
          cursor: pointer;
          transition: color 0.2s ease-in-out;
          padding: 0.5rem 0;
          position: relative;
        }

        .nav-item.active {
          color: #ffffff;
        }

        .nav-item.active::after {
          content: '';
          position: absolute;
          bottom: -1rem;
          left: 0;
          right: 0;
          height: 2px;
          background-color: #00d4aa;
        }

        .nav-item:hover {
          color: #ffffff;
        }

        .settings-content {
          display: flex;
          flex-direction: column;
          gap: 2rem;
        }

        .settings-section {
          padding: 2rem 0;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .section-title {
          font-size: 1.5rem;
          font-weight: 600;
          margin-bottom: 2rem;
          color: #ffffff;
          text-align: center;
        }

        .section-subtitle {
          font-size: 1.125rem;
          font-weight: 600;
          margin-bottom: 1rem;
          color: #ffffff;
        }

        .section-description {
          color: #b3b3b3;
          font-size: 0.875rem;
          line-height: 1.5;
          margin-bottom: 1.5rem;
        }

        .profile-banner {
          width: 100%;
          height: 300px;
          border-radius: 1rem;
          margin-bottom: 2rem;
          position: relative;
          overflow: hidden;
          box-shadow: 0 8px 32px rgba(0, 212, 170, 0.2);
        }

        .banner-background {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(135deg, #00d4aa 0%, #1dd1a1 25%, #2ecc71 50%, #27ae60 75%, #1a5f3f 100%);
        }

        .banner-background::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(45deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 50%, rgba(0, 0, 0, 0.1) 100%);
          pointer-events: none;
        }

        .banner-edit-icon {
          position: absolute;
          bottom: 1rem;
          right: 1rem;
          width: 48px;
          height: 48px;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease-in-out;
          backdrop-filter: blur(10px);
          border: 2px solid rgba(255, 255, 255, 0.2);
        }

        .banner-edit-icon:hover {
          background: rgba(0, 0, 0, 0.5);
          transform: scale(1.1);
          border-color: rgba(255, 255, 255, 0.4);
        }

        .profile-section {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          padding: 2rem;
          display: flex;
          align-items: flex-end;
          gap: 1rem;
          z-index: 2;
          background: linear-gradient(to top, rgba(0, 0, 0, 0.3) 0%, transparent 100%);
        }



        .avatar-wrapper {
          width: 96px;
          height: 96px;
          border-radius: 50%;
          border: 4px solid rgba(255, 255, 255, 0.9);
          overflow: hidden;
          background-color: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          flex-shrink: 0;
        }



        .avatar-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .avatar-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .profile-info {
          flex: 1;
        }

        .profile-name {
          font-size: 1.25rem;
          font-weight: 600;
          margin-bottom: 0.25rem;
          color: #ffffff;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
        }

        .profile-address {
          color: rgba(255, 255, 255, 0.9);
          font-size: 0.875rem;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
        }

        .form-section {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          margin-bottom: 2rem;
          width: 100%;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          width: 100%;
        }

        .form-label {
          color: #b3b3b3;
          font-size: 0.875rem;
          font-weight: 500;
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .form-input {
          background-color: #2a2a2a;
          color: #ffffff;
          padding: 0.75rem 1rem;
          border-radius: 0.5rem;
          border: 1px solid #404040;
          font-size: 0.875rem;
          outline: none;
          transition: all 0.2s ease-in-out;
          width: 100%;
          box-sizing: border-box;
        }

        .form-input::placeholder {
          color: #666666;
        }

        .form-input:focus {
          border-color: #00d4aa;
          background-color: #333333;
        }

        .form-input.with-icon {
          padding-left: 2.5rem;
        }

        .form-textarea {
          background-color: #2a2a2a;
          color: #ffffff;
          padding: 0.75rem 1rem;
          border-radius: 0.5rem;
          border: 1px solid #404040;
          font-size: 0.875rem;
          outline: none;
          resize: vertical;
          min-height: 100px;
          transition: all 0.2s ease-in-out;
          font-family: Inter, system-ui, sans-serif;
        }

        .form-textarea::placeholder {
          color: #666666;
        }

        .form-textarea:focus {
          border-color: #00d4aa;
          background-color: #333333;
        }

        .character-count {
          color: #808080;
          font-size: 0.75rem;
          margin-top: 0.25rem;
          align-self: flex-end;
        }

        .input-with-icon {
          position: relative;
          width: 100%;
        }

        .input-icon {
          position: absolute;
          left: 0.75rem;
          top: 50%;
          transform: translateY(-50%);
          color: #808080;
          z-index: 1;
        }

        .upload-section {
          margin-bottom: 2rem;
          width: 100%;
        }

        .upload-title {
          font-size: 1.125rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
          color: #ffffff;
        }

        .upload-description {
          color: #b3b3b3;
          font-size: 0.875rem;
          margin-bottom: 1rem;
        }

        .upload-area {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .upload-input {
          display: none;
        }

        .upload-button {
          background-color: #333333;
          color: #b3b3b3;
          padding: 0.75rem 1rem;
          border-radius: 0.5rem;
          border: 1px solid #404040;
          cursor: pointer;
          transition: all 0.2s ease-in-out;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .upload-button:hover:not(.loading) {
          background-color: #404040;
        }

        .upload-button.loading {
          cursor: not-allowed;
          opacity: 0.7;
        }

        .upload-button:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .upload-preview {
          width: 60px;
          height: 60px;
          border-radius: 0.5rem;
          overflow: hidden;
          border: 1px solid #404040;
          position: relative;
        }

        .preview-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .remove-image-button {
          position: absolute;
          top: -8px;
          right: -8px;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background-color: #ff4757;
          border: 2px solid #ffffff;
          color: #ffffff;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease-in-out;
          z-index: 1;
        }

        .remove-image-button:hover:not(:disabled) {
          background-color: #ff3742;
          transform: scale(1.1);
        }

        .remove-image-button:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .banner-remove-icon {
          position: absolute;
          top: 1rem;
          left: 1rem;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background-color: rgba(255, 71, 87, 0.9);
          border: 2px solid rgba(255, 255, 255, 0.9);
          color: #ffffff;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease-in-out;
          backdrop-filter: blur(10px);
        }

        .banner-remove-icon:hover:not(:disabled) {
          background-color: rgba(255, 55, 66, 0.9);
          transform: scale(1.1);
        }

        .banner-remove-icon:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .banner-edit-icon.loading {
          cursor: not-allowed;
          opacity: 0.7;
        }

        .loading-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid #404040;
          border-top: 2px solid #00d4aa;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .notifications-section {
          margin-bottom: 2rem;
          width: 100%;
        }

        .social-section {
          margin-bottom: 2rem;
          width: 100%;
        }

        .social-links {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          width: 100%;
        }

        .social-links .form-group {
          width: 100%;
        }

        .social-links .input-with-icon {
          width: 100%;
        }

        .social-links .form-input {
          width: 100%;
          box-sizing: border-box;
        }

        .save-section {
          display: flex;
          justify-content: flex-end;
          width: 100%;
        }

        .save-button {
          background-color: #00d4aa;
          color: #000000;
          padding: 0.75rem 1.5rem;
          border-radius: 0.5rem;
          border: none;
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease-in-out;
        }

        .save-button:hover {
          background-color: #00b894;
          transform: translateY(-1px);
        }

        .save-button:active {
          background-color: #009973;
          transform: translateY(0);
        }

        .save-button:disabled {
          background-color: #404040;
          color: #666666;
          cursor: not-allowed;
          transform: none;
        }

        .save-button.saving {
          background-color: #ffa500;
          color: #000000;
        }

        .save-button.success {
          background-color: #00d4aa;
          color: #000000;
        }

        .save-button.error {
          background-color: #ff4757;
          color: #ffffff;
        }

        @media (max-width: 768px) {
          .settings-wrapper {
            padding: 0.5rem;
            max-width: 100%;
          }

          .settings-section {
            padding: 1.5rem 0;
          }

          .header-nav {
            flex-direction: column;
            gap: 1rem;
          }

          .profile-banner {
            height: 200px;
          }

          .profile-section {
            flex-direction: column;
            align-items: center;
            text-align: center;
            padding: 1.5rem;
          }

          .avatar-wrapper {
            width: 80px;
            height: 80px;
          }

          .social-links {
            gap: 1rem;
          }
        }
      `}</style>
    </div>
  )
} 