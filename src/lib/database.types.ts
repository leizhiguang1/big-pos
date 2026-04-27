export type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'void'

export interface Customer {
  id: string
  clinic_name: string
  contact_person: string | null
  phone: string | null
  email: string | null
  billing_address: string | null
  delivery_address: string | null
  notes: string | null
  created_at: string
}

export interface Product {
  id: string
  name: string
  description: string | null
  unit_price: number
  unit: string
  active: boolean
  created_at: string
}

export interface Invoice {
  id: string
  invoice_number: string
  customer_id: string
  created_by: string
  invoice_date: string
  due_date: string
  status: InvoiceStatus
  notes: string | null
  subtotal: number
  total: number
  created_at: string
  customers?: Customer
  invoice_items?: InvoiceItem[]
  payments?: Payment[]
}

export interface InvoiceItem {
  id: string
  invoice_id: string
  product_id: string | null
  description: string
  quantity: number
  unit_price: number
  amount: number
}

export interface Payment {
  id: string
  invoice_id: string
  amount: number
  payment_date: string
  reference_number: string | null
  notes: string | null
  created_by: string
  created_at: string
}

type CustomerInsert = Omit<Customer, 'id' | 'created_at'>
type ProductInsert = Omit<Product, 'id' | 'created_at'>
type InvoiceInsert = Omit<Invoice, 'id' | 'created_at' | 'customers' | 'invoice_items' | 'payments'>
type InvoiceItemInsert = Omit<InvoiceItem, 'id'>
type PaymentInsert = Omit<Payment, 'id' | 'created_at'>

export type Database = {
  public: {
    Tables: {
      customers:     { Row: Customer;    Insert: CustomerInsert;    Update: Partial<CustomerInsert>;    Relationships: [] }
      products:      { Row: Product;     Insert: ProductInsert;     Update: Partial<ProductInsert>;     Relationships: [] }
      invoices:      { Row: Invoice;     Insert: InvoiceInsert;     Update: Partial<InvoiceInsert>;     Relationships: [] }
      invoice_items: { Row: InvoiceItem; Insert: InvoiceItemInsert; Update: Partial<InvoiceItemInsert>; Relationships: [] }
      payments:      { Row: Payment;     Insert: PaymentInsert;     Update: Partial<PaymentInsert>;     Relationships: [] }
    }
    Views: Record<string, never>
    Functions: {
      generate_invoice_number: { Args: Record<string, never>; Returns: string }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
