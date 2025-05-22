"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDataSetsInChunks = generateDataSetsInChunks;
const files_1 = require("./files");
const gpt_3_encoder_1 = require("gpt-3-encoder"); // Import the GPT-3 encoder to handle token counting
const fs = require("fs");
function writeJSONLToFile(jsonArray, filePath) {
    const jsonlData = jsonArray
        .map((entry) => JSON.stringify(entry)) // Convert each object to a JSON string
        .join("\n"); // Join them with newlines to form valid JSONL
    // Append the JSONL data to the file instead of overwriting it
    fs.appendFileSync(filePath, jsonlData + "\n", "utf8");
}
function convertToJSON(responseString) {
    const jsonlData = responseString
        .split("user:")
        .filter(Boolean)
        .map((entry) => {
        const [userContent, assistantPart] = entry.split("assistant:");
        if (!userContent || !assistantPart || userContent.trim().length < 10 || assistantPart.trim().length < 10) {
            return null;
        }
        return {
            messages: [
                { role: "user", content: userContent.trim() },
                { role: "assistant", content: assistantPart.trim() }
            ]
        };
    })
        .filter((entry) => entry !== null);
    return jsonlData;
}
function convertJSONToJSONL(jsonArray) {
    return jsonArray
        .map((entry) => {
        const cleanedMessages = entry.messages.map(message => {
            const cleanedContent = message.content.replace(/\\n/g, "\n").replace(/\\"/g, '"');
            return { role: message.role, content: cleanedContent };
        });
        return JSON.stringify({ messages: cleanedMessages });
    })
        .join("\n");
}
// Helper function to split text into smaller chunks (500 tokens instead of 1000)
function splitTextIntoChunks(text, tokensPerChunk = 500) {
    const encoded = (0, gpt_3_encoder_1.encode)(text);
    const chunks = [];
    for (let i = 0; i < encoded.length; i += tokensPerChunk) {
        const chunkTokens = encoded.slice(i, i + tokensPerChunk);
        const chunkText = decodeTokens(chunkTokens);
        chunks.push(chunkText);
    }
    return chunks;
}
// Simple token decoder placeholder (modify based on encoding method)
function decodeTokens(tokens) {
    return tokens.join(" "); // Adjust decoding logic if necessary
}
function generateDataForChunk(client_1, textChunk_1, summary_1) {
    return __awaiter(this, arguments, void 0, function* (client, textChunk, summary, maxIterations = 1) {
        let allDataSets = "";
        let remainingText = textChunk;
        let previousData = "";
        let iterationCount = 0;
        while (remainingText.trim() && iterationCount < maxIterations) {
            console.log("Processing chunk iteration:", iterationCount + 1);
            try {
                const completion = yield client.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        {
                            role: "system",
                            content: `You are an AI that generates fine-tuning datasets for training language models. 
                      Summary: ${summary}
                      Format: {user: ... assistant: ...}
                      
                      Generate conversation pairs where the user asks questions about the content and the assistant responds with helpful, accurate information.
                      Each pair should be clearly marked with "user:" and "assistant:" prefixes.`,
                        },
                        {
                            role: "user",
                            content: remainingText,
                        },
                    ],
                    max_tokens: 16384, // Reduced from 16384 to prevent memory overuse
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
            }
            catch (error) {
                console.error("Error generating additional dataset:", error.message);
                throw error;
            }
        }
        return allDataSets;
    });
}
function generateDataSetsInChunks(client_1, fileUrl_1) {
    return __awaiter(this, arguments, void 0, function* (client, fileUrl, trainingBreadth = 500, // Reduced chunk size from 1000 to 500
    trainingDepth = 1) {
        const extractedText = yield (0, files_1.extractTextFromFileUrl)(fileUrl);
        console.log("Extracted text length:", extractedText.length);
        const textChunks = splitTextIntoChunks(extractedText, trainingBreadth);
        console.log("Total chunks:", textChunks.length);
        const filePath = "./dist/datasets/generated_dataset.jsonl"; // File path for output
        fs.writeFileSync(filePath, ""); // Clear file before writing
        const classificationResponse = yield client.chat.completions.create({
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
            const chunkData = yield generateDataForChunk(client, chunk, classification, trainingDepth);
            if (chunkData.length > 0) {
                const jsonData = convertToJSON(chunkData);
                const jsonlData = convertJSONToJSONL(jsonData);
                writeJSONLToFile(jsonData, filePath); // Write each chunk immediately
            }
        }
        console.log("Dataset processing complete. Check:", filePath);
        return filePath;
    });
}
