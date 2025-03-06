import OpenAI from "openai";
import { extractTextFromFileUrl } from "./files";
import { encode } from "gpt-3-encoder"; // Import the GPT-3 encoder to handle token counting
const fs = require("fs");

function writeJSONLToFile(jsonArray: any[], filePath: string) {
  const jsonlData = jsonArray
    .map((entry: any) => JSON.stringify(entry)) // Convert each object to a JSON string
    .join("\n"); // Join them with newlines to form valid JSONL

  // Append the JSONL data to the file instead of overwriting it
  fs.appendFileSync(filePath, jsonlData + "\n", "utf8");
}

function convertToJSON(responseString: string): { prompt: string; completion: string }[] {
  const jsonlData = responseString
    .split("Prompt:")
    .filter(Boolean)
    .map((entry) => {
      const [prompt, completion] = entry.split("Completion:");
      if (!prompt || !completion || prompt.trim().length < 10 || completion.trim().length < 10) {
        return null;
      }
      return { prompt: prompt.trim(), completion: completion.trim() };
    })
    .filter((entry): entry is { prompt: string; completion: string } => entry !== null);

  return jsonlData;
}

function convertJSONToJSONL(jsonArray: { prompt: string; completion: string }[]): string {
  return jsonArray
    .map((entry) => {
      const cleanedPrompt = entry.prompt.replace(/\\n/g, "\n").replace(/\\"/g, '"');
      const cleanedCompletion = entry.completion.replace(/\\n/g, "\n").replace(/\\"/g, '"');
      return JSON.stringify({ prompt: cleanedPrompt, completion: cleanedCompletion });
    })
    .join("\n");
}

// Helper function to split text into smaller chunks (500 tokens instead of 1000)
function splitTextIntoChunks(text: string, tokensPerChunk: number = 500): string[] {
  const encoded = encode(text);
  const chunks = [];
  for (let i = 0; i < encoded.length; i += tokensPerChunk) {
    const chunkTokens = encoded.slice(i, i + tokensPerChunk);
    const chunkText = decodeTokens(chunkTokens);
    chunks.push(chunkText);
  }
  return chunks;
}

// Simple token decoder placeholder (modify based on encoding method)
function decodeTokens(tokens: number[]): string {
  return tokens.join(" "); // Adjust decoding logic if necessary
}

async function generateDataForChunk(
  client: OpenAI,
  textChunk: string,
  summary: string,
  maxIterations: number = 1
): Promise<string> {
  let allDataSets = "";
  let remainingText = textChunk;
  let previousData = "";
  let iterationCount = 0;

  while (remainingText.trim() && iterationCount < maxIterations) {
    console.log("Processing chunk iteration:", iterationCount + 1);

    try {
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an AI that generates fine-tuning datasets for training language models. 
                      Summary: ${summary}
                      Format: {Prompt: ... Completion: ...}`,
          },
          {
            role: "user",
            content: remainingText,
          },
        ],
        max_tokens: 4096, // Reduced from 16384 to prevent memory overuse
      });

      const newData = completion.choices[0].message.content;

      // Stop processing if newData is empty or too similar to previous data
      if (!newData || newData === previousData || newData.trim().length < 50) {
        console.log("No significant new data generated, stopping...");
        break;
      }

      allDataSets += newData;
      previousData = newData;
      iterationCount++; // Prevent infinite loops
    } catch (error) {
      console.error("Error generating additional dataset:", (error as any).message);
      throw error;
    }
  }

  return allDataSets;
}

export async function generateDataSetsInChunks(
  client: OpenAI,
  fileUrl: string,
  trainingBreadth: number = 500, // Reduced chunk size from 1000 to 500
  trainingDepth: number = 1
): Promise<string> {
  const extractedText = await extractTextFromFileUrl(fileUrl);
  console.log("Extracted text length:", extractedText.length);

  const textChunks = splitTextIntoChunks(extractedText, trainingBreadth);
  console.log("Total chunks:", textChunks.length);
  
  const filePath = "./dist/datasets/generated_dataset.jsonl"; // File path for output
  fs.writeFileSync(filePath, ""); // Clear file before writing

  const classificationResponse = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Classify the document and generate a summary for a child.`,
      },
      {
        role: "user",
        content: extractedText,
      },
    ],
    max_tokens: 1024,
  });

  const classification = classificationResponse.choices[0].message.content;
  console.log("Classification:", classification);

  if (!classification) {
    throw new Error("Failed to classify the document type");
  }

  let chunkIndex = 0;
  const totalChunks = textChunks.length;

  for (const chunk of textChunks) {
    chunkIndex++;
    console.log("Processing chunk index:", chunkIndex, "of", totalChunks);

    const chunkData = await generateDataForChunk(client, chunk, classification, trainingDepth);

    if (chunkData.length > 0) {
      const jsonData = convertToJSON(chunkData);
      const jsonlData = convertJSONToJSONL(jsonData);
      writeJSONLToFile(jsonData, filePath); // Write each chunk immediately
    }
  }

  console.log("Dataset processing complete. Check:", filePath);
  return filePath;
}
