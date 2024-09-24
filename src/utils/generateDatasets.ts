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

  // Write the JSONL data to a file
  // fs.writeFileSync(filePath, jsonlData, "utf8");
}
// Helper function to convert the returned string into JSONL format
function convertToJSON(responseString: string): {
  prompt: string;
  completion: string;
}[] {
  const jsonlData = responseString
    .split("Prompt:") // Split based on the "Prompt:" keyword
    .filter(Boolean) // Remove any empty results from splitting
    .map((entry) => {
      const [prompt, completion] = entry.split("Completion:");

      // Skip if prompt or completion is empty or less than 10 characters
      if (
        !prompt ||
        !completion ||
        prompt.trim().length < 10 ||
        completion.trim().length < 10
      ) {
        return null;
      }

      return {
        prompt: prompt.trim(),
        completion: completion.trim(), // No need for additional check since you already filter
      };
    })
    // Type guard to ensure TypeScript understands 'null' is being filtered out
    .filter(
      (entry): entry is { prompt: string; completion: string } => entry !== null
    );

  return jsonlData;
}

function convertJSONToJSONL(
  jsonArray: { prompt: string; completion: string }[]
): string {
  return jsonArray
    .map((entry) => {
      // Make sure to manually stringify each value without adding unnecessary escape characters
      const cleanedPrompt = entry.prompt
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"');
      const cleanedCompletion = entry.completion
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"');
      return JSON.stringify({
        prompt: cleanedPrompt,
        completion: cleanedCompletion,
      });
    })
    .join("\n"); // Join each string with a newline character for valid JSONL format
}

function convertToJSONL(responseString: string): string {
  const jsonlData = responseString
    // Split based on "Prompt:" but also handle multiple cases where invalid JSON parts might be mixed
    .split("Prompt:")
    .filter(Boolean) // Remove any empty results from splitting
    .map((entry) => {
      // Clean up any leftover invalid placeholders or escaped sequences (like extra \ or {\"})
      const cleanedEntry = entry
        .replace(/\\n|\\{\\}|\\}/g, "") // Remove escaped newlines and invalid placeholders
        .trim();

      // Split on "Completion:" and create prompt/completion pairs
      const [prompt, completion] = cleanedEntry.split("Completion:");

      // Skip if prompt or completion is empty or less than 10 characters
      if (
        !prompt ||
        !completion ||
        prompt.trim().length < 10 ||
        completion.trim().length < 10
      ) {
        return null;
      }

      // Create a valid JSON object for each entry
      return {
        prompt: prompt.trim(),
        completion: completion.trim(),
      };
    })
    // Filter out null values from invalid or incomplete entries
    .filter(
      (entry): entry is { prompt: string; completion: string } => entry !== null
    )
    // Convert each object to a JSON string for JSONL format
    .map((entry) => JSON.stringify(entry));

  // Join all JSON strings with newline characters to create JSONL output
  return jsonlData.join("\n");
}

// Helper function to split text into chunks of 1,000 tokens
function splitTextIntoChunks(
  text: string,
  tokensPerChunk: number = 1000
): string[] {
  const encoded = encode(text); // Encode the text into tokens
  const chunks = [];

  for (let i = 0; i < encoded.length; i += tokensPerChunk) {
    const chunkTokens = encoded.slice(i, i + tokensPerChunk);
    const chunkText = decodeTokens(chunkTokens); // Convert token array back to string
    chunks.push(chunkText);
  }

  return chunks;
}

