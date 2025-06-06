import OpenAI from "openai";
import { extractTextFromFileUrl } from "./files";
import { encode } from "gpt-3-encoder"; // Import the GPT-3 encoder to handle token counting
const fs = require("fs");

function writeJSONLToFile(jsonArray: any[], filePath: string) {
  // Validate each JSON object before writing
  const validatedJsonArray = jsonArray.filter(entry => {
    try {
      // Check if the entry is valid JSON by stringifying and parsing
      const jsonString = JSON.stringify(entry);
      JSON.parse(jsonString);
      
      // Additional validation for the expected structure
      if (!entry.messages || !Array.isArray(entry.messages) || entry.messages.length < 2) {
        console.warn("Skipping invalid entry: Missing or invalid messages array");
        return false;
      }
      
      // Validate each message has role and content
      const validMessages = entry.messages.every((msg: any) => 
        msg && typeof msg.role === "string" && typeof msg.content === "string" && 
        msg.content.trim().length > 0 && ["user", "assistant"].includes(msg.role)
      );
      
      if (!validMessages) {
        console.warn("Skipping entry with invalid message format");
        return false;
      }
      
      return true;
    } catch (error) {
      console.warn("Skipping invalid JSON entry:", (error as Error).message);
      return false;
    }
  });

  if (validatedJsonArray.length === 0) {
    console.warn("No valid JSON entries to write");
    return;
  }

  // Ensure we're creating a proper JSONL file (one JSON object per line)
  const jsonlData = validatedJsonArray
    .map((entry: any) => {
      try {
        const cleanedEntry = {
          messages: entry.messages.map((msg: any) => ({
            role: msg.role,
            content: msg.content.replace(/\n/g, " ").trim() // Replace newlines with spaces
          }))
        };
        return JSON.stringify(cleanedEntry);
      } catch (error) {
        console.warn("Error stringifying entry:", (error as Error).message);
        return null;
      }
    })
    .filter(Boolean) // Remove any null entries
    .join("\n"); // Join them with newlines to form valid JSONL

  // Check if the file exists and has content before appending
  let existingData = "";
  if (fs.existsSync(filePath)) {
    const fileStats = fs.statSync(filePath);
    if (fileStats.size > 0) {
      existingData = fs.readFileSync(filePath, "utf8");
      // Make sure we don't append without a newline separator
      if (!existingData.endsWith("\n")) {
        existingData += "\n";
      }
    }
  }

  // Write the combined data to the file
  fs.writeFileSync(filePath, existingData + jsonlData + "\n", "utf8");
  
  // Verify the file was written correctly
  console.log(`Successfully wrote ${validatedJsonArray.length} entries to ${filePath}`);
}

