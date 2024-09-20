import { Database } from "../database.types";
import supabase from "./supabaseClient";

export type BotModel = Database["public"]["Tables"]["bot_models"]["Row"];
export type BotModelInsert = Database["public"]["Tables"]["bot_models"]["Insert"];
export type BotModelUpdate = Database["public"]["Tables"]["bot_models"]["Update"];

// CRUD operations for bot models
export const fetchBotModel = async (modelId: number): Promise<BotModel> => {
  const { data, error } = await supabase
    .from("bot_models")
    .select("*")
    .eq("id", modelId)
    .single();

  if (error)
    throw new Error(`Failed to fetch bot model with ID ${modelId}: ${error.message}`);
  return data as BotModel;
};

export const createBotModel = async (model: BotModelInsert): Promise<BotModel> => {
  const { data, error } = await supabase
    .from("bot_models")
    .insert([model])
    .select("*")
    .single();

  if (error) throw new Error(`Failed to create bot model: ${error.message}`);
  return data;
};

export const updateBotModel = async (
  modelId: number,
  model: BotModelUpdate
): Promise<BotModel> => {
  const { data, error } = await supabase
    .from("bot_models")
    .update(model)
    .eq("id", modelId)
    .select("*")
    .single();

  if (error)
    throw new Error(`Failed to update bot model with ID ${modelId}: ${error.message}`);
  return data as BotModel;
};

export const deleteBotModel = async (modelId: number): Promise<void> => {
  const { error } = await supabase.from("bot_models").delete().eq("id", modelId);

  if (error)
    throw new Error(`Failed to delete bot model with ID ${modelId}: ${error.message}`);
};