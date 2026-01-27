'use client';

import React, { useState, useRef, useEffect, ReactNode } from 'react';
import styles from './MarketToolbar.module.css';
import SearchModal from '../SearchModal';

export interface MarketFilter {
  id: string;
  label: string;
  category?: string;
}

export type MarketToolbarSortOption = '24h_volume' | 'notional' | 'price' | 'trending';
export type MarketToolbarFrequencyOption = 'all' | 'recurring' | 'one-off';
export type MarketToolbarStatusOption = 'all' | 'active' | 'paused' | 'settled';

export interface MarketToolbarFilterSettings {
  sortBy: MarketToolbarSortOption;
  frequency: MarketToolbarFrequencyOption;
  status: MarketToolbarStatusOption;
  hideCrypto: boolean;
}

export interface MarketToolbarProps {
  filters?: MarketFilter[];
  selectedFilter?: string;
  onFilterChange?: (filterId: string) => void;
  onSearch?: (query: string) => void;
  onFilterClick?: () => void;
  onSavedClick?: () => void;
  savedCount?: number;
  className?: string;
  advancedFilters?: Partial<MarketToolbarFilterSettings>;
  onAdvancedFiltersChange?: (filters: MarketToolbarFilterSettings) => void;
}

const defaultAdvancedFilters: MarketToolbarFilterSettings = {
  sortBy: '24h_volume',
  frequency: 'all',
  status: 'active',
  hideCrypto: false,
};

interface DropdownOption<TValue extends string> {
  label: string;
  value: TValue;
  icon?: ReactNode;
}

const sortOptions: DropdownOption<MarketToolbarSortOption>[] = [
  {
    label: '24hr Volume',
    value: '24h_volume',
    icon: (
      <svg viewBox="0 0 24 24" focusable="false">
        <polyline points="4 14 8.5 9.5 12 13 20 5" />
        <polyline points="20 5 20 11 14 11" />
      </svg>
    ),
  },
  {
    label: 'Notional',
    value: 'notional',
    icon: (
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M12 3v18" />
        <path d="M8 7h8" />
        <path d="M8 17h8" />
      </svg>
    ),
  },
  {
    label: 'Price',
    value: 'price',
    icon: (
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M6 19c0-4 3-7 6-7s6 3 6 7" />
        <path d="M9 10l3-6 3 6" />
      </svg>
    ),
  },
  {
    label: 'Trending',
    value: 'trending',
    icon: (
      <svg viewBox="0 0 24 24" focusable="false">
        <polygon points="12 3 3 8 12 13 21 8 12 3" />
        <polyline points="3 13 12 18 21 13" />
      </svg>
    ),
  },
];

const frequencyOptions: DropdownOption<MarketToolbarFrequencyOption>[] = [
  { label: 'All', value: 'all' },
  { label: 'Recurring', value: 'recurring' },
  { label: 'One-off', value: 'one-off' },
];

const statusOptions: DropdownOption<MarketToolbarStatusOption>[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Paused', value: 'paused' },
  { label: 'Settled', value: 'settled' },
];

type BooleanFilterKey = 'hideCrypto';

const booleanFilterToggles: { key: BooleanFilterKey; label: string }[] = [
  { key: 'hideCrypto', label: 'Hide crypto?' },
];

interface ToolbarDropdownProps<TValue extends string> {
  label: string;
  value: TValue;
  options: DropdownOption<TValue>[];
  onChange: (value: TValue) => void;
}

