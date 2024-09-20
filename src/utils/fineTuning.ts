import OpenAI from "openai";
import fs from "fs";
import path from "path";

export async function fineTuneModel(client: OpenAI) {
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
    const fileUploadResponse = await client.files.create({
      file: datasetStream,
      purpose: 'fine-tune',
    });
    
    const fileId = fileUploadResponse.id;

    // Generate a unique fine-tuning job name (or use a different parameter)
    const uniqueJobName = `my-custom-finetune-${Date.now()}}`;

    // Step 2: Use the file ID to create a fine-tuning job
    const fineTune = await client.fineTuning.jobs.create({
      training_file: fileId,
      model: "gpt-3.5-turbo",
      suffix: uniqueJobName // Adds a unique suffix to ensure a new model is created
    });
  
    return fineTune;
  } catch (error) {
    console.error('Error during fine-tuning process:', (error as any).response?.data || (error as any).message);
    throw error;
  }
}
