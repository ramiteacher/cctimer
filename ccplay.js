const HISTORY_STORAGE_KEY = "ccplayRecentSongs";
const MAX_HISTORY_ITEMS = 5;

const form = document.getElementById("ccplayForm");
const songTitleInput = document.getElementById("songTitle");
const submitButton = document.getElementById("submitButton");
const statusMessage = document.getElementById("statusMessage");
const recentSongsList = document.getElementById("recentSongsList");
const clearHistoryButton = document.getElementById("clearHistoryButton");
const wakeTestButton = document.getElementById("wakeTestButton");

let socket = null;
let socketConnected = false;
let reconnectTimer = null;
let wakeTestAudio = null;
let wakeTestObjectUrl = null;

const CCPLAY_WAKE_PHRASE = "헤이, 클로바";

function buildWakeWordSsml() {
  return "<speak><break time=\"120ms\"/>" + CCPLAY_WAKE_PHRASE + "<break time=\"260ms\"/></speak>";
}

function getWebSocketUrl() {
  if (window.CCPLAY_WS_URL && typeof window.CCPLAY_WS_URL === "string" && window.CCPLAY_WS_URL.trim() !== "") {
    return window.CCPLAY_WS_URL.trim();
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return protocol + "//" + window.location.host;
}

function setStatus(message, isError) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", Boolean(isError));
}

function getApiBaseUrl() {
  const socketUrl = new URL(getWebSocketUrl());
  socketUrl.protocol = socketUrl.protocol === "wss:" ? "https:" : "http:";
  return socketUrl.origin;
}

function clearWakeTestAudio() {
  if (wakeTestAudio) {
    wakeTestAudio.pause();
    wakeTestAudio.currentTime = 0;
    wakeTestAudio = null;
  }

  if (wakeTestObjectUrl) {
    URL.revokeObjectURL(wakeTestObjectUrl);
    wakeTestObjectUrl = null;
  }
}

function loadRecentSongs() {
  const rawValue = localStorage.getItem(HISTORY_STORAGE_KEY);
  if (!rawValue) {
    return [];
  }

  try {
    const parsedValue = JSON.parse(rawValue);
    if (Array.isArray(parsedValue)) {
      return parsedValue.filter(function (item) {
        return typeof item === "string" && item.trim() !== "";
      });
    }
  } catch (error) {
    return [];
  }

  return [];
}

function saveRecentSongs(recentSongs) {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(recentSongs));
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderRecentSongs() {
  const recentSongs = loadRecentSongs();

  if (recentSongs.length === 0) {
    recentSongsList.innerHTML = '<li class="ccplay-empty">아직 요청한 곡이 없습니다.</li>';
    return;
  }

  recentSongsList.innerHTML = recentSongs
    .map(function (songTitle) {
      const safeTitle = escapeHtml(songTitle);
      return (
        '<li class="ccplay-history-item">' +
        '<span class="ccplay-history-title">' +
        safeTitle +
        "</span>" +
        '<button type="button" class="ccplay-history-use" data-song-title="' +
        safeTitle +
        '">다시 입력</button>' +
        "</li>"
      );
    })
    .join("");
}

function rememberSong(songTitle) {
  const recentSongs = loadRecentSongs().filter(function (item) {
    return item !== songTitle;
  });

  recentSongs.unshift(songTitle);
  saveRecentSongs(recentSongs.slice(0, MAX_HISTORY_ITEMS));
  renderRecentSongs();
}

function connectSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  socket = new WebSocket(getWebSocketUrl());
  setStatus("요청 서버에 연결 중입니다.", false);
  submitButton.disabled = true;

  socket.addEventListener("open", function () {
    socketConnected = true;
    submitButton.disabled = false;
    if (wakeTestButton) {
      wakeTestButton.disabled = false;
    }
    setStatus("곡명을 입력하면 바로 요청이 전달됩니다.", false);
  });

  socket.addEventListener("message", function (event) {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch (error) {
      return;
    }

    if (message.type === "requestAccepted" && message.request) {
      rememberSong(message.request.songTitle);
      songTitleInput.value = "";
      setStatus("요청이 전송되었습니다. 노트북의 CCTimer가 곧 읽어줍니다.", false);
      submitButton.disabled = false;
      return;
    }

    if (message.type === "error") {
      setStatus(message.message || "요청 전송에 실패했습니다.", true);
      submitButton.disabled = !socketConnected;
    }
  });

  socket.addEventListener("close", function () {
    socketConnected = false;
    submitButton.disabled = true;
    if (wakeTestButton) {
      wakeTestButton.disabled = true;
    }
    setStatus("서버 연결이 끊겼습니다. 다시 연결 중입니다.", true);

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }

    reconnectTimer = setTimeout(connectSocket, 2000);
  });

  socket.addEventListener("error", function () {
    setStatus("WebSocket 연결 오류가 발생했습니다.", true);
  });
}

