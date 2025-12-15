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
    youtube: '',
    facebook: ''
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
        facebook: walletData.userProfile.facebook_url || '',
      })
      setProfileImage(walletData.userProfile.profile_image_url || null)
      setBannerImage(walletData.userProfile.banner_image_url || null)
    } else if (walletData.isConnected && walletData.address) {
      // If wallet is connected but no profile data, try to refresh it
      refreshProfile()
    }
  }, [walletData.userProfile, walletData.isConnected, walletData.address, refreshProfile])

  // Validate username as user types
  const validateUsername = (username: string): string | null => {
    if (!username) return null // Allow empty username
    
    const usernameRegex = /^[a-zA-Z0-9_-]{3,30}$/
    if (!usernameRegex.test(username)) {
      return 'Username must be 3-30 characters long and can only contain letters, numbers, underscores, and hyphens'
    }
    if (username.startsWith('0x')) {
      return 'Username cannot start with 0x'
    }
    return null
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    
    // Validate username on change
    if (name === 'username') {
      setUsernameError(validateUsername(value))
    }
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

  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [usernameError, setUsernameError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!walletData.isConnected || !walletData.address) {
      setErrorMessage('Please connect your wallet first')
      return
    }

    setSaveStatus('saving')
    setIsLoading(true)
    setErrorMessage(null)

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
      
      // Set specific error message
      if (error instanceof Error) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('Failed to save profile. Please try again.')
      }
      
      // Clear error status after 5 seconds
      setTimeout(() => {
        setSaveStatus('idle')
        setErrorMessage(null)
      }, 5000)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={`min-h-screen bg-[#0F0F0F] text-white font-sans ${className || ''}`}>
      <div className="max-w-2xl mx-auto p-6">
        {/* Header Section */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
              Account Settings
            </h4>
            <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
              Profile
            </div>
          </div>
          
          <div className="flex gap-4 border-b border-[#222222] pb-4">
            <button className="text-sm font-medium text-white border-b-2 border-[#00d4aa] pb-4">
              Dashboard
            </button>
            <button className="text-sm font-medium text-[#808080] hover:text-white transition-colors duration-200">
              Edit Profile
            </button>
          </div>
        </div>

        {/* Profile Banner Section */}
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 mb-6">
          <div className="relative h-64 rounded-t-md overflow-hidden bg-gradient-to-r from-[#00d4aa] via-[#1dd1a1] to-[#2ecc71]">
            {bannerImage ? (
              <img 
                src={bannerImage}
                alt="Profile banner"
                className="absolute inset-0 w-full h-full object-contain object-center bg-black/20"
              />
            ) : null}
            <input
              type="file"
              id="banner-image"
              accept="image/*"
              onChange={(e) => handleImageUpload(e, 'banner')}
              className="hidden"
              disabled={isLoading}
            />
            
            {/* Banner Edit Button */}
            <label 
              htmlFor="banner-image" 
              className="absolute bottom-4 right-4 w-8 h-8 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center cursor-pointer transition-all duration-200 backdrop-blur-sm border border-white/20"
              title="Upload banner image"
            >
              {isLoading ? (
                <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="white"/>
                </svg>
              )}
            </label>
            
            {/* Banner Remove Button */}
            {bannerImage && (
              <button 
                onClick={() => handleRemoveImage('banner')}
                className="absolute top-4 right-4 w-6 h-6 bg-red-500/80 hover:bg-red-500 rounded-full flex items-center justify-center transition-all duration-200"
                title="Remove banner image"
                disabled={isLoading}
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                  <path d="M12 4L4 12M4 4l8 8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            )}
            
          </div>
          
          {/* Profile Info */}
          <div className="relative pb-6 px-6">
            {/* Profile Avatar - positioned relative to this section */}
            <div className="absolute -top-12 left-6 z-10">
              <div className="w-24 h-24 rounded-full border-4 border-[#0F0F0F] overflow-hidden bg-[#1A1A1A] flex items-center justify-center shadow-lg">
                {profileImage ? (
                  <Image
                    src={profileImage}
                    alt="Profile"
                    width={96}
                    height={96}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg width="32" height="32" viewBox="0 0 40 40" fill="none">
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
            </div>
            
            {/* Content with top margin for avatar */}
            <div className="pt-16">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white mb-1">
                    {walletData.userProfile?.display_name || 
                     walletData.userProfile?.username || 
                     (walletData.address ? `${walletData.address.slice(0, 6)}...${walletData.address.slice(-6)}` : 'Not Connected')}
                  </h3>
                  <p className="text-[11px] text-[#808080]">
                    {walletData.address ? `${walletData.address.slice(0, 6)}...${walletData.address.slice(-6)}` : 'Please connect wallet'}
                  </p>
                </div>
                
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${walletData.isConnected ? 'bg-green-400' : 'bg-[#404040]'}`} />
                  <span className="text-[10px] text-[#606060]">
                    {walletData.isConnected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Basic Information */}
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 mb-6">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                Basic Information
              </h4>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="username" className="block text-[11px] font-medium text-[#808080]">
                    Username *
                  </label>
                  {formData.username && (
                    <div className={`text-[10px] px-1.5 py-0.5 rounded ${
                      usernameError 
                        ? 'bg-red-500/10 text-red-500' 
                        : 'bg-green-500/10 text-green-500'
                    }`}>
                      {usernameError ? 'Invalid' : 'Valid'}
                    </div>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="text"
                    id="username"
                    name="username"
                    value={formData.username}
                    onChange={handleInputChange}
                    placeholder="Enter username..."
                    className={`w-full bg-[#1A1A1A] border rounded-md px-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:outline-none transition-colors duration-200 ${
                      usernameError
                        ? 'border-red-500/50 focus:border-red-500'
                        : formData.username
                        ? 'border-green-500/50 focus:border-green-500'
                        : 'border-[#333333] focus:border-[#00d4aa]'
                    }`}
                  />
                  {formData.username && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                      {usernameError ? (
                        <svg className="w-4 h-4 text-red-500" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                          <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-green-500" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                          <path d="M8 12l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                  )}
                </div>
                <div className="mt-2 flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#606060] flex-shrink-0 mt-1" />
                  <span className="text-[9px] text-[#606060]">
                    Username must be 3-30 characters long and can only contain letters, numbers, underscores, and hyphens
                  </span>
                </div>
              </div>

              <div>
                <label htmlFor="name" className="block text-[11px] font-medium text-[#808080] mb-2">
                  Display Name
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="Enter display name..."
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md px-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:border-[#00d4aa] focus:outline-none transition-colors duration-200"
                />
              </div>

              <div>
                <label htmlFor="bio" className="block text-[11px] font-medium text-[#808080] mb-2">
                  Bio
                </label>
                <textarea
                  id="bio"
                  name="bio"
                  value={formData.bio}
                  onChange={handleInputChange}
                  placeholder="Tell us about yourself..."
                  rows={4}
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md px-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:border-[#00d4aa] focus:outline-none transition-colors duration-200 resize-none"
                />
                <div className="flex justify-between items-center mt-2">
                  <span className="text-[9px] text-[#606060]">Share your story with the community</span>
                  <span className="text-[9px] text-[#606060]">{formData.bio.length}/180</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Profile Image Upload */}
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 mb-6">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                Profile Image
              </h4>
              <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                Optional
              </div>
            </div>

            <p className="text-[10px] text-[#606060] mb-4">
              Recommended 600px × 600px. JPEG, PNG, GIF, or WebP. Max 10MB
            </p>

            <div className="flex items-start gap-4">
              <input
                type="file"
                id="profile-image"
                accept="image/*"
                onChange={(e) => handleImageUpload(e, 'profile')}
                className="hidden"
                disabled={isLoading}
              />
              
              <label 
                htmlFor="profile-image" 
                className={`flex items-center gap-2 bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#333333] rounded-md px-4 py-2.5 cursor-pointer transition-all duration-200 ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isLoading ? (
                  <>
                    <div className="w-3 h-3 border border-[#606060] border-t-[#00d4aa] rounded-full animate-spin" />
                    <span className="text-[11px] text-[#606060]">Uploading...</span>
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                      <path d="M10 4V16M4 10H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    <span className="text-[11px] text-white">Choose Image</span>
                  </>
                )}
              </label>

              {profileImage && (
                <div className="relative">
                  <div className="w-16 h-16 rounded-md overflow-hidden border border-[#333333]">
                    <Image
                      src={profileImage}
                      alt="Profile preview"
                      width={64}
                      height={64}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <button 
                    onClick={() => handleRemoveImage('profile')}
                    className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center transition-colors duration-200"
                    title="Remove profile image"
                    disabled={isLoading}
                  >
                    <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
                      <path d="M9 3L3 9M3 3l6 6" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Email Notifications */}
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 mb-6">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                Email Notifications
              </h4>
              <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                Optional
              </div>
            </div>

            <p className="text-[10px] text-[#606060] mb-4">
              Get notifications about your activity. Your email won't be shared or visible publicly.
            </p>

            <div>
              <label htmlFor="email" className="block text-[11px] font-medium text-[#808080] mb-2">
                Email Address
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="Enter your email..."
                className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md px-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:border-[#00d4aa] focus:outline-none transition-colors duration-200"
              />
            </div>
          </div>
        </div>

        {/* Social Links */}
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 mb-6">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                Social & Web Links
              </h4>
              <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                Public
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="website" className="block text-[11px] font-medium text-[#808080] mb-2">
                  Website
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[#606060]">
                      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M8 1a7 7 0 0 0 0 14A7 7 0 0 0 8 1z" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M1 8h14" stroke="currentColor" strokeWidth="1.5"/>
                    </svg>
                  </div>
                  <input
                    type="url"
                    id="website"
                    name="website"
                    value={formData.website}
                    onChange={handleInputChange}
                    placeholder="https://your-website.com"
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md pl-10 pr-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:border-[#00d4aa] focus:outline-none transition-colors duration-200"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="twitter" className="block text-[11px] font-medium text-[#808080] mb-2">
                  Twitter
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[#606060]">
                      <path d="M16 3.037a6.5 6.5 0 0 1-1.885.516 3.28 3.28 0 0 0 1.443-1.816 6.57 6.57 0 0 1-2.085.795 3.28 3.28 0 0 0-5.593 2.99A9.32 9.32 0 0 1 1.114 2.1a3.28 3.28 0 0 0 1.015 4.381A3.28 3.28 0 0 1 .64 6.07v.041a3.28 3.28 0 0 0 2.633 3.218 3.28 3.28 0 0 1-1.482.056 3.28 3.28 0 0 0 3.067 2.277A6.58 6.58 0 0 1 0 13.027a9.29 9.29 0 0 0 5.032 1.475c6.038 0 9.34-5.002 9.34-9.34 0-.142-.003-.284-.009-.425A6.68 6.68 0 0 0 16 3.037z" fill="currentColor"/>
                    </svg>
                  </div>
                  <input
                    type="url"
                    id="twitter"
                    name="twitter"
                    value={formData.twitter}
                    onChange={handleInputChange}
                    placeholder="https://twitter.com/username"
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md pl-10 pr-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:border-[#00d4aa] focus:outline-none transition-colors duration-200"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="discord" className="block text-[11px] font-medium text-[#808080] mb-2">
                  Discord
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[#606060]">
                      <path d="M13.545 2.907a13.2 13.2 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.2 12.2 0 0 0-3.658 0 8 8 0 0 0-.412-.833.05.05 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.04.04 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032c.001.014.01.028.021.037a13.3 13.3 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019c.308-.42.582-.863.818-1.329a.05.05 0 0 0-.01-.059.05.05 0 0 0-.018-.011 8.9 8.9 0 0 1-1.248-.595.05.05 0 0 1-.02-.066.05.05 0 0 1 .015-.019c.084-.063.168-.129.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.05.05 0 0 1 .053.007c.08.066.164.132.248.195a.05.05 0 0 1-.004.085 8.3 8.3 0 0 1-1.249.594.05.05 0 0 0-.03.03.05.05 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.2 13.2 0 0 0 4.001-2.02.05.05 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.03.03 0 0 0-.02-.018" fill="currentColor"/>
                    </svg>
                  </div>
                  <input
                    type="url"
                    id="discord"
                    name="discord"
                    value={formData.discord}
                    onChange={handleInputChange}
                    placeholder="https://discord.gg/invite"
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md pl-10 pr-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:border-[#00d4aa] focus:outline-none transition-colors duration-200"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="instagram" className="block text-[11px] font-medium text-[#808080] mb-2">
                  Instagram
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[#606060]">
                      <rect x="1" y="1" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.5"/>
                      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/>
                      <circle cx="12" cy="4" r="0.5" fill="currentColor"/>
                    </svg>
                  </div>
                  <input
                    type="text"
                    id="instagram"
                    name="instagram"
                    value={formData.instagram}
                    onChange={handleInputChange}
                    placeholder="@username or https://www.instagram.com/username/"
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md pl-10 pr-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:border-[#00d4aa] focus:outline-none transition-colors duration-200"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="facebook" className="block text-[11px] font-medium text-[#808080] mb-2">
                  Facebook
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[#606060]">
                      <path
                        d="M9.2 15V9.2h2l.3-2.3H9.2V5.4c0-.7.2-1.2 1.2-1.2h1.3V2.1c-.2 0-1 0-2 0-2 0-3.3 1.2-3.3 3.5v1.3H4.3v2.3h2.1V15h2.8z"
                        fill="currentColor"
                      />
                    </svg>
                  </div>
                  <input
                    type="text"
                    id="facebook"
                    name="facebook"
                    value={formData.facebook}
                    onChange={handleInputChange}
                    placeholder="@username or https://www.facebook.com/username"
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md pl-10 pr-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:border-[#00d4aa] focus:outline-none transition-colors duration-200"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="youtube" className="block text-[11px] font-medium text-[#808080] mb-2">
                  YouTube
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[#606060]">
                      <path d="M15.841 4.258S15.692 3.177 15.225 2.687c-.468-.49-1.135-.49-1.394-.49C11.833 2.087 8.002 2.087 8.002 2.087s-3.831 0-5.829.11c-.259 0-.926 0-1.394.49C.312 3.177.163 4.258.163 4.258S.014 5.438.014 6.619v1.142c0 1.181.149 2.361.149 2.361s.149 1.081.616 1.571c.468.49 1.135.49 1.394.49 2.598.11 5.829.11 5.829.11s3.831 0 5.829-.11c.259 0 .926 0 1.394-.49.467-.49.616-1.571.616-1.571s.149-1.18.149-2.361V6.619c0-1.181-.149-2.361-.149-2.361zM6.4 9.6V5.6l4.267 2L6.4 9.6z" fill="currentColor"/>
                    </svg>
                  </div>
                  <input
                    type="url"
                    id="youtube"
                    name="youtube"
                    value={formData.youtube}
                    onChange={handleInputChange}
                    placeholder="https://youtube.com/@username"
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-md pl-10 pr-3 py-2.5 text-[11px] text-white placeholder-[#606060] focus:border-[#00d4aa] focus:outline-none transition-colors duration-200"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {errorMessage && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-md">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <span className="text-[11px] text-red-500">{errorMessage}</span>
            </div>
          </div>
        )}

        {/* Save Actions */}
        <div className="flex justify-end">
          <button 
            onClick={handleSave} 
            disabled={isLoading || !walletData.isConnected || !!usernameError}
            className={`px-6 py-3 rounded-md font-medium text-sm transition-all duration-200 flex items-center gap-2 ${
              saveStatus === 'saving' 
                ? 'bg-yellow-500 text-black cursor-not-allowed' 
                : saveStatus === 'success'
                ? 'bg-green-500 text-black'
                : saveStatus === 'error'
                ? 'bg-red-500 text-white'
                : walletData.isConnected
                ? 'bg-[#00d4aa] hover:bg-[#00b894] text-black'
                : 'bg-[#404040] text-[#666666] cursor-not-allowed'
            }`}
          >
            {saveStatus === 'saving' && (
              <>
                <div className="w-3 h-3 border border-black/30 border-t-black rounded-full animate-spin" />
                Saving...
              </>
            )}
            {saveStatus === 'success' && (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Saved!
              </>
            )}
            {saveStatus === 'error' && (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                  <line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" strokeWidth="2"/>
                  <line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" strokeWidth="2"/>
                </svg>
                Error
              </>
            )}
            {saveStatus === 'idle' && (
              <>
                {walletData.isConnected ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <polyline points="17,21 17,13 7,13 7,21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <polyline points="7,3 7,8 15,8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Save Profile
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" stroke="currentColor" strokeWidth="2"/>
                      <line x1="8" y1="21" x2="16" y2="21" stroke="currentColor" strokeWidth="2"/>
                      <line x1="12" y1="17" x2="12" y2="21" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                    Connect Wallet
                  </>
                )}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
} 