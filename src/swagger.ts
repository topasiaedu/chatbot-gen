import swaggerJsdoc from "swagger-jsdoc";

// Swagger definition
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Chatbot Generator API",
      version: "1.0.0",
      description: "API documentation for the Chatbot Generator application",
      contact: {
        name: "API Support",
      },
      license: {
        name: "MIT",
      },
    },
    servers: [
      {
        url: "http://localhost:8000",
        description: "Development server",
      },
    ],
    components: {
      schemas: {
        Bot: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Unique identifier for the bot",
            },
            name: {
              type: "string",
              description: "Name of the bot",
            },
            description: {
              type: "string",
              description: "Description of the bot",
            },
            status: {
              type: "string",
              description: "Current status of the bot (e.g., TRAINING, TRAINED)",
            },
            progress: {
              type: "number",
              description: "Training progress percentage (0-100)",
            },
            training_breadth: {
              type: "number",
              description: "Training breadth parameter",
            },
            training_depth: {
              type: "number",
              description: "Training depth parameter",
            },
            active_version: {
              type: "string",
              description: "ID of the active model version",
            },
          },
        },
        BotFile: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Unique identifier for the file",
            },
            bot_id: {
              type: "string",
              description: "ID of the bot this file belongs to",
            },
            file_name: {
              type: "string",
              description: "Name of the file",
            },
            file_url: {
              type: "string",
              description: "URL to access the file",
            },
            dataset: {
              type: "string",
              description: "Dataset generated from this file, if any",
            },
          },
        },
        BotModel: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Unique identifier for the model",
            },
            bot_id: {
              type: "string",
              description: "ID of the bot this model belongs to",
            },
            open_ai_id: {
              type: "string",
              description: "OpenAI model ID",
            },
            version: {
              type: "string",
              description: "Version string for this model",
            },
            created_at: {
              type: "string",
              format: "date-time",
              description: "Creation timestamp",
            },
          },
        },
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                message: {
                  type: "string",
                  description: "Error message",
                },
                details: {
                  type: "object",
                  description: "Additional error details, if any",
                },
              },
            },
          },
        },
      },
    },
  },
  apis: ["./src/server.ts"], // Path to the API handlers
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

export default swaggerSpec; 