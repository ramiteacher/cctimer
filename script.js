var refreshIntervalId; //1초마다 반복하는 함수
var refreshTimeoutId; // 일정시간 후 1회작동 함수

let generateRandom = function (min, max) {
    var ranNum = Math.floor(Math.random()*(max-min+1)) + min;
    return ranNum;
}

let player;
let playerState;
let atype;
let currentMode = null; // 'standard' 또는 'short'
let debugMode = false;
let debugTime = null; // 디버그 모드에서 사용할 가상 시간
let currentAudio = null; // 현재 재생 중인 오디오 객체
let isAudioPlaying = false; // 오디오 재생 상태

// 시간 보여주기 
function dpTime(){
    let now;
    if(debugMode && debugTime) {
        now = debugTime;
    } else {
        now = new Date();
    }
    
    hours = now.getHours();
    minutes = now.getMinutes();
    seconds = now.getSeconds();

    if (hours > 12){
        hours -= 12;
        ampm = "PM ";
    }
    else{
        ampm = "AM ";
    }
    if (hours < 10){
        hours = "0" + hours;
    }
    if (minutes < 10){
        minutes = "0" + minutes;
    }
    if (seconds < 10){
        seconds = "0" + seconds;
    }

    document.getElementById("dpTime").innerHTML = ampm + hours + ":" + minutes + ":" + seconds;
    
    // 디버그 모드일 때 시간 업데이트
    if(debugMode && debugTime) {
        debugTime.setSeconds(debugTime.getSeconds() + 1);
    }
}
setInterval("dpTime()",1000);

// 기본모드 스케줄 정의
const standardSchedule = [
    {time: "10:50", type: "rest", message: "지금은 쉬는시간 입니다."},
    {time: "11:00", type: "work", message: "지금은 근무시간 입니다."},
    {time: "11:50", type: "lunch", message: "지금은 점심시간 입니다."},
    {time: "12:00", type: "work", message: "지금은 근무시간 입니다."},
    {time: "12:50", type: "rest", message: "지금은 쉬는시간 입니다."},
    {time: "13:00", type: "work", message: "지금은 근무시간 입니다."},
    {time: "13:50", type: "rest", message: "지금은 쉬는시간 입니다."},
    {time: "14:00", type: "work", message: "지금은 근무시간 입니다."},
    {time: "14:50", type: "rest", message: "지금은 쉬는시간 입니다."},
    {time: "15:00", type: "work", message: "지금은 근무시간 입니다."},
    {time: "17:00", type: "rest", message: "지금은 쉬는시간 입니다."},
    {time: "17:30", type: "work", message: "지금은 근무시간 입니다."},
    {time: "17:50", type: "rest", message: "지금은 쉬는시간 입니다."},
    {time: "18:00", type: "work", message: "지금은 근무시간 입니다."},
    {time: "18:50", type: "rest", message: "지금은 쉬는시간 입니다."},
    {time: "19:00", type: "work", message: "지금은 근무시간 입니다."},
    {time: "19:50", type: "rest", message: "지금은 쉬는시간 입니다."}
];

// 단축모드 스케줄 정의
const shortSchedule = [
    {time: "10:50", type: "rest", message: "지금은 쉬는시간 입니다."},
    {time: "11:00", type: "work", message: "지금은 근무시간 입니다."},
    {time: "11:50", type: "lunch", message: "지금은 점심시간 입니다."},
    {time: "12:00", type: "work", message: "지금은 근무시간 입니다."},
    {time: "12:50", type: "rest", message: "지금은 쉬는시간 입니다."},
    {time: "13:00", type: "work", message: "지금은 근무시간 입니다."},
    {time: "13:50", type: "rest", message: "지금은 쉬는시간 입니다."},
    {time: "14:00", type: "work", message: "지금은 근무시간 입니다."},
    {time: "14:50", type: "rest", message: "지금은 쉬는시간 입니다."},
    {time: "15:00", type: "work", message: "지금은 근무시간 입니다."},
    {time: "16:10", type: "rest", message: "지금은 쉬는시간 입니다."},
    {time: "16:30", type: "work", message: "지금은 근무시간 입니다."},
    {time: "17:20", type: "rest", message: "지금은 쉬는시간 입니다."},
    {time: "17:30", type: "finish", message: "지금은 퇴근시간 입니다."}
];

function checkstate(state) {
    clearInterval(refreshIntervalId);
    currentMode = state;
    
    // 현재 모드 표시
    if(state == "standard"){
        document.getElementById("currentMode").innerHTML = "현재 모드: 기본모드";
        setInitialState(standardSchedule);
        refreshIntervalId = setInterval(() => checkSchedule(standardSchedule), 1000);
    }
    else if(state == "short"){
        document.getElementById("currentMode").innerHTML = "현재 모드: 단축모드";
        setInitialState(shortSchedule);
        refreshIntervalId = setInterval(() => checkSchedule(shortSchedule), 1000);
    }
}

function setInitialState(schedule) {
    const now = new Date();
    const currentTime = formatTime(now.getHours(), now.getMinutes());
    
    // 현재 시간에 맞는 상태 찾기
    let currentState = null;
    for(let i = schedule.length - 1; i >= 0; i--) {
        if(currentTime >= schedule[i].time) {
            currentState = schedule[i];
            break;
        }
    }
    
    // 기본값은 근무시간
    if(!currentState) {
        currentState = {type: "work", message: "지금은 근무시간 입니다."};
    }
    
    document.getElementById("text").innerHTML = currentState.message;
}