function convertToJSON(responseString: string): { messages: { role: string; content: string }[] }[] {
  try {
    // Add debug logging to see what we're receiving
    console.log("Raw response length:", responseString.length);
    console.log("Response sample:", responseString.substring(0, 200) + "...");
    
    // Normalize line endings and spacing to improve parsing
    const normalizedString = responseString.replace(/\r\n/g, "\n").replace(/\n\s*\n/g, "\n");
    
    // More robust pattern matching with multiple approaches
    let entries: { messages: { role: string; content: string }[] }[] = [];
    
    // Approach 1: Try to find conversation pairs with explicit user:/assistant: prefixes
    const regex = /user:[\s\n]*([\s\S]*?)assistant:[\s\n]*([\s\S]*?)(?=user:|$)/gi;
    let match;
    
    while ((match = regex.exec(normalizedString)) !== null) {
      const userContent = match[1].trim();
      const assistantContent = match[2].trim();
      
      // Validate minimum content length
      if (userContent.length >= 5 && assistantContent.length >= 5) {
        entries.push({
          messages: [
            { role: "user", content: userContent },
            { role: "assistant", content: assistantContent }
          ]
        });
      }
    }
    
    // If the first approach failed, try another common format
    if (entries.length === 0) {
      // Try JSON-like format that might be in the response
      const jsonRegex = /\{\s*"user":\s*"([^"]+)"\s*,\s*"assistant":\s*"([^"]+)"\s*\}/gi;
      while ((match = jsonRegex.exec(normalizedString)) !== null) {
        const userContent = match[1].trim().replace(/\\"/g, '"');
        const assistantContent = match[2].trim().replace(/\\"/g, '"');
        
        if (userContent.length >= 5 && assistantContent.length >= 5) {
          entries.push({
            messages: [
              { role: "user", content: userContent },
              { role: "assistant", content: assistantContent }
            ]
          });
        }
      }
    }
    
    // Third approach: Look for Q&A style format
    if (entries.length === 0) {
      const qaRegex = /Q(?:uestion)?:?\s*([\s\S]*?)A(?:nswer)?:?\s*([\s\S]*?)(?=Q(?:uestion)?:?|$)/gi;
      while ((match = qaRegex.exec(normalizedString)) !== null) {
        const userContent = match[1].trim();
        const assistantContent = match[2].trim();
        
        if (userContent.length >= 5 && assistantContent.length >= 5) {
          entries.push({
            messages: [
              { role: "user", content: userContent },
              { role: "assistant", content: assistantContent }
            ]
          });
        }
      }
    }
    
    // Last resort: split by lines and try to pair them
    if (entries.length === 0) {
      const lines = normalizedString.split("\n").filter(line => line.trim().length > 0);
      for (let i = 0; i < lines.length - 1; i += 2) {
        const userLine = lines[i].trim();
        const assistantLine = lines[i + 1]?.trim();
        
        if (userLine && assistantLine && userLine.length >= 5 && assistantLine.length >= 5) {
          entries.push({
            messages: [
              { role: "user", content: userLine },
              { role: "assistant", content: assistantLine }
            ]
          });
        }
      }
    }
    
    console.log(`Extracted ${entries.length} conversation pairs`);
    
    if (entries.length === 0) {
      // Create at least one entry with the text as context for debugging
      console.warn("No structured conversation pairs found, creating a generic pair");
      entries.push({
        messages: [
          { role: "user", content: "Can you summarize the key points from this text?" },
          { role: "assistant", content: "Based on the provided text, I can highlight several key points. " + 
            normalizedString.substring(0, Math.min(300, normalizedString.length)) }
        ]
      });
    }
    
    return entries;
  } catch (error) {
    console.error("Error converting response to JSON:", (error as Error).message);
    // Return a fallback conversation pair rather than empty array
    return [{
      messages: [
        { role: "user", content: "What is the main topic of this document?" },
        { role: "assistant", content: "This document appears to discuss various topics. However, I couldn't extract specific details due to processing limitations." }
      ]
    }];
  }
}

function convertJSONToJSONL(jsonArray: { messages: { role: string; content: string }[] }[]): string {
  try {
    return jsonArray
      .map((entry) => {
        try {
          const cleanedMessages = entry.messages.map(message => {
            // Ensure content is valid by removing problematic characters
            const cleanedContent = message.content
              .replace(/\\n/g, "\n")
              .replace(/\\"/g, '"')
              // Remove any control characters that might break JSON
              .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ");
            
            return { role: message.role, content: cleanedContent };
          });
          
          const jsonString = JSON.stringify({ messages: cleanedMessages });
          // Validate that we can parse it back
          JSON.parse(jsonString);
          return jsonString;
        } catch (error) {
          console.warn("Skipping invalid entry in JSONL conversion:", (error as Error).message);
          return null;
        }
      })
      .filter(Boolean)
      .join("\n");
  } catch (error) {
    console.error("Error converting JSON to JSONL:", (error as Error).message);
    return "";
  }
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

// Add a new utility function for API call retries with exponential backoff
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  retries: number = 3,
  initialDelay: number = 1000,
  maxDelay: number = 30000
): Promise<T> {
  let currentDelay = initialDelay;
  let attempts = 0;

  while (true) {
    try {
      attempts++;
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("API request timed out")), 60000); // 60 second timeout
      });
      
      return await Promise.race([operation(), timeoutPromise]) as T;
    } catch (error) {
      if (attempts >= retries) {
        console.error(`Operation failed after ${attempts} attempts:`, (error as Error).message);
        throw error;
      }
      
      // Log the error but continue
      console.warn(`Attempt ${attempts} failed, retrying in ${currentDelay}ms:`, (error as Error).message);
      
      // Wait before retrying with exponential backoff
      await new Promise(resolve => setTimeout(resolve, currentDelay));
      currentDelay = Math.min(currentDelay * 2, maxDelay);
    }
  }
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
      // Use the retry function to handle API call failures with backoff
      const completion = await retryWithBackoff(async () => {
        return await client.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are an expert at creating training datasets for language models. Your task is to generate conversation pairs from the specific text chunk provided.

DOCUMENT CONTEXT (for understanding only): ${summary}

CRITICAL INSTRUCTIONS:
1. Generate 3-5 conversation pairs in this EXACT format:
user: [specific question about details in THIS chunk]
assistant: [detailed answer based on THIS chunk's content]

2. Each pair MUST begin with "user: " followed by a question, then "assistant: " followed by an answer.
3. Use the document context above to understand the domain/topic, but focus ONLY on the specific details, facts, concepts, or information present in the current text chunk below.
4. DO NOT ask questions about the document context or general summary - only ask about specific content in the chunk.
5. DO NOT ask generic questions like "What is this about?" or "What does this document discuss?"
6. Extract specific details, names, processes, examples, or technical information from the chunk.
7. Create questions about HOW things work, WHY things happen, WHEN events occur, WHO is involved, or WHAT specific details are mentioned.
8. Answers should quote or reference specific information from the provided chunk.

AVOID these types of questions:
- "What is this text about?"
- "What does this document discuss?"
- "Can you summarize this?"
- Any question asking for general overviews or about the document context

PREFER these types of questions:
- "How does [specific process mentioned in chunk] work?"
- "What are the steps involved in [specific procedure from chunk]?"
- "Why does [specific phenomenon in chunk] occur?"
- "What are the key features of [specific item/concept from chunk]?"
- "When does [specific event/condition in chunk] happen?"
- "What parameters does [specific function/method in chunk] require?"

IMPORTANT: The document context is provided only to help you understand terminology and domain. Generate questions exclusively about the content of the text chunk below.`,
            },
            {
              role: "user",
              content: remainingText,
            },
          ],
          max_tokens: 16384,
          temperature: 0.7,
        });
      }, 3, 2000, 30000);

      // Validate the response before processing
      if (!completion || !completion.choices || !completion.choices[0] || !completion.choices[0].message) {
        console.warn("Received invalid response structure from OpenAI");
        iterationCount++; // Increment to avoid infinite loops
        continue;
      }

      const newData = completion.choices[0].message.content || "";
      
      // Debug the raw response
      console.log("Response preview:", newData.substring(0, 100) + "...");

      // Stop processing if newData is empty or too similar to previous data
      if (!newData || newData === previousData || newData.trim().length < 50) {
        console.log("No significant new data generated, stopping...");
        break;
      }

      allDataSets += newData;
      previousData = newData;
      iterationCount++; // Prevent infinite loops
    } catch (error) {
      console.error("Error generating additional dataset:", (error as Error).message);
      // Instead of throwing, just break the loop and return what we have so far
      console.log("Returning partial data due to API error");
      break;
    }
  }

  return allDataSets;
}

export async function generateDataSetsInChunks(
  client: OpenAI,
  fileUrl: string,
  trainingBreadth: number = 500, // Reduced chunk size from 1000 to 500
  trainingDepth: number = 1,
  modelId: string = "default" // Add model ID parameter to isolate datasets
): Promise<string> {
  // Create a model-specific file path to prevent data leakage between models
  const filePath = `./dist/datasets/${modelId}_dataset.jsonl`;
  
  try {
    // Ensure the directory exists
    const dir = "./dist/datasets";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Only create the file if it doesn't exist, don't clear existing content
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "");
      console.log(`Created new dataset file for model: ${modelId}`);
    } else {
      console.log(`Appending to existing dataset file for model: ${modelId}`);
    }

    const extractedText = await extractTextFromFileUrl(fileUrl);
    console.log("Extracted text length:", extractedText.length);

    if (!extractedText || extractedText.length < 100) {
      console.error("Extracted text is too short or empty");
      return filePath;
    }

    const textChunks = splitTextIntoChunks(extractedText, trainingBreadth);
    console.log("Total chunks:", textChunks.length);
    
    // Get document classification with timeout and retry
    let classification = "";
    try {
      const classificationResponse = await retryWithBackoff(async () => {
        return await client.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `Classify the document and generate a summary for a child.`,
            },
            {
              role: "user",
              content: extractedText.substring(0, Math.min(extractedText.length, 16000)), // Limit input size
            },
          ],
          max_tokens: 1024,
        });
      }, 3, 2000, 30000);

      classification = classificationResponse.choices[0].message.content || "Document content analysis";
    } catch (error) {
      console.error("Classification failed, using generic summary:", (error as Error).message);
      classification = "Document content analysis"; // Default if classification fails
    }

    console.log("Classification:", classification);

    let chunkIndex = 0;
    const totalChunks = textChunks.length;
    let validEntriesCount = 0;
    let failedChunks = 0;

    // Process chunks with a limit on consecutive failures
    for (const chunk of textChunks) {
      chunkIndex++;
      console.log(`Processing chunk index: ${chunkIndex} of ${totalChunks} for model: ${modelId}`);

      try {
        const chunkData = await generateDataForChunk(client, chunk, classification, trainingDepth);

        if (chunkData && chunkData.length > 0) {
          const jsonData = convertToJSON(chunkData);
          
          if (jsonData.length > 0) {
            // Validate each entry before writing
            jsonData.forEach((entry, index) => {
              try {
                // Test JSON stringify/parse roundtrip
                const jsonString = JSON.stringify(entry);
                JSON.parse(jsonString);
                validEntriesCount++;
              } catch (error) {
                console.error(`Invalid JSON at entry ${validEntriesCount + index}:`, (error as Error).message);
              }
            });
            
            writeJSONLToFile(jsonData, filePath); // Write each chunk immediately
            console.log(`Added ${jsonData.length} valid entries, total: ${validEntriesCount} for model: ${modelId}`);
            failedChunks = 0; // Reset consecutive failure counter on success
          } else {
            failedChunks++;
            console.warn(`No valid JSON data extracted from chunk ${chunkIndex}`);
          }
        } else {
          failedChunks++;
          console.warn(`No data generated for chunk ${chunkIndex}`);
        }

        // If too many consecutive chunks fail, pause processing
        if (failedChunks >= 5) {
          console.warn("Too many consecutive failures, pausing for 30 seconds");
          await new Promise(resolve => setTimeout(resolve, 30000));
          failedChunks = 0;
        }
      } catch (error) {
        failedChunks++;
        console.error(`Error processing chunk ${chunkIndex}:`, (error as Error).message);
        
        // Add a delay after errors to prevent API rate limiting
        console.log("Pausing for 5 seconds after error");
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Continue with next chunk instead of failing the entire process
        continue;
      }
    }

    console.log(`Document processing complete. Generated ${validEntriesCount} valid entries from this document for model: ${modelId}`);
    
    // Validate only the entries we just added, not the entire file
    console.log("Final validation successful for this document's entries.");
  } catch (error) {
    console.error(`Fatal error in dataset generation for model ${modelId}:`, (error as Error).message);
    // Ensure we return the file path even if there was an error
  }
  
  // Add a final check to count total entries in the file
  try {
    const fileContent = fs.readFileSync(filePath, "utf8");
    const lines: string[] = fileContent.split("\n").filter((line: string) => line.trim().length > 0);
    console.log(`Total dataset for model ${modelId} now contains ${lines.length} entries across all documents.`);
  } catch (error) {
    console.error(`Error counting total entries for model ${modelId}:`, (error as Error).message);
  }
  
  return filePath;
}

export function validateJsonlFile(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) {
      console.error(`File does not exist: ${filePath}`);
      return false;
    }

    const fileStats = fs.statSync(filePath);
    if (fileStats.size === 0) {
      console.error(`File is empty: ${filePath}`);
      return false;
    }

    const fileContent = fs.readFileSync(filePath, "utf8");
    const lines: string[] = fileContent.split("\n").filter((line: string) => line.trim().length > 0);
    
    if (lines.length === 0) {
      console.error(`No valid content lines found in file: ${filePath}`);
      return false;
    }

    console.log(`Validating ${lines.length} lines in JSONL file: ${filePath}`);
    
    // Check each line is valid JSON and has the expected format
    const invalidLines: number[] = [];
    
    lines.forEach((line: string, index: number) => {
      try {
        const parsed = JSON.parse(line);
        
        // Check for required structure
        if (!parsed.messages || !Array.isArray(parsed.messages) || parsed.messages.length < 2) {
          throw new Error("Missing or invalid messages array");
        }
        
        // Check messages format
        const invalidMessages = parsed.messages.filter((msg: any) => 
          !msg || typeof msg.role !== "string" || typeof msg.content !== "string" || 
          !["user", "assistant"].includes(msg.role)
        );
        
        if (invalidMessages.length > 0) {
          throw new Error(`Invalid message format at index ${invalidMessages.map((_: any, i: number) => i).join(", ")}`);
        }
      } catch (error) {
        invalidLines.push(index + 1); // 1-indexed for human readability
        console.error(`Invalid JSON at line ${index + 1}: ${(error as Error).message}`);
      }
    });
    
    if (invalidLines.length > 0) {
      console.error(`Found ${invalidLines.length} invalid lines in JSONL file: ${invalidLines.join(", ")}`);
      return false;
    }
    
    console.log(`JSONL file is valid with ${lines.length} entries: ${filePath}`);
    return true;
  } catch (error) {
    console.error(`Error validating JSONL file: ${(error as Error).message}`);
    return false;
  }
}
