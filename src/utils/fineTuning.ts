import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { updateBot } from "../db/bot";
import supabase from "../db/supabaseClient";

export interface FineTuningProgress {
  status: string;
  progress: number;
  startedAt: string;
  finishedAt?: string;
  modelId?: string;
  latestEvent?: string;
  error?: string;
}

export async function fineTuneModel(client: OpenAI, botId?: string) {
  if (!client) {
    throw new Error("OpenAI client is not defined");
  }

  // Use the dataset from the local path
  const datasetPath = path.join(
    __dirname,
    "..",
    "datasets",
    "generated_dataset.jsonl"
  );

  // Step 1: Upload the file to OpenAI and get the file ID
  const datasetStream = fs.createReadStream(datasetPath);
  
  try {
    // Update bot status to uploading dataset (if botId is provided)
    if (botId) {
      await updateBot(botId, {
        status: "uploading_dataset",
        progress: 0,
      });
    }

    const fileUploadResponse = await client.files.create({
      file: datasetStream,
      purpose: "fine-tune",
    });
    
    const fileId = fileUploadResponse.id;

    // Update bot status to starting fine-tuning (if botId is provided)
    if (botId) {
      await updateBot(botId, {
        status: "starting",
        progress: 10,
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

    // Update bot with job ID and in-progress status (if botId is provided)
    if (botId) {
      await updateBot(botId, {
        status: "in_progress",
        progress: 20,
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
      let progress = 20; // Starting progress
      
      switch (job.status) {
        case "validating_files":
          progress = 30;
          break;
        case "queued":
          progress = 40;
          break;
        case "running":
          // For running status, estimate progress based on available metrics
          // Note: OpenAI API may change, so we're being cautious with property access
          const trainedTokens = (job as any).trained_tokens as number | undefined;
          const totalTokens = (job as any).training_file_size_tokens as number | undefined;
          
          if (trainedTokens && totalTokens) {
            const trainingProgress = Math.min(
              Math.round((trainedTokens / totalTokens) * 60) + 40,
              95
            );
            progress = trainingProgress;
          } else {
            progress = 60; // Default progress for running status
          }
          break;
        case "succeeded":
          progress = 100;
          clearInterval(checkInterval); // Stop checking when complete
          
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
                description: "Fine-tuning completed successfully.",
              });
            } catch (error) {
              console.error("Error saving fine-tuned model:", (error as Error).message);
            }
          }
          
          return;
        case "failed":
          clearInterval(checkInterval); // Stop checking when failed
          
          // Update with failed status
          await updateBot(botId, {
            status: "failed",
            progress: 0,
          });
          return;
        case "cancelled":
          clearInterval(checkInterval); // Stop checking when cancelled
          
          // Update with cancelled status
          await updateBot(botId, {
            status: "cancelled",
            progress: 0,
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
        description: latestEvent?.message || `Fine-tuning in progress: ${job.status}`,
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
