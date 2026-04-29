var refreshIntervalId;
var refreshTimeoutId;

let currentMode = null;
let debugMode = false;
let debugTime = null;
let currentAudio = null;
let currentBellAudio = null;
let timerAudioActive = false;
let ccplaySpeechActive = false;
let preferredSpeechVoice = null;
let currentSpeechUtterance = null;
let speechCancelReason = null;

let socket = null;
let socketConnected = false;
let socketReconnectTimer = null;
let socketClaimPending = false;
let ccplayQueue = [];
let activeCcplayRequest = null;
let ccplaySpeechInterrupted = false;
let ccplayConnectionMessage = "서버 연결 대기 중";
let ccplayLastError = "";

const standardSchedule = [
  { time: "10:50", type: "rest", message: "지금은 쉬는시간 입니다." },
  { time: "11:00", type: "work", message: "지금은 근무시간 입니다." },
  { time: "11:50", type: "lunch", message: "지금은 점심시간 입니다." },
  { time: "12:00", type: "work", message: "지금은 근무시간 입니다." },
  { time: "12:50", type: "rest", message: "지금은 쉬는시간 입니다." },
  { time: "13:00", type: "work", message: "지금은 근무시간 입니다." },
  { time: "13:50", type: "rest", message: "지금은 쉬는시간 입니다." },
  { time: "14:00", type: "work", message: "지금은 근무시간 입니다." },
  { time: "14:50", type: "rest", message: "지금은 쉬는시간 입니다." },
  { time: "15:00", type: "work", message: "지금은 근무시간 입니다." },
  { time: "17:00", type: "rest", message: "지금은 쉬는시간 입니다." },
  { time: "17:30", type: "work", message: "지금은 근무시간 입니다." },
  { time: "17:50", type: "rest", message: "지금은 쉬는시간 입니다." },
  { time: "18:00", type: "work", message: "지금은 근무시간 입니다." },
  { time: "18:50", type: "rest", message: "지금은 쉬는시간 입니다." },
  { time: "19:00", type: "work", message: "지금은 근무시간 입니다." },
  { time: "19:50", type: "rest", message: "지금은 쉬는시간 입니다." }
];

const shortSchedule = [
  { time: "10:50", type: "rest", message: "지금은 쉬는시간 입니다." },
  { time: "11:00", type: "work", message: "지금은 근무시간 입니다." },
  { time: "11:50", type: "lunch", message: "지금은 점심시간 입니다." },
  { time: "12:00", type: "work", message: "지금은 근무시간 입니다." },
  { time: "12:50", type: "rest", message: "지금은 쉬는시간 입니다." },
  { time: "13:00", type: "work", message: "지금은 근무시간 입니다." },
  { time: "13:50", type: "rest", message: "지금은 쉬는시간 입니다." },
  { time: "14:00", type: "work", message: "지금은 근무시간 입니다." },
  { time: "14:50", type: "rest", message: "지금은 쉬는시간 입니다." },
  { time: "15:00", type: "work", message: "지금은 근무시간 입니다." },
  { time: "16:10", type: "rest", message: "지금은 쉬는시간 입니다." },
  { time: "16:30", type: "work", message: "지금은 근무시간 입니다." },
  { time: "17:20", type: "rest", message: "지금은 쉬는시간 입니다." },
  { time: "17:30", type: "finish", message: "지금은 퇴근시간 입니다." }
];

