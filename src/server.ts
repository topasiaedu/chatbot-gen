import express from "express";
import * as dotenv from "dotenv";
import OpenAI from "openai";
import { getChatCompletions } from "./utils/chatCompletions";
import { fineTuneModel } from "./utils/fineTuning";
import { getFineTunedChat } from "./utils/fineTunedChat";
import { generateDataSetsInChunks } from "./utils/generateDatasets";
import cors from "cors";
import { Bot, fetchBot, updateBot } from "./db/bot";
import { BotFile, fetchBotFilesByBotId } from "./db/bot_file";
import {
  BotModel,
  createBotModel,
  fetchBotModel,
  fetchBotModelCountByBotId,
} from "./db/bot_model";
const fs = require("fs");
import path from "path";
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./swagger";
import { initTranscriptionRealtime, startTranscriptionPolling } from "./realtime/transcription";
import { extractTextFromFileUrl } from "./utils/files";

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;

// Middleware
app.use(express.json());

// Configure CORS options
const corsOptions = {
  origin: "*", // Allow all origins
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // Allowed methods
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
  ], // Allowed headers
  optionsSuccessStatus: 200, // Some legacy browsers choke on 204
};

// Enable CORS with configured options
app.use(cors(corsOptions));
// Handle preflight (OPTIONS) requests for all routes
app.options("*", cors(corsOptions));

// Setup Swagger
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Endpoint to get the Swagger specs as JSON
app.get("/swagger.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error("Missing OpenAI API key");
  process.exit(1);
}

// Custom error type for API errors
interface ApiError extends Error {
  statusCode?: number;
  details?: unknown;
}

const client = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"], // This is the default and can be omitted
});

// Initialize realtime transcription listener
const TRANSCRIPTION_BUCKET = process.env.TRANSCRIPTION_BUCKET_NAME || "transcription";
const stopTranscriptionRealtime = initTranscriptionRealtime(client, TRANSCRIPTION_BUCKET);
const stopTranscriptionPolling = startTranscriptionPolling(client, TRANSCRIPTION_BUCKET, 30000);

/**
 * @swagger
 * /:
 *   get:
 *     summary: Health check endpoint
 *     description: Simple endpoint to check if the API is running
 *     responses:
 *       200:
 *         description: Success, returns "Hello World!"
 */
app.get("/", (req, res) => {
  res.send("Hello World!");
});

/**
 * @swagger
 * /chat-with-transcriptions:
 *   post:
 *     summary: Chat with context from selected transcription files
 *     description: Includes the given transcription results as system/context messages
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - prompt
 *               - transcriptionUrls
 *             properties:
 *               prompt:
 *                 type: string
 *               transcriptionUrls:
 *                 type: array
 *                 items:
 *                   type: string
 *               messages:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     role:
 *                       type: string
 *                       enum: [user, assistant, system]
 *                     content:
 *                       type: string
 *     responses:
 *       200:
 *         description: Success
 */
app.post("/chat-with-transcriptions", async (req, res) => {
  const { prompt, transcriptionUrls, messages } = req.body as {
    prompt?: string;
    transcriptionUrls?: string[];
    messages?: { role: "user" | "assistant" | "system"; content: string }[];
  };

  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }
  if (!Array.isArray(transcriptionUrls) || transcriptionUrls.length === 0) {
    return res.status(400).json({ error: "Missing transcriptionUrls" });
  }

  // Fetch transcript texts from public URLs
  const transcriptTexts: string[] = [];
  for (const url of transcriptionUrls) {
    try {
      const text = await extractTextFromFileUrl(url);
      transcriptTexts.push(text);
    } catch (e) {
      return res.status(400).json({ error: `Failed to fetch transcription: ${(e as any).message}` });
    }
  }

  const systemContext = `You are a helpful assistant. You are provided with one or more transcript documents. Use them to answer the user's question. If the answer is not in the transcripts, say you don't know.`;
  const contextMessages: { role: "system"; content: string }[] = transcriptTexts.map((t, i) => ({ role: "system", content: `Transcript ${i + 1}:\n${t}` }));

  const sanitizedHistory: { role: "user" | "assistant" | "system"; content: string }[] = Array.isArray(messages)
    ? messages.filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant" || m.role === "system"))
    : [];

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini-2024-07-18",
    messages: [
      { role: "system", content: systemContext },
      ...contextMessages,
      ...sanitizedHistory,
      { role: "user", content: prompt },
    ],
  });

  res.json({ completion: completion.choices[0]?.message?.content ?? "" });
});

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Detailed health check
 *     description: Returns detailed information about the API's health
 *     responses:
 *       200:
 *         description: Success, returns health information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "UP"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 version:
 *                   type: string
 *                   example: "1.0.0"
 *                 uptime:
 *                   type: number
 *                   example: 3600
 */
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "UP",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
    uptime: process.uptime()
  });
});

