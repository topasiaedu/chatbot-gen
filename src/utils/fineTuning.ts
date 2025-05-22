import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { updateBot } from "../db/bot";
import supabase from "../db/supabaseClient";
import { validateJsonlFile } from "./generateDatasets";

export interface FineTuningProgress {
  status: string;
  progress: number;
  startedAt: string;
  finishedAt?: string;
  modelId?: string;
  latestEvent?: string;
  error?: string;
}

// Progress breakdown (0-100%):
// 0-10%: Processing files to text
// 10-25%: Generating dataset
// 25-35%: Dataset compilation and upload to OpenAI
// 35-40%: OpenAI file validation
// 40-45%: Queued for training
// 45-95%: Fine-tuning running
// 95-100%: Finalizing model

export async function fineTuneModel(client: OpenAI, botId?: string, modelId: string = "default") {
  if (!client) {
    throw new Error("OpenAI client is not defined");
  }

  // Use the dataset from the local path with model-specific filename
  const datasetPath = path.join(
    __dirname,
    "..",
    "..",
    "dist",
    "datasets",
    `${modelId}_dataset.jsonl`
  );

  try {
    // Update bot status to processing files (if botId is provided)
    if (botId) {
      await updateBot(botId, {
        status: "processing_files",
        progress: 5,
        description: "Processing files to text format",
      });
    }

    // Simulate or actual file processing step would happen here
    // ...

    // Update status to generating dataset
    if (botId) {
      await updateBot(botId, {
        status: "generating_dataset",
        progress: 15,
        description: "Generating training dataset from processed files",
      });
    }

    // Simulate or actual dataset generation would happen here
    // ...

    // Update status to compiling dataset
    if (botId) {
      await updateBot(botId, {
        status: "compiling_dataset",
        progress: 25,
        description: "Compiling dataset for upload to OpenAI",
      });
    }

    // Check if the dataset file exists
    if (!fs.existsSync(datasetPath)) {
      throw new Error(`Dataset file not found at path: ${datasetPath}`);
    }

    // Verify file size and content
    const stats = fs.statSync(datasetPath);
    if (stats.size === 0) {
      throw new Error("Dataset file is empty");
    }

    // Verify file content is valid JSONL by reading a few lines
    const sampleContent = fs.readFileSync(datasetPath, "utf8").slice(0, 1000);
    const lines = sampleContent.split("\n").filter(line => line.trim().length > 0);
    if (lines.length === 0) {
      throw new Error("Dataset file does not contain valid JSONL data");
    }
    
    try {
      // Try parsing the first line to validate JSON
      JSON.parse(lines[0]);
    } catch (error) {
      throw new Error(`Dataset file contains invalid JSON: ${(error as Error).message}`);
    }

    // Perform full JSONL validation
    console.log("Validating JSONL file format...");
    const isValid = validateJsonlFile(datasetPath);
    if (!isValid) {
      throw new Error("Dataset file failed validation. Please check the format and try again.");
    }

    console.log(`Uploading dataset from ${datasetPath} (${stats.size} bytes)`);

    // Update bot status to uploading dataset
    if (botId) {
      await updateBot(botId, {
        status: "uploading_dataset",
        progress: 30,
        description: "Uploading dataset to OpenAI",
      });
    }

    // Step 1: Upload the file to OpenAI and get the file ID
    const fileUploadResponse = await client.files.create({
      file: fs.createReadStream(datasetPath),
      purpose: "fine-tune",
    });
    
    const fileId = fileUploadResponse.id;

    // Update bot status to starting fine-tuning
    if (botId) {
      await updateBot(botId, {
        status: "starting_finetune",
        progress: 35,
        description: "Starting fine-tuning process with OpenAI",
      });
    }

    // Generate a unique fine-tuning job name
    const uniqueJobName = botId 
      ? `bot-${botId}-finetune-${Date.now()}` 
      : `standalone-finetune-${Date.now()}`;

    // Step 2: Use the file ID to create a fine-tuning job
    const fineTune = await client.fineTuning.jobs.create({
      training_file: fileId,
      model: "gpt-4o-mini-2024-07-18",
      suffix: uniqueJobName // Adds a unique suffix to ensure a new model is created
    });

    // Update bot with job ID and in-progress status
    if (botId) {
      await updateBot(botId, {
        status: "in_progress",
        progress: 40,
        description: "Fine-tuning job submitted and in progress",
      });
      
      // Start tracking progress only if we have a botId
      trackFineTuningProgress(client, fineTune.id, botId);
    }
  
    return fineTune;
  } catch (error) {
    console.error("Error during fine-tuning process:", (error as Error).message);
    
    // Update bot with error status (if botId is provided)
    if (botId) {
      await updateBot(botId, {
        status: "failed",
        progress: 0,
        description: `Fine-tuning failed: ${(error as Error).message}`,
      });
    }
    
    throw error;
  }
}