function sendRequest(songTitle) {
  if (!socketConnected || !socket || socket.readyState !== WebSocket.OPEN) {
    setStatus("서버와 연결되지 않아 요청을 보낼 수 없습니다.", true);
    return false;
  }

  socket.send(
    JSON.stringify({
      type: "submitRequest",
      songTitle: songTitle
    })
  );

  return true;
}

function handleSubmit(event) {
  event.preventDefault();

  const songTitle = songTitleInput.value.trim();
  if (!songTitle) {
    setStatus("곡명을 입력해주세요.", true);
    songTitleInput.focus();
    return;
  }

  submitButton.disabled = true;
  setStatus("요청을 전송하는 중입니다.", false);

  if (!sendRequest(songTitle)) {
    submitButton.disabled = !socketConnected;
  }
}

function handleRecentSongClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const songTitle = target.getAttribute("data-song-title");
  if (!songTitle) {
    return;
  }

  songTitleInput.value = songTitle;
  songTitleInput.focus();
}

function clearHistory() {
  localStorage.removeItem(HISTORY_STORAGE_KEY);
  renderRecentSongs();
  setStatus("최근 요청 기록을 비웠습니다.", false);
}

async function playWakeWordTest() {
  if (!wakeTestButton) {
    return;
  }

  if (!socketConnected) {
    setStatus("서버 연결 후 호출 테스트를 사용할 수 있습니다.", true);
    return;
  }

  wakeTestButton.disabled = true;
  setStatus("호출 테스트 음성을 준비하는 중입니다.", false);

  try {
    const response = await fetch(getApiBaseUrl() + "/api/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: CCPLAY_WAKE_PHRASE,
        ssml: buildWakeWordSsml()
      })
    });

    if (!response.ok) {
      let errorMessage = "호출 테스트 음성 생성에 실패했습니다.";

      try {
        const errorPayload = await response.json();
        if (errorPayload && errorPayload.error) {
          errorMessage = errorPayload.error;
        }
      } catch (error) {
        const rawText = await response.text();
        if (rawText) {
          errorMessage = rawText;
        }
      }

      throw new Error(errorMessage);
    }

    clearWakeTestAudio();
    wakeTestObjectUrl = URL.createObjectURL(await response.blob());
    wakeTestAudio = new Audio(wakeTestObjectUrl);
    wakeTestAudio.volume = 1;

    wakeTestAudio.addEventListener("ended", function () {
      clearWakeTestAudio();
      if (wakeTestButton) {
        wakeTestButton.disabled = !socketConnected;
      }
      setStatus("호출 테스트 재생이 끝났습니다.", false);
    });

    wakeTestAudio.addEventListener("error", function () {
      clearWakeTestAudio();
      if (wakeTestButton) {
        wakeTestButton.disabled = !socketConnected;
      }
      setStatus("호출 테스트 오디오 재생에 실패했습니다.", true);
    });

    await wakeTestAudio.play();
    setStatus("헤이 클로바 호출 테스트를 재생합니다.", false);
  } catch (error) {
    clearWakeTestAudio();
    setStatus(error && error.message ? error.message : "호출 테스트 생성에 실패했습니다.", true);
    wakeTestButton.disabled = !socketConnected;
  }
}

form.addEventListener("submit", handleSubmit);
recentSongsList.addEventListener("click", handleRecentSongClick);
clearHistoryButton.addEventListener("click", clearHistory);
if (wakeTestButton) {
  wakeTestButton.addEventListener("click", playWakeWordTest);
  wakeTestButton.disabled = true;
}

renderRecentSongs();
connectSocket();
