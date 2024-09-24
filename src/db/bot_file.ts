import { Database } from "../database.types";
import supabase from "./supabaseClient";

export type BotFile = Database["public"]["Tables"]["bot_files"]["Row"];
export type BotFileInsert = Database["public"]["Tables"]["bot_files"]["Insert"];
export type BotFileUpdate = Database["public"]["Tables"]["bot_files"]["Update"];

// CRUD operations for bot files
export const fetchBotFile = async (fileId: number): Promise<BotFile> => {
  const { data, error } = await supabase
    .from("bot_files")
    .select("*")
    .eq("id", fileId)
    .single();

  if (error)
    throw new Error(`Failed to fetch bot file with ID ${fileId}: ${error.message}`);
  return data as BotFile;
};

export const createBotFile = async (file: BotFileInsert): Promise<BotFile> => {
  const { data, error } = await supabase
    .from("bot_files")
    .insert([file])
    .select("*")
    .single();

  if (error) throw new Error(`Failed to create bot file: ${error.message}`);
  return data;
};

export const updateBotFile = async (
  fileId: number,
  file: BotFileUpdate
): Promise<BotFile> => {
  const { data, error } = await supabase
    .from("bot_files")
    .update(file)
    .eq("id", fileId)
    .select("*")
    .single();

  if (error)
    throw new Error(`Failed to update bot file with ID ${fileId}: ${error.message}`);
  return data as BotFile;
};

export const deleteBotFile = async (fileId: number): Promise<void> => {
  const { error } = await supabase.from("bot_files").delete().eq("id", fileId);

  if (error)
    throw new Error(`Failed to delete bot file with ID ${fileId}: ${error.message}`);
};

export const fetchBotFilesByBotId = async (botId: string): Promise<BotFile[]> => {
  const { data, error } = await supabase
    .from("bot_files")
    .select("*")
    .eq("bot_id", botId);

  if (error)
    throw new Error(`Failed to fetch bot files for bot ID ${botId}: ${error.message}`);
  return data as BotFile[];
}