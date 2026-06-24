import { z } from 'zod'

/**
 * Normalize a product unit-of-measure: trim, lowercase, and drop a redundant
 * leading "per " (the UI renders "per {unit}", so the stored value is the bare
 * noun, e.g. "tooth"). Returns "" for blank or bare-"per " input.
 */
export function normalizeUnit(raw: string): string {
  return raw.trim().toLowerCase().replace(/^per(?:\s+|$)/, '').trim()
}

export const lineItemSchema = z.object({
  product_id: z.string().uuid().nullable(),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit_price: z.number().min(0),
})
export const invoiceInputSchema = z.object({
  customer_id: z.string().uuid(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  patient: z.string().optional(),
  doctor: z.string().optional(),
  items: z.array(lineItemSchema).min(1),
})
export const paymentInputSchema = z.object({
  amount: z.number().positive(),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reference_number: z.string().optional(),
  notes: z.string().optional(),
})
// Wave 6 — account credit / adjustment. A credit is a non-payment reduction of a
// clinic's account (remake / return / goodwill). `invoice_id` is optional: a
// credit may be clinic-level (unlinked) or issued against a specific invoice.
export const creditInputSchema = z.object({
  amount: z.number().positive('Amount must be greater than 0'),
  reason: z.enum(['remake', 'return', 'goodwill']),
  invoice_id: z.string().uuid().nullable().optional(),
  credit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
})
export const customerInputSchema = z.object({
  clinic_name: z.string().min(1, 'Clinic name is required'),
  ssm_no: z.string().optional(),
  contact_person: z.string().min(1, 'Contact person is required'),
  phone: z.string().min(1, 'Phone is required'),
  email: z.string().min(1, 'Email is required').pipe(z.email('Invalid email')),
  billing_address: z.string().min(1, 'Billing address is required'),
  delivery_address: z.string().min(1, 'Delivery address is required'),
  notes: z.string().optional(),
})
export const productInputSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().nullable(),
    unit_price: z.number().min(0),
    unit: z
      .string()
      .transform(normalizeUnit)
      .refine((v) => v.length > 0, 'Unit is required'),
    min_unit_price: z.number().min(0).nullable(),
    max_unit_price: z.number().min(0).nullable(),
  })
  .refine((p) => p.min_unit_price == null || p.max_unit_price == null || p.min_unit_price <= p.max_unit_price, {
    message: 'min must be <= max',
    path: ['max_unit_price'],
  })

export type InvoiceInput = z.infer<typeof invoiceInputSchema>
export type PaymentInput = z.infer<typeof paymentInputSchema>
export type CreditInput = z.infer<typeof creditInputSchema>
export type CustomerInput = z.infer<typeof customerInputSchema>
// Form-side value type: the schema's INPUT shape that react-hook-form binds.
export type CustomerFormInput = z.input<typeof customerInputSchema>
export type ProductInput = z.infer<typeof productInputSchema>
