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

export type Database = {
  public: {
    Tables: {
      customers: { Row: Customer; Insert: Omit<Customer, 'id' | 'created_at'>; Update: Partial<Omit<Customer, 'id' | 'created_at'>> }
      products: { Row: Product; Insert: Omit<Product, 'id' | 'created_at'>; Update: Partial<Omit<Product, 'id' | 'created_at'>> }
      invoices: { Row: Invoice; Insert: Omit<Invoice, 'id' | 'created_at' | 'customers' | 'invoice_items' | 'payments'>; Update: Partial<Omit<Invoice, 'id' | 'created_at' | 'customers' | 'invoice_items' | 'payments'>> }
      invoice_items: { Row: InvoiceItem; Insert: Omit<InvoiceItem, 'id'>; Update: Partial<Omit<InvoiceItem, 'id'>> }
      payments: { Row: Payment; Insert: Omit<Payment, 'id' | 'created_at'>; Update: Partial<Omit<Payment, 'id' | 'created_at'>> }
    }
  }
}
