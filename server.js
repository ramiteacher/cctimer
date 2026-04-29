const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { WebSocketServer } = require("ws");

const HOST = "0.0.0.0";
const PORT = process.env.PORT ? Number(process.env.PORT) : 8123;
const ROOT_DIR = __dirname;
const QUEUE_DATA_FILE = path.join(ROOT_DIR, "queue-data.json");

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const ELEVENLABS_OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_22050_32";
const ELEVENLABS_LANGUAGE_CODE = process.env.ELEVENLABS_LANGUAGE_CODE || "ko";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

let queueState = loadQueueState();

function loadQueueState() {
  if (!fs.existsSync(QUEUE_DATA_FILE)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(QUEUE_DATA_FILE, "utf8"));
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: String(item.id || createRequestId()),
        songTitle: String(item.songTitle || "").trim(),
        requestedAt: typeof item.requestedAt === "number" ? item.requestedAt : Date.now(),
        status: normalizeStatus(item.status)
      }))
      .filter((item) => item.songTitle);
  } catch (error) {
    console.error("queue-data.json 읽기 실패:", error);
    return [];
  }
}

function saveQueueState() {
  const prunedState = pruneCompletedHistory(queueState);
  queueState = prunedState;
  fs.writeFileSync(QUEUE_DATA_FILE, JSON.stringify(prunedState, null, 2), "utf8");
}

function pruneCompletedHistory(items) {
  const activeItems = items.filter((item) => item.status === "queued" || item.status === "speaking");
  const completedItems = items
    .filter((item) => item.status === "done" || item.status === "cancelled")
    .sort((left, right) => right.requestedAt - left.requestedAt)
    .slice(0, 100);

  return [...activeItems, ...completedItems].sort((left, right) => {
    if (left.requestedAt === right.requestedAt) {
      return left.id.localeCompare(right.id);
    }
    return left.requestedAt - right.requestedAt;
  });
}

function normalizeStatus(status) {
  if (status === "queued" || status === "speaking" || status === "done" || status === "cancelled") {
    return status;
  }
  return "queued";
}

function createRequestId() {
  return "req_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function getSortedQueueState() {
  return queueState.slice().sort((left, right) => {
    if (left.requestedAt === right.requestedAt) {
      return left.id.localeCompare(right.id);
    }
    return left.requestedAt - right.requestedAt;
  });
}

function getQueuedRequests() {
  return getSortedQueueState().filter((item) => item.status === "queued");
}

function getSpeakingRequest() {
  return getSortedQueueState().find((item) => item.status === "speaking") || null;
}

function createSnapshotPayload() {
  return {
    type: "queueSnapshot",
    queue: getQueuedRequests(),
    active: getSpeakingRequest()
  };
}

function broadcastSnapshot() {
  const payload = JSON.stringify(createSnapshotPayload());

  webSocketServer.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  });
}

function sendSnapshot(socket) {
  socket.send(JSON.stringify(createSnapshotPayload()));
}

function sendError(socket, message) {
  socket.send(JSON.stringify({ type: "error", message }));
}

function sendJson(response, statusCode, payload, extraHeaders) {
  response.writeHead(
    statusCode,
    Object.assign(
      {
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8"
      },
      extraHeaders || {}
    )
  );
  response.end(JSON.stringify(payload));
}

function markRequestStatus(requestId, status) {
  const target = queueState.find((item) => item.id === requestId);
  if (!target) {
    return null;
  }

  target.status = normalizeStatus(status);
  saveQueueState();
  broadcastSnapshot();
  return target;
}

function cancelQueuedRequests() {
  let changed = false;

  queueState.forEach((item) => {
    if (item.status === "queued") {
      item.status = "cancelled";
      changed = true;
    }
  });

  if (changed) {
    saveQueueState();
    broadcastSnapshot();
  }
}

function requeueSpeakingRequests() {
  let changed = false;

  queueState.forEach((item) => {
    if (item.status === "speaking") {
      item.status = "queued";
      changed = true;
    }
  });

  if (changed) {
    saveQueueState();
    broadcastSnapshot();
  }
}

function collectRequestBody(request) {
  return new Promise((resolve, reject) => {
    let rawBody = "";

    request.on("data", (chunk) => {
      rawBody += chunk;
      if (rawBody.length > 32768) {
        reject(new Error("요청 본문이 너무 큽니다."));
        request.destroy();
      }
    });

    request.on("end", () => {
      resolve(rawBody);
    });

    request.on("error", reject);
  });
}

