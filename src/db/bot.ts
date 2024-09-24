import { Database } from "../database.types";
import supabase from "./supabaseClient";

export type Bot = Database["public"]["Tables"]["bots"]["Row"];
export type BotInsert = Database["public"]["Tables"]["bots"]["Insert"];
export type BotUpdate = Database["public"]["Tables"]["bots"]["Update"];

// CRUD operations for bots
export const fetchBot = async (botId: number): Promise<Bot> => {
  const { data, error } = await supabase
    .from("bots")
    .select("*")
    .eq("id", botId)
    .single();

  if (error)
    throw new Error(`Failed to fetch bot with ID ${botId}: ${error.message}`);
  return data as Bot;
};

export const createBot = async (bot: BotInsert): Promise<Bot> => {
  const { data, error } = await supabase
    .from("bots")
    .insert([bot])
    .select("*")
    .single();

  if (error) throw new Error(`Failed to create bot: ${error.message}`);
  return data;
};

export const updateBot = async (
  botId: string,
  bot: BotUpdate
): Promise<Bot> => {
  const { data, error } = await supabase
    .from("bots")
    .update(bot)
    .eq("id", botId)
    .select("*")
    .single();

  if (error)
    throw new Error(`Failed to update bot with ID ${botId}: ${error.message}`);
  return data as Bot;
};

export const deleteBot = async (botId: number): Promise<void> => {
  const { error } = await supabase.from("bots").delete().eq("id", botId);

  if (error)
    throw new Error(`Failed to delete bot with ID ${botId}: ${error.message}`);
};
