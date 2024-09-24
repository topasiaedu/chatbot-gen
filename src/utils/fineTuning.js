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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fineTuneModel = fineTuneModel;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function fineTuneModel(client) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!client) {
            throw new Error("OpenAI client is not defined");
        }
        // Use the dataset from the local path
        const datasetPath = path_1.default.join(__dirname, "..", "datasets", "generated_dataset.jsonl");
        // Step 1: Upload the file to OpenAI and get the file ID
        const datasetStream = fs_1.default.createReadStream(datasetPath);
        try {
            const fileUploadResponse = yield client.files.create({
                file: datasetStream,
                purpose: 'fine-tune',
            });
            const fileId = fileUploadResponse.id;
            // Generate a unique fine-tuning job name (or use a different parameter)
            const uniqueJobName = `my-custom-finetune-${Date.now()}}`;
            // Step 2: Use the file ID to create a fine-tuning job
            const fineTune = yield client.fineTuning.jobs.create({
                training_file: fileId,
                model: "gpt-3.5-turbo",
                suffix: uniqueJobName // Adds a unique suffix to ensure a new model is created
            });
            return fineTune;
        }
        catch (error) {
            console.error('Error during fine-tuning process:', ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
            throw error;
        }
    });
}
