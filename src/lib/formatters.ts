export function inr(value: number): string {
  return `Rs ${Number(value || 0).toFixed(2)}`
}

export function shortInr(value: number): string {
  return `Rs ${Number(value || 0).toFixed(0)}`
}
