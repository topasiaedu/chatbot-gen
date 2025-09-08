import fs from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import OpenAI from "openai";
import supabase from "../db/supabaseClient";
import logger from "./logger";
import { uploadErrorReport, type TranscriptionPhase } from "./transcriptionDiagnostics";
import { updateTranscriptionTask, fetchTranscriptionFilesByTaskId, deleteTranscriptionFilesByTaskId } from "../db/transcription";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";

/**
 * Downloads a public URL to a temporary file path.
 */
async function downloadToTempFile(fileUrl: string): Promise<string> {
  logger.info("Downloading media", { phase: "download", fileUrl });
  const fileName = path.basename(decodeURIComponent(fileUrl));
  const tempFilePath = path.join(os.tmpdir(), `${Date.now()}-${fileName}`);
  const response = await axios({
    url: fileUrl,
    method: "GET",
    responseType: "stream",
    maxContentLength: 100 * 1024 * 1024, // 100MB limit
    timeout: 60_000, // 60s timeout
    validateStatus: (status) => status >= 200 && status < 400,
  });
  const writer = fs.createWriteStream(tempFilePath);
  await new Promise<void>((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", () => resolve());
    writer.on("error", (err) => reject(err));
  });
  logger.info("Downloaded media to temp path", { phase: "download", tempFilePath });
  return tempFilePath;
}

/**
 * Uploads raw text to the Supabase public bucket at result/{taskId}.txt and returns the full public URL.
 */
async function uploadResultText(bucket: string, taskId: string, text: string): Promise<string> {
  const filePathInBucket = `result/${taskId}.txt`;
  const { error } = await supabase.storage.from(bucket).upload(
    filePathInBucket,
    Buffer.from(text, "utf8"),
    {
    upsert: true,
    contentType: "text/plain",
  }
  );
  if (error) {
    throw new Error(`Failed to upload transcription result: ${error.message}`);
  }
  const { data: publicUrl } = supabase.storage.from(bucket).getPublicUrl(filePathInBucket);
  logger.info("Uploaded transcription result", { phase: "upload", url: publicUrl.publicUrl, taskId });
  return publicUrl.publicUrl;
}

/**
 * Downloads all media chunk URLs to a temporary directory in a stable order.
 */
async function downloadAllChunks(mediaUrls: string[], outDir: string): Promise<string[]> {
  fs.mkdirSync(outDir, { recursive: true });
  const localPaths: string[] = [];
  for (let i = 0; i < mediaUrls.length; i += 1) {
    const url = mediaUrls[i];
    const downloaded = await downloadToTempFile(url);
    const ext = path.extname(downloaded) || ".m4a";
    const ordered = path.join(outDir, `src-${String(i).padStart(3, "0")}${ext}`);
    try { fs.renameSync(downloaded, ordered); } catch {
      // Fallback to copy if rename across devices fails
      fs.copyFileSync(downloaded, ordered);
      try { fs.unlinkSync(downloaded); } catch {}
    }
    localPaths.push(ordered);
  }
  return localPaths;
}

/**
 * Concatenates multiple media files into a single normalized MP3 (mono, 16kHz).
 * Uses filter_complex concat with re-encode to ensure consistent format.
 */
async function concatenateMediaFiles(inputPaths: string[], outputPath: string): Promise<void> {
  if (inputPaths.length === 1) {
    // Single input: just transcode to normalized output
    const args: string[] = [
      "-hide_banner",
      "-loglevel", "error",
      "-i", inputPaths[0],
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-c:a", "libmp3lame",
      "-q:a", "2",
      outputPath,
    ];
    await runFfmpeg(args);
    return;
  }

  const args: string[] = ["-hide_banner", "-loglevel", "error"];
  for (const p of inputPaths) {
    args.push("-i", p);
  }
  args.push(
    "-filter_complex", `concat=n=${inputPaths.length}:v=0:a=1`,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-c:a", "libmp3lame",
    "-q:a", "2",
    outputPath
  );
  await runFfmpeg(args);
}

