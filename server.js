const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { WebSocketServer } = require("ws");

const HOST = "0.0.0.0";
const PORT = process.env.PORT ? Number(process.env.PORT) : 8123;
const ROOT_DIR = __dirname;
const QUEUE_DATA_FILE = path.join(ROOT_DIR, "queue-data.json");

const EDGE_TTS_VOICE = process.env.EDGE_TTS_VOICE || "ko-KR-SunHiNeural";
const EDGE_TTS_RATE = process.env.EDGE_TTS_RATE || "-8%";
const EDGE_TTS_VOLUME = process.env.EDGE_TTS_VOLUME || "+100%";
const EDGE_TTS_PITCH = process.env.EDGE_TTS_PITCH || "+0Hz";

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
    const audioBuffer = await synthesizeEdgeTtsAudio(text);
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audioBuffer.length)
    });
    response.end(audioBuffer);
  } catch (error) {
    console.error("TTS 프록시 실패:", error);
    sendJson(response, 502, { error: error instanceof Error ? error.message : "TTS 프록시 서버에서 오류가 발생했습니다." });
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || "edge-tts 실행에 실패했습니다."));
    });
  });
}

async function synthesizeEdgeTtsAudio(text) {
  const tempFilePath = path.join(
    os.tmpdir(),
    "ccplay-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8) + ".mp3"
  );

  try {
    await runCommand("edge-tts", [
      "--voice",
      EDGE_TTS_VOICE,
      "--rate=" + EDGE_TTS_RATE,
      "--volume=" + EDGE_TTS_VOLUME,
      "--pitch=" + EDGE_TTS_PITCH,
      "--text",
      text,
      "--write-media",
      tempFilePath
    ]);

    return fs.readFileSync(tempFilePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error("edge-tts가 서버에 설치되지 않았습니다.");
    }

    throw error;
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", "http://localhost");

  if (requestUrl.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      ttsProvider: "edge-tts",
      edgeVoice: EDGE_TTS_VOICE,
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
