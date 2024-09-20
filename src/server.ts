import express from "express";
import * as dotenv from "dotenv";
import OpenAI from "openai";
import { getChatCompletions } from "./utils/chatCompletions";
import { fineTuneModel } from "./utils/fineTuning";
import { getFineTunedChat } from "./utils/fineTunedChat";
import { generateDataSetsInChunks } from "./utils/generateDatasets";

dotenv.config();

const app = express();
const port = 8080;

app.use(express.json());

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

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