function generateRandom(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getWebSocketUrl() {
  if (window.CCPLAY_WS_URL && typeof window.CCPLAY_WS_URL === "string" && window.CCPLAY_WS_URL.trim() !== "") {
    return window.CCPLAY_WS_URL.trim();
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return protocol + "//" + window.location.host;
}

function getActiveClock() {
  if (debugMode && debugTime) {
    return debugTime;
  }
  return new Date();
}

function initializeSpeechVoices() {
  if (!("speechSynthesis" in window)) {
    return;
  }

  updatePreferredSpeechVoice();

  if (typeof window.speechSynthesis.addEventListener === "function") {
    window.speechSynthesis.addEventListener("voiceschanged", updatePreferredSpeechVoice);
  } else {
    window.speechSynthesis.onvoiceschanged = updatePreferredSpeechVoice;
  }
}

function updatePreferredSpeechVoice() {
  if (!("speechSynthesis" in window)) {
    return;
  }

  const voices = window.speechSynthesis.getVoices();
  preferredSpeechVoice =
    voices.find((voice) => voice.lang && voice.lang.toLowerCase().startsWith("ko")) ||
    voices.find((voice) => /korean/i.test(voice.name || "")) ||
    null;
}

function dpTime() {
  const now = getActiveClock();
  let hours = now.getHours();
  let minutes = now.getMinutes();
  let seconds = now.getSeconds();
  let ampm = "AM ";

  if (hours > 12) {
    hours -= 12;
    ampm = "PM ";
  }

  if (hours < 10) {
    hours = "0" + hours;
  }

  if (minutes < 10) {
    minutes = "0" + minutes;
  }

  if (seconds < 10) {
    seconds = "0" + seconds;
  }

  document.getElementById("dpTime").innerHTML = ampm + hours + ":" + minutes + ":" + seconds;

  if (debugMode && debugTime) {
    debugTime.setSeconds(debugTime.getSeconds() + 1);
  }
}

setInterval(dpTime, 1000);

function checkstate(state) {
  clearInterval(refreshIntervalId);
  currentMode = state;

  if (state === "standard") {
    document.getElementById("currentMode").innerHTML = "현재 모드: 기본모드";
    setInitialState(standardSchedule);
    refreshIntervalId = setInterval(function () {
      checkSchedule(standardSchedule);
    }, 1000);
  } else if (state === "short") {
    document.getElementById("currentMode").innerHTML = "현재 모드: 단축모드";
    setInitialState(shortSchedule);
    refreshIntervalId = setInterval(function () {
      checkSchedule(shortSchedule);
    }, 1000);
  }
}

function setInitialState(schedule) {
  const now = getActiveClock();
  const currentTime = formatTime(now.getHours(), now.getMinutes());
  let currentState = null;

  for (let index = schedule.length - 1; index >= 0; index -= 1) {
    if (currentTime >= schedule[index].time) {
      currentState = schedule[index];
      break;
    }
  }

  if (!currentState) {
    currentState = { type: "work", message: "지금은 근무시간 입니다." };
  }

  document.getElementById("text").innerHTML = currentState.message;
}

function checkSchedule(schedule) {
  const now = getActiveClock();
  const currentTime = formatTime(now.getHours(), now.getMinutes());

  if (now.getSeconds() === 0) {
    for (let index = 0; index < schedule.length; index += 1) {
      if (currentTime === schedule[index].time) {
        document.getElementById("text").innerHTML = schedule[index].message;
        audiobell(schedule[index].type);
        break;
      }
    }
  }

  if (debugMode) {
    updateNextSchedule(schedule, currentTime);
  }
}

function formatTime(hours, minutes) {
  return hours.toString().padStart(2, "0") + ":" + minutes.toString().padStart(2, "0");
}

function resolveScheduleAudioFile(type) {
  switch (type) {
    case "work":
      return "work_" + generateRandom(1, 2) + ".mp3";
    case "rest":
      return "rest_" + generateRandom(1, 11) + ".mp3";
    case "lunch":
      return "lu_" + generateRandom(1, 3) + ".mp3";
    case "finish":
      return "f_" + generateRandom(1, 2) + ".mp3";
    default:
      return "work_" + generateRandom(1, 2) + ".mp3";
  }
}

function finishTimerAudioIfIdle() {
  if (!currentBellAudio && !currentAudio) {
    timerAudioActive = false;
    maybeProcessCcplayQueue();
  }
}

function stopTimerAudioElements() {
  if (currentBellAudio) {
    currentBellAudio.pause();
    currentBellAudio.currentTime = 0;
    currentBellAudio = null;
  }

  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }

  if (!currentBellAudio && !currentAudio) {
    timerAudioActive = false;
  }
}

function startTimerAudioSession() {
  interruptCcplaySpeechForTimer();
  stopTimerAudioElements();
  timerAudioActive = true;
}

function audioctrl(type) {
  stopTimerAudioElements();
  timerAudioActive = true;

  currentAudio = new Audio(resolveScheduleAudioFile(type));

  currentAudio.addEventListener("ended", function () {
    currentAudio = null;
    finishTimerAudioIfIdle();
  });

  currentAudio.addEventListener("error", function () {
    currentAudio = null;
    finishTimerAudioIfIdle();
  });

  currentAudio.play().catch(function () {
    currentAudio = null;
    finishTimerAudioIfIdle();
  });
}

function audiobell(type) {
  startTimerAudioSession();
  currentBellAudio = new Audio("bell.mp3");

  currentBellAudio.addEventListener("ended", function () {
    currentBellAudio = null;
    audioctrl(type);
  });

  currentBellAudio.addEventListener("error", function () {
    currentBellAudio = null;
    finishTimerAudioIfIdle();
  });

  currentBellAudio.play().catch(function () {
    currentBellAudio = null;
    finishTimerAudioIfIdle();
  });
}

function toggleDebugMode() {
  debugMode = !debugMode;
  const debugPanel = document.getElementById("debugPanel");

  if (debugMode) {
    debugPanel.style.display = "block";
    debugTime = new Date();
    document.getElementById("debugHour").value = debugTime.getHours();
    document.getElementById("debugMinute").value = debugTime.getMinutes();
    document.getElementById("debugSecond").value = debugTime.getSeconds();
    document.getElementById("currentMode").innerHTML = "현재 모드: 디버그모드";
  } else {
    debugPanel.style.display = "none";
    debugTime = null;
    document.getElementById("currentMode").innerHTML = "모드를 선택해주세요";
  }
}

function setDebugTime() {
  const hour = parseInt(document.getElementById("debugHour").value, 10);
  const minute = parseInt(document.getElementById("debugMinute").value, 10);
  const second = parseInt(document.getElementById("debugSecond").value, 10);

  debugTime = new Date();
  debugTime.setHours(hour, minute, second, 0);

  if (currentMode) {
    setInitialState(currentMode === "standard" ? standardSchedule : shortSchedule);
  }
}

function resetToRealTime() {
  debugTime = new Date();
  document.getElementById("debugHour").value = debugTime.getHours();
  document.getElementById("debugMinute").value = debugTime.getMinutes();
  document.getElementById("debugSecond").value = debugTime.getSeconds();

  if (currentMode) {
    setInitialState(currentMode === "standard" ? standardSchedule : shortSchedule);
  }
}

function testSchedule(type) {
  if (timerAudioActive) {
    return;
  }

  let message = "지금은 근무시간 입니다.";

  if (type === "rest") {
    message = "지금은 쉬는시간 입니다.";
  } else if (type === "lunch") {
    message = "지금은 점심시간 입니다.";
  } else if (type === "finish") {
    message = "지금은 퇴근시간 입니다.";
  }

  document.getElementById("text").innerHTML = message;
  audiobell(type);
}

function updateNextSchedule(schedule, currentTime) {
  let nextItem = null;

  for (let index = 0; index < schedule.length; index += 1) {
    if (schedule[index].time > currentTime) {
      nextItem = schedule[index];
      break;
    }
  }

  document.getElementById("nextSchedule").innerHTML = nextItem
    ? "다음: " + nextItem.time + " - " + nextItem.message
    : "오늘 스케줄 완료";
}

function supportsSpeechSynthesis() {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setCcplayError(message) {
  ccplayLastError = message;
  renderCcplayPanel();
}

function clearCcplayError() {
  ccplayLastError = "";
  renderCcplayPanel();
}

function sendSocketMessage(payload) {
  if (!socketConnected || !socket || socket.readyState !== WebSocket.OPEN) {
    setCcplayError("서버와 연결되지 않아 요청을 처리할 수 없습니다.");
    return false;
  }

  socket.send(JSON.stringify(payload));
  return true;
}

function connectSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  socket = new WebSocket(getWebSocketUrl());
  ccplayConnectionMessage = "서버 연결 중";
  renderCcplayPanel();

  socket.addEventListener("open", function () {
    socketConnected = true;
    ccplayConnectionMessage = "서버 연결됨";
    clearCcplayError();
    renderCcplayPanel();
    sendSocketMessage({ type: "requeueSpeaking" });
  });

  socket.addEventListener("message", function (event) {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch (error) {
      return;
    }

    handleSocketMessage(message);
  });

  socket.addEventListener("close", function () {
    socketConnected = false;
    socketClaimPending = false;
    ccplayConnectionMessage = "서버 연결 끊김, 재연결 시도 중";
    renderCcplayPanel();

    if (socketReconnectTimer) {
      clearTimeout(socketReconnectTimer);
    }

    socketReconnectTimer = setTimeout(connectSocket, 2000);
  });

  socket.addEventListener("error", function () {
    setCcplayError("WebSocket 연결 오류가 발생했습니다.");
  });
}

function handleSocketMessage(message) {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "queueSnapshot") {
    socketClaimPending = false;
    ccplayQueue = Array.isArray(message.queue) ? message.queue : [];
    ccplayConnectionMessage = socketConnected ? "서버 연결됨" : ccplayConnectionMessage;

    if (!activeCcplayRequest && message.active) {
      activeCcplayRequest = message.active;
    }

    if (activeCcplayRequest && message.active && activeCcplayRequest.id !== message.active.id) {
      activeCcplayRequest = message.active;
      ccplaySpeechInterrupted = false;
    }

    if (activeCcplayRequest && !message.active && !ccplaySpeechActive) {
      activeCcplayRequest = null;
      ccplaySpeechInterrupted = false;
    }

    clearCcplayError();
    renderCcplayPanel();
    maybeProcessCcplayQueue();
    return;
  }

  if (message.type === "claimResult") {
    socketClaimPending = false;
    if (message.request) {
      activeCcplayRequest = message.request;
      ccplaySpeechInterrupted = false;
      renderCcplayPanel();
      speakActiveCcplayRequest();
    } else {
      renderCcplayPanel();
    }
    return;
  }

  if (message.type === "error") {
    setCcplayError(message.message || "서버 요청 처리 중 오류가 발생했습니다.");
  }
}

