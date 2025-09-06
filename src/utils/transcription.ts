import fs from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import OpenAI from "openai";
import supabase from "../db/supabaseClient";
import logger from "./logger";
import { uploadErrorReport, type TranscriptionPhase } from "./transcriptionDiagnostics";

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

/**
 * Transcribes a media file using Whisper with automatic language detection (supports Chinese),
 * and uploads the transcription as text to the Supabase bucket.
 */
export async function transcribeMediaWithOpenAI(
  client: OpenAI,
  opts: TranscribeOptions
): Promise<{ resultUrl: string; openaiTaskId?: string }> {
  if (!opts.mediaUrl) {
    throw new Error("mediaUrl is required");
  }

  const tempPath = await downloadToTempFile(opts.mediaUrl);
  try {
    logger.info("Starting Whisper transcription", { phase: "transcribe", taskId: opts.taskId });
    const fileStream = fs.createReadStream(tempPath);

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

    const t0 = Date.now();
    const transcription = await withTimeout(
      client.audio.transcriptions.create({
        model: "whisper-1",
        file: fileStream,
        // language omitted => auto-detect, supports Chinese
        response_format: "text",
        temperature: 0,
      }),
      180_000
    );
    const transcribeMs = Date.now() - t0;

    const text = (typeof transcription === "string") ? transcription : (transcription as { text?: string }).text ?? "";
    if (text.length === 0) {
      throw new Error("Transcription returned empty text");
    }
    logger.info("Whisper finished", { phase: "transcribe", taskId: opts.taskId, chars: text.length, transcribeMs });

    const resultUrl = await uploadResultText(opts.bucketName, opts.taskId, text);
    logger.info("Result uploaded", { phase: "upload", url: resultUrl, taskId: opts.taskId });
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
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
      logger.info("Cleaned up temp file", { phase: "download", tempFilePath: tempPath });
    }
  }
}


