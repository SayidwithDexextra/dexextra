import { useEffect, useState, useRef } from 'react'

interface DecryptedTextProps {
    text: string
    speed?: number
    maxIterations?: number
    characters?: string
    className?: string
    style?: React.CSSProperties
    animateOnHover?: boolean
    animateOnMount?: boolean
}

export default function DecryptedText({
    text,
    speed = 50,
    maxIterations = 10,
    characters = '0123456789$.,ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
    className = '',
    style,
    animateOnHover = true,
    animateOnMount = false,
}: DecryptedTextProps) {
    const [displayText, setDisplayText] = useState<string>(text)
    const [isHovering, setIsHovering] = useState<boolean>(false)
    const [shouldAnimate, setShouldAnimate] = useState<boolean>(false)
    const [isAnimating, setIsAnimating] = useState<boolean>(false)
    const [isMounted, setIsMounted] = useState<boolean>(false)
    const [hasAnimatedOnMount, setHasAnimatedOnMount] = useState<boolean>(false)
    const intervalRef = useRef<NodeJS.Timeout | undefined>(undefined)

    // Prevent hydration mismatches by only enabling animations after mount
    useEffect(() => {
        setIsMounted(true)
    }, [])

    // Trigger animation on mount if enabled
    useEffect(() => {
        if (isMounted && animateOnMount && !hasAnimatedOnMount && !isAnimating) {
            setShouldAnimate(true)
            setHasAnimatedOnMount(true)
        }
    }, [isMounted, animateOnMount, hasAnimatedOnMount, isAnimating])

    // Update display text when text prop changes
    useEffect(() => {
        if (isMounted && !isAnimating) {
            setDisplayText(text)
        }
    }, [text, isMounted, isAnimating])

    useEffect(() => {
        // Don't run animations during SSR or before mount
        if (!isMounted) return

        if (shouldAnimate) {
            setIsAnimating(true)
            let iterations = 0

            const animate = () => {
                if (iterations < maxIterations) {
                    setDisplayText(
                        text
                            .split('')
                            .map((char, index) => {
                                if (char === ' ') return ' '
                                // Gradually reveal characters
                                if (iterations > index * (maxIterations / text.length)) {
                                    return char
                                }
                                return characters[Math.floor(Math.random() * characters.length)]
                            })
                            .join('')
                    )
                    iterations++
                    intervalRef.current = setTimeout(animate, speed)
                } else {
                    setDisplayText(text)
                    setIsAnimating(false)
                    setShouldAnimate(false) // Reset animation trigger
                }
            }

            animate()
        } else if (!isHovering) {
            // Only reset display text if not hovering (to prevent interruption)
            setDisplayText(text)
            setIsAnimating(false)
            if (intervalRef.current) {
                clearTimeout(intervalRef.current)
            }
        }

        return () => {
            if (intervalRef.current) {
                clearTimeout(intervalRef.current)
            }
        }
    }, [shouldAnimate, isHovering, text, speed, maxIterations, characters, isMounted])

    // Handle hover state changes to trigger animations
    useEffect(() => {
        if (isMounted && isHovering && animateOnHover && !isAnimating) {
            setShouldAnimate(true)
        }
    }, [isHovering, animateOnHover, isMounted, isAnimating])

    const hoverProps = animateOnHover && isMounted
        ? {
            onMouseEnter: () => setIsHovering(true),
            onMouseLeave: () => setIsHovering(false),
        }
        : {}

    // During SSR or before mount, render static text to prevent hydration mismatch
    if (!isMounted) {
        return (
            <span className={className} style={style}>
                {text}
            </span>
        )
    }

    return (
        <span 
            className={className} 
            style={{
                ...style,
                fontVariantNumeric: 'tabular-nums',
                fontFamily: isAnimating ? 'monospace' : undefined,
                letterSpacing: isAnimating ? '0.5px' : 'normal',
                transition: 'letter-spacing 0.2s ease, font-family 0.2s ease'
            }}
            {...hoverProps}
        >
            {displayText}
        </span>
    )
}