/**
 * Cleans up file chunks from Supabase storage after successful transcription.
 * Extracts the file path from the public URL and deletes it from storage.
 */
async function cleanupFileChunksFromStorage(bucket: string, taskId: string, mediaUrls: string[]): Promise<void> {
  logger.info("Starting cleanup of file chunks from storage", { taskId, chunkCount: mediaUrls.length });
  
  const filePaths: string[] = [];
  
  // Extract file paths from public URLs
  for (const url of mediaUrls) {
    try {
      // Parse the public URL to extract the file path
      // URL format: https://project.supabase.co/storage/v1/object/public/bucket/path/to/file
      const urlParts = url.split("/");
      const bucketIndex = urlParts.findIndex(part => part === bucket);
      if (bucketIndex !== -1 && bucketIndex < urlParts.length - 1) {
        // Get everything after the bucket name as the file path
        const filePath = urlParts.slice(bucketIndex + 1).join("/");
        filePaths.push(filePath);
      }
    } catch (error) {
      logger.warn("Failed to parse file URL for cleanup", { url, error: (error as Error).message });
    }
  }
  
  if (filePaths.length === 0) {
    logger.warn("No valid file paths found for cleanup", { taskId });
    return;
  }
  
  // Delete files from storage
  const { data, error } = await supabase.storage.from(bucket).remove(filePaths);
  
  if (error) {
    logger.error("Failed to cleanup file chunks from storage", { taskId, error: error.message });
    // Don't throw error - cleanup failure shouldn't fail the transcription
  } else {
    logger.info("Successfully cleaned up file chunks from storage", { 
      taskId, 
      deletedCount: data?.length || 0,
      filePathsCount: filePaths.length
    });
  }
}

export type TranscribeOptions = {
  bucketName: string;
  taskId: string;
  mediaUrls: string[]; // File chunks from transcription_files table
  language?: string | null; // Language code for Whisper (e.g., "en", "zh", "es", etc.)
};

export type TranscriptionProgress =
  | { phase: "download_start" }
  | { phase: "download_done" }
  | { phase: "transcribe_start" }
  | { phase: "transcribe_done"; ms: number; chars: number }
  | { phase: "upload_start" }
  | { phase: "upload_done"; url: string };

/**
 * Processes multiple file chunks individually through Whisper.
 * Each chunk is downloaded, split into 1-minute segments, and transcribed.
 * Returns all transcription results combined into a single text.
 */
