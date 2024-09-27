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

dotenv.config();

const app = express();
const port = 8000;

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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error("Missing OpenAI API key");
  process.exit(1);
}

const client = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"], // This is the default and can be omitted
});

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/chat", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }

  const completion = await getChatCompletions(client, prompt);
  res.json({ completion });
});

app.post("/fine-tune", async (req, res) => {
  const fineTune = await fineTuneModel(client);
  res.json({ fineTune });
});

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

  const filePath = "./src/datasets/generated_dataset.jsonl";
  fs.writeFileSync(filePath, "", "utf8");

  let fileProcessed = 0;

  for (const botFile of botFiles) {
    // Extract text from the bot file
    await generateDataSetsInChunks(
      client,
      botFile.file_url,
      bot.training_breadth,
      bot.training_depth
    );

    fileProcessed++;

    // Update the bot progress (round to integer)
    const progress = Math.round((fileProcessed / botFiles.length) * 100);

    await updateBot(bot.id, { progress });
  }

  // Train the bot with the generated dataset
  const fineTune = await fineTuneModel(client);

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

app.post("/chat-with-bot", async (req, res) => {
  const { botId, prompt, messages } = req.body;

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
    messages
  );
  res.json({ completion });
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
