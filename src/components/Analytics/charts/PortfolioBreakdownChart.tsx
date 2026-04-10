'use client'

import React, { useEffect, useRef, useMemo } from 'react'
import { Chart, registerables } from 'chart.js/auto'
import { formatCurrency, formatPercent } from '@/lib/formatters'
import { Tooltip } from '@/components/ui/Tooltip'

Chart.register(...registerables)

const segmentDescriptions: Record<string, string> = {
  'Margin Used': 'Collateral currently locked in your open trading positions. This amount is securing your active trades.',
  'Margin Reserved': 'Collateral set aside for pending limit orders. Released when orders are filled or cancelled.',
  'Available Cash': 'Free collateral available for new trades or withdrawal. Not committed to any positions.',
  'Unrealized Gain': 'Profit from open positions that hasn\'t been realized yet. Will convert to realized P&L when positions close.',
  'Unrealized Loss': 'Loss from open positions that hasn\'t been realized yet. Will convert to realized P&L when positions close.',
}

export interface PortfolioBreakdownData {
  marginUsed: number
  marginReserved: number
  availableCash: number
  unrealizedPnl: number
  totalCollateral: number
}

interface PortfolioBreakdownChartProps {
  data: PortfolioBreakdownData
  isLoading?: boolean
  height?: number
  hideValues?: boolean
}

const palette = [
  'rgba(59, 130, 246, 0.85)',   // blue - margin used (active positions)
  'rgba(251, 191, 36, 0.8)',    // amber - margin reserved (pending orders)
  'rgba(74, 222, 128, 0.8)',    // green - available cash
  'rgba(168, 85, 247, 0.8)',    // purple - unrealized P&L (positive)
  'rgba(248, 113, 113, 0.8)',   // red - unrealized P&L (negative)
]

