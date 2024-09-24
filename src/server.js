"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv = __importStar(require("dotenv"));
const openai_1 = __importDefault(require("openai"));
const chatCompletions_1 = require("./utils/chatCompletions");
const fineTuning_1 = require("./utils/fineTuning");
const fineTunedChat_1 = require("./utils/fineTunedChat");
const generateDatasets_1 = require("./utils/generateDatasets");
const cors_1 = __importDefault(require("cors"));
const bot_1 = require("./db/bot");
const bot_file_1 = require("./db/bot_file");
const bot_model_1 = require("./db/bot_model");
const fs = require("fs");
dotenv.config();
const app = (0, express_1.default)();
const port = 8000;
app.use(express_1.default.json());
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
app.use((0, cors_1.default)(corsOptions));
// Handle preflight (OPTIONS) requests for all routes
app.options("*", (0, cors_1.default)(corsOptions));
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
    console.error("Missing OpenAI API key");
    process.exit(1);
}
const client = new openai_1.default({
    apiKey: process.env["OPENAI_API_KEY"], // This is the default and can be omitted
});
app.get("/", (req, res) => {
    res.send("Hello World!");
});
app.post("/chat", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { prompt } = req.body;
    if (!prompt) {
        return res.status(400).json({ error: "Missing prompt" });
    }
    const completion = yield (0, chatCompletions_1.getChatCompletions)(client, prompt);
    res.json({ completion });
}));
app.post("/fine-tune", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const fineTune = yield (0, fineTuning_1.fineTuneModel)(client);
    res.json({ fineTune });
}));
app.post("/fine-tuned-chat", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { modelId, prompt } = req.body;
    if (!modelId) {
        return res.status(400).json({ error: "Missing modelId" });
    }
    if (!prompt) {
        return res.status(400).json({ error: "Missing prompt" });
    }
    const completion = yield (0, fineTunedChat_1.getFineTunedChat)(client, modelId, prompt);
    res.json({ completion });
}));
app.post("/generate-datasets", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { fileUrl } = req.body;
    if (!fileUrl) {
        return res.status(400).json({ error: "Missing fileUrl" });
    }
    try {
        const dataSets = yield (0, generateDatasets_1.generateDataSetsInChunks)(client, fileUrl);
        res.json({ dataSets });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
}));
app.post("/train-bot", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { modelId } = req.body;
    console.log("modelId", modelId);
    if (!modelId) {
        return res.status(400).json({ error: "Missing modelId" });
    }
    // Here you would start the training process for the bot
    const bot = yield (0, bot_1.fetchBot)(modelId);
    if (!bot) {
        return res.status(404).json({ error: "Bot not found" });
    }
    // Update the bot status to TRAINING
    yield (0, bot_1.updateBot)(bot.id, { status: "TRAINING" });
    const botFiles = yield (0, bot_file_1.fetchBotFilesByBotId)(bot.id);
    const filePath = "./src/datasets/generated_dataset.jsonl";
    fs.writeFileSync(filePath, "", "utf8");
    let fileProcessed = 0;
    for (const botFile of botFiles) {
        // Extract text from the bot file
        yield (0, generateDatasets_1.generateDataSetsInChunks)(client, botFile.file_url, bot.training_breadth, bot.training_depth);
        fileProcessed++;
        // Update the bot progress (round to integer)
        const progress = Math.round((fileProcessed / botFiles.length) * 100);
        yield (0, bot_1.updateBot)(bot.id, { progress });
    }
    // Train the bot with the generated dataset
    const fineTune = yield (0, fineTuning_1.fineTuneModel)(client);
    const versionNumber = (yield (0, bot_model_1.fetchBotModelCountByBotId)(bot.id)) + 1;
    // Create bot model with the fine-tuned model ID
    const botModel = yield (0, bot_model_1.createBotModel)({
        bot_id: bot.id,
        open_ai_id: fineTune.model,
        version: versionNumber.toString() + ".0",
    });
    // Update the bot status to TRAINED
    yield (0, bot_1.updateBot)(bot.id, { status: "TRAINED", active_version: botModel.id });
    res.json({ message: "Training bot..." });
}));
app.post("/chat-with-bot", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { botId, prompt } = req.body;
    if (!botId) {
        return res.status(400).json({ error: "Missing botId" });
    }
    if (!prompt) {
        return res.status(400).json({ error: "Missing prompt" });
    }
    const bot = yield (0, bot_1.fetchBot)(botId);
    if (!bot) {
        return res.status(404).json({ error: "Bot not found" });
    }
    if (bot.status !== "TRAINED") {
        return res.status(400).json({ error: "Bot is not trained" });
    }
    if (!bot.active_version) {
        return res.status(400).json({ error: "Bot has no active version" });
    }
    const botModel = yield (0, bot_model_1.fetchBotModel)(bot.active_version);
    if (!botModel) {
        return res.status(404).json({ error: "Bot model not found" });
    }
    const completion = yield (0, fineTunedChat_1.getFineTunedChat)(client, botModel.open_ai_id, prompt);
    res.json({ completion });
}));
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