async function handleTtsRequest(request, response) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });
    response.end();
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "POST 요청만 허용됩니다." });
    return;
  }

  if (!ELEVENLABS_API_KEY) {
    sendJson(response, 503, { error: "서버에 ElevenLabs API 키가 설정되지 않았습니다." });
    return;
  }

  let payload;

  try {
    const rawBody = await collectRequestBody(request);
    payload = JSON.parse(rawBody || "{}");
  } catch (error) {
    sendJson(response, 400, { error: "잘못된 JSON 요청입니다." });
    return;
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) {
    sendJson(response, 400, { error: "TTS로 변환할 텍스트가 비어 있습니다." });
    return;
  }

  if (text.length > 200) {
    sendJson(response, 400, { error: "TTS 텍스트가 너무 깁니다." });
    return;
  }

  try {
    const elevenResponse = await fetch(
      "https://api.elevenlabs.io/v1/text-to-speech/" +
        encodeURIComponent(ELEVENLABS_VOICE_ID) +
        "?output_format=" +
        encodeURIComponent(ELEVENLABS_OUTPUT_FORMAT),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY
        },
        body: JSON.stringify({
          text: text,
          model_id: ELEVENLABS_MODEL_ID,
          language_code: ELEVENLABS_LANGUAGE_CODE,
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.75,
            style: 0.2,
            use_speaker_boost: true,
            speed: 0.95
          }
        })
      }
    );

    if (!elevenResponse.ok) {
      const errorText = await elevenResponse.text();
      console.error("ElevenLabs TTS 오류:", errorText);

      let upstreamMessage = "ElevenLabs 음성 생성에 실패했습니다.";

      try {
        const parsedError = JSON.parse(errorText);
        if (parsedError && typeof parsedError.detail === "object" && parsedError.detail && parsedError.detail.message) {
          upstreamMessage = String(parsedError.detail.message);
        } else if (parsedError && typeof parsedError.detail === "string") {
          upstreamMessage = parsedError.detail;
        } else if (parsedError && parsedError.message) {
          upstreamMessage = String(parsedError.message);
        }
      } catch (error) {
        if (errorText) {
          upstreamMessage = errorText;
        }
      }

      sendJson(response, 502, { error: upstreamMessage });
      return;
    }

    const audioBuffer = Buffer.from(await elevenResponse.arrayBuffer());
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audioBuffer.length)
    });
    response.end(audioBuffer);
  } catch (error) {
    console.error("TTS 프록시 실패:", error);
    sendJson(response, 500, { error: "TTS 프록시 서버에서 오류가 발생했습니다." });
  }
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", "http://localhost");

  if (requestUrl.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      hasElevenLabsKey: Boolean(ELEVENLABS_API_KEY),
      queueSize: getQueuedRequests().length
    });
    return;
  }

  if (requestUrl.pathname === "/api/tts") {
    handleTtsRequest(request, response);
    return;
  }

  const requestPath = requestUrl.pathname === "/" ? "/index.html" : decodeURIComponent(requestUrl.pathname);
  const normalizedPath = path.normalize(requestPath).replace(/^(\.\.[\\/])+/, "");
  const resolvedPath = path.join(ROOT_DIR, normalizedPath);

  if (!resolvedPath.startsWith(ROOT_DIR)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  fs.readFile(resolvedPath, (error, data) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8"
      });
      response.end(error.code === "ENOENT" ? "Not Found" : "Internal Server Error");
      return;
    }

    const extension = path.extname(resolvedPath).toLowerCase();
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream"
    });
    response.end(data);
  });
});

const webSocketServer = new WebSocketServer({ server });

webSocketServer.on("connection", (socket) => {
  sendSnapshot(socket);

  socket.on("message", (rawMessage) => {
    let message;

    try {
      message = JSON.parse(String(rawMessage));
    } catch (error) {
      sendError(socket, "잘못된 메시지 형식입니다.");
      return;
    }

    if (!message || typeof message !== "object") {
      sendError(socket, "빈 메시지는 처리할 수 없습니다.");
      return;
    }

    switch (message.type) {
      case "submitRequest": {
        const songTitle = typeof message.songTitle === "string" ? message.songTitle.trim() : "";
        if (!songTitle) {
          sendError(socket, "곡명을 입력해주세요.");
          return;
        }

        const requestItem = {
          id: createRequestId(),
          songTitle: songTitle,
          requestedAt: Date.now(),
          status: "queued"
        };

        queueState.push(requestItem);
        saveQueueState();
        socket.send(JSON.stringify({ type: "requestAccepted", request: requestItem }));
        broadcastSnapshot();
        return;
      }

      case "claimNext": {
        if (getSpeakingRequest()) {
          socket.send(JSON.stringify({ type: "claimResult", request: null }));
          return;
        }

        const nextRequest = getQueuedRequests()[0] || null;
        if (!nextRequest) {
          socket.send(JSON.stringify({ type: "claimResult", request: null }));
          return;
        }

        nextRequest.status = "speaking";
        saveQueueState();
        socket.send(JSON.stringify({ type: "claimResult", request: nextRequest }));
        broadcastSnapshot();
        return;
      }

      case "completeRequest": {
        if (!message.requestId || !message.status) {
          sendError(socket, "요청 완료 메시지가 올바르지 않습니다.");
          return;
        }

        const updated = markRequestStatus(String(message.requestId), String(message.status));
        if (!updated) {
          sendError(socket, "대상 요청을 찾지 못했습니다.");
        }
        return;
      }

      case "deleteRequest": {
        if (!message.requestId) {
          sendError(socket, "삭제할 요청 ID가 없습니다.");
          return;
        }

        const updated = markRequestStatus(String(message.requestId), "cancelled");
        if (!updated) {
          sendError(socket, "삭제할 요청을 찾지 못했습니다.");
        }
        return;
      }

      case "clearQueue":
        cancelQueuedRequests();
        return;

      case "requeueSpeaking":
        requeueSpeakingRequests();
        return;

      case "ping":
        socket.send(JSON.stringify({ type: "pong", now: Date.now() }));
        return;

      default:
        sendError(socket, "알 수 없는 메시지 타입입니다.");
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log("CCTimer server running at http://localhost:" + PORT);
});