function maybeProcessCcplayQueue() {
  if (!socketConnected) {
    return;
  }

  if (!supportsSpeechSynthesis()) {
    setCcplayError("이 브라우저는 TTS를 지원하지 않습니다.");
    return;
  }

  if (timerAudioActive) {
    return;
  }

  if (activeCcplayRequest) {
    if (!ccplaySpeechActive && ccplaySpeechInterrupted) {
      speakActiveCcplayRequest();
    }
    return;
  }

  if (ccplayQueue.length === 0 || socketClaimPending) {
    return;
  }

  socketClaimPending = true;
  sendSocketMessage({ type: "claimNext" });
}

function speakActiveCcplayRequest() {
  if (!activeCcplayRequest || timerAudioActive || ccplaySpeechActive || !supportsSpeechSynthesis()) {
    return;
  }

  updatePreferredSpeechVoice();

  const utterance = new SpeechSynthesisUtterance(
    "클로바, " + activeCcplayRequest.songTitle + " 틀어줘"
  );

  if (preferredSpeechVoice) {
    utterance.voice = preferredSpeechVoice;
    utterance.lang = preferredSpeechVoice.lang;
  } else {
    utterance.lang = "ko-KR";
  }

  currentSpeechUtterance = utterance;
  speechCancelReason = null;
  ccplaySpeechActive = true;
  ccplaySpeechInterrupted = false;
  renderCcplayPanel();

  const requestId = activeCcplayRequest.id;

  utterance.addEventListener("end", function () {
    handleSpeechCompletion(requestId, null);
  });

  utterance.addEventListener("error", function (event) {
    handleSpeechCompletion(requestId, event);
  });

  window.speechSynthesis.speak(utterance);
}

