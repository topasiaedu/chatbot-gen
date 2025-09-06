import supabase from "../db/supabaseClient";

export type TranscriptionPhase = "download" | "transcribe" | "upload" | "update";

export interface ErrorReport {
  taskId: string;
  phase: TranscriptionPhase;
  message: string;
  name: string;
  code?: string;
  httpStatus?: number;
  timings?: Record<string, number>;
  mediaUrl?: string;
  fileBytes?: number;
  openaiInfo?: { model?: string; requestId?: string };
  serverVersion?: string;
  createdAtIso: string;
}

export async function uploadErrorReport(
  bucketName: string,
  report: ErrorReport
): Promise<string> {
  const timestamp: string = new Date().toISOString().replace(/[:.]/g, "-");
  const path: string = `errors/${report.taskId}-${timestamp}.json`;
  const payload: Buffer = Buffer.from(JSON.stringify(report, null, 2), "utf8");

  const { error } = await supabase.storage.from(bucketName).upload(path, payload, {
    upsert: true,
    contentType: "application/json",
  });
  if (error) {
    throw new Error(`Failed to upload error report: ${error.message}`);
  }
  const { data } = supabase.storage.from(bucketName).getPublicUrl(path);
  return data.publicUrl;
}


