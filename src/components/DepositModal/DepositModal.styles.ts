// Design system constants for DepositModal
export const designSystem = {
  colors: {
    background: {
      primary: "#1a1d29",
      secondary: "#252937",
      modalOverlay: "transparent"
    },
    text: {
      primary: "#ffffff",
      secondary: "#9ca3af",
      muted: "#6b7280",
      accent: "#3b82f6"
    },
    interactive: {
      buttonPrimary: "#3b82f6",
      buttonPrimaryHover: "#2563eb",
      cardBackground: "#2d3142",
      cardHover: "#363a4f",
      border: "#374151"
    },
    status: {
      lowBalance: "#6b7280"
    },
    brand: {
      ethereum: "#627eea",
      polygon: "#8247e5",
      bitcoin: "#f7931a",
      visa: "#1a1f71",
      coinbase: "#0052ff"
    }
  },
  typography: {
    hierarchy: {
      modalTitle: {
        fontSize: "13px",
        fontWeight: "500",
        lineHeight: "1.2",
        color: "#ffffff"
      },
      modalSubtitle: {
        fontSize: "10px",
        fontWeight: "400",
        lineHeight: "1.3",
        color: "#9ca3af"
      },
      sectionLabel: {
        fontSize: "10px",
        fontWeight: "500",
        lineHeight: "1.3",
        color: "#9ca3af"
      },
      primaryText: {
        fontSize: "12px",
        fontWeight: "500",
        lineHeight: "1.3",
        color: "#ffffff"
      },
      secondaryText: {
        fontSize: "10px",
        fontWeight: "400",
        lineHeight: "1.3",
        color: "#9ca3af"
      },
      amountText: {
        fontSize: "12px",
        fontWeight: "600",
        lineHeight: "1.2",
        color: "#ffffff"
      },
      statusText: {
        fontSize: "11px",
        fontWeight: "400",
        lineHeight: "1.2",
        color: "#6b7280"
      }
    }
  },
  spacing: {
    modalPadding: "10px",
    cardPadding: "10px",
    iconSpacing: "10px",
    sectionSpacing: "12px",
    itemSpacing: "8px"
  },
  effects: {
    borderRadius: {
      medium: "12px",
      large: "16px",
      full: "50%"
    },
    shadows: {
      modal: "0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05)"
    },
    transitions: {
      default: "all 0.2s ease"
    }
  }
}

// Style objects
export const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: designSystem.colors.background.modalOverlay,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '16px'
  },

  modal: {
    backgroundColor: designSystem.colors.background.secondary,
    borderRadius: designSystem.effects.borderRadius.large,
    padding: designSystem.spacing.modalPadding,
    boxShadow: designSystem.effects.shadows.modal,
    border: `1px solid ${designSystem.colors.interactive.border}`,
    width: '380px',
    height: '480px',
    overflow: 'hidden' as const,
    position: 'relative' as const,
    display: 'flex',
    flexDirection: 'column' as const
  },

  closeButton: {
    position: 'absolute' as const,
    top: '12px',
    right: '12px',
    width: '24px',
    height: '24px',
    color: designSystem.colors.text.secondary,
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: designSystem.effects.transitions.default
  },

  header: {
    textAlign: 'center' as const,
    marginBottom: designSystem.spacing.sectionSpacing,
    flexShrink: 0,
    paddingTop: '16px',
    paddingBottom: '12px',
    borderBottom: `1px solid ${designSystem.colors.interactive.border}`
  },

  headerIcon: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '8px'
  },

  title: {
    ...designSystem.typography.hierarchy.modalTitle,
    margin: 0,
    marginBottom: '1px'
  },

  subtitle: {
    ...designSystem.typography.hierarchy.modalSubtitle,
    margin: 0
  },

  paymentSection: {
    marginBottom: designSystem.spacing.sectionSpacing,
    flexShrink: 0
  },

  paymentCard: {
    borderRadius: designSystem.effects.borderRadius.medium,
    padding: designSystem.spacing.cardPadding,
    cursor: 'pointer',
    transition: designSystem.effects.transitions.default,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },

  paymentCardLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: designSystem.spacing.iconSpacing
  },

  paymentCardRight: {
    display: 'flex',
    alignItems: 'center',
    gap: designSystem.spacing.iconSpacing
  },

  paymentIcons: {
    display: 'flex',
    gap: '4px'
  },

  tokenSection: {
    marginBottom: '8px',
    flex: 1,
    overflow: 'hidden' as const,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column' as const
  },

  tokenList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: designSystem.spacing.itemSpacing,
    overflowY: 'auto' as const,
    paddingRight: '4px',
    marginRight: '-4px',
    flex: 1,
    minHeight: 0
  },

  tokenCard: {
    borderRadius: '8px',
    padding: designSystem.spacing.cardPadding,
    border: '1px solid transparent',
    cursor: 'pointer',
    transition: designSystem.effects.transitions.default,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },

  tokenCardSelected: {
    borderRadius: '8px',
    padding: designSystem.spacing.cardPadding,
    border: '1px solid rgba(255, 255, 255, 0.2)',
    cursor: 'pointer',
    transition: designSystem.effects.transitions.default,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },

  paymentCardSelected: {
    borderRadius: designSystem.effects.borderRadius.medium,
    padding: designSystem.spacing.cardPadding,
    border: '1px solid rgba(255, 255, 255, 0.2)',
    cursor: 'pointer',
    transition: designSystem.effects.transitions.default,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },

  tokenCardLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: designSystem.spacing.iconSpacing
  },

  tokenCardRight: {
    display: 'flex',
    alignItems: 'center',
    gap: designSystem.spacing.iconSpacing
  },

  tokenIcon: {
    width: '28px',
    height: '28px',
    borderRadius: designSystem.effects.borderRadius.full,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px'
  },

  networkBadge: {
    position: 'absolute' as const,
    bottom: '-2px',
    right: '-2px',
    width: '16px',
    height: '16px',
    borderRadius: designSystem.effects.borderRadius.full,
    border: `2px solid ${designSystem.colors.background.primary}`,
    fontSize: '9px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },

  continueButton: {
    backgroundColor: designSystem.colors.interactive.buttonPrimary,
    color: designSystem.colors.text.primary,
    borderRadius: designSystem.effects.borderRadius.medium,
    padding: '10px 16px',
    fontSize: '12px',
    fontWeight: '600',
    border: 'none',
    cursor: 'pointer',
    width: '100%',
    transition: designSystem.effects.transitions.default,
    flexShrink: 0,
    marginTop: 'auto'
  }
} 