// Helper function to decode tokens back to string (not provided in gpt-3-encoder, implement a simple decoder if needed)
function decodeTokens(tokens: number[]): string {
  // Implement a basic token decoder (or use any appropriate library to decode tokens back to string)
  // This is just a placeholder, adjust based on how you're encoding tokens
  return tokens.join(" "); // Assuming simple decoding back to text, replace with proper decoding logic if necessary
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
    const remainingTokens = encode(remainingText).length;
    console.log(
      "Processing chunk iteration:",
      iterationCount + 1,
      "Remaining tokens:",
      remainingTokens
    );

    try {
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an AI that generates fine-tuning datasets for training language models. 

                    You are provided with a document that needs to be processed to generate prompts and completions for training data.

                    Summary: ${summary}
                    
                     The input text you receive can vary widely in content, including technical documents with structured data like error codes, and unstructured content such as notes or articles.
          
                     Your task is to carefully read through the provided text and generate high-quality prompts and completions that are contextually relevant to the content. For example:
                     - If the document contains structured data like error codes, create prompts asking about the error codes and their meanings, causes, or resolutions.
                     - For technical or instructional documents, generate prompts that focus on key concepts, definitions, or explanations.
                     - For general unstructured documents, create prompts that ask questions about the main points or key pieces of information.
          
                     When generating the prompts:
                     - Be specific to the document's structure, asking questions about the particular content (e.g., 'What does error code X/Y/Z/T mean?').
                     - Ensure that prompts are contextually relevant to the type of document (e.g., 'Explain the retry process in SMS 365 error handling' for a document on SMS errors).
                     - Avoid generating vague or irrelevant prompts (e.g., do not ask about random numbers unless they are part of the content's meaning).
                     - Format it in {Prompt: ... Completion: ...} format.
          
                     When generating completions:
                     - Provide concise and accurate responses based on the information in the document.
                     - If there is missing or unclear data in the document, note that in the completion (e.g., 'The document does not provide detailed information about this error code').`,
          },
          {
            role: "user",
            content: remainingText,
          },
        ],
        max_tokens: 16384, // Adjust based on token limits
      });

      const newData = completion.choices[0].message.content;

      // If no new data is generated or it's too similar to previous data, stop processing this chunk
      if (!newData || newData === previousData || newData.trim().length < 50) {
        console.log("No significant new data generated, stopping...");
        break;
      }

      allDataSets += newData; // Add new data to the final dataset
      previousData = newData; // Track previous data to detect repetition

      // // Calculate the token length of newData and slice remainingText accordingly
      // const newDataTokens = encode(newData).length;
      // remainingText = encode(remainingText).slice(newDataTokens).join(" "); // Slice by token count

      iterationCount++; // Track the number of iterations
    } catch (error) {
      console.error(
        "Error generating additional dataset:",
        (error as any).message
      );
      throw error;
    }
  }

  return allDataSets; // Return generated data for the chunk
}

// Main function to process the document by splitting it into chunks
export async function generateDataSetsInChunks(
  client: OpenAI,
  fileUrl: string,
  trainingBreadth: number = 1000,
  trainingDepth: number = 1
): Promise<string> {
  const extractedText = await extractTextFromFileUrl(fileUrl); // Extract full document text
  console.log("Extracted text length:", extractedText.length);
  const textChunks = splitTextIntoChunks(extractedText, trainingBreadth); // Split the text into 1k token chunks
  console.log("Total chunks:", textChunks.length);
  let allDataSets = "";

  const classificationResponse = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are tasked with classifying the document type based on the content provided. 
                  
                  Based on the classification, describe the document type briefly. And generate a summary of the document content. so that a kid can understand it easily.`,
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

  for (const chunk of textChunks) {
    console.log("Processing chunk:", chunk.length);
    const chunkData = await generateDataForChunk(client, chunk, classification, trainingDepth); // Process each chunk
    allDataSets += chunkData; // Collect all generated data
    console.log("Total data length:", allDataSets.length);
  }

  // Convert the aggregated data to JSONL format
  const jsonData = convertToJSON(allDataSets);
  const jsonlData = convertJSONToJSONL(jsonData);
  console.log("Total JSONL data length:", jsonData.length);

  // File path to save the JSONL
  const filePath = "./src/datasets/generated_dataset.jsonl";

  // Call the function to write JSONL
  writeJSONLToFile(jsonData, filePath);

  // Return the final JSONL dataset
  return jsonlData;
}
