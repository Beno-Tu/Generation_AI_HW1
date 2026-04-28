const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 5173;
const API_KEY = process.env.GROQ_API_KEY;
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "llama-3.1-8b-instant";
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const REASONING_MODEL = "llama-3.3-70b-versatile";

const mimeTypes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".md": "text/markdown"
};

const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "get_current_time",
      description: "Get the current local date and time for a named IANA timezone.",
      parameters: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description: "IANA timezone, for example Asia/Taipei or America/New_York."
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "calculate",
      description: "Safely evaluate a simple arithmetic expression.",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "Arithmetic expression using numbers, parentheses, +, -, *, /, %, and **."
          }
        },
        required: ["expression"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_available_tools",
      description: "List the local MCP-style tools available to the chatbot.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  }
];

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function sendSse(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function safeFilePath(urlPath) {
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const normalized = path.normalize(safePath).replace(/^([.][.][\/])+/, "");
  return path.join(__dirname, normalized);
}

function getMessageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text || "";
      return "";
    })
    .join(" ");
}

function hasImageContent(messages) {
  return messages.some((message) =>
    Array.isArray(message.content) &&
    message.content.some((part) => part?.type === "image_url")
  );
}

function routeModel(requestedModel, messages) {
  if (requestedModel && requestedModel !== "auto") return requestedModel;
  if (hasImageContent(messages)) return VISION_MODEL;

  const text = messages.map((message) => getMessageText(message.content)).join(" ").toLowerCase();
  const needsReasoning = /\b(analy[sz]e|architecture|debug|refactor|proof|compare|plan|reason|complex|程式|架構|分析|除錯|重構)\b/.test(text);
  const isLong = text.length > 1800;

  if (needsReasoning || isLong) return REASONING_MODEL;
  return DEFAULT_MODEL;
}

function getRouteReason(model, messages) {
  if (hasImageContent(messages)) return "vision input detected";
  if (model === REASONING_MODEL) return "reasoning or long-context prompt detected";
  return "fast general chat";
}

function parseToolArgs(rawArgs) {
  if (!rawArgs) return {};
  if (typeof rawArgs === "object") return rawArgs;
  try {
    return JSON.parse(rawArgs);
  } catch {
    return {};
  }
}

function runLocalTool(name, args = {}) {
  if (name === "get_current_time") {
    const timezone = args.timezone || "Asia/Taipei";
    const now = new Date();
    return {
      timezone,
      iso: now.toISOString(),
      formatted: new Intl.DateTimeFormat("en-US", {
        dateStyle: "full",
        timeStyle: "long",
        timeZone: timezone
      }).format(now)
    };
  }

  if (name === "calculate") {
    const expression = String(args.expression || "");
    if (!/^[\d\s+\-*/().,%*]+$/.test(expression)) {
      throw new Error("Expression contains unsupported characters.");
    }
    const normalized = expression.replace(/,/g, "");
    const result = Function(`"use strict"; return (${normalized});`)();
    if (typeof result !== "number" || !Number.isFinite(result)) {
      throw new Error("Expression did not produce a finite number.");
    }
    return { expression, result };
  }

  if (name === "list_available_tools") {
    return toolDefinitions.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description
    }));
  }

  throw new Error(`Unknown tool: ${name}`);
}

function getLatestUserText(messages) {
  const userMessages = messages.filter((message) => message.role === "user");
  const latest = userMessages[userMessages.length - 1];
  return latest ? getMessageText(latest.content).trim() : "";
}

function detectDirectToolResponse(messages) {
  const text = getLatestUserText(messages);
  if (!text) return null;

  const asksForTime =
    /幾點|現在時間|目前時間|現在幾點|time now|current time|what time/i.test(text);
  if (asksForTime) {
    const timezone =
      /new york|紐約/i.test(text) ? "America/New_York" :
      /tokyo|東京|日本/i.test(text) ? "Asia/Tokyo" :
      /london|倫敦/i.test(text) ? "Europe/London" :
      "Asia/Taipei";
    const result = runLocalTool("get_current_time", { timezone });
    return {
      toolName: "get_current_time",
      content: `現在時間是 ${result.formatted}（${result.timezone}）。`
    };
  }

  const asksToCalculate = /計算|算一下|calculate|what is/i.test(text);
  const expressionMatch = text.match(/[-+*/().%\d\s,]{3,}/);
  if (asksToCalculate && expressionMatch) {
    const expression = expressionMatch[0].trim();
    if (expression) {
      const result = runLocalTool("calculate", { expression });
      return {
        toolName: "calculate",
        content: `${expression} = ${result.result}`
      };
    }
  }

  return null;
}

