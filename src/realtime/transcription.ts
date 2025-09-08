import OpenAI from "openai";
import supabase from "../db/supabaseClient";
import { TRANSCRIPTION_TABLE } from "../db/constants";
import { fetchTranscriptionTask, updateTranscriptionTask, claimTranscriptionTaskForProcessing, resetTranscriptionTaskProcessing, fetchTranscriptionFilesByTaskId } from "../db/transcription";
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
            // Check for media files in the transcription_files table
            const transcriptionFiles = await fetchTranscriptionFilesByTaskId(taskId);
            
            if (transcriptionFiles.length === 0) {
              logger.warn("No transcription files found for task", { taskId });
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
              // Prepare transcription options
              const transcribeOptions = {
                bucketName,
                taskId: task.id,
                mediaUrls: transcriptionFiles.map(f => f.media_url).filter(url => url !== null) as string[],
                language: task.language // Pass language from database to Whisper
              };
              
              logger.info("Starting transcription", { 
                taskId, 
                chunkCount: transcriptionFiles.length,
                language: task.language || "auto"
              });
              
              const { resultUrl, openaiTaskId } = await transcribeMediaWithOpenAI(client, transcribeOptions, async (p) => {
                // Persist coarse progress into status column if available
                try {
                  if (p.phase === "download_start") {
                    await updateTranscriptionTask(task.id, { status: "PROCESSING:DOWNLOADING" });
                  } else if (p.phase === "download_done") {
                    await updateTranscriptionTask(task.id, { status: "PROCESSING:DOWNLOADED" });
                  } else if (p.phase === "transcribe_start") {
                    await updateTranscriptionTask(task.id, { status: "PROCESSING:TRANSCRIBING" });
                  } else if (p.phase === "transcribe_done") {
                    await updateTranscriptionTask(task.id, { status: "PROCESSING:UPLOADING" });
                  } else if (p.phase === "upload_done") {
                    await updateTranscriptionTask(task.id, { status: "COMPLETED" });
                  }
                } catch (e) {
                  // Best-effort; ignore if status column is missing
                }
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
 * This will periodically query for tasks with media_url set or transcription files and result_url null, and process them.
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
        .limit(5);
      if (error) {
        // eslint-disable-next-line no-console
        console.error("Polling fetch error:", error.message);
      } else if (Array.isArray(data)) {
        // Filter tasks that have transcription files
        const validTasks = [];
        for (const task of data) {
          // Check if task has transcription files
          const transcriptionFiles = await fetchTranscriptionFilesByTaskId(task.id);
          if (transcriptionFiles.length > 0) {
            validTasks.push(task);
          }
        }
        
        // eslint-disable-next-line no-console
        console.log(`[polling] Found ${validTasks.length} pending task(s) with media.`);
        for (const task of validTasks) {
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
              // Fetch transcription files for this task
              const transcriptionFiles = await fetchTranscriptionFilesByTaskId(task.id);
              
              // Prepare transcription options
              const transcribeOptions = {
                bucketName,
                taskId: task.id,
                mediaUrls: transcriptionFiles.map(f => f.media_url).filter(url => url !== null) as string[],
                language: task.language // Pass language from database to Whisper
              };
              
              const { resultUrl, openaiTaskId } = await transcribeMediaWithOpenAI(client, transcribeOptions);
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


