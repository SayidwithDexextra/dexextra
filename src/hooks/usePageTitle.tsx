import { useEffect } from 'react';

interface UsePageTitleOptions {
  title: string;
  suffix?: string;
  override?: boolean; // If true, don't append suffix
}

export function usePageTitle({ title, suffix = 'Dexetra', override = false }: UsePageTitleOptions) {
  useEffect(() => {
    const fullTitle = override ? title : `${title} | ${suffix}`;
    document.title = fullTitle;
    
    // Cleanup: Reset to default title when component unmounts
    return () => {
      document.title = 'Dexetra';
    };
  }, [title, suffix, override]);
}

// Hook for dynamic titles that change based on data
export function useDynamicPageTitle() {
  const updateTitle = (title: string, suffix = 'Dexetra') => {
    document.title = `${title} | ${suffix}`;
  };

  const resetTitle = () => {
    document.title = 'Dexetra';
  };

  return { updateTitle, resetTitle };
} 