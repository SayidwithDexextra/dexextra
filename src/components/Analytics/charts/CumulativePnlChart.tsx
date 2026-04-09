'use client'

import React, { useEffect, useRef, useMemo } from 'react'
import { Chart, registerables } from 'chart.js/auto'
import { DailyActivityData } from '@/hooks/useAccountActivity'
import { DailyPnlData } from '@/hooks/useOnChainTrades'
import { formatCurrency } from '@/lib/formatters'

Chart.register(...registerables)

interface CumulativePnlChartProps {
  data: DailyActivityData[] | DailyPnlData[]
  isLoading?: boolean
  height?: number
}

export default function CumulativePnlChart({ data, isLoading, height = 180 }: CumulativePnlChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)

  const cumulativeData = useMemo(() => {
    let cumulative = 0
    return data.map(d => {
      cumulative += d.pnl
      return { date: d.date, pnl: d.pnl, cumulative }
    })
  }, [data])

  const isPositive = cumulativeData.length > 0 && cumulativeData[cumulativeData.length - 1].cumulative >= 0

  useEffect(() => {
    if (!canvasRef.current) return

    if (chartRef.current) {
      chartRef.current.destroy()
      chartRef.current = null
    }

    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return

    const labels = cumulativeData.map(d => {
      const date = new Date(d.date)
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    })

    const gradient = ctx.createLinearGradient(0, 0, 0, height)
    if (isPositive) {
      gradient.addColorStop(0, 'rgba(74, 222, 128, 0.3)')
      gradient.addColorStop(1, 'rgba(74, 222, 128, 0.02)')
    } else {
      gradient.addColorStop(0, 'rgba(248, 113, 113, 0.3)')
      gradient.addColorStop(1, 'rgba(248, 113, 113, 0.02)')
    }

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Cumulative',
            data: cumulativeData.map(d => d.cumulative),
            borderColor: isPositive ? 'rgba(74, 222, 128, 0.9)' : 'rgba(248, 113, 113, 0.9)',
            backgroundColor: gradient,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 3,
            pointBackgroundColor: isPositive ? 'rgba(74, 222, 128, 1)' : 'rgba(248, 113, 113, 1)',
            borderWidth: 1.5,
          },
          {
            label: 'Daily',
            data: cumulativeData.map(d => d.pnl),
            type: 'bar',
            backgroundColor: cumulativeData.map(d => 
              d.pnl >= 0 ? 'rgba(74, 222, 128, 0.4)' : 'rgba(248, 113, 113, 0.4)'
            ),
            borderColor: cumulativeData.map(d => 
              d.pnl >= 0 ? 'rgba(74, 222, 128, 0.6)' : 'rgba(248, 113, 113, 0.6)'
            ),
            borderWidth: 1,
            borderRadius: 1,
            barPercentage: 0.5,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              boxWidth: 6,
              boxHeight: 6,
              usePointStyle: true,
              pointStyle: 'rect',
              padding: 8,
              font: { size: 9 },
              color: '#808080',
            },
          },
          tooltip: {
            backgroundColor: 'rgba(5,5,5,0.95)',
            titleColor: '#a0a0a0',
            bodyColor: '#e0e0e0',
            borderColor: '#252525',
            borderWidth: 1,
            padding: 8,
            titleFont: { size: 9 },
            bodyFont: { size: 9 },
            displayColors: true,
            boxWidth: 6,
            boxHeight: 6,
            callbacks: {
              label: (ctx) => {
                const value = ctx.parsed.y
                return `${ctx.dataset.label}: ${formatCurrency(value, { showSign: true })}`
              },
            },
          },
        },
        scales: {
          x: {
            border: { display: false },
            grid: { display: false },
            ticks: {
              color: '#505050',
              font: { size: 8 },
              maxRotation: 0,
            },
          },
          y: {
            border: { display: false },
            grid: { color: 'rgba(40,40,40,0.5)' },
            ticks: {
              color: '#505050',
              font: { size: 8 },
              callback: (value) => formatCurrency(Number(value), { showSign: true, compact: true }),
            },
          },
        },
      },
    })

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [cumulativeData, isPositive, height])

  const totalPnl = cumulativeData.length > 0 ? cumulativeData[cumulativeData.length - 1].cumulative : 0

  return (
    <div className="bg-[#0A0A0A] rounded border border-[#141414] p-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-medium text-[#a0a0a0] uppercase tracking-wide">Cumulative P&L</span>
        <span className={`text-[9px] font-mono ${isPositive ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
          {formatCurrency(totalPnl, { showSign: true })}
        </span>
      </div>

      <div style={{ height }} className="relative">
        {isLoading && data.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[9px] text-[#707070]">Loading...</span>
          </div>
        ) : data.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[9px] text-[#505050]">No data</span>
          </div>
        ) : (
          <canvas ref={canvasRef} />
        )}
      </div>
    </div>
  )
}
