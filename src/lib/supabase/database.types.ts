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
          created_at: string
          document_locale: Database["public"]["Enums"]["locale_code"]
          document_number: string
          document_type: Database["public"]["Enums"]["document_type"]
          id: string
          legal_notice: string
          order_id: string
          status: Database["public"]["Enums"]["document_status"]
          tenant_id: string
          totals_snapshot: Json
        }
        Insert: {
          created_at?: string
          document_locale?: Database["public"]["Enums"]["locale_code"]
          document_number: string
          document_type: Database["public"]["Enums"]["document_type"]
          id?: string
          legal_notice?: string
          order_id: string
          status?: Database["public"]["Enums"]["document_status"]
          tenant_id: string
          totals_snapshot?: Json
        }
        Update: {
          created_at?: string
          document_locale?: Database["public"]["Enums"]["locale_code"]
          document_number?: string
          document_type?: Database["public"]["Enums"]["document_type"]
          id?: string
          legal_notice?: string
          order_id?: string
          status?: Database["public"]["Enums"]["document_status"]
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
      get_token_catalog: { Args: { p_token: string }; Returns: Json }
      has_tenant_role: {
        Args: {
          p_roles: Database["public"]["Enums"]["tenant_role"][]
          p_tenant_id: string
        }
        Returns: boolean
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
      remove_tenant_member: {
        Args: { p_tenant_id: string; p_user_id: string }
        Returns: undefined
      }
      revoke_customer_access_link: {
        Args: { p_link_id: string; p_tenant_id: string }
        Returns: string
      }
      revoke_tenant_invite: {
        Args: { p_invite_id: string; p_tenant_id: string }
        Returns: string
      }
      set_product_active: {
        Args: {
          p_is_active: boolean
          p_product_id: string
          p_tenant_id: string
        }
        Returns: string
      }
      unassign_customer_from_rep: {
        Args: { p_customer_id: string; p_tenant_id: string; p_user_id: string }
        Returns: undefined
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
      locale_code: ["ar", "he", "en"],
      order_source: ["sales_visit", "remote_customer", "admin"],
      order_status: ["new", "confirmed", "preparing", "delivered", "cancelled"],
      package_unit: ["carton", "pack", "unit"],
      tenant_role: ["owner", "admin", "sales_rep"],
    },
  },
} as const

