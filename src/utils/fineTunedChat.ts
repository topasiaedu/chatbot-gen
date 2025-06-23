import OpenAI from "openai";
import { saveChatMessage } from "../db/chat_message";

export async function getFineTunedChat(
  client: OpenAI,
  modelId: string,
  prompt: string,
  description?: string | null,
  messages?: any[],
  userEmail?: string,
  botId?: string
) {
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
    const role:"function" | "user" | "assistant" | "system" | "tool" = message.sender === "user" ? "user" : "assistant";
    return {
      role: role,
      content: message.text,
    };
  });

  const completion = await client.chat.completions.create({
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
      await saveChatMessage({
        bot_id: botId,
        user_email: userEmail,
        sender: "user",
        message_text: prompt,
      });

      // Save bot response
      await saveChatMessage({
        bot_id: botId,
        user_email: userEmail,
        sender: "bot",
        message_text: botResponse,
      });
    } catch (error) {
      // Log the error but don't fail the chat response
      console.error("Failed to save chat messages:", error);
    }
  }

  return botResponse;
}
