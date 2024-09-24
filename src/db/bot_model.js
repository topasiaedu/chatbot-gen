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
exports.fetchBotModelCountByBotId = exports.deleteBotModel = exports.updateBotModel = exports.createBotModel = exports.fetchBotModel = void 0;
const supabaseClient_1 = __importDefault(require("./supabaseClient"));
// CRUD operations for bot models
const fetchBotModel = (modelId) => __awaiter(void 0, void 0, void 0, function* () {
    const { data, error } = yield supabaseClient_1.default
        .from("bot_models")
        .select("*")
        .eq("id", modelId)
        .single();
    if (error)
        throw new Error(`Failed to fetch bot model with ID ${modelId}: ${error.message}`);
    return data;
});
exports.fetchBotModel = fetchBotModel;
const createBotModel = (model) => __awaiter(void 0, void 0, void 0, function* () {
    const { data, error } = yield supabaseClient_1.default
        .from("bot_models")
        .insert([model])
        .select("*")
        .single();
    if (error)
        throw new Error(`Failed to create bot model: ${error.message}`);
    return data;
});
exports.createBotModel = createBotModel;
const updateBotModel = (modelId, model) => __awaiter(void 0, void 0, void 0, function* () {
    const { data, error } = yield supabaseClient_1.default
        .from("bot_models")
        .update(model)
        .eq("id", modelId)
        .select("*")
        .single();
    if (error)
        throw new Error(`Failed to update bot model with ID ${modelId}: ${error.message}`);
    return data;
});
exports.updateBotModel = updateBotModel;
const deleteBotModel = (modelId) => __awaiter(void 0, void 0, void 0, function* () {
    const { error } = yield supabaseClient_1.default
        .from("bot_models")
        .delete()
        .eq("id", modelId);
    if (error)
        throw new Error(`Failed to delete bot model with ID ${modelId}: ${error.message}`);
});
exports.deleteBotModel = deleteBotModel;
const fetchBotModelCountByBotId = (botId) => __awaiter(void 0, void 0, void 0, function* () {
    const { data, error } = yield supabaseClient_1.default
        .from("bot_models")
        .select("id")
        .eq("bot_id", botId);
    if (error)
        throw new Error(`Failed to fetch bot models for bot with ID ${botId}: ${error.message}`);
    return data.length;
});
exports.fetchBotModelCountByBotId = fetchBotModelCountByBotId;
