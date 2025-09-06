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
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      bot_files: {
        Row: {
          bot_id: string
          created_at: string
          dataset: string | null
          file_name: string
          file_url: string
          id: string
        }
        Insert: {
          bot_id: string
          created_at?: string
          dataset?: string | null
          file_name: string
          file_url: string
          id?: string
        }
        Update: {
          bot_id?: string
          created_at?: string
          dataset?: string | null
          file_name?: string
          file_url?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_files_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_models: {
        Row: {
          bot_id: string | null
          created_at: string
          id: string
          open_ai_id: string
          version: string
        }
        Insert: {
          bot_id?: string | null
          created_at?: string
          id?: string
          open_ai_id: string
          version: string
        }
        Update: {
          bot_id?: string | null
          created_at?: string
          id?: string
          open_ai_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_models_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      bots: {
        Row: {
          active_version: string | null
          created_at: string
          description: string | null
          id: string
          img: string | null
          name: string
          progress: number | null
          short_desc: string | null
          status: string | null
          training_breadth: number
          training_depth: number
        }
        Insert: {
          active_version?: string | null
          created_at?: string
          description?: string | null
          id?: string
          img?: string | null
          name: string
          progress?: number | null
          short_desc?: string | null
          status?: string | null
          training_breadth?: number
          training_depth?: number
        }
        Update: {
          active_version?: string | null
          created_at?: string
          description?: string | null
          id?: string
          img?: string | null
          name?: string
          progress?: number | null
          short_desc?: string | null
          status?: string | null
          training_breadth?: number
          training_depth?: number
        }
        Relationships: [
          {
            foreignKeyName: "bots_active_version_fkey"
            columns: ["active_version"]
            isOneToOne: false
            referencedRelation: "bot_models"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          bot_id: string
          conversation_id: string | null
          created_at: string | null
          id: string
          message_text: string
          sender: string
          user_email: string
        }
        Insert: {
          bot_id: string
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          message_text: string
          sender: string
          user_email: string
        }
        Update: {
          bot_id?: string
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          message_text?: string
          sender?: string
          user_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          name: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      transciption_task: {
        Row: {
          created_at: string
          file_name: string | null
          folder_id: string | null
          id: string
          media_url: string | null
          openai_task_id: string | null
          result_url: string | null
          status: string | null
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          folder_id?: string | null
          id?: string
          media_url?: string | null
          openai_task_id?: string | null
          result_url?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string | null
          folder_id?: string | null
          id?: string
          media_url?: string | null
          openai_task_id?: string | null
          result_url?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transciption_task_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "transcription_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      transcription_conversations: {
        Row: {
          conversation_id: string | null
          created_at: string
          id: string
          transcription_id: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          id?: string
          transcription_id?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          id?: string
          transcription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transcription_conversations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transcription_conversations_transcription_id_fkey"
            columns: ["transcription_id"]
            isOneToOne: false
            referencedRelation: "transciption_task"
            referencedColumns: ["id"]
          },
        ]
      }
      transcription_folders: {
        Row: {
          created_at: string
          id: string
          name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
