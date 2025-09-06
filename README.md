# Chatbot Generator

A powerful chatbot generation system that allows you to train custom bots using various file types.

## Features

- Create and train custom bots using uploaded files
- Fine-tune models based on content from multiple file formats
- Chat with trained bots using a responsive API
- Control training breadth and depth for customized bot behavior

## Supported File Types

The system currently supports the following file formats for bot training:

| File Type | Extension | Description |
|-----------|-----------|-------------|
| PDF       | `.pdf`    | Extracts and processes text from PDF documents |
| Word      | `.docx`   | Processes Microsoft Word documents |
| PowerPoint| `.pptx`   | Extracts content from PowerPoint presentations |
| Excel     | `.xlsx`, `.xls` | Processes data from Excel spreadsheets |
| CSV       | `.csv`    | Handles comma-separated values files |
| Text      | `.txt`    | Processes plain text files |
| HTML      | `.html`   | Extracts text content from HTML files |

## Getting Started

### Prerequisites

- Node.js 16+
- npm or yarn
- OpenAI API key

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/chatbot-gen.git
   cd chatbot-gen
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory with your OpenAI API key:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   ```

4. Build the project:
   ```
   npm run build
   ```

5. Start the server:
   ```
   npm start
   ```

The server will start running at `http://localhost:8000`.

## API Endpoints

### Health Check
```
GET /health
```
Returns the current status of the service.

### Chat Completion
```
POST /chat
Body: { "prompt": "Your message here" }
```
Gets a completion from the OpenAI model.

### Train Bot
```
POST /train-bot
Body: { "modelId": "bot-id-here" }
```
Starts the training process for a bot with the specified ID.

### Chat with Bot
```
POST /chat-with-bot
Body: { "botId": "bot-id-here", "prompt": "Your message here", "messages": [] }
```
Interact with a trained bot.

### Generate Datasets
```
POST /generate-datasets
Body: { "fileUrl": "url-to-file" }
```
Generate training datasets from a file URL.

### Chat with Transcriptions
```
POST /chat-with-transcriptions
Body: {
  "prompt": "Your question",
  "transcriptionUrls": [
    "https://<your-project>.supabase.co/storage/v1/object/public/transcription/result/<taskId>.txt"
  ],
  "messages": [{ "role": "user", "content": "previous message" }]
}
```
Uses one or more public transcription result files as context and returns an answer. Messages are optional; frontend is responsible for chat history storage.

## Realtime Transcription Processing

When the frontend uploads a media file to the public bucket `transcription/medias/...` and then inserts a row into `public.transciption_task` with `media_url` (full public URL), the server subscribes to realtime changes and automatically processes new tasks using OpenAI Whisper and stores the plain text result at `transcription/result/<taskId>.txt`.

### Environment variables

Add the following to `.env`:
```
OPENAI_API_KEY="..."
SUPABASE_URL="..."
SUPABASE_SERVICE_KEY="..."
TRANSCRIPTION_BUCKET_NAME="transcription"
```

### Storage layout

- Bucket: `transcription` (public)
- Upload media to: `medias/<anything>/<fileName>`
- Server writes results to: `result/<taskId>.txt` and saves the full public URL in `public.transciption_task.result_url`.

### Database contract

- Frontend inserts into `public.transciption_task` after uploading media:
  - `id`: UUID (server listens for INSERT)
  - `media_url`: full public URL to the uploaded media
  - `result_url`: initially null (server fills after processing)

Language is auto-detected by Whisper and can return Chinese text.

## Training Process

The bot training process involves these steps:

1. Upload files for the bot to learn from
2. The system extracts text from the files based on their format
3. Content is broken into chunks for processing
4. A fine-tuned model is created based on the content
5. The bot becomes available for chatting once training is complete

## License

[Insert your license here]

## Contact

[Your contact information] 