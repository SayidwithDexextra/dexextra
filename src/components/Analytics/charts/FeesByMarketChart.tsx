'use client'

import React, { useEffect, useRef } from 'react'
import { Chart, registerables } from 'chart.js/auto'
import { formatCurrency, formatNumber } from '@/lib/formatters'

Chart.register(...registerables)

interface FeesByMarketChartProps {
  data: Array<{ market: string; fees: number; trades: number }>
  isLoading?: boolean
  height?: number
}

export default function FeesByMarketChart({ data, isLoading, height = 180 }: FeesByMarketChartProps) {
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

    const topMarkets = data.slice(0, 8)

    chartRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: topMarkets.map(d => d.market),
        datasets: [
          {
            label: 'Fees',
            data: topMarkets.map(d => d.fees),
            backgroundColor: 'rgba(59, 130, 246, 0.5)',
            borderColor: 'rgba(59, 130, 246, 0.8)',
            borderWidth: 1,
            borderRadius: 2,
            barPercentage: 0.6,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(5,5,5,0.95)',
            titleColor: '#a0a0a0',
            bodyColor: '#e0e0e0',
            borderColor: '#252525',
            borderWidth: 1,
            padding: 8,
            titleFont: { size: 9 },
            bodyFont: { size: 9 },
            displayColors: false,
            callbacks: {
              label: (ctx) => {
                const item = topMarkets[ctx.dataIndex]
                return [formatCurrency(item?.fees || 0, { minimumDecimals: 4 }), `${formatNumber(item?.trades || 0)} trades`]
              },
            },
          },
        },
        scales: {
          x: {
            border: { display: false },
            grid: { color: 'rgba(40,40,40,0.5)' },
            ticks: {
              color: '#505050',
              font: { size: 8 },
              callback: (value) => formatCurrency(Number(value), { compact: true }),
            },
          },
          y: {
            border: { display: false },
            grid: { display: false },
            ticks: {
              color: '#c0c0c0',
              font: { size: 8 },
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
  }, [data])

  return (
    <div className="bg-[#0A0A0A] rounded border border-[#141414] p-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-medium text-[#a0a0a0] uppercase tracking-wide">Fees by Market</span>
        <span className="text-[8px] text-[#3b82f6]">{Math.min(data.length, 8)}</span>
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
