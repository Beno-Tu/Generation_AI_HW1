# Beno GPT v2

Beno GPT v2 is a browser-based personal chatbot console for Generation AI Homework 02. It extends the Homework 01 web chatbot with long-term memory, multimodal input, automatic model routing, streaming responses, and a small local MCP-style tool layer.

## System Introduction

The app runs as a lightweight Node.js HTTP server with a vanilla HTML/CSS/JavaScript frontend. Users can create and organize chats, attach images, tune generation parameters, set a custom system prompt, and export or import chat history. Conversation state is stored in the browser, so chats survive refreshes without requiring a database.

The v2 upgrade adds persistent long-term memory. Users can save durable facts, preferences, or project notes in the memory panel. These memories are stored in `localStorage` and injected into future model calls as system context, while the existing memory-turn slider controls how many recent chat turns are included.

Model routing can be left on `Auto route best model`. The server inspects the request and selects a model: vision prompts route to Llama 4 Scout, long or reasoning-heavy prompts route to Llama 3.3 70B, and normal short chat routes to Llama 3.1 8B. Users can still override the route with a fixed model or a custom Groq model id.

Tool use is implemented through a local MCP-style registry. The server exposes `/api/mcp/tools` and `/api/mcp/call`, and the chat endpoint can let the model call local tools before streaming the final answer. Current tools include current time, arithmetic calculation, and tool discovery.

## Run Locally

Set a Groq API key, then start the server:

```powershell
$env:GROQ_API_KEY="your_api_key_here"
node server.js
```

Open `http://localhost:5173` in a browser.

## Main Features

- Streaming chat responses from Groq-compatible chat completions.
- Long-term memory stored locally and injected into model context.
- Multimodal image input for vision-capable routed or selected models.
- Automatic routing between fast, reasoning, and vision models.
- Local MCP-style tool registry with model tool-calling support.
- Chat history, folders, rename/delete, import/export, and parameter tuning.

## Files

- `index.html`: application layout and controls.
- `styles.css`: responsive UI styling.
- `app.js`: frontend state, memory, routing status, image handling, and streaming client.
- `server.js`: static server, Groq proxy, model router, tool planner, and MCP-style endpoints.
- `ARCHITECTURE.md`: system architecture diagram and request flow.