function handleSpeechCompletion(requestId, errorEvent) {
  if (!activeCcplayRequest || activeCcplayRequest.id !== requestId) {
    currentSpeechUtterance = null;
    ccplaySpeechActive = false;
    return;
  }

  currentSpeechUtterance = null;
  ccplaySpeechActive = false;
  const cancelReason = speechCancelReason;
  speechCancelReason = null;

  if (cancelReason === "timer") {
    ccplaySpeechInterrupted = true;
    renderCcplayPanel();
    return;
  }

  if (cancelReason === "skip") {
    finalizeActiveCcplayRequest("cancelled");
    return;
  }

  if (errorEvent && errorEvent.error && errorEvent.error !== "interrupted" && errorEvent.error !== "canceled") {
    setCcplayError("TTS 재생 중 오류가 발생했습니다.");
    finalizeActiveCcplayRequest("cancelled");
    return;
  }

  finalizeActiveCcplayRequest("done");
}

function finalizeActiveCcplayRequest(status) {
  if (!activeCcplayRequest) {
    renderCcplayPanel();
    return;
  }

  const requestId = activeCcplayRequest.id;
  activeCcplayRequest = null;
  ccplaySpeechInterrupted = false;
  renderCcplayPanel();
  sendSocketMessage({ type: "completeRequest", requestId: requestId, status: status });
  maybeProcessCcplayQueue();
}

