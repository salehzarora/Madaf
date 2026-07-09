export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      archival_records: {
        Row: {
          archive_uri: string | null
          archived_at: string
          checksum: string | null
          content_sha256: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          legal_document_id: string
          legal_effective: boolean
          non_legal_notice: string | null
          provider_mode: string | null
          retention_until: string | null
          sandbox: boolean
          tenant_id: string
        }
        Insert: {
          archive_uri?: string | null
          archived_at?: string
          checksum?: string | null
          content_sha256?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          legal_document_id: string
          legal_effective?: boolean
          non_legal_notice?: string | null
          provider_mode?: string | null
          retention_until?: string | null
          sandbox?: boolean
          tenant_id: string
        }
        Update: {
          archive_uri?: string | null
          archived_at?: string
          checksum?: string | null
          content_sha256?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          legal_document_id?: string
          legal_effective?: boolean
          non_legal_notice?: string | null
          provider_mode?: string | null
          retention_until?: string | null
          sandbox?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "archival_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "archival_records_tenant_id_legal_document_id_fkey"
            columns: ["tenant_id", "legal_document_id"]
            isOneToOne: true
            referencedRelation: "legal_documents"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      audit_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          event_type: string
          id: number
          metadata: Json
          tenant_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          event_type: string
          id?: never
          metadata?: Json
          tenant_id: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          event_type?: string
          id?: never
          metadata?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_showcase_links: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          label: string | null
          last_used_at: string | null
          revoked_at: string | null
          tenant_id: string
          token_hash: string
          token_preview: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          tenant_id: string
          token_hash: string
          token_preview?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          tenant_id?: string
          token_hash?: string
          token_preview?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_showcase_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          color_hue: number
          created_at: string
          icon: string | null
          id: string
          name_ar: string
          name_en: string
          name_he: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          color_hue?: number
          created_at?: string
          icon?: string | null
          id?: string
          name_ar: string
          name_en: string
          name_he: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          color_hue?: number
          created_at?: string
          icon?: string | null
          id?: string
          name_ar?: string
          name_en?: string
          name_he?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_access_links: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          expires_at: string | null
          id: string
          label: string | null
          last_used_at: string | null
          revoked_at: string | null
          tenant_id: string
          token_hash: string
          token_preview: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          expires_at?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          tenant_id: string
          token_hash: string
          token_preview?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          expires_at?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          tenant_id?: string
          token_hash?: string
          token_preview?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_access_links_tenant_id_customer_id_fkey"
            columns: ["tenant_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "customer_access_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_signup_links: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          label: string | null
          last_used_at: string | null
          revoked_at: string | null
          tenant_id: string
          token_hash: string
          token_preview: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          tenant_id: string
          token_hash: string
          token_preview?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          tenant_id?: string
          token_hash?: string
          token_preview?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_signup_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_signup_requests: {
        Row: {
          address: string | null
          approved_at: string | null
          approved_customer_id: string | null
          city_ar: string | null
          city_en: string | null
          city_he: string | null
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          link_id: string
          name: string
          notes: string | null
          phone: string | null
          rejected_at: string | null
          reviewed_by: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          approved_at?: string | null
          approved_customer_id?: string | null
          city_ar?: string | null
          city_en?: string | null
          city_he?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          link_id: string
          name: string
          notes?: string | null
          phone?: string | null
          rejected_at?: string | null
          reviewed_by?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          approved_at?: string | null
          approved_customer_id?: string | null
          city_ar?: string | null
          city_en?: string | null
          city_he?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          link_id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          rejected_at?: string | null
          reviewed_by?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_signup_requests_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "customer_signup_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_signup_requests_tenant_id_approved_customer_id_fkey"
            columns: ["tenant_id", "approved_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "customer_signup_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          city_ar: string | null
          city_en: string | null
          city_he: string | null
          contact_name: string | null
          created_at: string
          customer_type: Database["public"]["Enums"]["customer_type"]
          id: string
          name: string
          notes: string | null
          phone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city_ar?: string | null
          city_en?: string | null
          city_he?: string | null
          contact_name?: string | null
          created_at?: string
          customer_type?: Database["public"]["Enums"]["customer_type"]
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city_ar?: string | null
          city_en?: string | null
          city_he?: string | null
          contact_name?: string | null
          created_at?: string
          customer_type?: Database["public"]["Enums"]["customer_type"]
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          checksum: string | null
          created_at: string
          document_locale: Database["public"]["Enums"]["locale_code"]
          document_number: string
          document_type: Database["public"]["Enums"]["document_type"]
          file_size_bytes: number | null
          generated_at: string | null
          id: string
          legal_notice: string
          order_id: string
          status: Database["public"]["Enums"]["document_status"]
          storage_path: string | null
          tenant_id: string
          totals_snapshot: Json
        }
        Insert: {
          checksum?: string | null
          created_at?: string
          document_locale?: Database["public"]["Enums"]["locale_code"]
          document_number: string
          document_type: Database["public"]["Enums"]["document_type"]
          file_size_bytes?: number | null
          generated_at?: string | null
          id?: string
          legal_notice?: string
          order_id: string
          status?: Database["public"]["Enums"]["document_status"]
          storage_path?: string | null
          tenant_id: string
          totals_snapshot?: Json
        }
        Update: {
          checksum?: string | null
          created_at?: string
          document_locale?: Database["public"]["Enums"]["locale_code"]
          document_number?: string
          document_type?: Database["public"]["Enums"]["document_type"]
          file_size_bytes?: number | null
          generated_at?: string | null
          id?: string
          legal_notice?: string
          order_id?: string
          status?: Database["public"]["Enums"]["document_status"]
          storage_path?: string | null
          tenant_id?: string
          totals_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_tenant_id_order_id_fkey"
            columns: ["tenant_id", "order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          created_at: string
          expiry_date: string | null
          id: string
          low_stock_threshold: number
          product_id: string
          quantity_available: number
          tenant_id: string
          updated_at: string
          warehouse_location: string | null
        }
        Insert: {
          created_at?: string
          expiry_date?: string | null
          id?: string
          low_stock_threshold?: number
          product_id: string
          quantity_available?: number
          tenant_id: string
          updated_at?: string
          warehouse_location?: string | null
        }
        Update: {
          created_at?: string
          expiry_date?: string | null
          id?: string
          low_stock_threshold?: number
          product_id?: string
          quantity_available?: number
          tenant_id?: string
          updated_at?: string
          warehouse_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_tenant_id_product_id_fkey"
            columns: ["tenant_id", "product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      legal_document_events: {
        Row: {
          actor_role: string | null
          actor_user_id: string | null
          created_at: string
          event: string
          id: number
          legal_document_id: string
          note: string | null
          tenant_id: string
        }
        Insert: {
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          event: string
          id?: never
          legal_document_id: string
          note?: string | null
          tenant_id: string
        }
        Update: {
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          event?: string
          id?: never
          legal_document_id?: string
          note?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_document_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_document_events_tenant_id_legal_document_id_fkey"
            columns: ["tenant_id", "legal_document_id"]
            isOneToOne: false
            referencedRelation: "legal_documents"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      legal_document_items: {
        Row: {
          created_at: string
          id: string
          legal_document_id: string
          line_subtotal: number | null
          line_total: number | null
          line_vat: number | null
          name_snapshot: Json | null
          quantity: number | null
          sku_snapshot: string | null
          tenant_id: string
          unit_price: number | null
          vat_rate: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          legal_document_id: string
          line_subtotal?: number | null
          line_total?: number | null
          line_vat?: number | null
          name_snapshot?: Json | null
          quantity?: number | null
          sku_snapshot?: string | null
          tenant_id: string
          unit_price?: number | null
          vat_rate?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          legal_document_id?: string
          line_subtotal?: number | null
          line_total?: number | null
          line_vat?: number | null
          name_snapshot?: Json | null
          quantity?: number | null
          sku_snapshot?: string | null
          tenant_id?: string
          unit_price?: number | null
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_document_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_document_items_tenant_id_legal_document_id_fkey"
            columns: ["tenant_id", "legal_document_id"]
            isOneToOne: false
            referencedRelation: "legal_documents"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      legal_documents: {
        Row: {
          allocation_number: string | null
          content_hash: string | null
          corrects_document_id: string | null
          created_at: string
          currency: string | null
          customer_snapshot: Json | null
          document_type: Database["public"]["Enums"]["legal_document_type"]
          id: string
          issued_at: string | null
          legal_effective: boolean
          legal_entity_id: string | null
          legal_number: string | null
          non_legal_notice: string | null
          order_id: string | null
          pdf_sha256: string | null
          pdf_storage_path: string | null
          provider_mode: string | null
          sandbox: boolean
          status: Database["public"]["Enums"]["legal_document_status"]
          subtotal: number | null
          supplier_snapshot: Json | null
          tenant_id: string
          total: number | null
          vat_breakdown: Json | null
          vat_total: number | null
        }
        Insert: {
          allocation_number?: string | null
          content_hash?: string | null
          corrects_document_id?: string | null
          created_at?: string
          currency?: string | null
          customer_snapshot?: Json | null
          document_type: Database["public"]["Enums"]["legal_document_type"]
          id?: string
          issued_at?: string | null
          legal_effective?: boolean
          legal_entity_id?: string | null
          legal_number?: string | null
          non_legal_notice?: string | null
          order_id?: string | null
          pdf_sha256?: string | null
          pdf_storage_path?: string | null
          provider_mode?: string | null
          sandbox?: boolean
          status?: Database["public"]["Enums"]["legal_document_status"]
          subtotal?: number | null
          supplier_snapshot?: Json | null
          tenant_id: string
          total?: number | null
          vat_breakdown?: Json | null
          vat_total?: number | null
        }
        Update: {
          allocation_number?: string | null
          content_hash?: string | null
          corrects_document_id?: string | null
          created_at?: string
          currency?: string | null
          customer_snapshot?: Json | null
          document_type?: Database["public"]["Enums"]["legal_document_type"]
          id?: string
          issued_at?: string | null
          legal_effective?: boolean
          legal_entity_id?: string | null
          legal_number?: string | null
          non_legal_notice?: string | null
          order_id?: string | null
          pdf_sha256?: string | null
          pdf_storage_path?: string | null
          provider_mode?: string | null
          sandbox?: boolean
          status?: Database["public"]["Enums"]["legal_document_status"]
          subtotal?: number | null
          supplier_snapshot?: Json | null
          tenant_id?: string
          total?: number | null
          vat_breakdown?: Json | null
          vat_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_documents_tenant_id_corrects_document_id_fkey"
            columns: ["tenant_id", "corrects_document_id"]
            isOneToOne: false
            referencedRelation: "legal_documents"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "legal_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_documents_tenant_id_order_id_fkey"
            columns: ["tenant_id", "order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      legal_invoice_sequences: {
        Row: {
          created_at: string
          document_type: Database["public"]["Enums"]["legal_document_type"]
          id: string
          legal_entity_id: string | null
          next_value: number
          prefix: string | null
          tenant_id: string
          updated_at: string
          year_scope: number | null
        }
        Insert: {
          created_at?: string
          document_type: Database["public"]["Enums"]["legal_document_type"]
          id?: string
          legal_entity_id?: string | null
          next_value?: number
          prefix?: string | null
          tenant_id: string
          updated_at?: string
          year_scope?: number | null
        }
        Update: {
          created_at?: string
          document_type?: Database["public"]["Enums"]["legal_document_type"]
          id?: string
          legal_entity_id?: string | null
          next_value?: number
          prefix?: string | null
          tenant_id?: string
          updated_at?: string
          year_scope?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_invoice_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_numbering_settings: {
        Row: {
          enabled: boolean
          id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      manufacturers: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          name_ar: string
          name_en: string
          name_he: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name_ar: string
          name_en: string
          name_he: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name_ar?: string
          name_en?: string
          name_he?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manufacturers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_inventory_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          order_id: string
          product_id: string | null
          quantity_delta: number
          reason: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          order_id: string
          product_id?: string | null
          quantity_delta: number
          reason?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          order_id?: string
          product_id?: string | null
          quantity_delta?: number
          reason?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_inventory_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_inventory_movements_tenant_id_order_id_fkey"
            columns: ["tenant_id", "order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          line_subtotal: number
          line_total: number
          line_vat: number
          manufacturer_name_snapshot: Json | null
          order_id: string
          package_quantity_snapshot: number
          package_unit_snapshot: Database["public"]["Enums"]["package_unit"]
          product_id: string | null
          product_name_snapshot: Json
          quantity: number
          tenant_id: string
          unit_price_snapshot: number
          vat_rate_snapshot: number
        }
        Insert: {
          created_at?: string
          id?: string
          line_subtotal: number
          line_total: number
          line_vat: number
          manufacturer_name_snapshot?: Json | null
          order_id: string
          package_quantity_snapshot?: number
          package_unit_snapshot: Database["public"]["Enums"]["package_unit"]
          product_id?: string | null
          product_name_snapshot: Json
          quantity: number
          tenant_id: string
          unit_price_snapshot: number
          vat_rate_snapshot?: number
        }
        Update: {
          created_at?: string
          id?: string
          line_subtotal?: number
          line_total?: number
          line_vat?: number
          manufacturer_name_snapshot?: Json | null
          order_id?: string
          package_quantity_snapshot?: number
          package_unit_snapshot?: Database["public"]["Enums"]["package_unit"]
          product_id?: string | null
          product_name_snapshot?: Json
          quantity?: number
          tenant_id?: string
          unit_price_snapshot?: number
          vat_rate_snapshot?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_tenant_id_order_id_fkey"
            columns: ["tenant_id", "order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "order_items_tenant_id_product_id_fkey"
            columns: ["tenant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      order_status_history: {
        Row: {
          changed_by: string | null
          created_at: string
          id: string
          new_status: Database["public"]["Enums"]["order_status"]
          note: string | null
          old_status: Database["public"]["Enums"]["order_status"] | null
          order_id: string
          tenant_id: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_status: Database["public"]["Enums"]["order_status"]
          note?: string | null
          old_status?: Database["public"]["Enums"]["order_status"] | null
          order_id: string
          tenant_id: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_status?: Database["public"]["Enums"]["order_status"]
          note?: string | null
          old_status?: Database["public"]["Enums"]["order_status"] | null
          order_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_status_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_history_tenant_id_order_id_fkey"
            columns: ["tenant_id", "order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          currency: string
          customer_id: string | null
          customer_snapshot: Json | null
          id: string
          notes: string | null
          order_number: string
          public_ref: string
          sales_rep_user_id: string | null
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          tenant_id: string
          total: number
          updated_at: string
          vat_total: number
        }
        Insert: {
          created_at?: string
          currency?: string
          customer_id?: string | null
          customer_snapshot?: Json | null
          id?: string
          notes?: string | null
          order_number: string
          public_ref: string
          sales_rep_user_id?: string | null
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          tenant_id: string
          total?: number
          updated_at?: string
          vat_total?: number
        }
        Update: {
          created_at?: string
          currency?: string
          customer_id?: string | null
          customer_snapshot?: Json | null
          id?: string
          notes?: string | null
          order_number?: string
          public_ref?: string
          sales_rep_user_id?: string | null
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          tenant_id?: string
          total?: number
          updated_at?: string
          vat_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_tenant_id_customer_id_fkey"
            columns: ["tenant_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          base_unit: Database["public"]["Enums"]["base_unit"]
          category_id: string | null
          created_at: string
          description_ar: string | null
          description_en: string | null
          description_he: string | null
          id: string
          image_url: string | null
          is_active: boolean
          manufacturer_id: string | null
          name_ar: string
          name_en: string
          name_he: string
          package_quantity: number
          package_unit: Database["public"]["Enums"]["package_unit"]
          sku: string | null
          tenant_id: string
          track_expiry: boolean
          unit_size: string | null
          updated_at: string
          vat_rate: number
          wholesale_price: number
        }
        Insert: {
          barcode?: string | null
          base_unit?: Database["public"]["Enums"]["base_unit"]
          category_id?: string | null
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          description_he?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          manufacturer_id?: string | null
          name_ar: string
          name_en: string
          name_he: string
          package_quantity?: number
          package_unit?: Database["public"]["Enums"]["package_unit"]
          sku?: string | null
          tenant_id: string
          track_expiry?: boolean
          unit_size?: string | null
          updated_at?: string
          vat_rate?: number
          wholesale_price: number
        }
        Update: {
          barcode?: string | null
          base_unit?: Database["public"]["Enums"]["base_unit"]
          category_id?: string | null
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          description_he?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          manufacturer_id?: string | null
          name_ar?: string
          name_en?: string
          name_he?: string
          package_quantity?: number
          package_unit?: Database["public"]["Enums"]["package_unit"]
          sku?: string | null
          tenant_id?: string
          track_expiry?: boolean
          unit_size?: string | null
          updated_at?: string
          vat_rate?: number
          wholesale_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "products_tenant_id_category_id_fkey"
            columns: ["tenant_id", "category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tenant_id_manufacturer_id_fkey"
            columns: ["tenant_id", "manufacturer_id"]
            isOneToOne: false
            referencedRelation: "manufacturers"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      sales_rep_customers: {
        Row: {
          assigned_by: string | null
          created_at: string
          customer_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          customer_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          customer_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_rep_customers_tenant_id_customer_id_fkey"
            columns: ["tenant_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      signing_records: {
        Row: {
          algorithm: string | null
          cert_ref: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          legal_document_id: string
          legal_effective: boolean
          non_legal_notice: string | null
          provider_mode: string | null
          sandbox: boolean
          signature: string | null
          signed_at: string | null
          signed_hash: string | null
          tenant_id: string
        }
        Insert: {
          algorithm?: string | null
          cert_ref?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          legal_document_id: string
          legal_effective?: boolean
          non_legal_notice?: string | null
          provider_mode?: string | null
          sandbox?: boolean
          signature?: string | null
          signed_at?: string | null
          signed_hash?: string | null
          tenant_id: string
        }
        Update: {
          algorithm?: string | null
          cert_ref?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          legal_document_id?: string
          legal_effective?: boolean
          non_legal_notice?: string | null
          provider_mode?: string | null
          sandbox?: boolean
          signature?: string | null
          signed_at?: string | null
          signed_hash?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signing_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signing_records_tenant_id_legal_document_id_fkey"
            columns: ["tenant_id", "legal_document_id"]
            isOneToOne: true
            referencedRelation: "legal_documents"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      tax_authority_requests: {
        Row: {
          created_at: string
          id: string
          idempotency_key: string | null
          kind: string | null
          legal_document_id: string | null
          provider_mode: string | null
          request_payload: Json | null
          sandbox: boolean
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          idempotency_key?: string | null
          kind?: string | null
          legal_document_id?: string | null
          provider_mode?: string | null
          request_payload?: Json | null
          sandbox?: boolean
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          idempotency_key?: string | null
          kind?: string | null
          legal_document_id?: string | null
          provider_mode?: string | null
          request_payload?: Json | null
          sandbox?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_authority_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_authority_requests_tenant_id_legal_document_id_fkey"
            columns: ["tenant_id", "legal_document_id"]
            isOneToOne: false
            referencedRelation: "legal_documents"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      tax_authority_responses: {
        Row: {
          allocation_number: string | null
          http_status: number | null
          id: string
          legal_effective: boolean
          outcome: string | null
          provider_ref: string | null
          received_at: string
          request_id: string | null
          response_payload: Json | null
          sandbox: boolean
          tenant_id: string
        }
        Insert: {
          allocation_number?: string | null
          http_status?: number | null
          id?: string
          legal_effective?: boolean
          outcome?: string | null
          provider_ref?: string | null
          received_at?: string
          request_id?: string | null
          response_payload?: Json | null
          sandbox?: boolean
          tenant_id: string
        }
        Update: {
          allocation_number?: string | null
          http_status?: number | null
          id?: string
          legal_effective?: boolean
          outcome?: string | null
          provider_ref?: string | null
          received_at?: string
          request_id?: string | null
          response_payload?: Json | null
          sandbox?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_authority_responses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_authority_responses_tenant_id_request_id_fkey"
            columns: ["tenant_id", "request_id"]
            isOneToOne: false
            referencedRelation: "tax_authority_requests"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      tenant_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string | null
          id: string
          invited_by: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          token_hash: string
          token_preview: string | null
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          revoked_at?: string | null
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          token_hash: string
          token_preview?: string | null
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id?: string
          token_hash?: string
          token_preview?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_tax_settings: {
        Row: {
          business_registration_number: string | null
          city: string | null
          contact_email: string | null
          contact_phone: string | null
          country: string | null
          country_code: string
          created_at: string
          default_vat_rate: number | null
          id: string
          invoice_language: string | null
          legal_invoicing_ready: boolean
          legal_name: string | null
          postal_code: string | null
          readiness_notes: string | null
          street: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          vat_registration_number: string | null
          vat_registration_type: string | null
        }
        Insert: {
          business_registration_number?: string | null
          city?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          country?: string | null
          country_code?: string
          created_at?: string
          default_vat_rate?: number | null
          id?: string
          invoice_language?: string | null
          legal_invoicing_ready?: boolean
          legal_name?: string | null
          postal_code?: string | null
          readiness_notes?: string | null
          street?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          vat_registration_number?: string | null
          vat_registration_type?: string | null
        }
        Update: {
          business_registration_number?: string | null
          city?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          country?: string | null
          country_code?: string
          created_at?: string
          default_vat_rate?: number | null
          id?: string
          invoice_language?: string | null
          legal_invoicing_ready?: boolean
          legal_name?: string | null
          postal_code?: string | null
          readiness_notes?: string | null
          street?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          vat_registration_number?: string | null
          vat_registration_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_tax_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_users: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          address_ar: string | null
          address_en: string | null
          address_he: string | null
          company_id: string | null
          created_at: string
          default_locale: Database["public"]["Enums"]["locale_code"]
          document_locale: Database["public"]["Enums"]["locale_code"]
          id: string
          legal_name: string | null
          name_ar: string
          name_en: string
          name_he: string
          order_seq: number
          phone: string | null
          updated_at: string
          vat_registration_type: string | null
        }
        Insert: {
          address_ar?: string | null
          address_en?: string | null
          address_he?: string | null
          company_id?: string | null
          created_at?: string
          default_locale?: Database["public"]["Enums"]["locale_code"]
          document_locale?: Database["public"]["Enums"]["locale_code"]
          id?: string
          legal_name?: string | null
          name_ar: string
          name_en: string
          name_he: string
          order_seq?: number
          phone?: string | null
          updated_at?: string
          vat_registration_type?: string | null
        }
        Update: {
          address_ar?: string | null
          address_en?: string | null
          address_he?: string | null
          company_id?: string | null
          created_at?: string
          default_locale?: Database["public"]["Enums"]["locale_code"]
          document_locale?: Database["public"]["Enums"]["locale_code"]
          id?: string
          legal_name?: string | null
          name_ar?: string
          name_en?: string
          name_he?: string
          order_seq?: number
          phone?: string | null
          updated_at?: string
          vat_registration_type?: string | null
        }
        Relationships: []
      }
      token_access_attempts: {
        Row: {
          attempts: number
          created_at: string
          fingerprint: string
          id: number
          purpose: string
          updated_at: string
          window_start: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          fingerprint: string
          id?: never
          purpose: string
          updated_at?: string
          window_start?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          fingerprint?: string
          id?: never
          purpose?: string
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _gen_order_public_ref: { Args: never; Returns: string }
      _legal_numbering_enabled: { Args: never; Returns: boolean }
      _order_create_core: {
        Args: {
          p_customer_id: string
          p_items: Json
          p_notes: string
          p_source: Database["public"]["Enums"]["order_source"]
          p_tenant_id: string
        }
        Returns: {
          order_id: string
          order_number: string
        }[]
      }
      _record_token_failure: {
        Args: { p_fingerprint: string; p_purpose: string }
        Returns: undefined
      }
      _resolve_showcase_token: {
        Args: { p_raw_token: string }
        Returns: {
          link_id: string
          tenant_id: string
        }[]
      }
      _resolve_signup_token: {
        Args: { p_raw_token: string }
        Returns: {
          link_id: string
          tenant_id: string
        }[]
      }
      _resolve_token: {
        Args: { p_raw_token: string }
        Returns: {
          customer_id: string
          link_id: string
          tenant_id: string
        }[]
      }
      _token_rate_exceeded: {
        Args: { p_fingerprint: string; p_purpose: string }
        Returns: boolean
      }
      _touch_token_attempt: {
        Args: { p_fingerprint: string; p_purpose: string }
        Returns: undefined
      }
      accept_tenant_invite: { Args: { p_token: string }; Returns: string }
      approve_customer_signup_request: {
        Args: { p_request_id: string; p_tenant_id: string }
        Returns: string
      }
      assert_service_role: { Args: { p_fn: string }; Returns: undefined }
      assign_customer_to_rep: {
        Args: { p_customer_id: string; p_tenant_id: string; p_user_id: string }
        Returns: undefined
      }
      authorize_tenant: {
        Args: {
          p_roles: Database["public"]["Enums"]["tenant_role"][]
          p_tenant_id: string
        }
        Returns: string
      }
      can_access_customer: {
        Args: { p_customer_id: string; p_tenant_id: string }
        Returns: boolean
      }
      can_access_order: {
        Args: { p_order_id: string; p_tenant_id: string }
        Returns: boolean
      }
      create_customer: {
        Args: {
          p_address?: string
          p_city_ar?: string
          p_city_en?: string
          p_city_he?: string
          p_contact_name?: string
          p_customer_type?: Database["public"]["Enums"]["customer_type"]
          p_name: string
          p_notes?: string
          p_phone?: string
          p_tenant_id: string
        }
        Returns: string
      }
      create_manufacturer: {
        Args: {
          p_logo_url?: string
          p_name_ar: string
          p_name_en: string
          p_name_he: string
          p_sort_order?: number
          p_tenant_id: string
        }
        Returns: string
      }
      create_order_document: {
        Args: {
          p_document_locale?: Database["public"]["Enums"]["locale_code"]
          p_document_type: Database["public"]["Enums"]["document_type"]
          p_legal_notice?: string
          p_order_id: string
          p_tenant_id: string
        }
        Returns: {
          checksum: string | null
          created_at: string
          document_locale: Database["public"]["Enums"]["locale_code"]
          document_number: string
          document_type: Database["public"]["Enums"]["document_type"]
          file_size_bytes: number | null
          generated_at: string | null
          id: string
          legal_notice: string
          order_id: string
          status: Database["public"]["Enums"]["document_status"]
          storage_path: string | null
          tenant_id: string
          totals_snapshot: Json
        }[]
        SetofOptions: {
          from: "*"
          to: "documents"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_order_request: {
        Args: {
          p_customer_id?: string
          p_items: Json
          p_notes?: string
          p_source?: Database["public"]["Enums"]["order_source"]
          p_tenant_id: string
        }
        Returns: {
          order_id: string
          order_number: string
        }[]
      }
      create_order_request_from_token: {
        Args: { p_items: Json; p_notes?: string; p_token: string }
        Returns: {
          order_number: string
        }[]
      }
      create_product: {
        Args: { p_inventory?: Json; p_product: Json; p_tenant_id: string }
        Returns: string
      }
      create_tenant_invite: {
        Args: {
          p_email: string
          p_expires_at?: string
          p_role: Database["public"]["Enums"]["tenant_role"]
          p_tenant_id: string
          p_token_hash: string
          p_token_preview?: string
        }
        Returns: string
      }
      create_tenant_with_owner: {
        Args: {
          p_default_locale?: Database["public"]["Enums"]["locale_code"]
          p_name_ar: string
          p_name_en: string
          p_name_he: string
        }
        Returns: string
      }
      current_membership: {
        Args: never
        Returns: {
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
        }[]
      }
      demote_tenant_owner: {
        Args: {
          p_new_role: Database["public"]["Enums"]["tenant_role"]
          p_tenant_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      draw_legal_document_number: {
        Args: {
          p_document_type: Database["public"]["Enums"]["legal_document_type"]
          p_legal_entity_id?: string
          p_tenant_id: string
          p_year?: number
        }
        Returns: string
      }
      get_showcase_catalog: { Args: { p_token: string }; Returns: Json }
      get_tenant_tax_settings: {
        Args: { p_tenant_id: string }
        Returns: {
          business_registration_number: string | null
          city: string | null
          contact_email: string | null
          contact_phone: string | null
          country: string | null
          country_code: string
          created_at: string
          default_vat_rate: number | null
          id: string
          invoice_language: string | null
          legal_invoicing_ready: boolean
          legal_name: string | null
          postal_code: string | null
          readiness_notes: string | null
          street: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          vat_registration_number: string | null
          vat_registration_type: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "tenant_tax_settings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_token_catalog: { Args: { p_token: string }; Returns: Json }
      has_tenant_role: {
        Args: {
          p_roles: Database["public"]["Enums"]["tenant_role"][]
          p_tenant_id: string
        }
        Returns: boolean
      }
      insert_catalog_showcase_link: {
        Args: {
          p_expires_at?: string
          p_label?: string
          p_tenant_id: string
          p_token_hash: string
          p_token_preview?: string
        }
        Returns: string
      }
      insert_customer_access_link: {
        Args: {
          p_customer_id: string
          p_expires_at?: string
          p_label?: string
          p_tenant_id: string
          p_token_hash: string
          p_token_preview?: string
        }
        Returns: string
      }
      insert_customer_signup_link: {
        Args: {
          p_expires_at?: string
          p_label?: string
          p_tenant_id: string
          p_token_hash: string
          p_token_preview?: string
        }
        Returns: string
      }
      is_tenant_member: { Args: { p_tenant_id: string }; Returns: boolean }
      list_memberships: {
        Args: never
        Returns: {
          name_ar: string
          name_en: string
          name_he: string
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
        }[]
      }
      list_rep_assignments: {
        Args: { p_tenant_id: string }
        Returns: {
          created_at: string
          customer_id: string
          user_id: string
        }[]
      }
      list_tenant_members: {
        Args: { p_tenant_id: string }
        Returns: {
          created_at: string
          email: string
          role: Database["public"]["Enums"]["tenant_role"]
          user_id: string
        }[]
      }
      next_order_number: { Args: { p_tenant_id: string }; Returns: string }
      promote_tenant_owner: {
        Args: { p_tenant_id: string; p_user_id: string }
        Returns: undefined
      }
      reject_customer_signup_request: {
        Args: { p_request_id: string; p_tenant_id: string }
        Returns: string
      }
      remove_tenant_member: {
        Args: { p_tenant_id: string; p_user_id: string }
        Returns: undefined
      }
      revoke_catalog_showcase_link: {
        Args: { p_link_id: string; p_tenant_id: string }
        Returns: string
      }
      revoke_customer_access_link: {
        Args: { p_link_id: string; p_tenant_id: string }
        Returns: string
      }
      revoke_customer_access_links_for_customer: {
        Args: { p_customer_id: string; p_tenant_id: string }
        Returns: number
      }
      revoke_customer_signup_link: {
        Args: { p_link_id: string; p_tenant_id: string }
        Returns: string
      }
      revoke_tenant_invite: {
        Args: { p_invite_id: string; p_tenant_id: string }
        Returns: string
      }
      sandbox_archive_and_sign_legal_document: {
        Args: {
          p_idempotency_key: string
          p_legal_document_id: string
          p_tenant_id: string
        }
        Returns: Json
      }
      sandbox_issue_legal_document: {
        Args: {
          p_document_type: Database["public"]["Enums"]["legal_document_type"]
          p_idempotency_key: string
          p_order_id?: string
          p_provider_mode?: string
          p_tenant_id: string
        }
        Returns: Json
      }
      set_document_storage: {
        Args: {
          p_checksum?: string
          p_document_id: string
          p_file_size_bytes?: number
          p_storage_path: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      set_product_active: {
        Args: {
          p_is_active: boolean
          p_product_id: string
          p_tenant_id: string
        }
        Returns: string
      }
      submit_customer_signup_request: {
        Args: {
          p_address?: string
          p_city_ar?: string
          p_city_en?: string
          p_city_he?: string
          p_contact_name?: string
          p_email?: string
          p_name: string
          p_notes?: string
          p_phone?: string
          p_token: string
        }
        Returns: boolean
      }
      unassign_customer_from_rep: {
        Args: { p_customer_id: string; p_tenant_id: string; p_user_id: string }
        Returns: undefined
      }
      update_customer: {
        Args: {
          p_address?: string
          p_city_ar?: string
          p_city_en?: string
          p_city_he?: string
          p_contact_name?: string
          p_customer_id: string
          p_customer_type?: Database["public"]["Enums"]["customer_type"]
          p_name: string
          p_notes?: string
          p_phone?: string
          p_tenant_id: string
        }
        Returns: string
      }
      update_manufacturer: {
        Args: {
          p_logo_url?: string
          p_manufacturer_id: string
          p_name_ar: string
          p_name_en: string
          p_name_he: string
          p_sort_order?: number
          p_tenant_id: string
        }
        Returns: string
      }
      update_order_status: {
        Args: {
          p_new_status: Database["public"]["Enums"]["order_status"]
          p_order_id: string
          p_tenant_id: string
        }
        Returns: {
          new_status: Database["public"]["Enums"]["order_status"]
          old_status: Database["public"]["Enums"]["order_status"]
          order_id: string
        }[]
      }
      update_product: {
        Args: {
          p_inventory?: Json
          p_product: Json
          p_product_id: string
          p_tenant_id: string
        }
        Returns: string
      }
      update_tenant_member_role: {
        Args: {
          p_new_role: Database["public"]["Enums"]["tenant_role"]
          p_tenant_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      upsert_inventory_item: {
        Args: { p_inventory: Json; p_product_id: string; p_tenant_id: string }
        Returns: string
      }
      upsert_tenant_tax_settings: {
        Args: {
          p_business_registration_number?: string
          p_city?: string
          p_contact_email?: string
          p_contact_phone?: string
          p_country?: string
          p_country_code?: string
          p_default_vat_rate?: number
          p_invoice_language?: string
          p_legal_invoicing_ready?: boolean
          p_legal_name?: string
          p_postal_code?: string
          p_readiness_notes?: string
          p_street?: string
          p_tenant_id: string
          p_vat_registration_number?: string
          p_vat_registration_type?: string
        }
        Returns: {
          business_registration_number: string | null
          city: string | null
          contact_email: string | null
          contact_phone: string | null
          country: string | null
          country_code: string
          created_at: string
          default_vat_rate: number | null
          id: string
          invoice_language: string | null
          legal_invoicing_ready: boolean
          legal_name: string | null
          postal_code: string | null
          readiness_notes: string | null
          street: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          vat_registration_number: string | null
          vat_registration_type: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "tenant_tax_settings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      validate_product_payload: {
        Args: { p_product: Json; p_tenant_id: string }
        Returns: {
          barcode: string
          base_unit: Database["public"]["Enums"]["base_unit"]
          category_id: string
          description_ar: string
          description_en: string
          description_he: string
          image_url: string
          is_active: boolean
          manufacturer_id: string
          name_ar: string
          name_en: string
          name_he: string
          package_quantity: number
          package_unit: Database["public"]["Enums"]["package_unit"]
          sku: string
          track_expiry: boolean
          unit_size: string
          vat_rate: number
          wholesale_price: number
        }[]
      }
    }
    Enums: {
      base_unit:
        | "bottles"
        | "cans"
        | "packs"
        | "units"
        | "bags"
        | "jars"
        | "bars"
        | "rolls"
        | "tubs"
      customer_type: "grocery" | "kiosk" | "supermarket" | "minimarket"
      document_status: "draft" | "generated" | "voided"
      document_type: "order_request" | "delivery_note" | "invoice_draft"
      legal_document_status:
        | "draft_internal"
        | "ready_for_issue"
        | "issuing_locked"
        | "provider_pending"
        | "provider_approved"
        | "issued"
        | "issue_failed"
        | "cancel_requested"
        | "cancelled"
        | "archived"
      legal_document_type:
        | "tax_invoice"
        | "tax_invoice_receipt"
        | "credit_note"
        | "cancellation_notice"
      locale_code: "ar" | "he" | "en"
      order_source: "sales_visit" | "remote_customer" | "admin"
      order_status:
        | "new"
        | "confirmed"
        | "preparing"
        | "delivered"
        | "cancelled"
      package_unit: "carton" | "pack" | "unit"
      tenant_role: "owner" | "admin" | "sales_rep"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      base_unit: [
        "bottles",
        "cans",
        "packs",
        "units",
        "bags",
        "jars",
        "bars",
        "rolls",
        "tubs",
      ],
      customer_type: ["grocery", "kiosk", "supermarket", "minimarket"],
      document_status: ["draft", "generated", "voided"],
      document_type: ["order_request", "delivery_note", "invoice_draft"],
      legal_document_status: [
        "draft_internal",
        "ready_for_issue",
        "issuing_locked",
        "provider_pending",
        "provider_approved",
        "issued",
        "issue_failed",
        "cancel_requested",
        "cancelled",
        "archived",
      ],
      legal_document_type: [
        "tax_invoice",
        "tax_invoice_receipt",
        "credit_note",
        "cancellation_notice",
      ],
      locale_code: ["ar", "he", "en"],
      order_source: ["sales_visit", "remote_customer", "admin"],
      order_status: ["new", "confirmed", "preparing", "delivered", "cancelled"],
      package_unit: ["carton", "pack", "unit"],
      tenant_role: ["owner", "admin", "sales_rep"],
    },
  },
} as const

