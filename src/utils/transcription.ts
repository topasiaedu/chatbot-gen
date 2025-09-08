import fs from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import OpenAI from "openai";
import supabase from "../db/supabaseClient";
import logger from "./logger";
import { uploadErrorReport, type TranscriptionPhase } from "./transcriptionDiagnostics";
import { updateTranscriptionTask } from "../db/transcription";
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
  language?: string | null,
  onProgress?: (p: TranscriptionProgress) => Promise<void> | void
): Promise<string> {
  const allResults: string[] = [];
  let totalProcessed = 0;
  
  logger.info("Processing file chunks individually", { chunkCount: mediaUrls.length, taskId });
  
  // Process each chunk individually
  for (let chunkIndex = 0; chunkIndex < mediaUrls.length; chunkIndex++) {
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
 * and uploads the transcription as text to the Supabase bucket.
 * 
 * Process:
 * - Takes multiple media URLs (file chunks from transcription_files table)
 * - Downloads each chunk individually
 * - Splits each chunk into 1-minute segments (same as normal processing)
 * - Sends segments to Whisper with optional language parameter
 * - Combines all transcription results into single output
 * 
 * Language support:
 * - If language is provided, it's passed to Whisper for better accuracy
 * - If language is null/empty, Whisper will auto-detect the language
 * - Language should be in ISO 639-1 format (e.g., "en", "zh", "es", "fr")
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
  
  logger.info("Processing file chunks individually", { 
    taskId: opts.taskId, 
    chunkCount: opts.mediaUrls.length,
    language: opts.language || "auto-detect"
  });
  
  // Initialize progress
  try {
    await updateTranscriptionTask(opts.taskId, { status: "PROCESSING", progress: `0/${opts.mediaUrls.length} chunks` });
  } catch {}
  
  if (onProgress) await onProgress({ phase: "download_done" });
  
  // Process all chunks and get combined result
  const mergedText = await processFileChunks(client, opts.mediaUrls, opts.taskId, opts.language, onProgress);
  
  if (mergedText.trim().length === 0) {
    throw new Error("Merged transcription is empty");
  }

  if (onProgress) await onProgress({ phase: "upload_start" });
  const resultUrl = await uploadResultText(opts.bucketName, opts.taskId, mergedText);
  logger.info("Result uploaded", { phase: "upload", url: resultUrl, taskId: opts.taskId });
  try {
    await updateTranscriptionTask(opts.taskId, { status: "COMPLETED" });
  } catch {}
  if (onProgress) await onProgress({ phase: "upload_done", url: resultUrl });
  return { resultUrl };
}

async function splitMediaIntoChunks(inputPath: string, outDir: string, segmentSeconds: number): Promise<string[]> {
  const pattern = path.join(outDir, "chunk-%05d.mp3");
  const args: string[] = [
    "-hide_banner",
    "-loglevel", "error",
    "-i", inputPath,
    "-vn", // drop video; extract audio only
    "-ac", "1", // mono
    "-ar", "16000", // 16kHz for Whisper efficiency
    "-f", "segment",
    "-segment_time", String(segmentSeconds),
    "-c:a", "libmp3lame",
    pattern,
  ];
  await runFfmpeg(args);
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


