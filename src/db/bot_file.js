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
exports.fetchBotFilesByBotId = exports.deleteBotFile = exports.updateBotFile = exports.createBotFile = exports.fetchBotFile = void 0;
const supabaseClient_1 = __importDefault(require("./supabaseClient"));
// CRUD operations for bot files
const fetchBotFile = (fileId) => __awaiter(void 0, void 0, void 0, function* () {
    const { data, error } = yield supabaseClient_1.default
        .from("bot_files")
        .select("*")
        .eq("id", fileId)
        .single();
    if (error)
        throw new Error(`Failed to fetch bot file with ID ${fileId}: ${error.message}`);
    return data;
});
exports.fetchBotFile = fetchBotFile;
const createBotFile = (file) => __awaiter(void 0, void 0, void 0, function* () {
    const { data, error } = yield supabaseClient_1.default
        .from("bot_files")
        .insert([file])
        .select("*")
        .single();
    if (error)
        throw new Error(`Failed to create bot file: ${error.message}`);
    return data;
});
exports.createBotFile = createBotFile;
const updateBotFile = (fileId, file) => __awaiter(void 0, void 0, void 0, function* () {
    const { data, error } = yield supabaseClient_1.default
        .from("bot_files")
        .update(file)
        .eq("id", fileId)
        .select("*")
        .single();
    if (error)
        throw new Error(`Failed to update bot file with ID ${fileId}: ${error.message}`);
    return data;
});
exports.updateBotFile = updateBotFile;
const deleteBotFile = (fileId) => __awaiter(void 0, void 0, void 0, function* () {
    const { error } = yield supabaseClient_1.default.from("bot_files").delete().eq("id", fileId);
    if (error)
        throw new Error(`Failed to delete bot file with ID ${fileId}: ${error.message}`);
});
exports.deleteBotFile = deleteBotFile;
const fetchBotFilesByBotId = (botId) => __awaiter(void 0, void 0, void 0, function* () {
    const { data, error } = yield supabaseClient_1.default
        .from("bot_files")
        .select("*")
        .eq("bot_id", botId);
    if (error)
        throw new Error(`Failed to fetch bot files for bot ID ${botId}: ${error.message}`);
    return data;
});
exports.fetchBotFilesByBotId = fetchBotFilesByBotId;
