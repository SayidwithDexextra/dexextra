'use client'

import React, { useState } from 'react'
import Image from 'next/image'

export interface SettingsProps {
  className?: string
}

export default function Settings({ className }: SettingsProps) {
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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        setProfileImage(e.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSave = () => {
    console.log('Settings saved:', formData)
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
              <div className="banner-background">
                <div className="banner-edit-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="white"/>
                  </svg>
                </div>
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
                  <h3 className="profile-name">0x60D...2796B</h3>
                  <p className="profile-address">0x60D...2796B</p>
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
              <p className="upload-description">Recommended 600px x 600px. JPG, PNG, or GIF. Max file size: 2MB</p>
              <div className="upload-area">
                <input
                  type="file"
                  id="profile-image"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="upload-input"
                />
                <label htmlFor="profile-image" className="upload-button">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M10 4V16M4 10H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  Choose Media
                </label>
                {profileImage && (
                  <div className="upload-preview">
                    <Image
                      src={profileImage}
                      alt="Preview"
                      width={60}
                      height={60}
                      className="preview-image"
                    />
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
              <button onClick={handleSave} className="save-button">
                Save
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

        .upload-button:hover {
          background-color: #404040;
        }

        .upload-preview {
          width: 60px;
          height: 60px;
          border-radius: 0.5rem;
          overflow: hidden;
          border: 1px solid #404040;
        }

        .preview-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
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