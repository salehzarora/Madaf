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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_tenant_role: {
        Args: {
          p_roles: Database["public"]["Enums"]["tenant_role"][]
          p_tenant_id: string
        }
        Returns: boolean
      }
      is_tenant_member: { Args: { p_tenant_id: string }; Returns: boolean }
      next_order_number: { Args: { p_tenant_id: string }; Returns: string }
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

