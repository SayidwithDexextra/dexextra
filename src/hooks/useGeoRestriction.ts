'use client';

import { useState, useEffect, useCallback } from 'react';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

interface GeoRestrictionState {
  isRestricted: boolean;
  country: string | null;
  countryName: string | null;
}

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States',
};

export function useGeoRestriction() {
  const [state, setState] = useState<GeoRestrictionState>({
    isRestricted: false,
    country: null,
    countryName: null,
  });

  const checkRestriction = useCallback(() => {
    const blocked = getCookie('geo-blocked') === 'true';
    const country = getCookie('geo-country');
    const countryName = country ? (COUNTRY_NAMES[country] || country) : null;
    
    setState({
      isRestricted: blocked,
      country,
      countryName,
    });
  }, []);

  useEffect(() => {
    checkRestriction();
    
    // Re-check periodically in case cookies change (VPN switch, etc.)
    const interval = setInterval(checkRestriction, 5000);
    return () => clearInterval(interval);
  }, [checkRestriction]);

  return state;
}
