import { Database } from "../database.types";
import supabase from "./supabaseClient";

export type ChatMessage = Database["public"]["Tables"]["chat_messages"]["Row"];
export type ChatMessageInsert = Database["public"]["Tables"]["chat_messages"]["Insert"];
export type ChatMessageUpdate = Database["public"]["Tables"]["chat_messages"]["Update"];

/**
 * Saves a chat message to the database
 * @param message - The chat message data to insert
 * @returns Promise<ChatMessage> - The created chat message
 */
export const saveChatMessage = async (message: ChatMessageInsert): Promise<ChatMessage> => {
  const { data, error } = await supabase
    .from("chat_messages")
    .insert([message])
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to save chat message: ${error.message}`);
  }
  
  return data;
};

/**
 * Fetches chat messages for a specific bot and user email
 * @param botId - The bot ID to filter messages by
 * @param userEmail - The user email to filter messages by
 * @param limit - Optional limit for number of messages (default: 50)
 * @returns Promise<ChatMessage[]> - Array of chat messages
 */
export const fetchChatMessages = async (
  botId: string,
  userEmail: string,
  limit: number = 50
): Promise<ChatMessage[]> => {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("bot_id", botId)
    .eq("user_email", userEmail)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch chat messages: ${error.message}`);
  }

  return data || [];
};

/**
 * Fetches all chat messages for a specific bot
 * @param botId - The bot ID to filter messages by
 * @param limit - Optional limit for number of messages (default: 100)
 * @returns Promise<ChatMessage[]> - Array of chat messages
 */
export const fetchBotChatMessages = async (
  botId: string,
  limit: number = 100
): Promise<ChatMessage[]> => {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("bot_id", botId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch bot chat messages: ${error.message}`);
  }

  return data || [];
};

/**
 * Deletes chat messages for a specific bot and user email
 * @param botId - The bot ID to filter messages by
 * @param userEmail - The user email to filter messages by
 * @returns Promise<void>
 */
export const deleteChatMessages = async (
  botId: string,
  userEmail: string
): Promise<void> => {
  const { error } = await supabase
    .from("chat_messages")
    .delete()
    .eq("bot_id", botId)
    .eq("user_email", userEmail);

  if (error) {
    throw new Error(`Failed to delete chat messages: ${error.message}`);
  }
}; 