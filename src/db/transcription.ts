import { Database } from "../database.types";
import supabase from "./supabaseClient";
import { TRANSCRIPTION_TABLE } from "./constants";

export type TranscriptionTask = Database["public"]["Tables"]["transciption_task"]["Row"];
export type TranscriptionTaskInsert = Database["public"]["Tables"]["transciption_task"]["Insert"];
export type TranscriptionTaskUpdate = Database["public"]["Tables"]["transciption_task"]["Update"];

export type TranscriptionConversation = Database["public"]["Tables"]["transcription_conversations"]["Row"];
export type TranscriptionConversationInsert = Database["public"]["Tables"]["transcription_conversations"]["Insert"];
export type TranscriptionConversationUpdate = Database["public"]["Tables"]["transcription_conversations"]["Update"];

export type TranscriptionFile = Database["public"]["Tables"]["transcription_files"]["Row"];
export type TranscriptionFileInsert = Database["public"]["Tables"]["transcription_files"]["Insert"];
export type TranscriptionFileUpdate = Database["public"]["Tables"]["transcription_files"]["Update"];

export const fetchTranscriptionTask = async (taskId: string): Promise<TranscriptionTask> => {
  const { data, error } = await supabase
    .from(TRANSCRIPTION_TABLE)
    .select("*")
    .eq("id", taskId)
    .single();

  if (error) {
    throw new Error(`Failed to fetch transcription task with ID ${taskId}: ${error.message}`);
  }
  return data as TranscriptionTask;
};

export const createTranscriptionTask = async (
  task: TranscriptionTaskInsert
): Promise<TranscriptionTask> => {
  const { data, error } = await supabase
    .from(TRANSCRIPTION_TABLE)
    .insert([task])
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create transcription task: ${error.message}`);
  }
  return data as TranscriptionTask;
};

export const updateTranscriptionTask = async (
  taskId: string,
  updates: TranscriptionTaskUpdate
): Promise<TranscriptionTask> => {
  const { data, error } = await supabase
    .from(TRANSCRIPTION_TABLE)
    .update(updates)
    .eq("id", taskId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to update transcription task ${taskId}: ${error.message}`);
  }
  return data as TranscriptionTask;
};

/**
 * Attempts to atomically claim a task for processing by setting result_url to a processing marker
 * only if it is currently NULL.
 * Returns true if the claim succeeded; otherwise false.
 */
export const claimTranscriptionTaskForProcessing = async (
  taskId: string,
  workerId: string
): Promise<{ claimed: boolean }> => {
  const processingMarker: string = `processing:${workerId}:${Date.now()}`;
  // First, try to set both result_url and status if column exists
  let data: unknown;
  let error: { message: string } | null = null;
  {
    const resp = await supabase
      .from(TRANSCRIPTION_TABLE)
      .update({ result_url: processingMarker, status: "PROCESSING" })
      .eq("id", taskId)
      .is("result_url", null)
      .select("id");
    data = resp.data as unknown;
    error = resp.error as { message: string } | null;
  }

  if (error) {
    // Fallback for environments without a status column
    const fallback = await supabase
      .from(TRANSCRIPTION_TABLE)
      .update({ result_url: processingMarker })
      .eq("id", taskId)
      .is("result_url", null)
      .select("id");
    if (fallback.error) {
      throw new Error(`Failed to claim transcription task ${taskId}: ${fallback.error.message}`);
    }
    data = fallback.data as unknown;
  }

  const claimed = Array.isArray(data as unknown[]) && (data as unknown[]).length === 1;
  return { claimed };
};

/**
 * Clears a processing marker back to NULL, used on error to allow retries.
 */
export const resetTranscriptionTaskProcessing = async (
  taskId: string,
  newStatus: "PENDING" | "FAILED" = "PENDING"
): Promise<void> => {
  // Try to set status and clear result_url; fallback if status column missing
  const resp = await supabase
    .from(TRANSCRIPTION_TABLE)
    .update({ result_url: null, status: newStatus, openai_task_id: null })
    .eq("id", taskId);
  if (resp.error) {
    const fallback = await supabase
      .from(TRANSCRIPTION_TABLE)
      .update({ result_url: null, openai_task_id: null })
      .eq("id", taskId);
    if (fallback.error) {
      throw new Error(`Failed to reset transcription task ${taskId}: ${fallback.error.message}`);
    }
  }
};

/**
 * Fetches all transcription files associated with a transcription task
 */
export const fetchTranscriptionFilesByTaskId = async (taskId: string): Promise<TranscriptionFile[]> => {
  const { data, error } = await supabase
    .from("transcription_files")
    .select("*")
    .eq("transcription_task_id", taskId)
    .order("created_at", { ascending: true }); // Ensure consistent ordering for file chunks

  if (error) {
    throw new Error(`Failed to fetch transcription files for task ${taskId}: ${error.message}`);
  }
  return (data || []) as TranscriptionFile[];
};

/**
 * Creates a new transcription file record
 */
export const createTranscriptionFile = async (
  file: TranscriptionFileInsert
): Promise<TranscriptionFile> => {
  const { data, error } = await supabase
    .from("transcription_files")
    .insert([file])
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create transcription file: ${error.message}`);
  }
  return data as TranscriptionFile;
};

export const linkTranscriptionsToConversation = async (
  conversationId: string,
  transcriptionIds: string[]
): Promise<TranscriptionConversation[]> => {
  if (transcriptionIds.length === 0) {
    return [];
  }

  const rows: TranscriptionConversationInsert[] = transcriptionIds.map((id) => ({
    conversation_id: conversationId,
    transcription_id: id,
  }));

  const { data, error } = await supabase
    .from("transcription_conversations")
    .insert(rows)
    .select("*");

  if (error) {
    throw new Error(`Failed to link transcriptions to conversation: ${error.message}`);
  }
  return (data || []) as TranscriptionConversation[];
};


