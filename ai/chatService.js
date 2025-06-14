const { VertexAI } = require("@google-cloud/vertexai");
const functionDeclarations = require("./tools");


const vertexAI = new VertexAI({
  project: "translation-demo-050624",
  location: "us-central1",
});

const activeChats = new Map();

exports.getChatSession = (...args) => {
  const [senderId, instruction, systemPrompt] = args;

  if (!activeChats.has(senderId)) {
    const generativeModel = vertexAI.preview.getGenerativeModel({
      model: "gemini-2.0-flash-lite",
      generationConfig: {
        maxOutputTokens: 256,
        temperature: 0.3,
        topP: 0.95,
      },
      systemInstruction: {
        parts: [
          {
            text: instruction || systemPrompt,
          },
        ],
      },
      tools: functionDeclarations,
    });
    const chat = generativeModel.startChat();
    activeChats.set(senderId, chat);
  }
  return activeChats.get(senderId);
};
