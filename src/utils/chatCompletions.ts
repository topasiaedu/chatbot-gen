import OpenAI from "openai";

export async function getChatCompletions(client: OpenAI, prompt: string) {
  if (!client) {
    throw new Error("OpenAI client is not defined");
  }

  if (!prompt) {
    throw new Error("Prompt is required");
  }
  const completion = await client.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: "You are a helpful assistant.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  return completion.choices[0].message.content;
}