async function processFileChunks(
  client: OpenAI,
  mediaUrls: string[],
  taskId: string,
  language: string | null | undefined,
  startAtChunkIndex: number,
  onProgress?: (p: TranscriptionProgress) => Promise<void> | void
): Promise<string> {
  const allResults: string[] = [];
  let totalProcessed = 0;
  
  logger.info("Processing file chunks", { chunkCount: mediaUrls.length, startAtChunkIndex, taskId });
  
  // Process each chunk individually
  for (let chunkIndex = startAtChunkIndex; chunkIndex < mediaUrls.length; chunkIndex++) {
    const mediaUrl = mediaUrls[chunkIndex];
    logger.info("Processing chunk", { chunkIndex: chunkIndex + 1, totalChunks: mediaUrls.length, taskId });
    
    // Download the chunk
    const tempPath = await downloadToTempFile(mediaUrl);
    const tempDir = path.join(os.tmpdir(), `chunk-${taskId}-${chunkIndex}-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    try {
      // Split this chunk into 1-minute segments like normal
      const segmentSeconds: number = Number.parseInt(process.env.CHUNK_DURATION_SECONDS || "60", 10);
      const segmentPaths = await splitMediaIntoChunks(tempPath, tempDir, segmentSeconds);
      
      logger.info("Split chunk into segments", { 
        chunkIndex: chunkIndex + 1, 
        segmentCount: segmentPaths.length, 
        taskId 
      });
      
      // Process each segment with Whisper
      const chunkResults: string[] = [];
      for (let segmentIndex = 0; segmentIndex < segmentPaths.length; segmentIndex++) {
        const segmentPath = segmentPaths[segmentIndex];
        logger.info("Transcribing segment", { 
          chunkIndex: chunkIndex + 1, 
          segmentIndex: segmentIndex + 1, 
          totalSegments: segmentPaths.length,
          taskId 
        });
        
        const fileStream = fs.createReadStream(segmentPath);
        const transcriptionOptions: any = {
          model: "whisper-1",
          file: fileStream,
          response_format: "text",
          temperature: 0,
        };
        
        // Add language parameter if provided
        if (language && language.trim() !== "") {
          transcriptionOptions.language = language;
        }
        
        const transcription = await client.audio.transcriptions.create(transcriptionOptions);
        
        const text = (typeof transcription === "string") ? transcription : (transcription as { text?: string }).text ?? "";
        chunkResults.push(text);
        totalProcessed += 1;
        
        // Update progress if callback provided
        if (onProgress) {
          try {
            await onProgress({ 
              phase: "transcribe_done", 
              ms: 0, 
              chars: text.length 
            });
          } catch {}
        }
      }
      
      // Combine results from this chunk
      const chunkText = chunkResults.join("\n\n");
      allResults.push(chunkText);

      // Persist chunk-level progress in the DB as "X/Y chunks"
      try {
        await updateTranscriptionTask(taskId, { progress: `${chunkIndex + 1}/${mediaUrls.length} chunks`, status: "PROCESSING:TRANSCRIBING" });
      } catch {}
      
      // Clean up temp files for this chunk
      fs.unlinkSync(tempPath);
      fs.rmSync(tempDir, { recursive: true, force: true });
      
    } catch (error) {
      // Clean up on error
      try {
        fs.unlinkSync(tempPath);
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
      throw error;
    }
  }
  
  // Combine all chunk results
  const finalResult = allResults.join("\n\n");
  logger.info("Completed processing all chunks", { 
    chunkCount: mediaUrls.length, 
    totalSegments: totalProcessed,
    resultLength: finalResult.length,
    taskId 
  });
  
  return finalResult;
}

/**
 * Transcribes media file chunks using Whisper with configurable language detection,
 * uploads the transcription as text to the Supabase bucket, and cleans up all temporary files.
 * 
 * Process:
 * - Takes multiple media URLs (file chunks from transcription_files table)
 * - Downloads each chunk individually
 * - Splits each chunk into 1-minute segments (same as normal processing)
 * - Sends segments to Whisper with optional language parameter
 * - Combines all transcription results into single output
 * - Cleans up file chunks from Supabase storage to save space
 * - Removes transcription_files database records
 * - Cleans up all temporary files from server
 * 
 * Language support:
 * - If language is provided, it's passed to Whisper for better accuracy
 * - If language is null/empty, Whisper will auto-detect the language
 * - Language should be in ISO 639-1 format (e.g., "en", "zh", "es", "fr")
 * 
 * Cleanup behavior:
 * - After successful transcription, all file chunks are deleted from Supabase storage
 * - Database records in transcription_files table are removed
 * - All temporary files on server are cleaned up during processing
 * - Cleanup failures are logged but don't affect transcription success
 */
export async function transcribeMediaWithOpenAI(
  client: OpenAI,
  opts: TranscribeOptions,
  onProgress?: (p: TranscriptionProgress) => Promise<void> | void
): Promise<{ resultUrl: string; openaiTaskId?: string }> {
  // Validate input - mediaUrls must be provided
  if (!opts.mediaUrls || opts.mediaUrls.length === 0) {
    throw new Error("mediaUrls is required and must contain at least one URL");
  }

  if (onProgress) await onProgress({ phase: "download_start" });
  
  logger.info("Preparing to concatenate and segment", {
    taskId: opts.taskId,
    chunkCount: opts.mediaUrls.length,
    language: opts.language || "auto-detect",
  });

  // Workspace for downloads and combined audio
  const workRoot = path.join(os.tmpdir(), `merge-${opts.taskId}-${Date.now()}`);
  const dlDir = path.join(workRoot, "dl");
  const combinedPath = path.join(workRoot, "combined.mp3");
  const chunksDir = path.join(workRoot, "chunks");
  fs.mkdirSync(workRoot, { recursive: true });
  fs.mkdirSync(chunksDir, { recursive: true });

  let mergedText = "";
  try {
    // Download all chunk files locally in order
    const localInputs = await downloadAllChunks(opts.mediaUrls, dlDir);
    
    if (onProgress) await onProgress({ phase: "download_done" });

    // Concatenate and normalize to a single MP3
    await concatenateMediaFiles(localInputs, combinedPath);

    // Segment the combined audio into 60s chunks
    const segmentSeconds: number = Number.parseInt(process.env.CHUNK_DURATION_SECONDS || "60", 10);
    const segmentPaths = await splitMediaIntoChunks(combinedPath, chunksDir, segmentSeconds);
    const totalSegments = segmentPaths.length;
    if (totalSegments === 0) {
      throw new Error("No segments produced from combined media");
    }

    // Initialize progress per segment
    try {
      await updateTranscriptionTask(opts.taskId, { status: "PROCESSING", progress: `0/${totalSegments} segments` });
    } catch {}

    // Concurrency-limited transcription of segments
    const concurrency: number = Math.max(1, Number.parseInt(process.env.CHUNK_CONCURRENCY || "3", 10));
    const results: string[] = new Array(totalSegments).fill("");
    let completed = 0;

    const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
      return new Promise<T>((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error("TRANSCRIBE_TIMEOUT")), ms);
        promise.then(
          (value) => { clearTimeout(timeoutId); resolve(value); },
          (err) => { clearTimeout(timeoutId); reject(err); }
        );
      });
    };

    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const i = nextIndex;
        nextIndex += 1;
        if (i >= totalSegments) return;
        const segPath = segmentPaths[i];
        logger.info("Transcribing segment", { taskId: opts.taskId, index: i + 1, total: totalSegments });
        const fileStream = fs.createReadStream(segPath);

        const transcriptionOptions: Record<string, unknown> = {
          model: "whisper-1",
          file: fileStream,
          response_format: "text",
          temperature: 0,
        };
        if (typeof opts.language === "string" && opts.language.trim().length > 0) {
          transcriptionOptions.language = opts.language;
        }

        const transcription = await withTimeout(
          client.audio.transcriptions.create(transcriptionOptions as any),
          Number.parseInt(process.env.TRANSCRIBE_TIMEOUT_MS || "900000", 10)
        );
        const text = (typeof transcription === "string") ? transcription : (transcription as { text?: string }).text ?? "";
        results[i] = text;
        completed += 1;
        const progressStr = `${completed}/${totalSegments} segments`;
        try {
          await updateTranscriptionTask(opts.taskId, { progress: progressStr, status: completed === totalSegments ? "PROCESSING:UPLOADING" : "PROCESSING:TRANSCRIBING" });
        } catch {}
      }
    };

    const workers: Promise<void>[] = [];
    for (let w = 0; w < Math.min(concurrency, totalSegments); w += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);

    mergedText = results.join("\n\n");
    if (mergedText.trim().length === 0) {
      throw new Error("Merged transcription is empty");
    }
  } finally {
    // Cleanup local temp files regardless of success
    try {
      if (fs.existsSync(workRoot)) {
        const entries = fs.readdirSync(workRoot);
        for (const name of entries) {
          const p = path.join(workRoot, name);
          try {
            if (fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true });
            else fs.unlinkSync(p);
          } catch {}
        }
        try { fs.rmdirSync(workRoot); } catch {}
      }
    } catch {}
  }
  
  if (mergedText.trim().length === 0) {
    throw new Error("Merged transcription is empty");
  }

  if (onProgress) await onProgress({ phase: "upload_start" });
  const resultUrl = await uploadResultText(opts.bucketName, opts.taskId, mergedText);
  logger.info("Result uploaded", { phase: "upload", url: resultUrl, taskId: opts.taskId });
  
  try {
    await updateTranscriptionTask(opts.taskId, { status: "COMPLETED" });
  } catch {}
  
  // Clean up file chunks from storage and database after successful transcription
  try {
    await cleanupFileChunksFromStorage(opts.bucketName, opts.taskId, opts.mediaUrls);
    await deleteTranscriptionFilesByTaskId(opts.taskId);
    logger.info("Cleanup completed successfully", { taskId: opts.taskId });
  } catch (cleanupError) {
    // Log cleanup errors but don't fail the transcription
    logger.error("Cleanup failed", { taskId: opts.taskId }, cleanupError as Error);
  }
  
  if (onProgress) await onProgress({ phase: "upload_done", url: resultUrl });
  return { resultUrl };
}

export async function splitMediaIntoChunks(inputPath: string, outDir: string, segmentSeconds: number): Promise<string[]> {
  // Validate input file exists and is non-empty
  try {
    const stats = fs.statSync(inputPath);
    if (!stats.isFile() || stats.size === 0) {
      throw new Error("Input media file is empty or not a file");
    }
  } catch (e) {
    throw new Error(`Failed to access input media: ${(e as Error).message}`);
  }

  const pattern = path.join(outDir, "chunk-%05d.mp3");

  // First attempt: direct segmentation with re-encode, explicit audio mapping
  const argsPrimary: string[] = [
    "-hide_banner",
    "-loglevel", "error",
    "-fflags", "+genpts",
    "-i", inputPath,
    "-vn", // drop video; extract audio only
    "-ac", "1", // mono
    "-ar", "16000", // 16kHz for Whisper efficiency
    "-map", "0:a:0?", // map first audio stream if present (do not fail if absent)
    "-f", "segment",
    "-segment_time", String(segmentSeconds),
    "-reset_timestamps", "1",
    "-c:a", "libmp3lame",
    "-q:a", "2",
    pattern,
  ];

  try {
    await runFfmpeg(argsPrimary);
  } catch (err) {
    const stderr: string = (err as Error).message || "";
    // Fallback: re-encode full input into a stable MP3 first, then segment with stream copy
    const intermediatePath = path.join(outDir, "intermediate.mp3");
    try {
      const reencodeArgs: string[] = [
        "-hide_banner",
        "-loglevel", "error",
        "-fflags", "+genpts",
        "-i", inputPath,
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-c:a", "libmp3lame",
        "-q:a", "2",
        intermediatePath,
      ];
      await runFfmpeg(reencodeArgs);

      const segmentArgs: string[] = [
        "-hide_banner",
        "-loglevel", "error",
        "-i", intermediatePath,
        "-f", "segment",
        "-segment_time", String(segmentSeconds),
        "-reset_timestamps", "1",
        "-c", "copy",
        pattern,
      ];
      await runFfmpeg(segmentArgs);
    } catch (fallbackErr) {
      // Provide clearer error including initial failure
      const combinedMsg = `Primary segmentation failed: ${stderr}; Fallback re-encode failed: ${(fallbackErr as Error).message}`;
      throw new Error(combinedMsg);
    } finally {
      // Cleanup intermediate file if created
      try { if (fs.existsSync(intermediatePath)) fs.unlinkSync(intermediatePath); } catch {}
    }
  }

  const files = fs.readdirSync(outDir)
    .filter((f) => f.startsWith("chunk-") && f.endsWith(".mp3"))
    .sort();
  return files.map((f) => path.join(outDir, f));
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = (ffmpegPath as unknown as string) || "ffmpeg";
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (e) => reject(e));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
    });
  });
}