function checkSchedule(schedule) {
    let now;
    if(debugMode && debugTime) {
        now = debugTime;
    } else {
        now = new Date();
    }
    
    const currentTime = formatTime(now.getHours(), now.getMinutes());
    const currentSeconds = now.getSeconds();
    
    // 정확히 0초일 때만 체크 (1초마다 실행되므로)
    if(currentSeconds === 0) {
        for(let item of schedule) {
            if(currentTime === item.time) {
                document.getElementById("text").innerHTML = item.message;
                audiobell(item.type);
                break;
            }
        }
    }
    
    // 다음 스케줄 표시 (디버그 모드일 때)
    if(debugMode) {
        updateNextSchedule(schedule, currentTime);
    }
}

function formatTime(hours, minutes) {
    return hours.toString().padStart(2, '0') + ':' + minutes.toString().padStart(2, '0');
}

function audioctrl(type){
    // 기존 오디오가 재생 중이면 중지
    stopCurrentAudio();
    
    let filename;
    
    switch(type) {
        case 'work':
            filename = `work_${generateRandom(1, 2)}.mp3`;
            break;
        case 'rest':
            filename = `rest_${generateRandom(1, 11)}.mp3`;
            break;
        case 'lunch':
            filename = `lu_${generateRandom(1, 3)}.mp3`;
            break;
        case 'finish':
            filename = `f_${generateRandom(1, 2)}.mp3`;
            break;
        default:
            filename = `work_${generateRandom(1, 2)}.mp3`;
    }
    
    console.log(filename);
    currentAudio = new Audio(filename);
    isAudioPlaying = true;
    
    currentAudio.addEventListener('ended', function() {
        isAudioPlaying = false;
        currentAudio = null;
    });
    
    currentAudio.addEventListener('error', function() {
        isAudioPlaying = false;
        currentAudio = null;
        audioctrl(`${atype}`);
    });
    
    currentAudio.play();
} 

function audiobell(type){
    // 기존 오디오가 재생 중이면 중지
    stopCurrentAudio();
    
    const bell_audio = new Audio(`bell.mp3`)   
    atype = type;
    isAudioPlaying = true;
    
    bell_audio.addEventListener("ended", function(){ 
        isAudioPlaying = false;
        audioctrl(`${type}`); 
    });
    
    bell_audio.addEventListener("error", function() {
        isAudioPlaying = false;
    });
    
    bell_audio.play();
}

// 디버그 모드 관련 함수들
function toggleDebugMode() {
    debugMode = !debugMode;
    const debugPanel = document.getElementById("debugPanel");
    
    if(debugMode) {
        debugPanel.style.display = "block";
        debugTime = new Date(); // 현재 시간으로 초기화
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
    const hour = parseInt(document.getElementById("debugHour").value);
    const minute = parseInt(document.getElementById("debugMinute").value);
    const second = parseInt(document.getElementById("debugSecond").value);
    
    debugTime = new Date();
    debugTime.setHours(hour, minute, second, 0);
    
    // 현재 상태 업데이트
    if(currentMode) {
        const schedule = currentMode === "standard" ? standardSchedule : shortSchedule;
        setInitialState(schedule);
    }
}

function resetToRealTime() {
    debugTime = new Date();
    document.getElementById("debugHour").value = debugTime.getHours();
    document.getElementById("debugMinute").value = debugTime.getMinutes();
    document.getElementById("debugSecond").value = debugTime.getSeconds();
    
    // 현재 상태 업데이트
    if(currentMode) {
        const schedule = currentMode === "standard" ? standardSchedule : shortSchedule;
        setInitialState(schedule);
    }
}

function testSchedule(type) {
    // 이미 오디오가 재생 중이면 중복 재생 방지
    if(isAudioPlaying) {
        console.log("오디오가 이미 재생 중입니다. 잠시 후 다시 시도해주세요.");
        return;
    }
    
    let message;
    switch(type) {
        case 'work':
            message = "지금은 근무시간 입니다.";
            break;
        case 'rest':
            message = "지금은 쉬는시간 입니다.";
            break;
        case 'lunch':
            message = "지금은 점심시간 입니다.";
            break;
        case 'finish':
            message = "지금은 퇴근시간 입니다.";
            break;
    }
    
    document.getElementById("text").innerHTML = message;
    audiobell(type);
}

function updateNextSchedule(schedule, currentTime) {
    let nextItem = null;
    
    for(let item of schedule) {
        if(item.time > currentTime) {
            nextItem = item;
            break;
        }
    }
    
    if(nextItem) {
        document.getElementById("nextSchedule").innerHTML = 
            `다음: ${nextItem.time} - ${nextItem.message}`;
    } else {
        document.getElementById("nextSchedule").innerHTML = "오늘 스케줄 완료";
    }
}

// 오디오 중지 함수
function stopCurrentAudio() {
    if(currentAudio && !currentAudio.paused) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
    }
    isAudioPlaying = false;
    currentAudio = null;
}