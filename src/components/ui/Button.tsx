'use client'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary'
  size?: 'sm' | 'md' | 'lg'
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonProps) {
  const baseStyles = 'rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'
  
  const variants = {
    primary: 'bg-[#3b82f6] text-white hover:bg-[#2563eb] active:bg-[#1d4ed8] focus:ring-[#3b82f6]/50 disabled:bg-[#374151] disabled:text-[#9ca3af] border-none',
    secondary: 'bg-transparent text-[#a1a1a1] hover:bg-[#2a2a2a] hover:border-[#525252] focus:ring-[#3b82f6]/50 border border-[#404040]',
  }
  
  const sizes = {
    sm: 'px-3 py-1.5 text-sm h-8',
    md: 'px-6 py-3 text-sm h-12',
    lg: 'px-8 py-4 text-base h-14',
  }

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export default Button 