function interruptCcplaySpeechForTimer() {
  if (!activeCcplayRequest) {
    return;
  }

  if (ccplaySpeechActive && currentSpeechUtterance && supportsSpeechSynthesis()) {
    speechCancelReason = "timer";
    window.speechSynthesis.cancel();
  } else {
    ccplaySpeechInterrupted = true;
  }
}

function skipActiveCcplayRequest() {
  if (!activeCcplayRequest) {
    return;
  }

  if (ccplaySpeechActive && currentSpeechUtterance && supportsSpeechSynthesis()) {
    speechCancelReason = "skip";
    window.speechSynthesis.cancel();
  } else {
    finalizeActiveCcplayRequest("cancelled");
  }
}

function clearCcplayQueue() {
  sendSocketMessage({ type: "clearQueue" });
}

function deleteQueuedRequest(requestId) {
  sendSocketMessage({ type: "deleteRequest", requestId: requestId });
}

function stopCurrentAudio() {
  stopTimerAudioElements();

  if (activeCcplayRequest) {
    skipActiveCcplayRequest();
  }
}

function renderCcplayPanel() {
  const connectionElement = document.getElementById("ccplayConnectionStatus");
  const currentElement = document.getElementById("ccplayCurrentRequest");
  const queueElement = document.getElementById("ccplayQueueList");
  const skipButton = document.getElementById("ccplaySkipButton");
  const clearButton = document.getElementById("ccplayClearQueueButton");
  const errorElement = document.getElementById("ccplayError");

  if (!connectionElement || !currentElement || !queueElement || !skipButton || !clearButton || !errorElement) {
    return;
  }

  connectionElement.textContent = ccplayConnectionMessage;
  currentElement.textContent = activeCcplayRequest
    ? "클로바, " + activeCcplayRequest.songTitle + " 틀어줘"
    : "현재 재생 중인 요청이 없습니다.";

  if (ccplayQueue.length === 0) {
    queueElement.innerHTML = '<li class="ccplay-empty">대기 중인 요청이 없습니다.</li>';
  } else {
    queueElement.innerHTML = ccplayQueue
      .map(function (item) {
        return (
          '<li class="ccplay-queue-item">' +
          '<span class="ccplay-queue-title">' +
          escapeHtml(item.songTitle) +
          "</span>" +
          '<button type="button" class="ccplay-delete-button" data-request-id="' +
          escapeHtml(item.id) +
          '">삭제</button>' +
          "</li>"
        );
      })
      .join("");
  }

  skipButton.disabled = !activeCcplayRequest || !socketConnected;
  clearButton.disabled = ccplayQueue.length === 0 || !socketConnected;

  if (ccplayLastError) {
    errorElement.textContent = ccplayLastError;
    errorElement.style.display = "block";
  } else {
    errorElement.textContent = "";
    errorElement.style.display = "none";
  }
}

function initializeCcplayPanel() {
  renderCcplayPanel();
  initializeSpeechVoices();
  connectSocket();

  const queueElement = document.getElementById("ccplayQueueList");
  const skipButton = document.getElementById("ccplaySkipButton");
  const clearButton = document.getElementById("ccplayClearQueueButton");

  if (queueElement) {
    queueElement.addEventListener("click", function (event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const requestId = target.getAttribute("data-request-id");
      if (requestId) {
        deleteQueuedRequest(requestId);
      }
    });
  }

  if (skipButton) {
    skipButton.addEventListener("click", skipActiveCcplayRequest);
  }

  if (clearButton) {
    clearButton.addEventListener("click", clearCcplayQueue);
  }
}

document.addEventListener("DOMContentLoaded", initializeCcplayPanel);