async function callGroq(payload) {
  return fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`
    },
    body: JSON.stringify(payload)
  });
}

async function streamGroqResponse(response, res) {
  if (!response.ok || !response.body) {
    const errorText = await response.text();
    const message = errorText || `Upstream error (status ${response.status})`;
    console.error("Groq upstream error:", response.status, message);
    sendSse(res, { type: "error", message });
    res.end();
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      const lines = part.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.replace("data:", "").trim();
        if (!data) continue;
        if (data === "[DONE]") {
          sendSse(res, { type: "done" });
          res.end();
          return;
        }

        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content;
          if (delta) {
            sendSse(res, { type: "delta", content: delta });
          }
        } catch (error) {
          console.error("Stream parse error:", error);
          sendSse(res, { type: "error", message: "Stream parse error" });
        }
      }
    }
  }

  sendSse(res, { type: "done" });
  res.end();
}

async function runToolPlanningTurn(payload, res) {
  const planningPayload = {
    ...payload,
    stream: false,
    tools: toolDefinitions,
    tool_choice: "auto"
  };
  const planningResponse = await callGroq(planningPayload);
  if (!planningResponse.ok) {
    const errorText = await planningResponse.text();
    console.error("Tool planning failed; falling back to plain stream:", errorText);
    sendSse(res, {
      type: "tool",
      message: "Tool planning unavailable; continuing without tools."
    });
    return payload;
  }

  const planningJson = await planningResponse.json();
  const assistantMessage = planningJson?.choices?.[0]?.message;
  const toolCalls = assistantMessage?.tool_calls || [];

  if (toolCalls.length === 0) {
    return payload;
  }

  sendSse(res, {
    type: "tool",
    message: `Running ${toolCalls.length} local tool${toolCalls.length === 1 ? "" : "s"}...`
  });

  const toolMessages = toolCalls.map((toolCall) => {
    const toolName = toolCall.function?.name;
    try {
      const result = runLocalTool(toolName, parseToolArgs(toolCall.function?.arguments));
      return {
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify({ ok: true, result })
      };
    } catch (error) {
      return {
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify({ ok: false, error: error?.message || "Tool failed." })
      };
    }
  });

  return {
    ...payload,
    messages: [...payload.messages, assistantMessage, ...toolMessages],
    stream: true
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/mcp/tools") {
    sendJson(res, 200, {
      protocol: "local-mcp-v1",
      tools: toolDefinitions.map((tool) => tool.function)
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/mcp/call") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { name, arguments: args } = JSON.parse(body || "{}");
        sendJson(res, 200, { ok: true, result: runLocalTool(name, args) });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error?.message || "Tool call failed." });
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat/stream") {
    let body = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8_000_000) {
        tooLarge = true;
        res.writeHead(413, { "Content-Type": "text/event-stream; charset=utf-8" });
        sendSse(res, { type: "error", message: "Payload too large. Please use a smaller image." });
        res.end();
        req.destroy();
      }
    });

    req.on("end", async () => {
      if (tooLarge) return;
      try {
        const { model, messages, params, toolsEnabled } = JSON.parse(body || "{}");
        const requestMessages = Array.isArray(messages) ? messages : [];
        const routedModel = routeModel(model, requestMessages);
        const payload = {
          model: routedModel,
          messages: requestMessages,
          temperature: typeof params?.temperature === "number" ? params.temperature : 0.7,
          top_p: typeof params?.top_p === "number" ? params.top_p : 1,
          max_tokens: typeof params?.max_tokens === "number" ? params.max_tokens : 300,
          stream: true
        };

        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        });

        sendSse(res, {
          type: "route",
          model: routedModel,
          reason: getRouteReason(routedModel, requestMessages)
        });

        let streamPayload = payload;
        if (toolsEnabled && !hasImageContent(requestMessages)) {
          const directToolResponse = detectDirectToolResponse(requestMessages);
          if (directToolResponse) {
            sendSse(res, {
              type: "tool",
              message: `Running local tool: ${directToolResponse.toolName}`
            });
            sendSse(res, { type: "delta", content: directToolResponse.content });
            sendSse(res, { type: "done" });
            res.end();
            return;
          }

          if (!API_KEY) {
            sendSse(res, { type: "error", message: "GROQ_API_KEY is not set on the server." });
            res.end();
            return;
          }

          const plannedPayload = await runToolPlanningTurn(payload, res);
          if (!plannedPayload) return;
          streamPayload = plannedPayload;
        } else if (toolsEnabled) {
          sendSse(res, {
            type: "tool",
            message: "Vision request detected; tools skipped for this turn."
          });
        }

        if (!API_KEY) {
          sendSse(res, { type: "error", message: "GROQ_API_KEY is not set on the server." });
          res.end();
          return;
        }

        const response = await callGroq(streamPayload);
        await streamGroqResponse(response, res);
      } catch (error) {
        console.error("Server error:", error);
        res.writeHead(500, { "Content-Type": "text/event-stream; charset=utf-8" });
        sendSse(res, { type: "error", message: "Server error." });
        res.end();
      }
    });

    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const filePath = safeFilePath(requestUrl.pathname);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "text/plain" });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
