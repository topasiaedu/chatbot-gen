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
  mediaUrl: string;
};

export type TranscriptionProgress =
  | { phase: "download_start" }
  | { phase: "download_done" }
  | { phase: "transcribe_start" }
  | { phase: "transcribe_done"; ms: number; chars: number }
  | { phase: "upload_start" }
  | { phase: "upload_done"; url: string };

/**
 * Transcribes a media file using Whisper with automatic language detection (supports Chinese),
 * and uploads the transcription as text to the Supabase bucket.
 */
export async function transcribeMediaWithOpenAI(
  client: OpenAI,
  opts: TranscribeOptions,
  onProgress?: (p: TranscriptionProgress) => Promise<void> | void
): Promise<{ resultUrl: string; openaiTaskId?: string }> {
  if (!opts.mediaUrl) {
    throw new Error("mediaUrl is required");
  }

  if (onProgress) await onProgress({ phase: "download_start" });
  const tempPath = await downloadToTempFile(opts.mediaUrl);
  const tempDir = path.join(os.tmpdir(), `chunks-${opts.taskId}-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  try {
    if (onProgress) await onProgress({ phase: "download_done" });
    // Segment media (audio or video) into 60s chunks and transcode to mono 16kHz mp3 for consistency
    const segmentSeconds: number = Number.parseInt(process.env.CHUNK_DURATION_SECONDS || "60", 10);
    const chunkPaths = await splitMediaIntoChunks(tempPath, tempDir, segmentSeconds);
    const totalChunks = chunkPaths.length;
    if (totalChunks === 0) {
      throw new Error("No chunks produced by ffmpeg");
    }

    // Initialize progress
    try {
      await updateTranscriptionTask(opts.taskId, { status: "PROCESSING", progress: `0/${totalChunks}` });
    } catch {}

    // Concurrency-limited processing
    const concurrency: number = Math.max(1, Number.parseInt(process.env.CHUNK_CONCURRENCY || "3", 10));
    const results: string[] = new Array(totalChunks).fill("");
    let completed = 0;

    const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
      return new Promise<T>((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error("TRANSCRIBE_TIMEOUT")), ms);
        promise.then(
          (value) => {
            clearTimeout(timeoutId);
            resolve(value);
          },
          (err) => {
            clearTimeout(timeoutId);
            reject(err);
          }
        );
      });
    };

    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const i = nextIndex;
        nextIndex += 1;
        if (i >= totalChunks) return;
        const chunkPath = chunkPaths[i];
        logger.info("Transcribing chunk", { taskId: opts.taskId, index: i + 1, total: totalChunks });
        const fileStream = fs.createReadStream(chunkPath);
        const transcription = await withTimeout(
          client.audio.transcriptions.create({
            model: "whisper-1",
            file: fileStream,
            response_format: "text",
            temperature: 0,
          }),
          Number.parseInt(process.env.TRANSCRIBE_TIMEOUT_MS || "900000", 10)
        );
        const text = (typeof transcription === "string") ? transcription : (transcription as { text?: string }).text ?? "";
        results[i] = text;
        completed += 1;
        const progressStr = `${completed}/${totalChunks}`;
        try {
          await updateTranscriptionTask(opts.taskId, { progress: progressStr, status: completed === totalChunks ? "PROCESSING:UPLOADING" : "PROCESSING:TRANSCRIBING" });
        } catch {}
      }
    };

    const workers: Promise<void>[] = [];
    for (let w = 0; w < Math.min(concurrency, totalChunks); w += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);

    const mergedText = results.join("\n\n");
    if (mergedText.trim().length === 0) {
      throw new Error("Merged transcription is empty");
    }

    if (onProgress) await onProgress({ phase: "upload_start" });
    const resultUrl = await uploadResultText(opts.bucketName, opts.taskId, mergedText);
    logger.info("Result uploaded", { phase: "upload", url: resultUrl, taskId: opts.taskId });
    try {
      await updateTranscriptionTask(opts.taskId, { progress: `${totalChunks}/${totalChunks}`, status: "COMPLETED" });
    } catch {}
    if (onProgress) await onProgress({ phase: "upload_done", url: resultUrl });
    return { resultUrl };
  } catch (error) {
    const err = error as Error;
    try {
      await uploadErrorReport(opts.bucketName, {
        taskId: opts.taskId,
        phase: "transcribe",
        message: err.message,
        name: err.name,
        serverVersion: process.env.npm_package_version,
        createdAtIso: new Date().toISOString(),
      });
    } catch (uploadErr) {
      logger.error("Failed to upload error report", { taskId: opts.taskId }, uploadErr as Error);
    }
    logger.error("Transcription failed", { taskId: opts.taskId }, err);
    throw err;
  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        for (const f of files) {
          const p = path.join(tempDir, f);
          try { fs.unlinkSync(p); } catch {}
        }
        try { fs.rmdirSync(tempDir); } catch {}
      }
    } catch {}
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch {}
      logger.info("Cleaned up temp file", { phase: "download", tempFilePath: tempPath });
    }
  }
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


