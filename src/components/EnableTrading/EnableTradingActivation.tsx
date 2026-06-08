'use client'

import { useMemo } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

export type ActivationPhase = 'awaiting' | 'finalizing' | 'success'

// Liquid fill height per phase (0..1). The "finalizing" stage is the fluid
// middle state that bridges the wallet-signature wait and the success state.
const PHASE_LEVEL: Record<ActivationPhase, number> = {
  awaiting: 0.3,
  finalizing: 0.82,
  success: 1,
}

// Tone color per phase. Cool blue while waiting, shifting toward the brand
// green as the session finalizes and lands.
const PHASE_TONE: Record<ActivationPhase, string> = {
  awaiting: '#60A5FA',
  finalizing: '#22D3EE',
  success: '#4ADE80',
}

function phaseCopy(phase: ActivationPhase): { title: string; sub: string; badge: string } {
  switch (phase) {
    case 'awaiting':
      return {
        title: 'Confirm in your wallet',
        sub: 'Approve the signature request to open your gasless session.',
        badge: 'Waiting for signature',
      }
    case 'finalizing':
      return {
        title: 'Activating gasless mode',
        sub: 'Registering your session key — almost there.',
        badge: 'Finalizing',
      }
    case 'success':
      return {
        title: 'Gasless mode activated',
        sub: 'Trade freely — no more signing every order.',
        badge: 'Active',
      }
  }
}

const VESSEL = 96
const RADIUS = 44
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function Wave({
  duration,
  opacity,
  delay = 0,
  topPct,
}: {
  duration: number
  opacity: number
  delay?: number
  topPct: number
}) {
  return (
    <motion.svg
      className="absolute left-0 h-3 w-[200%]"
      style={{ top: `${topPct}%`, opacity }}
      viewBox="0 0 240 16"
      preserveAspectRatio="none"
      aria-hidden="true"
      animate={{ x: ['0%', '-50%'] }}
      transition={{ duration, ease: 'linear', repeat: Infinity, delay }}
    >
      <path
        d="M0 8 C 20 2 40 2 60 8 S 100 14 120 8 S 160 2 180 8 S 220 14 240 8 V16 H0 Z"
        fill="currentColor"
      />
    </motion.svg>
  )
}

