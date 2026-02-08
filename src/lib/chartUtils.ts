export function defaultChartSeries(basePrice: number): number[] {
  const points = [basePrice - 4, basePrice - 3, basePrice - 2, basePrice - 1, basePrice, basePrice + 1, basePrice + 2]
  return points.map((point) => Math.max(1, Math.min(99, Math.round(point))))
}

export function toLinePoints(series: number[]): string {
  const width = 300
  const top = 12
  const bottom = 88

  if (series.length <= 1) {
    const y = 50
    return `0,${y} ${width},${y}`
  }

  const minValue = Math.min(...series)
  const maxValue = Math.max(...series)
  const range = Math.max(1, maxValue - minValue)

  return series
    .map((value, index) => {
      const x = (index / (series.length - 1)) * width
      const normalized = (value - minValue) / range
      const y = bottom - normalized * (bottom - top)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

export function toAreaPoints(series: number[]): string {
  const line = toLinePoints(series)
  return `${line} 300,100 0,100`
}

export function toSparklinePoints(series: number[], width = 120, height = 32, padding = 4): string {
  if (series.length <= 1) {
    const y = height / 2
    return `0,${y} ${width},${y}`
  }

  const minValue = Math.min(...series)
  const maxValue = Math.max(...series)
  const range = Math.max(1, maxValue - minValue)

  return series
    .map((value, index) => {
      const x = (index / (series.length - 1)) * width
      const normalized = (value - minValue) / range
      const y = (height - padding) - normalized * (height - padding * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}
