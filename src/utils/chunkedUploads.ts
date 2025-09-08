import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";
import axios from "axios";
import { spawn } from "child_process";
import OpenAI from "openai";
import ffprobeStatic from "ffprobe-static";
import logger from "./logger";
import supabase from "../db/supabaseClient";
import { updateTranscriptionTask, type TranscriptionFile } from "../db/transcription";

export interface CompletionInfo {
  expected: number | null;
  received: number;
  complete: boolean;
}

export interface FfprobeAudioStreamInfo {
  codecName: string;
  sampleRateHz: number | null;
  channels: number | null;
  durationSeconds: number | null;
}

export interface AssembleAndTranscribeOptions {
  bucketName: string;
  taskId: string;
  language: string | null | undefined;
  files: TranscriptionFile[];
}

/**
 * Detects whether all chunks have been uploaded for a task using the files' chunk_count metadata.
 * Accepts various string formats (e.g., "8", "8/8", "of 8").
 */
export function detectUploadCompletion(files: TranscriptionFile[]): CompletionInfo {
  const received: number = files.length;
  let expected: number | null = null;

  for (const f of files) {
    const raw: string | null = typeof f.chunk_count === "string" ? f.chunk_count : null;
    if (raw && raw.trim().length > 0) {
      const matches = raw.match(/(\d+)/g);
      if (Array.isArray(matches) && matches.length > 0) {
        const last = Number.parseInt(matches[matches.length - 1] ?? "", 10);
        if (Number.isFinite(last) && last > 0) {
          expected = Math.max(expected ?? 0, last);
        }
      }
    }
  }

  const complete: boolean = expected !== null ? received >= expected : false;
  return { expected, received, complete };
}

/**
 * Downloads the given public URLs to a directory in order and returns local paths.
 * Ensures each downloaded file is > 0 bytes.
 */
export async function downloadChunksOrdered(urls: string[], outDir: string): Promise<string[]> {
  await fsp.mkdir(outDir, { recursive: true });
  const results: string[] = [];

  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    const name = `part-${String(i).padStart(5, "0")}.m4a`;
    const destPath = path.join(outDir, name);

    const response = await axios({ url, method: "GET", responseType: "stream", timeout: 120_000, validateStatus: (s) => s >= 200 && s < 400 });
    await new Promise<void>((resolve, reject) => {
      const w = fs.createWriteStream(destPath);
      response.data.on("error", (e: unknown) => reject(e as Error));
      w.on("error", (e) => reject(e));
      w.on("finish", () => resolve());
      response.data.pipe(w);
    });

    const stat = await fsp.stat(destPath);
    if (!stat.isFile() || stat.size <= 0) {
      throw new Error(`Downloaded chunk is empty: index=${i}`);
    }
    results.push(destPath);
  }
  return results;
}

/**
 * Concatenates chunk files via sequential streaming (binary cat) into the output path.
 * Returns total bytes written.
 */
export async function concatenateChunksBinary(inputPaths: string[], outputPath: string): Promise<number> {
  if (inputPaths.length === 0) {
    throw new Error("No input chunks to concatenate");
  }

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  const out = fs.createWriteStream(outputPath);

  let total = 0;
  for (let i = 0; i < inputPaths.length; i += 1) {
    const p = inputPaths[i];
    const st = await fsp.stat(p);
    if (!st.isFile() || st.size <= 0) {
      throw new Error(`Chunk file is empty or not a file: index=${i}`);
    }
    await new Promise<void>((resolve, reject) => {
      const r = fs.createReadStream(p);
      r.on("error", (e) => reject(e));
      out.on("error", (e) => reject(e));
      r.on("end", () => { total += st.size; resolve(); });
      r.pipe(out, { end: false });
    });
  }
  await new Promise<void>((resolve, reject) => {
    out.end(() => resolve());
    out.on("error", (e) => reject(e));
  });
  return total;
}

/**
 * Runs ffprobe to validate that the file has at least one audio stream.
 */