/**
 * @swagger
 * /chat:
 *   post:
 *     summary: Get chat completions
 *     description: Send a prompt to OpenAI and get a completion response
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - prompt
 *             properties:
 *               prompt:
 *                 type: string
 *                 description: The prompt to send to the AI
 *     responses:
 *       200:
 *         description: Success, returns the completion
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 completion:
 *                   type: string
 *       400:
 *         description: Bad request, missing prompt
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/chat", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }

  const completion = await getChatCompletions(client, prompt);
  res.json({ completion });
});

/**
 * @swagger
 * /fine-tune:
 *   post:
 *     summary: Start a fine-tuning job
 *     description: Start a fine-tuning job with the current dataset
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               botId:
 *                 type: string
 *                 description: Optional bot ID to associate with the fine-tuning job
 *     responses:
 *       200:
 *         description: Success, returns the fine-tuning job details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 fineTune:
 *                   type: object
 *                   description: OpenAI fine-tuning job object
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/fine-tune", async (req, res) => {
  // Get botId from the request if available, but don't require it
  const { botId } = req.body;
  
  const fineTune = await fineTuneModel(client, botId);
  res.json({ fineTune });
});

/**
 * @swagger
 * /fine-tuned-chat:
 *   post:
 *     summary: Chat with a fine-tuned model
 *     description: Send a prompt to a specific fine-tuned model
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - modelId
 *               - prompt
 *             properties:
 *               modelId:
 *                 type: string
 *                 description: The ID of the fine-tuned model to use
 *               prompt:
 *                 type: string
 *                 description: The prompt to send to the model
 *     responses:
 *       200:
 *         description: Success, returns the completion
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 completion:
 *                   type: string
 *       400:
 *         description: Bad request, missing required parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/fine-tuned-chat", async (req, res) => {
  const { modelId, prompt } = req.body;

  if (!modelId) {
    return res.status(400).json({ error: "Missing modelId" });
  }

  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }

  const completion = await getFineTunedChat(client, modelId, prompt);
  res.json({ completion });
});

/**
 * @swagger
 * /generate-datasets:
 *   post:
 *     summary: Generate datasets from a file
 *     description: Generate training datasets from a file URL
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fileUrl
 *             properties:
 *               fileUrl:
 *                 type: string
 *                 description: URL of the file to process
 *     responses:
 *       200:
 *         description: Success, returns the generated datasets
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 dataSets:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Bad request, missing fileUrl
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/generate-datasets", async (req, res) => {
  const { fileUrl } = req.body;

  if (!fileUrl) {
    return res.status(400).json({ error: "Missing fileUrl" });
  }

  try {
    const dataSets = await generateDataSetsInChunks(client, fileUrl);
    res.json({ dataSets });
  } catch (error) {
    res.status(500).json({ error: (error as any).message });
  }
});

/**
 * @swagger
 * /train-bot:
 *   post:
 *     summary: Train a bot
 *     description: Process bot files, generate datasets, and fine-tune a model for the bot
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - modelId
 *             properties:
 *               modelId:
 *                 type: string
 *                 description: ID of the bot to train
 *     responses:
 *       200:
 *         description: Success, training started
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Training bot..."
 *       400:
 *         description: Bad request, missing modelId
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Not found, bot not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/train-bot", async (req, res) => {
  const { modelId } = req.body;

  console.log("modelId", modelId);

  if (!modelId) {
    return res.status(400).json({ error: "Missing modelId" });
  }

  // Here you would start the training process for the bot

  const bot: Bot = await fetchBot(modelId);

  if (!bot) {
    return res.status(404).json({ error: "Bot not found" });
  }

  // Update the bot status to TRAINING

  await updateBot(bot.id, { status: "TRAINING" });

  const botFiles: BotFile[] = await fetchBotFilesByBotId(bot.id);

  const filePath = "./dist/datasets/generated_dataset.jsonl";

  // Ensure the directory exists
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  fs.writeFileSync(filePath, "", "utf8");

  let fileProcessed = 0;

  for (const botFile of botFiles) {
    // Extract text from the bot file
    await generateDataSetsInChunks(
      client,
      botFile.file_url,
      bot.training_breadth,
      bot.training_depth,
      bot.id
    );

    fileProcessed++;

    // Update the bot progress (round to integer)
    const progress = Math.round((fileProcessed / botFiles.length) * 100);

    await updateBot(bot.id, { progress });
  }

  // Train the bot with the generated dataset
  const fineTune = await fineTuneModel(client, bot.id);

  const versionNumber = (await fetchBotModelCountByBotId(bot.id)) + 1;

  // Create bot model with the fine-tuned model ID
  const botModel: BotModel = await createBotModel({
    bot_id: bot.id,
    open_ai_id: fineTune.model,
    version: versionNumber.toString() + ".0",
  });

  // Update the bot status to TRAINED
  await updateBot(bot.id, { status: "TRAINED", active_version: botModel.id });

  res.json({ message: "Training bot..." });
});

/**
 * @swagger
 * /chat-with-bot:
 *   post:
 *     summary: Chat with a trained bot
 *     description: Send a prompt to a specific trained bot. Chat messages will be saved to database if email is provided.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - botId
 *               - prompt
 *             properties:
 *               botId:
 *                 type: string
 *                 description: ID of the bot to chat with
 *               prompt:
 *                 type: string
 *                 description: The prompt to send to the bot
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User's email address (optional, used for saving chat history)
 *               messages:
 *                 type: array
 *                 description: Optional chat history
 *                 items:
 *                   type: object
 *                   properties:
 *                     text:
 *                       type: string
 *                       description: The message text
 *                     sender:
 *                       type: string
 *                       enum: [user, bot]
 *                       description: Who sent the message
 *     responses:
 *       200:
 *         description: Success, returns the completion
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 completion:
 *                   type: string
 *       400:
 *         description: Bad request, missing required parameters or bot not trained
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Not found, bot or model not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/chat-with-bot", async (req, res) => {
  const { botId, prompt, messages, email } = req.body;

  if (!botId) {
    return res.status(400).json({ error: "Missing botId" });
  }

  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }

  const bot: Bot = await fetchBot(botId);

  if (!bot) {
    return res.status(404).json({ error: "Bot not found" });
  }

  if (bot.status !== "TRAINED") {
    return res.status(400).json({ error: "Bot is not trained" });
  }

  if (!bot.active_version) {
    return res.status(400).json({ error: "Bot has no active version" });
  }

  const botModel: BotModel = await fetchBotModel(bot.active_version);

  if (!botModel) {
    return res.status(404).json({ error: "Bot model not found" });
  }

  const completion = await getFineTunedChat(
    client,
    botModel.open_ai_id,
    prompt,
    bot.description,
    messages,
    email,     // 👈 Pass email for chat history saving
    botId      // 👈 Pass botId for chat history saving
  );
  res.json({ completion });
});

// Error handling middleware
app.use((err: ApiError, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(`Error: ${err.message}`);
  console.error(err.stack);
  
  const statusCode = err.statusCode || 500;
  const errorResponse: Record<string, any> = {
    error: {
      message: err.message || "Internal Server Error"
    }
  };
  
  // Add stack trace in non-production environments
  if (process.env.NODE_ENV !== "production" && err.stack) {
    errorResponse.error.stack = err.stack;
  }
  
  // Add error details if available
  if (err.details) {
    errorResponse.error.details = err.details;
  }
  
  res.status(statusCode).json(errorResponse);
});

// Not found middleware
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({
    error: {
      message: `Not Found - ${req.method} ${req.originalUrl}`
    }
  });
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  console.log(`API documentation available at http://localhost:${port}/api-docs`);
});
