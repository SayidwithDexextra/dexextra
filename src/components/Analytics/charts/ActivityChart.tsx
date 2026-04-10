'use client'

import React, { useEffect, useRef } from 'react'
import { Chart, registerables } from 'chart.js/auto'
import { DailyActivityData } from '@/hooks/useAccountActivity'
import { formatCurrency, formatNumber } from '@/lib/formatters'

Chart.register(...registerables)

interface ActivityChartProps {
  data: DailyActivityData[]
  isLoading?: boolean
  height?: number
  hideValues?: boolean
}

export default function ActivityChart({ data, isLoading, height = 180, hideValues = false }: ActivityChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return

    if (chartRef.current) {
      chartRef.current.destroy()
      chartRef.current = null
    }

    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return

    const labels = data.map(d => {
      const date = new Date(d.date)
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    })

    chartRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Deposits',
            data: data.map(d => d.deposits),
            backgroundColor: 'rgba(74, 222, 128, 0.7)',
            borderColor: 'rgba(74, 222, 128, 0.9)',
            borderWidth: 1,
            borderRadius: 1,
            barPercentage: 0.7,
            categoryPercentage: 0.85,
          },
          {
            label: 'Withdrawals',
            data: data.map(d => d.withdrawals),
            backgroundColor: 'rgba(160, 160, 160, 0.5)',
            borderColor: 'rgba(160, 160, 160, 0.7)',
            borderWidth: 1,
            borderRadius: 1,
            barPercentage: 0.7,
            categoryPercentage: 0.85,
          },
          {
            label: 'Fees',
            data: data.map(d => d.fees),
            backgroundColor: 'rgba(251, 191, 36, 0.6)',
            borderColor: 'rgba(251, 191, 36, 0.8)',
            borderWidth: 1,
            borderRadius: 1,
            barPercentage: 0.7,
            categoryPercentage: 0.85,
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
              label: (ctx) => `${ctx.dataset.label}: ${hideValues ? '$••••••' : formatCurrency(ctx.parsed.y ?? 0)}`,
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
              callback: (value) => hideValues ? '•••' : formatCurrency(Number(value), { compact: true }),
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
  }, [data, hideValues])

  return (
    <div className="bg-[#0A0A0A] rounded border border-[#141414] p-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-medium text-[#a0a0a0] uppercase tracking-wide">Daily Activity</span>
        <span className="text-[8px] text-[#3b82f6]">{data.length}d</span>
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