export default function EnableTradingActivation({ phase }: { phase: ActivationPhase }) {
  const reducedMotion = useReducedMotion()
  const level = PHASE_LEVEL[phase]
  const tone = PHASE_TONE[phase]
  const copy = useMemo(() => phaseCopy(phase), [phase])
  const isSuccess = phase === 'success'

  // Liquid surface sits at (1 - level) from the top of the vessel.
  const surfaceTopPct = (1 - level) * 100

  const sweepArc = CIRCUMFERENCE * 0.26

  return (
    <div className="flex flex-col items-center justify-center px-2 py-1 text-center">
      <div className="relative" style={{ height: VESSEL, width: VESSEL }}>
        {/* Ambient glow */}
        <motion.div
          className="absolute -inset-4 rounded-full blur-2xl"
          animate={{
            backgroundColor: tone,
            opacity: isSuccess ? 0.32 : 0.16,
            scale: reducedMotion ? 1 : isSuccess ? 1.05 : [1, 1.08, 1],
          }}
          transition={{
            backgroundColor: { duration: 0.6 },
            opacity: { duration: 0.6 },
            scale: reducedMotion
              ? { duration: 0 }
              : isSuccess
                ? { duration: 0.5 }
                : { duration: 2.4, repeat: Infinity, ease: 'easeInOut' },
          }}
          aria-hidden="true"
        />

        {/* Vessel + liquid */}
        <div className="absolute inset-0 overflow-hidden rounded-full border border-white/10 bg-[#0B0B0B]">
          {/* glass sheen */}
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.06] via-transparent to-white/[0.02]" />

          <motion.div
            className="absolute inset-0"
            style={{ color: tone }}
            animate={{ color: tone }}
            transition={{ duration: 0.6 }}
            aria-hidden="true"
          >
            {/* liquid body grows from the bottom */}
            <motion.div
              className="absolute inset-x-0 bottom-0"
              initial={false}
              animate={{ height: `${level * 100}%` }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="absolute inset-0" style={{ background: 'currentColor', opacity: 0.22 }} />
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: 'linear-gradient(to top, currentColor, transparent)',
                  opacity: 0.18,
                }}
              />
            </motion.div>

            {/* moving surface waves, parked at the current liquid level */}
            <motion.div
              className="absolute inset-x-0 top-0 h-full"
              initial={false}
              animate={{ opacity: isSuccess ? 0 : 1 }}
              transition={{ duration: 0.5 }}
            >
              {!reducedMotion && (
                <motion.div
                  className="absolute inset-x-0"
                  initial={false}
                  animate={{ top: `${surfaceTopPct}%` }}
                  transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                  style={{ height: 24, transform: 'translateY(-12px)' }}
                >
                  <Wave duration={phase === 'finalizing' ? 1.8 : 3} opacity={0.5} topPct={0} />
                  <Wave duration={phase === 'finalizing' ? 2.6 : 4.2} opacity={0.32} delay={0.3} topPct={18} />
                </motion.div>
              )}
            </motion.div>
          </motion.div>
        </div>

        {/* Base ring */}
        <svg
          className="absolute inset-0"
          viewBox={`0 0 ${VESSEL} ${VESSEL}`}
          fill="none"
          aria-hidden="true"
        >
          <circle cx={VESSEL / 2} cy={VESSEL / 2} r={RADIUS} stroke="rgba(255,255,255,0.08)" strokeWidth={3} />
          {isSuccess && (
            <motion.circle
              cx={VESSEL / 2}
              cy={VESSEL / 2}
              r={RADIUS}
              stroke={tone}
              strokeWidth={3}
              strokeLinecap="round"
              transform={`rotate(-90 ${VESSEL / 2} ${VESSEL / 2})`}
              initial={{ pathLength: reducedMotion ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            />
          )}
        </svg>

        {/* Rotating sweep (whole SVG rotates around its center for reliable origin) */}
        {!isSuccess && (
          <motion.svg
            className="absolute inset-0"
            style={{ transformOrigin: 'center' }}
            viewBox={`0 0 ${VESSEL} ${VESSEL}`}
            fill="none"
            aria-hidden="true"
            animate={reducedMotion ? undefined : { rotate: 360 }}
            transition={
              reducedMotion
                ? undefined
                : { duration: phase === 'finalizing' ? 0.9 : 1.6, repeat: Infinity, ease: 'linear' }
            }
          >
            <circle
              cx={VESSEL / 2}
              cy={VESSEL / 2}
              r={RADIUS}
              stroke={tone}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={`${sweepArc} ${CIRCUMFERENCE - sweepArc}`}
            />
          </motion.svg>
        )}

        {/* Checkmark on success */}
        <AnimatePresence>
          {isSuccess && (
            <motion.div
              className="absolute inset-0 flex items-center justify-center"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.12 }}
            >
              <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <motion.path
                  d="M5 12.5 L10 17.5 L19 7"
                  stroke={tone}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: reducedMotion ? 1 : 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
                />
              </svg>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Success ripple burst */}
        <AnimatePresence>
          {isSuccess && !reducedMotion && (
            <>
              <motion.div
                className="pointer-events-none absolute inset-0 rounded-full border"
                style={{ borderColor: tone }}
                initial={{ scale: 0.85, opacity: 0.6 }}
                animate={{ scale: 1.6, opacity: 0 }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
                aria-hidden="true"
              />
              {Array.from({ length: 8 }).map((_, i) => {
                const angle = (i / 8) * Math.PI * 2
                const dx = Math.cos(angle) * 64
                const dy = Math.sin(angle) * 64
                return (
                  <motion.span
                    key={i}
                    className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: tone }}
                    initial={{ x: '-50%', y: '-50%', opacity: 0, scale: 0.5 }}
                    animate={{ x: `calc(-50% + ${dx}px)`, y: `calc(-50% + ${dy}px)`, opacity: [1, 0], scale: 1 }}
                    transition={{ duration: 0.85, ease: 'easeOut', delay: 0.1 }}
                    aria-hidden="true"
                  />
                )
              })}
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Copy */}
      <div className="mt-4 flex flex-col items-center">
        <div
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide"
          style={{
            color: tone,
            borderColor: `${tone}55`,
            backgroundColor: `${tone}14`,
          }}
        >
          <motion.span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: tone }}
            animate={reducedMotion || isSuccess ? { opacity: 1 } : { opacity: [1, 0.35, 1] }}
            transition={reducedMotion || isSuccess ? undefined : { duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          />
          {copy.badge}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={phase}
            className="mt-2.5 flex flex-col items-center"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <h2 className="text-sm font-medium text-white">{copy.title}</h2>
            <p className="mt-1 max-w-[20rem] text-[11px] leading-relaxed text-[#808080]">{copy.sub}</p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
