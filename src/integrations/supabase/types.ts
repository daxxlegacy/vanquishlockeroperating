export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      automation_run_items: {
        Row: {
          badge_number: string | null
          created_at: string
          employee_name: string | null
          id: string
          location: string | null
          locker_id: string | null
          locker_number: string | null
          prior_status: string | null
          row_label: string | null
          run_id: string
          succeeded: boolean
          termination_id: string | null
        }
        Insert: {
          badge_number?: string | null
          created_at?: string
          employee_name?: string | null
          id?: string
          location?: string | null
          locker_id?: string | null
          locker_number?: string | null
          prior_status?: string | null
          row_label?: string | null
          run_id: string
          succeeded?: boolean
          termination_id?: string | null
        }
        Update: {
          badge_number?: string | null
          created_at?: string
          employee_name?: string | null
          id?: string
          location?: string | null
          locker_id?: string | null
          locker_number?: string | null
          prior_status?: string | null
          row_label?: string | null
          run_id?: string
          succeeded?: boolean
          termination_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_run_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "automation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          candidates_count: number
          created_at: string
          dry_run: boolean
          executed_by: string
          executed_by_email: string | null
          failed_count: number
          filename: string | null
          id: string
          reason: string | null
          task_type: string
          terminated_count: number
          termination_date: string | null
          undone_at: string | null
          undone_by: string | null
        }
        Insert: {
          candidates_count?: number
          created_at?: string
          dry_run?: boolean
          executed_by: string
          executed_by_email?: string | null
          failed_count?: number
          filename?: string | null
          id?: string
          reason?: string | null
          task_type?: string
          terminated_count?: number
          termination_date?: string | null
          undone_at?: string | null
          undone_by?: string | null
        }
        Update: {
          candidates_count?: number
          created_at?: string
          dry_run?: boolean
          executed_by?: string
          executed_by_email?: string | null
          failed_count?: number
          filename?: string | null
          id?: string
          reason?: string | null
          task_type?: string
          terminated_count?: number
          termination_date?: string | null
          undone_at?: string | null
          undone_by?: string | null
        }
        Relationships: []
      }
      deletion_audit: {
        Row: {
          affected_count: number
          affected_locker_numbers: string[] | null
          created_at: string
          deleted_by: string
          deleted_by_email: string | null
          deletion_kind: string
          id: string
          location: string
          locker_id: string | null
          locker_number: string | null
          reason: string
          undone_at: string | null
          undone_by: string | null
        }
        Insert: {
          affected_count?: number
          affected_locker_numbers?: string[] | null
          created_at?: string
          deleted_by: string
          deleted_by_email?: string | null
          deletion_kind: string
          id?: string
          location: string
          locker_id?: string | null
          locker_number?: string | null
          reason: string
          undone_at?: string | null
          undone_by?: string | null
        }
        Update: {
          affected_count?: number
          affected_locker_numbers?: string[] | null
          created_at?: string
          deleted_by?: string
          deleted_by_email?: string | null
          deletion_kind?: string
          id?: string
          location?: string
          locker_id?: string | null
          locker_number?: string | null
          reason?: string
          undone_at?: string | null
          undone_by?: string | null
        }
        Relationships: []
      }
      faq_assistant_log: {
        Row: {
          answer: string | null
          asked_at: string
          id: string
          ip_address: unknown
          question: string
        }
        Insert: {
          answer?: string | null
          asked_at?: string
          id?: string
          ip_address?: unknown
          question: string
        }
        Update: {
          answer?: string | null
          asked_at?: string
          id?: string
          ip_address?: unknown
          question?: string
        }
        Relationships: []
      }
      locker_lookup_attempts: {
        Row: {
          attempted_at: string
          id: string
          ip_address: string | null
          locker_number: string | null
          success: boolean
        }
        Insert: {
          attempted_at?: string
          id?: string
          ip_address?: string | null
          locker_number?: string | null
          success?: boolean
        }
        Update: {
          attempted_at?: string
          id?: string
          ip_address?: string | null
          locker_number?: string | null
          success?: boolean
        }
        Relationships: []
      }
      locker_occupancy: {
        Row: {
          badge_number: string | null
          batch_intake_date: string | null
          category: string
          contact: string | null
          created_at: string
          department: string | null
          employee_name: string | null
          gradeset: string | null
          id: string
          key_lock_type: string | null
          locker_location_by_row: string | null
          locker_number: string
          locker_row: string | null
          locker_unit: string | null
          national_id: string | null
          remarks: string | null
          source_filename: string | null
          status: string | null
          termination_date: string | null
          updated_at: string
          work_location: string | null
        }
        Insert: {
          badge_number?: string | null
          batch_intake_date?: string | null
          category: string
          contact?: string | null
          created_at?: string
          department?: string | null
          employee_name?: string | null
          gradeset?: string | null
          id?: string
          key_lock_type?: string | null
          locker_location_by_row?: string | null
          locker_number: string
          locker_row?: string | null
          locker_unit?: string | null
          national_id?: string | null
          remarks?: string | null
          source_filename?: string | null
          status?: string | null
          termination_date?: string | null
          updated_at?: string
          work_location?: string | null
        }
        Update: {
          badge_number?: string | null
          batch_intake_date?: string | null
          category?: string
          contact?: string | null
          created_at?: string
          department?: string | null
          employee_name?: string | null
          gradeset?: string | null
          id?: string
          key_lock_type?: string | null
          locker_location_by_row?: string | null
          locker_number?: string
          locker_row?: string | null
          locker_unit?: string | null
          national_id?: string | null
          remarks?: string | null
          source_filename?: string | null
          status?: string | null
          termination_date?: string | null
          updated_at?: string
          work_location?: string | null
        }
        Relationships: []
      }
      lockers: {
        Row: {
          badge_number: string | null
          batch_intake: string | null
          created_at: string
          custom_status: string | null
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
          employee_name: string | null
          id: string
          key_lock: string | null
          location: string
          locker_number: string
          national_id: string | null
          physical_key_status: Database["public"]["Enums"]["key_status"] | null
          remark: string | null
          row_label: string | null
          spare_key_status: Database["public"]["Enums"]["key_status"] | null
          status: Database["public"]["Enums"]["locker_status"]
          unit_type: string | null
          updated_at: string
          work_location: string | null
        }
        Insert: {
          badge_number?: string | null
          batch_intake?: string | null
          created_at?: string
          custom_status?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          employee_name?: string | null
          id?: string
          key_lock?: string | null
          location: string
          locker_number: string
          national_id?: string | null
          physical_key_status?: Database["public"]["Enums"]["key_status"] | null
          remark?: string | null
          row_label?: string | null
          spare_key_status?: Database["public"]["Enums"]["key_status"] | null
          status?: Database["public"]["Enums"]["locker_status"]
          unit_type?: string | null
          updated_at?: string
          work_location?: string | null
        }
        Update: {
          badge_number?: string | null
          batch_intake?: string | null
          created_at?: string
          custom_status?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          employee_name?: string | null
          id?: string
          key_lock?: string | null
          location?: string
          locker_number?: string
          national_id?: string | null
          physical_key_status?: Database["public"]["Enums"]["key_status"] | null
          remark?: string | null
          row_label?: string | null
          spare_key_status?: Database["public"]["Enums"]["key_status"] | null
          status?: Database["public"]["Enums"]["locker_status"]
          unit_type?: string | null
          updated_at?: string
          work_location?: string | null
        }
        Relationships: []
      }
      map_layouts: {
        Row: {
          id: string
          layout: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id: string
          layout: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          layout?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      national_id_access_log: {
        Row: {
          accessed_at: string
          id: string
          record_id: string
          table_name: string
          user_id: string
        }
        Insert: {
          accessed_at?: string
          id?: string
          record_id: string
          table_name: string
          user_id: string
        }
        Update: {
          accessed_at?: string
          id?: string
          record_id?: string
          table_name?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      support_requests: {
        Row: {
          badge_number: string
          client_ip: unknown
          contact_number: string
          created_at: string
          id: string
          locker_number: string | null
          message: string
          name: string
          request_type: Database["public"]["Enums"]["support_request_type"]
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["support_request_status"]
          updated_at: string
        }
        Insert: {
          badge_number: string
          client_ip?: unknown
          contact_number: string
          created_at?: string
          id?: string
          locker_number?: string | null
          message: string
          name: string
          request_type: Database["public"]["Enums"]["support_request_type"]
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["support_request_status"]
          updated_at?: string
        }
        Update: {
          badge_number?: string
          client_ip?: unknown
          contact_number?: string
          created_at?: string
          id?: string
          locker_number?: string | null
          message?: string
          name?: string
          request_type?: Database["public"]["Enums"]["support_request_type"]
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["support_request_status"]
          updated_at?: string
        }
        Relationships: []
      }
      terminations: {
        Row: {
          badge_number: string | null
          created_at: string
          employee_name: string | null
          id: string
          location: string | null
          locker_id: string | null
          locker_number: string
          prior_badge_number: string | null
          prior_employee_name: string | null
          prior_status: Database["public"]["Enums"]["locker_status"] | null
          reason: string | null
          row_label: string | null
          terminated_by: string
          terminated_by_email: string | null
          termination_date: string
          undone_at: string | null
          undone_by: string | null
        }
        Insert: {
          badge_number?: string | null
          created_at?: string
          employee_name?: string | null
          id?: string
          location?: string | null
          locker_id?: string | null
          locker_number: string
          prior_badge_number?: string | null
          prior_employee_name?: string | null
          prior_status?: Database["public"]["Enums"]["locker_status"] | null
          reason?: string | null
          row_label?: string | null
          terminated_by: string
          terminated_by_email?: string | null
          termination_date: string
          undone_at?: string | null
          undone_by?: string | null
        }
        Update: {
          badge_number?: string | null
          created_at?: string
          employee_name?: string | null
          id?: string
          location?: string | null
          locker_id?: string | null
          locker_number?: string
          prior_badge_number?: string | null
          prior_employee_name?: string | null
          prior_status?: Database["public"]["Enums"]["locker_status"] | null
          reason?: string | null
          row_label?: string | null
          terminated_by?: string
          terminated_by_email?: string | null
          termination_date?: string
          undone_at?: string | null
          undone_by?: string | null
        }
        Relationships: []
      }
      upload_history: {
        Row: {
          active_count: number | null
          created_at: string
          filename: string | null
          id: string
          resigned_count: number | null
          rows_processed: number | null
          uploaded_by: string | null
        }
        Insert: {
          active_count?: number | null
          created_at?: string
          filename?: string | null
          id?: string
          resigned_count?: number | null
          rows_processed?: number | null
          uploaded_by?: string | null
        }
        Update: {
          active_count?: number | null
          created_at?: string
          filename?: string | null
          id?: string
          resigned_count?: number | null
          rows_processed?: number | null
          uploaded_by?: string | null
        }
        Relationships: []
      }
      user_permissions: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          permission: Database["public"]["Enums"]["app_permission"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          permission: Database["public"]["Enums"]["app_permission"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          permission?: Database["public"]["Enums"]["app_permission"]
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      locker_occupancy_masked: {
        Row: {
          badge_number: string | null
          batch_intake_date: string | null
          category: string | null
          contact: string | null
          created_at: string | null
          department: string | null
          employee_name: string | null
          gradeset: string | null
          id: string | null
          key_lock_type: string | null
          locker_location_by_row: string | null
          locker_number: string | null
          locker_row: string | null
          locker_unit: string | null
          national_id: string | null
          remarks: string | null
          source_filename: string | null
          status: string | null
          termination_date: string | null
          updated_at: string | null
          work_location: string | null
        }
        Insert: {
          badge_number?: string | null
          batch_intake_date?: string | null
          category?: string | null
          contact?: string | null
          created_at?: string | null
          department?: string | null
          employee_name?: string | null
          gradeset?: string | null
          id?: string | null
          key_lock_type?: string | null
          locker_location_by_row?: string | null
          locker_number?: string | null
          locker_row?: string | null
          locker_unit?: string | null
          national_id?: never
          remarks?: string | null
          source_filename?: string | null
          status?: string | null
          termination_date?: string | null
          updated_at?: string | null
          work_location?: string | null
        }
        Update: {
          badge_number?: string | null
          batch_intake_date?: string | null
          category?: string | null
          contact?: string | null
          created_at?: string | null
          department?: string | null
          employee_name?: string | null
          gradeset?: string | null
          id?: string | null
          key_lock_type?: string | null
          locker_location_by_row?: string | null
          locker_number?: string | null
          locker_row?: string | null
          locker_unit?: string | null
          national_id?: never
          remarks?: string | null
          source_filename?: string | null
          status?: string | null
          termination_date?: string | null
          updated_at?: string | null
          work_location?: string | null
        }
        Relationships: []
      }
      lockers_masked: {
        Row: {
          badge_number: string | null
          batch_intake: string | null
          created_at: string | null
          custom_status: string | null
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
          employee_name: string | null
          id: string | null
          key_lock: string | null
          location: string | null
          locker_number: string | null
          national_id: string | null
          physical_key_status: Database["public"]["Enums"]["key_status"] | null
          remark: string | null
          row_label: string | null
          spare_key_status: Database["public"]["Enums"]["key_status"] | null
          status: Database["public"]["Enums"]["locker_status"] | null
          unit_type: string | null
          updated_at: string | null
          work_location: string | null
        }
        Insert: {
          badge_number?: string | null
          batch_intake?: string | null
          created_at?: string | null
          custom_status?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          employee_name?: string | null
          id?: string | null
          key_lock?: string | null
          location?: string | null
          locker_number?: string | null
          national_id?: never
          physical_key_status?: Database["public"]["Enums"]["key_status"] | null
          remark?: string | null
          row_label?: string | null
          spare_key_status?: Database["public"]["Enums"]["key_status"] | null
          status?: Database["public"]["Enums"]["locker_status"] | null
          unit_type?: string | null
          updated_at?: string | null
          work_location?: string | null
        }
        Update: {
          badge_number?: string | null
          batch_intake?: string | null
          created_at?: string | null
          custom_status?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          employee_name?: string | null
          id?: string | null
          key_lock?: string | null
          location?: string | null
          locker_number?: string | null
          national_id?: never
          physical_key_status?: Database["public"]["Enums"]["key_status"] | null
          remark?: string | null
          row_label?: string | null
          spare_key_status?: Database["public"]["Enums"]["key_status"] | null
          status?: Database["public"]["Enums"]["locker_status"] | null
          unit_type?: string | null
          updated_at?: string | null
          work_location?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      can_access_lockers: { Args: { _user_id: string }; Returns: boolean }
      can_view_national_id: { Args: { _user_id: string }; Returns: boolean }
      has_permission: {
        Args: {
          _permission: Database["public"]["Enums"]["app_permission"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      mask_national_id: { Args: { _nid: string }; Returns: string }
      reveal_national_id: {
        Args: { _record_id: string; _table_name: string }
        Returns: string
      }
      submit_support_request: {
        Args: {
          _badge_number: string
          _contact_number: string
          _ip: string
          _locker_number: string
          _message: string
          _name: string
          _request_type: Database["public"]["Enums"]["support_request_type"]
        }
        Returns: string
      }
      swap_lockers: { Args: { _a_id: string; _b_id: string }; Returns: Json }
      transfer_locker: {
        Args: { _from_id: string; _old_action: string; _to_id: string }
        Returns: Json
      }
    }
    Enums: {
      app_permission:
        | "locker_management"
        | "termination_actions"
        | "upload_roster"
        | "run_automation"
        | "page_map"
        | "page_lockers"
        | "page_spare_keys"
        | "page_occupancy"
        | "page_duplicates"
        | "page_operations"
        | "page_reconcile"
        | "page_upload"
        | "view_national_id"
        | "manage_support_requests"
      app_role: "admin" | "viewer"
      key_status:
        | "available"
        | "missing"
        | "with_employee"
        | "damaged"
        | "unknown"
        | "taken"
        | "taken_for_cleaning"
      locker_status:
        | "active"
        | "empty"
        | "repair"
        | "unknown"
        | "cleaning"
        | "broken_door"
        | "on_hold"
        | "reserved"
        | "find_spare_key"
        | "returning_locker"
        | "reset"
        | "done_reset"
      support_request_status: "new" | "in_progress" | "resolved"
      support_request_type: "transfer_locker" | "cant_find_locker" | "other"
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
      app_permission: [
        "locker_management",
        "termination_actions",
        "upload_roster",
        "run_automation",
        "page_map",
        "page_lockers",
        "page_spare_keys",
        "page_occupancy",
        "page_duplicates",
        "page_operations",
        "page_reconcile",
        "page_upload",
        "view_national_id",
        "manage_support_requests",
      ],
      app_role: ["admin", "viewer"],
      key_status: [
        "available",
        "missing",
        "with_employee",
        "damaged",
        "unknown",
        "taken",
        "taken_for_cleaning",
      ],
      locker_status: [
        "active",
        "empty",
        "repair",
        "unknown",
        "cleaning",
        "broken_door",
        "on_hold",
        "reserved",
        "find_spare_key",
        "returning_locker",
        "reset",
        "done_reset",
      ],
      support_request_status: ["new", "in_progress", "resolved"],
      support_request_type: ["transfer_locker", "cant_find_locker", "other"],
    },
  },
} as const
