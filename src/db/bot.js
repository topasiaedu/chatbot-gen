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
exports.deleteBot = exports.updateBot = exports.createBot = exports.fetchBot = void 0;
const supabaseClient_1 = __importDefault(require("./supabaseClient"));
// CRUD operations for bots
const fetchBot = (botId) => __awaiter(void 0, void 0, void 0, function* () {
    const { data, error } = yield supabaseClient_1.default
        .from("bots")
        .select("*")
        .eq("id", botId)
        .single();
    if (error)
        throw new Error(`Failed to fetch bot with ID ${botId}: ${error.message}`);
    return data;
});
exports.fetchBot = fetchBot;
const createBot = (bot) => __awaiter(void 0, void 0, void 0, function* () {
    const { data, error } = yield supabaseClient_1.default
        .from("bots")
        .insert([bot])
        .select("*")
        .single();
    if (error)
        throw new Error(`Failed to create bot: ${error.message}`);
    return data;
});
exports.createBot = createBot;
const updateBot = (botId, bot) => __awaiter(void 0, void 0, void 0, function* () {
    const { data, error } = yield supabaseClient_1.default
        .from("bots")
        .update(bot)
        .eq("id", botId)
        .select("*")
        .single();
    if (error)
        throw new Error(`Failed to update bot with ID ${botId}: ${error.message}`);
    return data;
});
exports.updateBot = updateBot;
const deleteBot = (botId) => __awaiter(void 0, void 0, void 0, function* () {
    const { error } = yield supabaseClient_1.default.from("bots").delete().eq("id", botId);
    if (error)
        throw new Error(`Failed to delete bot with ID ${botId}: ${error.message}`);
});
exports.deleteBot = deleteBot;
