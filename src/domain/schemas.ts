import { z } from 'zod'

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
export const customerInputSchema = z.object({
  clinic_name: z.string().min(1),
  contact_person: z.string().optional(),
  phone: z.string().optional(),
  email: z.email().optional().or(z.literal('')),
})
export const productInputSchema = z
  .object({
    name: z.string().min(1),
    unit_price: z.number().min(0),
    min_unit_price: z.number().min(0).nullable(),
    max_unit_price: z.number().min(0).nullable(),
  })
  .refine((p) => p.min_unit_price == null || p.max_unit_price == null || p.min_unit_price <= p.max_unit_price, {
    message: 'min must be <= max',
  })

export type InvoiceInput = z.infer<typeof invoiceInputSchema>
export type PaymentInput = z.infer<typeof paymentInputSchema>
