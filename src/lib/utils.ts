import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  const hasCents = Math.round(amount * 100) % 100 !== 0
  return new Intl.NumberFormat('ms-MY', {
    style: 'currency',
    currency: 'MYR',
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date))
}