const ToolbarDropdown = <TValue extends string>({
  label,
  value,
  options,
  onChange,
}: ToolbarDropdownProps<TValue>) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const currentOption = options.find((option) => option.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  const handleSelect = (optionValue: TValue) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div className={styles.dropdown} ref={dropdownRef}>
      <button
        type="button"
        className={styles.dropdownTrigger}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className={styles.dropdownText}>
          <span className={styles.dropdownLabel}>{label}</span>
          <span className={styles.dropdownValue}>{currentOption?.label ?? 'Select'}</span>
        </div>
        <span className={styles.dropdownIndicator} data-active={isOpen} />
        <span className={styles.dropdownChevron} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M7 10l5 5 5-5" />
          </svg>
        </span>
      </button>
      <div
        className={`${styles.dropdownMenu} ${isOpen ? styles.dropdownMenuOpen : ''}`}
        role="listbox"
      >
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={isSelected}
              className={`${styles.dropdownOption} ${isSelected ? styles.dropdownOptionSelected : ''}`}
              onClick={() => handleSelect(option.value)}
            >
              <span className={styles.dropdownOptionIcon}>
                {option.icon ?? <span className={styles.dropdownOptionBullet} />}
              </span>
              <span className={styles.dropdownOptionLabel}>{option.label}</span>
              <span
                className={`${styles.dropdownOptionIndicator} ${
                  isSelected ? styles.dropdownOptionIndicatorActive : ''
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};

const MarketToolbar: React.FC<MarketToolbarProps> = ({
  filters = [],
  selectedFilter = 'all',
  onFilterChange,
  onSearch,
  onFilterClick,
  onSavedClick,
  savedCount = 0,
  className,
  advancedFilters,
  onAdvancedFiltersChange,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = useState(false);
  const [internalAdvancedFilters, setInternalAdvancedFilters] =
    useState<MarketToolbarFilterSettings>(defaultAdvancedFilters);

  const activeAdvancedFilters = advancedFilters
    ? { ...defaultAdvancedFilters, ...advancedFilters }
    : internalAdvancedFilters;

  // Default filters if none provided
  const defaultFilters: MarketFilter[] = [
    { id: 'all', label: 'All' },
    { id: 'custom', label: 'Custom' },
    { id: 'metrics', label: 'Metrics' },
    { id: 'generic', label: 'Generic' },
    { id: 'sports', label: 'Sports' },
    { id: 'politics', label: 'Politics' },
    { id: 'financial-assets', label: 'Financial Assets' },
    { id: 'crypto', label: 'Crypto' },
    { id: 'elections', label: 'Elections' },
    { id: 'entertainment', label: 'Entertainment' },
    { id: 'commodities', label: 'Commodities' },
    { id: 'forex', label: 'Forex' },
    { id: 'stocks', label: 'Stocks' },
    { id: 'indices', label: 'Indices' },
    { id: 'events', label: 'Events' },
    { id: 'trump', label: 'Trump' },
    { id: 'venezuela', label: 'Venezuela' },
    { id: 'iran', label: 'Iran' },
    { id: 'ukraine', label: 'Ukraine' },
    { id: 'portugal-election', label: 'Portugal Election' },
    { id: 'minnesota-fraud', label: 'Minnesota Fraud' },
    { id: 'epstein', label: 'Epstein' },
    { id: 'fed', label: 'Fed' },
    { id: 'tweet-markets', label: 'Tweet Markets' },
    { id: 'golden-globes', label: 'Golden Globes' },
    { id: 'silver', label: 'Silver' },
    { id: 'gold', label: 'Gold' },
    { id: 'oil', label: 'Oil' },
    { id: 'technology', label: 'Technology' },
    { id: 'healthcare', label: 'Healthcare' },
    { id: 'energy', label: 'Energy' },
    { id: 'real-estate', label: 'Real Estate' },
    { id: 'currencies', label: 'Currencies' },
    { id: 'bonds', label: 'Bonds' },
    { id: 'derivatives', label: 'Derivatives' },
  ];

  const displayFilters = filters.length > 0 ? filters : defaultFilters;

  // Check scroll position
  const checkScrollPosition = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1);
    }
  };

  useEffect(() => {
    checkScrollPosition();
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', checkScrollPosition);
      window.addEventListener('resize', checkScrollPosition);
      return () => {
        container.removeEventListener('scroll', checkScrollPosition);
        window.removeEventListener('resize', checkScrollPosition);
      };
    }
  }, [displayFilters]);

  const handleFilterIconClick = () => {
    setIsAdvancedFiltersOpen((prev) => !prev);
    onFilterClick?.();
  };

  const updateAdvancedFilters = (updates: Partial<MarketToolbarFilterSettings>) => {
    if (advancedFilters) {
      const next = { ...defaultAdvancedFilters, ...advancedFilters, ...updates };
      onAdvancedFiltersChange?.(next);
      return;
    }

    setInternalAdvancedFilters((prev) => {
      const next = { ...prev, ...updates };
      onAdvancedFiltersChange?.(next);
      return next;
    });
  };

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const scrollAmount = 200;
      scrollContainerRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
    }
  };

  const handleFilterClick = (filterId: string) => {
    onFilterChange?.(filterId);
  };

  return (
    <>
      <div className={styles.toolbarStack}>
    <div className={`${styles.toolbar} ${className || ''}`}>
      {/* Left side: Scrollable filters */}
      <div className={styles.filtersContainer}>
        {/* Scroll left button */}
        {canScrollLeft && (
          <button
            className={styles.scrollButton}
            onClick={() => scroll('left')}
            aria-label="Scroll left"
          >
            <svg
              className={styles.scrollIcon}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}

        {/* Scrollable filter buttons */}
        <div className={styles.filtersScroll} ref={scrollContainerRef}>
          {displayFilters.map((filter) => {
            const isActive = selectedFilter === filter.id;
            return (
              <button
                key={filter.id}
                className={`${styles.filterButton} ${isActive ? styles.filterButtonActive : ''}`}
                onClick={() => handleFilterClick(filter.id)}
                type="button"
              >
                {filter.label}
              </button>
            );
          })}
        </div>

        {/* Scroll right button */}
        {canScrollRight && (
          <button
            className={styles.scrollButton}
            onClick={() => scroll('right')}
            aria-label="Scroll right"
          >
            <svg
              className={styles.scrollIcon}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}
      </div>

      {/* Right side: Action icons */}
      <div className={styles.actionsContainer}>
        {/* Chevron/Scroll indicator */}
        {canScrollRight && (
          <button
            className={styles.iconButton}
            onClick={() => scroll('right')}
            aria-label="Scroll right"
            type="button"
          >
            <svg
              className={styles.actionIcon}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}

        {/* Search icon */}
        <button
          className={styles.iconButton}
            onClick={() => {
              onSearch?.('');
              setIsSearchModalOpen(true);
            }}
          aria-label="Search markets"
          type="button"
        >
          <svg
            className={styles.actionIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </button>

        {/* Filter icon */}
        <button
          className={styles.iconButton}
          onClick={handleFilterIconClick}
          aria-label="Filter options"
          aria-pressed={isAdvancedFiltersOpen}
          type="button"
        >
          <svg
            className={styles.actionIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
            <circle cx="8" cy="6" r="2" />
            <circle cx="16" cy="12" r="2" />
            <circle cx="8" cy="18" r="2" />
          </svg>
        </button>

        {/* Bookmark icon */}
        <button
          className={styles.iconButton}
          onClick={onSavedClick}
          aria-label="Saved markets"
          type="button"
        >
          {savedCount > 0 && (
            <span className={styles.savedBadge}>{savedCount}</span>
          )}
          <svg
            className={styles.actionIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </div>
    </div>

        <div
          className={styles.advancedFiltersWrapper}
          data-open={isAdvancedFiltersOpen}
          aria-hidden={!isAdvancedFiltersOpen}
        >
          <div className={styles.advancedFilters}>
              <div className={styles.filterChip}>
                <ToolbarDropdown
                  label="Sort by"
                  value={activeAdvancedFilters.sortBy}
                  options={sortOptions}
                  onChange={(optionValue) =>
                    updateAdvancedFilters({ sortBy: optionValue as MarketToolbarSortOption })
                  }
                />
              </div>

              <div className={styles.filterChip}>
                <ToolbarDropdown
                  label="Frequency"
                  value={activeAdvancedFilters.frequency}
                  options={frequencyOptions}
                  onChange={(optionValue) =>
                    updateAdvancedFilters({ frequency: optionValue as MarketToolbarFrequencyOption })
                  }
                />
              </div>

              <div className={styles.filterChip}>
                <ToolbarDropdown
                  label="Status"
                  value={activeAdvancedFilters.status}
                  options={statusOptions}
                  onChange={(optionValue) =>
                    updateAdvancedFilters({ status: optionValue as MarketToolbarStatusOption })
                  }
                />
              </div>

              {booleanFilterToggles.map((toggle) => (
                <label key={toggle.key} className={styles.filterToggle}>
                  <span>{toggle.label}</span>
                  <input
                    suppressHydrationWarning
                    type="checkbox"
                    className={styles.filterToggleInput}
                    checked={activeAdvancedFilters[toggle.key]}
                    onChange={(event) =>
                      updateAdvancedFilters({ [toggle.key]: event.target.checked } as Pick<
                        MarketToolbarFilterSettings,
                        BooleanFilterKey
                      >)
                    }
                  />
                </label>
              ))}
          </div>
        </div>
      </div>
      <SearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
      />
    </>
  );
};

export default MarketToolbar;