export default function PortfolioBreakdownChart({ 
  data, 
  isLoading, 
  height = 180,
  hideValues = false,
}: PortfolioBreakdownChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)

  const chartData = useMemo(() => {
    const { marginUsed, marginReserved, availableCash, unrealizedPnl } = data
    const items: Array<{ label: string; value: number; color: string }> = []

    if (marginUsed > 0) {
      items.push({ label: 'Margin Used', value: marginUsed, color: palette[0] })
    }
    if (marginReserved > 0) {
      items.push({ label: 'Margin Reserved', value: marginReserved, color: palette[1] })
    }
    if (availableCash > 0) {
      items.push({ label: 'Available Cash', value: availableCash, color: palette[2] })
    }
    if (unrealizedPnl !== 0) {
      const isPositive = unrealizedPnl > 0
      items.push({ 
        label: isPositive ? 'Unrealized Gain' : 'Unrealized Loss', 
        value: Math.abs(unrealizedPnl), 
        color: isPositive ? palette[3] : palette[4] 
      })
    }

    const total = items.reduce((sum, i) => sum + i.value, 0)
    return items.map(i => ({
      ...i,
      percentage: total > 0 ? (i.value / total) * 100 : 0,
    }))
  }, [data])

  useEffect(() => {
    if (!canvasRef.current) return

    if (chartRef.current) {
      chartRef.current.destroy()
      chartRef.current = null
    }

    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return

    chartRef.current = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: chartData.map(d => d.label),
        datasets: [
          {
            data: chartData.map(d => d.value),
            backgroundColor: chartData.map(d => d.color),
            borderColor: '#0A0A0A',
            borderWidth: 2,
            hoverOffset: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            display: true,
            position: 'right',
            labels: {
              boxWidth: 8,
              boxHeight: 8,
              usePointStyle: true,
              pointStyle: 'rect',
              padding: 10,
              font: { size: 10 },
              color: '#a0a0a0',
              generateLabels: (chart) => {
                const original = Chart.overrides.doughnut.plugins.legend.labels.generateLabels(chart)
                return original.map((label, idx) => ({
                  ...label,
                  text: `${label.text} ${formatPercent(chartData[idx]?.percentage || 0, { decimals: 0 })}`,
                }))
              },
            },
          },
          tooltip: {
            enabled: false,
            external: (context) => {
              const { chart, tooltip } = context
              
              let tooltipEl = document.getElementById('portfolio-chart-tooltip')
              
              if (!tooltipEl) {
                tooltipEl = document.createElement('div')
                tooltipEl.id = 'portfolio-chart-tooltip'
                tooltipEl.style.position = 'fixed'
                tooltipEl.style.pointerEvents = 'none'
                tooltipEl.style.zIndex = '10000'
                tooltipEl.style.transition = 'opacity 0.15s ease'
                document.body.appendChild(tooltipEl)
              }
              
              if (tooltip.opacity === 0) {
                tooltipEl.style.opacity = '0'
                return
              }
              
              const dataIndex = tooltip.dataPoints?.[0]?.dataIndex
              const item = chartData[dataIndex]
              if (!item) return
              
              const desc = segmentDescriptions[item.label] || ''
              const descLines = desc.split(' ').reduce((lines: string[], word) => {
                const last = lines[lines.length - 1] || ''
                if ((last + ' ' + word).length > 45) {
                  lines.push(word)
                } else {
                  lines[lines.length - 1] = (last + ' ' + word).trim()
                }
                return lines
              }, [''])
              
              const valueDisplay = hideValues ? '$••••••' : formatCurrency(item.value)
              tooltipEl.innerHTML = `
                <div style="background: rgba(15,15,15,0.98); border: 1px solid #333; border-radius: 6px; padding: 12px; max-width: 220px;">
                  <div style="color: #fff; font-size: 11px; font-weight: 600; margin-bottom: 4px;">${item.label}</div>
                  <div style="color: #a0a0a0; font-size: 10px; margin-bottom: 8px;">
                    ${valueDisplay} (${formatPercent(item.percentage, { decimals: 1 })})
                  </div>
                  <div style="color: #707070; font-size: 9px; line-height: 1.4;">
                    ${descLines.join('<br/>')}
                  </div>
                </div>
              `
              
              const rect = tooltipEl.getBoundingClientRect()
              const canvasRect = chart.canvas.getBoundingClientRect()
              const x = canvasRect.left + tooltip.caretX - rect.width - 8
              const y = canvasRect.top + tooltip.caretY - rect.height - 8
              
              tooltipEl.style.left = Math.max(8, x) + 'px'
              tooltipEl.style.top = Math.max(8, y) + 'px'
              tooltipEl.style.opacity = '1'
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
      const tooltipEl = document.getElementById('portfolio-chart-tooltip')
      if (tooltipEl) {
        tooltipEl.remove()
      }
    }
  }, [chartData, hideValues])

  const total = data.totalCollateral

  return (
    <div className="bg-[#0A0A0A] rounded border border-[#141414] p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-medium text-[#a0a0a0] uppercase tracking-wide">
          Portfolio Breakdown
        </span>
        <span className="text-[10px] text-[#e0e0e0] font-mono">
          {hideValues ? '$••••••' : formatCurrency(total, { compact: true })}
        </span>
      </div>

      <div style={{ height }} className="relative">
        {isLoading && chartData.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] text-[#707070]">Loading...</span>
          </div>
        ) : chartData.length === 0 || total === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span className="text-[10px] text-[#505050]">No collateral</span>
            <span className="text-[9px] text-[#404040]">Deposit to get started</span>
          </div>
        ) : (
          <canvas ref={canvasRef} />
        )}
      </div>

      {chartData.length > 0 && total > 0 && (
        <div className="mt-3 grid grid-cols-4 gap-2 text-center border-t border-[#181818] pt-3">
          <Tooltip 
            content={segmentDescriptions['Margin Used']} 
            title="Margin Used"
            maxWidth={200}
          >
            <div className="cursor-help">
              <div className="text-[9px] text-[#606060] uppercase">Used</div>
              <div className={`text-[11px] font-mono ${hideValues ? 'text-[#606060]' : 'text-[#3b82f6]'}`}>
                {hideValues ? '$••••••' : formatCurrency(data.marginUsed, { compact: true })}
              </div>
            </div>
          </Tooltip>
          <Tooltip 
            content={segmentDescriptions['Margin Reserved']} 
            title="Margin Reserved"
            maxWidth={200}
          >
            <div className="cursor-help">
              <div className="text-[9px] text-[#606060] uppercase">Reserved</div>
              <div className={`text-[11px] font-mono ${hideValues ? 'text-[#606060]' : 'text-[#fbbf24]'}`}>
                {hideValues ? '$••••••' : formatCurrency(data.marginReserved, { compact: true })}
              </div>
            </div>
          </Tooltip>
          <Tooltip 
            content={segmentDescriptions['Available Cash']} 
            title="Available Cash"
            maxWidth={200}
          >
            <div className="cursor-help">
              <div className="text-[9px] text-[#606060] uppercase">Available</div>
              <div className={`text-[11px] font-mono ${hideValues ? 'text-[#606060]' : 'text-[#4ade80]'}`}>
                {hideValues ? '$••••••' : formatCurrency(data.availableCash, { compact: true })}
              </div>
            </div>
          </Tooltip>
          <Tooltip 
            content={segmentDescriptions[data.unrealizedPnl >= 0 ? 'Unrealized Gain' : 'Unrealized Loss']} 
            title={data.unrealizedPnl >= 0 ? 'Unrealized Gain' : 'Unrealized Loss'}
            maxWidth={200}
          >
            <div className="cursor-help">
              <div className="text-[9px] text-[#606060] uppercase">Unrealized</div>
              <div className={`text-[11px] font-mono ${hideValues ? 'text-[#606060]' : data.unrealizedPnl >= 0 ? 'text-[#a855f7]' : 'text-[#f87171]'}`}>
                {hideValues ? '$••••••' : formatCurrency(data.unrealizedPnl, { compact: true, showSign: true })}
              </div>
            </div>
          </Tooltip>
        </div>
      )}
    </div>
  )
}