export async function validateWithFfprobe(filePath: string): Promise<FfprobeAudioStreamInfo> {
  const bin: string = (ffprobeStatic.path as unknown as string) || "ffprobe";
  const args: string[] = [
    "-hide_banner",
    "-loglevel", "error",
    "-print_format", "json",
    "-show_streams",
    "-select_streams", "a",
    filePath,
  ];

  const { stdout } = await runChild(bin, args);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    throw new Error("ffprobe returned non-JSON output");
  }
  const obj = parsed as { streams?: Array<Record<string, unknown>> };
  const streams = Array.isArray(obj.streams) ? obj.streams : [];
  if (streams.length === 0) {
    throw new Error("No audio streams detected by ffprobe");
  }

  const s = streams[0] ?? {};
  const codecName = typeof s["codec_name"] === "string" ? (s["codec_name"] as string) : "";
  const sampleRateHz = typeof s["sample_rate"] === "string" ? Number.parseInt(s["sample_rate"] as string, 10) : null;
  const channels = typeof s["channels"] === "number" ? (s["channels"] as number) : null;
  const durationSeconds = typeof s["duration"] === "string" ? Number.parseFloat(s["duration"] as string) : null;
  return { codecName, sampleRateHz, channels, durationSeconds };
}

/**
 * Assembles chunked m4a bytes via binary concatenation, validates with ffprobe, then transcribes with Whisper.
 * Uploads the resulting text to the bucket and updates the task status on success.
 */
export async function assembleAndTranscribeM4a(
  client: OpenAI,
  opts: AssembleAndTranscribeOptions
): Promise<{ resultUrl: string }> {
  const workDir = path.join(os.tmpdir(), `chunks-${opts.taskId}-${Date.now()}`);
  const dlDir = path.join(workDir, "dl");
  const outPath = path.join(workDir, "merged.m4a");
  await fsp.mkdir(workDir, { recursive: true });

  try {
    // Sort files by created_at to preserve order
    const filesSorted = [...opts.files].sort((a, b) => {
      const at = a.created_at ?? "";
      const bt = b.created_at ?? "";
      return at.localeCompare(bt);
    });
    const urls: string[] = filesSorted
      .map((f) => (typeof f.media_url === "string" ? f.media_url : null))
      .filter((u): u is string => typeof u === "string");

    // Download all chunks
    const local = await downloadChunksOrdered(urls, dlDir);

    // Binary concatenate
    const totalBytes = await concatenateChunksBinary(local, outPath);
    if (totalBytes <= 0) {
      throw new Error("Merged file is empty after concatenation");
    }

    // Validate merged file has audio stream
    const info = await validateWithFfprobe(outPath);
    logger.info("ffprobe validation passed", {
      taskId: opts.taskId,
      codec: info.codecName,
      sampleRateHz: info.sampleRateHz ?? 0,
      channels: info.channels ?? 0,
      durationSeconds: info.durationSeconds ?? 0,
    });

    // Transcribe merged file directly (no segmentation to preserve simplicity)
    await updateTranscriptionTask(opts.taskId, { status: "PROCESSING:TRANSCRIBING", progress: null });
    const readStream = fs.createReadStream(outPath);
    const req: Record<string, unknown> = {
      model: "whisper-1",
      file: readStream,
      response_format: "text",
      temperature: 0,
    };
    if (typeof opts.language === "string" && opts.language.trim().length > 0) {
      req.language = opts.language;
    }
    const transcription = await client.audio.transcriptions.create(req as never);
    const text = typeof transcription === "string"
      ? transcription
      : ((transcription as { text?: string }).text ?? "");

    if (text.trim().length === 0) {
      throw new Error("Transcription result is empty");
    }

    // Upload transcription text
    const filePathInBucket = `result/${opts.taskId}.txt`;
    const { error } = await supabase.storage.from(opts.bucketName).upload(
      filePathInBucket,
      Buffer.from(text, "utf8"),
      { upsert: true, contentType: "text/plain" }
    );
    if (error) {
      throw new Error(`Failed to upload transcription result: ${error.message}`);
    }
    const { data: publicUrl } = supabase.storage.from(opts.bucketName).getPublicUrl(filePathInBucket);
    await updateTranscriptionTask(opts.taskId, { status: "COMPLETED", result_url: publicUrl.publicUrl });
    return { resultUrl: publicUrl.publicUrl };
  } finally {
    // Best-effort local cleanup
    try {
      if (fs.existsSync(workDir)) {
        await fsp.rm(workDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }
}

async function runChild(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (e) => reject(e));
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Process exited with code ${code}: ${stderr}`));
    });
  });
}


