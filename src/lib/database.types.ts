export type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'void'
export type WorkStatus = 'received' | 'in_progress' | 'qc' | 'ready' | 'delivered' | 'on_hold'

export interface Customer {
  id: string
  clinic_name: string
  ssm_no: string | null
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
  min_unit_price: number | null
  max_unit_price: number | null
  unit: string
  active: boolean
  created_at: string
}

export interface ServiceStatus {
  id: string
  label: string
  color: string | null
  sort_order: number
  is_active: boolean
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
  patient: string | null
  doctor: string | null
  service_status_id: string | null
  subtotal: number
  total: number
  created_at: string
  customers?: Customer
  invoice_items?: InvoiceItem[]
  payments?: Payment[]
  service_statuses?: ServiceStatus | null
}

export interface InvoiceItem {
  id: string
  invoice_id: string
  product_id: string | null
  description: string
  quantity: number
  unit_price: number
  amount: number
  work_status: WorkStatus
  work_status_updated_at: string
  work_note: string | null
  created_at: string
}

export interface InvoiceItemStatusHistory {
  id: string
  invoice_item_id: string
  status: WorkStatus
  note: string | null
  changed_by: string | null
  changed_by_name: string | null
  changed_at: string
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
type InvoiceInsert = Omit<Invoice, 'id' | 'created_at' | 'invoice_number' | 'customers' | 'invoice_items' | 'payments' | 'service_statuses'> &
  Partial<Pick<Invoice, 'invoice_number'>>
type InvoiceItemInsert = Omit<InvoiceItem, 'id' | 'created_at' | 'work_status' | 'work_status_updated_at' | 'work_note'> &
  Partial<Pick<InvoiceItem, 'work_status' | 'work_note'>>
type PaymentInsert = Omit<Payment, 'id' | 'created_at'>
type StatusHistoryInsert = Omit<InvoiceItemStatusHistory, 'id' | 'changed_at'>
type ServiceStatusInsert = Omit<ServiceStatus, 'id' | 'created_at'>

export type Database = {
  public: {
    Tables: {
      customers:                    { Row: Customer;                   Insert: CustomerInsert;       Update: Partial<CustomerInsert>;       Relationships: [] }
      products:                     { Row: Product;                    Insert: ProductInsert;        Update: Partial<ProductInsert>;        Relationships: [] }
      invoices:                     { Row: Invoice;                    Insert: InvoiceInsert;        Update: Partial<InvoiceInsert>;        Relationships: [] }
      invoice_items:                { Row: InvoiceItem;                Insert: InvoiceItemInsert;    Update: Partial<InvoiceItemInsert>;    Relationships: [] }
      invoice_item_status_history:  { Row: InvoiceItemStatusHistory;   Insert: StatusHistoryInsert;  Update: Partial<StatusHistoryInsert>;  Relationships: [] }
      payments:                     { Row: Payment;                    Insert: PaymentInsert;        Update: Partial<PaymentInsert>;        Relationships: [] }
      service_statuses:             { Row: ServiceStatus;              Insert: ServiceStatusInsert;  Update: Partial<ServiceStatusInsert>;  Relationships: [] }
    }
    Views: Record<string, never>
    Functions: {
      generate_invoice_number: { Args: Record<string, never>; Returns: string }
    }
    Enums: {
      work_status: WorkStatus
    }
    CompositeTypes: Record<string, never>
  }
}
