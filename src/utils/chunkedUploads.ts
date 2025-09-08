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
import { splitMediaIntoChunks } from "./transcription";

export interface CompletionInfo {
  expected: number | null;
  received: number;
  complete: boolean;
  presentIndices?: number[];
  missingIndices?: number[];
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
  // Prefer explicit total_chunks if present in rows
  let expected: number | null = null;
  for (const f of files) {
    if (typeof f.total_chunks === "number" && Number.isFinite(f.total_chunks) && f.total_chunks > 0) {
      expected = Math.max(expected ?? 0, f.total_chunks);
    }
  }

  if (expected === null) {
    // If clients failed to set total_chunks, infer from max chunk_index + 1
    let maxIndex = -1;
    for (const f of files) {
      if (typeof f.chunk_index === "number" && Number.isFinite(f.chunk_index)) {
        maxIndex = Math.max(maxIndex, f.chunk_index);
      }
    }
    if (maxIndex >= 0) {
      expected = maxIndex + 1;
    }
  }

  if (expected === null) {
    // As last resort, if we have chunks but no expected figure, assume complete
    return { expected: received, received, complete: received > 0, presentIndices: [], missingIndices: [] };
  }

  // If chunk_index is available, ensure all indices from 0..expected-1 are present
  const seen = new Set<number>();
  for (const f of files) {
    if (typeof f.chunk_index === "number" && Number.isFinite(f.chunk_index)) {
      seen.add(f.chunk_index);
    }
  }
  let hasAll = true;
  const missing: number[] = [];
  for (let i = 0; i < expected; i += 1) {
    if (!seen.has(i)) { hasAll = false; missing.push(i); }
  }

  const complete: boolean = hasAll && received >= expected;
  return { expected, received, complete, presentIndices: Array.from(seen.values()).sort((a, b) => a - b), missingIndices: missing };
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
  const segDir = path.join(workDir, "segments");
  await fsp.mkdir(workDir, { recursive: true });

  try {
    // Sort by chunk_index when present, else by created_at
    const filesSorted = [...opts.files].sort((a, b) => {
      const ai = typeof a.chunk_index === "number" ? a.chunk_index : Number.POSITIVE_INFINITY;
      const bi = typeof b.chunk_index === "number" ? b.chunk_index : Number.POSITIVE_INFINITY;
      if (Number.isFinite(ai) && Number.isFinite(bi)) return ai - bi;
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

    // Segment merged file into ~60s chunks and transcribe concurrently
    await fsp.mkdir(segDir, { recursive: true });
    const segmentSeconds: number = Number.parseInt(process.env.CHUNK_DURATION_SECONDS || "60", 10);
    const segmentPaths = await splitMediaIntoChunks(outPath, segDir, segmentSeconds);
    if (segmentPaths.length === 0) {
      throw new Error("No segments produced from merged media");
    }

    await updateTranscriptionTask(opts.taskId, { status: "PROCESSING:TRANSCRIBING", progress: `0/${segmentPaths.length} segments` });

    const concurrency: number = Math.max(1, Number.parseInt(process.env.CHUNK_CONCURRENCY || "3", 10));
    const results: string[] = new Array(segmentPaths.length).fill("");
    let completed = 0;

    const workers: Promise<void>[] = [];
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const i = nextIndex;
        nextIndex += 1;
        if (i >= segmentPaths.length) return;
        const seg = segmentPaths[i];
        const fileStream = fs.createReadStream(seg);
        const req: Record<string, unknown> = {
          model: "whisper-1",
          file: fileStream,
          response_format: "text",
          temperature: 0,
        };
        if (typeof opts.language === "string" && opts.language.trim().length > 0) {
          req.language = opts.language;
        }
        const transcription = await client.audio.transcriptions.create(req as never);
        const text = typeof transcription === "string" ? transcription : ((transcription as { text?: string }).text ?? "");
        results[i] = text;
        completed += 1;
        try {
          await updateTranscriptionTask(opts.taskId, { status: completed === segmentPaths.length ? "PROCESSING:UPLOADING" : "PROCESSING:TRANSCRIBING", progress: `${completed}/${segmentPaths.length} segments` });
        } catch {}
      }
    };
    for (let w = 0; w < Math.min(concurrency, segmentPaths.length); w += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);
    const text = results.join("\n\n");
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


