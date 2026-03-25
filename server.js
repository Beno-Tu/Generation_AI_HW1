const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 5173;
const API_KEY = process.env.GROQ_API_KEY;
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

const mimeTypes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json"
};

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, { "Content-Type": "application/json" });
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

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/chat/stream") {
    if (!API_KEY) {
      res.writeHead(500, { "Content-Type": "text/event-stream" });
      sendSse(res, { type: "error", message: "GROQ_API_KEY is not set on the server." });
      res.end();
      return;
    }

    let body = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8_000_000) {
        tooLarge = true;
        res.writeHead(413, { "Content-Type": "text/event-stream" });
        sendSse(res, { type: "error", message: "Payload too large. Please use a smaller image." });
        res.end();
        req.destroy();
      }
    });

    req.on("end", async () => {
      if (tooLarge) return;
      try {
        const { model, messages, params } = JSON.parse(body || "{}");
        const payload = {
          model: model || "gpt-4.1-mini",
          messages: Array.isArray(messages) ? messages : [],
          temperature: typeof params?.temperature === "number" ? params.temperature : 0.7,
          top_p: typeof params?.top_p === "number" ? params.top_p : 1,
          max_tokens: typeof params?.max_tokens === "number" ? params.max_tokens : 300,
          stream: true
        };

        const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${API_KEY}`
          },
          body: JSON.stringify(payload)
        });

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        });

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
      } catch (error) {
        console.error("Server error:", error);
        res.writeHead(500, { "Content-Type": "text/event-stream" });
        sendSse(res, { type: "error", message: "Server error." });
        res.end();
      }
    });

    return;
  }

  const filePath = safeFilePath(req.url);

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
