import OpenAI from "openai";

export async function getFineTunedChat(
  client: OpenAI,
  modelId: string,
  prompt: string,
  description?: string | null,
  messages?: any[]
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

  return completion.choices[0].message.content;
}
