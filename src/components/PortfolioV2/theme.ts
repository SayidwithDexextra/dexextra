import portfolioDesign from '../../../design/PortfolioDesign.json'

export type PortfolioTheme = {
	backgroundGradient: string
	cardBackground: string
	cardRadius: string
	cardPadding: string
	cardGap: string
	textPrimary: string
	textSecondary: string
	success: string
	borderColor: string
	shadow: string
	buttonRadius: string
	pillRadius: string
	sectionGap: string
	containerPadding: string
}

/**
 * Extracts a minimal theme from design/PortfolioDesign.json for component styling.
 * Falls back to sensible defaults if any key is missing.
 */
export function getPortfolioTheme(): PortfolioTheme {
	const t: any = (portfolioDesign as any)?.theme ?? {}
	return {
		// Use app-wide background for consistency instead of the purple gradient token
		backgroundGradient: 'var(--primary-bg)',
		cardBackground: t?.components?.card?.background ?? '#111111',
		cardRadius: t?.components?.card?.borderRadius ?? '1rem',
		cardPadding: t?.components?.card?.padding ?? '1.5rem',
		cardGap: t?.spacing?.card?.gap ?? '1rem',
		textPrimary: t?.colors?.text?.primary ?? '#FFFFFF',
		textSecondary: t?.colors?.text?.secondary ?? '#9CA3AF',
		success: t?.colors?.text?.success ?? '#10B981',
		borderColor: '#222222',
		shadow:
			t?.shadows?.card ??
			'0 1px 3px rgba(16,24,40,0.06), 0 1px 2px rgba(16,24,40,0.08)',
		buttonRadius: t?.borderRadius?.button ?? '0.5rem',
		pillRadius: t?.borderRadius?.pill ?? '9999px',
		sectionGap: t?.spacing?.section?.gap ?? '1.5rem',
		containerPadding: t?.spacing?.container?.padding ?? '2rem',
	}
}