async function trackFineTuningProgress(client: OpenAI, jobId: string, botId: string): Promise<void> {
  // Set up interval to check progress
  const checkInterval = setInterval(async () => {
    try {
      // Get the latest job status
      const job = await client.fineTuning.jobs.retrieve(jobId);
      
      // Calculate progress percentage based on job status
      let progress = 40; // Starting progress
      let description = "";
      
      switch (job.status) {
        case "validating_files":
          progress = 40;
          description = "OpenAI is validating the training files";
          break;
        case "queued":
          progress = 45;
          description = "Job is queued for training";
          break;
        case "running":
          // For running status, estimate progress based on available metrics
          const trainedTokens = (job as any).trained_tokens as number | undefined;
          const totalTokens = (job as any).training_file_size_tokens as number | undefined;
          
          if (trainedTokens && totalTokens) {
            // Scale the progress from 45% to 95% based on training progress
            const trainingProgress = Math.min(
              Math.round((trainedTokens / totalTokens) * 50) + 45,
              95
            );
            progress = trainingProgress;
          } else {
            progress = 70; // Default mid-point progress for running status
          }
          description = "Fine-tuning model in progress";
          break;
        case "succeeded":
          progress = 95;
          description = "Fine-tuning completed, finalizing model";
          
          // Store the model ID in a bot_models entry
          if (job.fine_tuned_model) {
            try {
              // Create a new bot model entry
              const { data: newModel, error } = await supabase
                .from("bot_models")
                .insert({
                  bot_id: botId,
                  open_ai_id: job.fine_tuned_model,
                  version: `v${Date.now()}`,
                })
                .select("*")
                .single();
              
              if (error) {
                throw new Error(`Failed to create bot model: ${error.message}`);
              }
              
              // Set the new model as the active version using its ID
              await updateBot(botId, {
                active_version: newModel.id,
                status: "completed",
                progress: 100,
                description: "Fine-tuning completed successfully. Model is ready to use.",
              });
            } catch (error) {
              console.error("Error saving fine-tuned model:", (error as Error).message);
            }
          }
          
          clearInterval(checkInterval); // Stop checking when complete
          return;
        case "failed":
          clearInterval(checkInterval); // Stop checking when failed
          
          // Update with failed status
          await updateBot(botId, {
            status: "failed",
            progress: 0,
            description: `Fine-tuning failed: ${job.error?.message || "Unknown error"}`,
          });
          return;
        case "cancelled":
          clearInterval(checkInterval); // Stop checking when cancelled
          
          // Update with cancelled status
          await updateBot(botId, {
            status: "cancelled",
            progress: 0,
            description: "Fine-tuning job was cancelled",
          });
          return;
      }
      
      // Get the latest events for more detailed progress information
      const events = await client.fineTuning.jobs.listEvents(jobId);
      const latestEvent = events.data[0];
      
      // Update bot with current progress and latest event message
      await updateBot(botId, {
        status: job.status,
        progress: progress,
        description: description || latestEvent?.message || `Fine-tuning in progress: ${job.status}`,
      });
      
    } catch (error) {
      console.error("Error tracking fine-tuning progress:", (error as Error).message);
      
      // If we can't check progress, we should stop trying after some attempts
      // This is simplified - you might want to add retry logic
      clearInterval(checkInterval);
    }
  }, 60000); // Check every minute
  
  // Set a timeout to stop checking after 24 hours as a safety measure
  setTimeout(() => {
    clearInterval(checkInterval);
  }, 24 * 60 * 60 * 1000);
}
