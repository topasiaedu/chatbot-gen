import OpenAI from "openai";
import supabase from "../db/supabaseClient";
import { TRANSCRIPTION_TABLE } from "../db/constants";
import { fetchTranscriptionTask, updateTranscriptionTask, claimTranscriptionTaskForProcessing, resetTranscriptionTaskProcessing } from "../db/transcription";
import { transcribeMediaWithOpenAI } from "../utils/transcription";
import logger from "../utils/logger";
import { uploadErrorReport } from "../utils/transcriptionDiagnostics";

/**
 * Initializes a realtime subscription to the `public.transciption_task` table.
 * On INSERT where `media_url` is present and `result_url` is null, processes the task
 * with OpenAI Whisper and updates `result_url` with the public text file URL.
 */
export function initTranscriptionRealtime(client: OpenAI, bucketName: string): () => void {
  // Subscribe to all changes but handle INSERT specifically
  const channel = supabase
    .channel("transcription_tasks")
    .on(
      "postgres_changes" as any,
      { event: "INSERT", schema: "public", table: "transciption_task" },
      async (payload: any) => {
        try {
          const eventType: string | undefined = payload?.eventType;
          const taskId: string | undefined = payload?.new?.id ?? payload?.old?.id;
          if (!taskId) {
            return;
          }

          if (eventType === "INSERT" && payload?.new) {
            logger.info("Realtime INSERT received", { taskId, phase: "update" });
            const task = await fetchTranscriptionTask(taskId);
            if (task.result_url) {
              logger.info("Task already processed", { taskId });
              return; // Already processed
            }
            if (!task.media_url) {
              logger.warn("Task missing media_url", { taskId });
              return; // No media to process
            }

            // Attempt to claim to avoid duplicate workers
            const { claimed } = await claimTranscriptionTaskForProcessing(task.id, "realtime");
            if (!claimed) {
              logger.info("Task already claimed; skipping", { taskId });
              return;
            }

            logger.info("Processing transcription task", { taskId });
            try {
              // Generate a run correlation ID to store in openai_task_id early
              const runId: string = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
              try {
                await updateTranscriptionTask(task.id, { openai_task_id: runId });
              } catch (e) {
                logger.warn("Failed to set initial openai_task_id runId", { taskId });
              }
              const { resultUrl, openaiTaskId } = await transcribeMediaWithOpenAI(client, {
                bucketName,
                taskId: task.id,
                mediaUrl: task.media_url,
              });
              await updateTranscriptionTask(task.id, { result_url: resultUrl, openai_task_id: openaiTaskId ?? runId, status: "COMPLETED" });
              logger.info("Task updated with result_url", { taskId });
            } catch (err) {
              await resetTranscriptionTaskProcessing(task.id, "FAILED");
              const error = err as Error;
              logger.error("Realtime transcription failed", { taskId }, error);
              try {
                await uploadErrorReport(bucketName, {
                  taskId: task.id,
                  phase: "transcribe",
                  message: error.message,
                  name: error.name,
                  serverVersion: process.env.npm_package_version,
                  createdAtIso: new Date().toISOString(),
                });
              } catch (uploadErr) {
                logger.error("Failed to upload realtime error report", { taskId }, uploadErr as Error);
              }
              throw error;
            }
          }
        } catch (error) {
          const err = error as Error;
          logger.error("Realtime transcription handler error", undefined, err);
        }
      }
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
}

/**
 * Polling fallback in case realtime events are missed.
 * This will periodically query for tasks with media_url set and result_url null, and process them.
 */
export function startTranscriptionPolling(
  client: OpenAI,
  bucketName: string,
  intervalMs: number = 30000
): () => void {
  let isRunning = false;
  const timer = setInterval(async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      // eslint-disable-next-line no-console
      console.log(`[polling] Checking for pending transcription tasks...`);
      const { data, error } = await (await import("../db/supabaseClient")).default
        .from(TRANSCRIPTION_TABLE)
        .select("*")
        .or("result_url.is.null,result_url.eq.")
        .not("media_url", "is", null)
        .limit(5);
      if (error) {
        // eslint-disable-next-line no-console
        console.error("Polling fetch error:", error.message);
      } else if (Array.isArray(data)) {
        // eslint-disable-next-line no-console
        console.log(`[polling] Found ${data.length} pending task(s).`);
        for (const task of data) {
          try {
            // Try to claim first to avoid duplicate work
            const { claimed } = await claimTranscriptionTaskForProcessing(task.id, "polling");
            if (!claimed) {
              // eslint-disable-next-line no-console
              console.log(`[polling] Skipped; already claimed id=${task.id}`);
              continue;
            }
            // eslint-disable-next-line no-console
            console.log(`[polling] Processing task id=${task.id}`);
            try {
              const { resultUrl, openaiTaskId } = await transcribeMediaWithOpenAI(client, {
                bucketName,
                taskId: task.id,
                mediaUrl: task.media_url,
              });
              await updateTranscriptionTask(task.id, { result_url: resultUrl, status: "COMPLETED", openai_task_id: openaiTaskId ?? null });
            } catch (err) {
              await resetTranscriptionTaskProcessing(task.id, "FAILED");
              throw err;
            }
            // eslint-disable-next-line no-console
            console.log(`[polling] Updated task with result_url id=${task.id}`);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error("Polling process error:", (err as Error).message);
          }
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Polling cycle error:", (e as Error).message);
    } finally {
      isRunning = false;
    }
  }, intervalMs);

  return () => clearInterval(timer);
}


