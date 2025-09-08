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
exports.getFineTunedChat = getFineTunedChat;
const chat_message_1 = require("../db/chat_message");
function getFineTunedChat(client, modelId, prompt, description, messages, userEmail, botId) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!client) {
            throw new Error("OpenAI client is not defined");
        }
        if (!prompt) {
            throw new Error("Prompt is required");
        }
        // Example of messages from input
        // [
        //   { text: "Hi there", sender: "user" },
        //   { text:  Hello! How can I help you today?", sender: "bot" },
        // ]
        if (!messages) {
            messages = [];
        }
        let messagesPayload = messages.map((message) => {
            const role = message.sender === "user" ? "user" : "assistant";
            return {
                role: role,
                content: message.text,
            };
        });
        const completion = yield client.chat.completions.create({
            model: modelId,
            messages: [
                {
                    role: "system",
                    content: description || "You are a helpful assistant.",
                },
                ...messagesPayload,
                {
                    role: "user",
                    content: prompt,
                },
            ],
        });
        const botResponse = completion.choices[0].message.content;
        // Save chat messages to database if email and botId are provided
        if (userEmail && botId && botResponse) {
            try {
                // Save user message
                yield (0, chat_message_1.saveChatMessage)({
                    bot_id: botId,
                    user_email: userEmail,
                    sender: "user",
                    message_text: prompt,
                });
                // Save bot response
                yield (0, chat_message_1.saveChatMessage)({
                    bot_id: botId,
                    user_email: userEmail,
                    sender: "bot",
                    message_text: botResponse,
                });
            }
            catch (error) {
                // Log the error but don't fail the chat response
                console.error("Failed to save chat messages:", error);
            }
        }
        return botResponse;
    });
}
