/**
 * @file speech.js
 * @description 系统语音合成（Web Speech API）封装。
 *
 * 统一使用页面内的 `speechSynthesis`，而不是扩展特权 API `chrome.tts`：
 * - `speechSynthesis` 暴露系统完整的音色列表（含 Samantha、Daniel 等），
 * 可以按名字精确选中，避免 chrome.tts 在 macOS 上落到效果音或奇怪音色；
 * - 在普通网页、油猴脚本、扩展内容脚本里行为一致。
 *
 * `chrome.tts` 仅作为 `speechSynthesis` 完全不可用时的兜底。
 */

function normalizeLang(lang) {
  const value = String(lang || "")
    .trim()
    .replace(/_/g, "-");
  const lowerValue = value.toLowerCase();

  // auto 等检测值统一兜底为英语发音。
  if (
    !value ||
    lowerValue === "en" ||
    lowerValue === "auto" ||
    lowerValue === "detect" ||
    lowerValue === "und" ||
    lowerValue === "unknown"
  ) {
    return "en-US";
  }

  // 只保留简单的 BCP-47 形态，避免合成引擎报 Invalid lang。
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(value)) {
    return "en-US";
  }

  return value;
}

function hasChromeTts() {
  return typeof globalThis.chrome?.tts?.speak === "function";
}

function hasWebSpeech() {
  return (
    typeof globalThis.speechSynthesis?.speak === "function" &&
    typeof globalThis.SpeechSynthesisUtterance === "function"
  );
}

const FINAL_CHROME_TTS_EVENTS = new Set([
  "end",
  "interrupted",
  "cancelled",
  "error",
]);

/**
 * 在给定音色列表中为语言挑选最合适的音色。
 *
 * 优先级：设置里指定的音色 → 精确匹配地区（如 en-GB）→ 系统默认音色 →
 * 同语言族的第一个音色。以语言作为硬性过滤条件，避免用中文音色朗读英文。
 */
export function pickVoice(voices, lang, preferredName) {
  const list = Array.isArray(voices) ? voices : [];
  const normalized = normalizeLang(lang).toLowerCase();
  const base = normalized.split("-")[0];
  const codeOf = (voice) =>
    String(voice?.lang || "")
      .toLowerCase()
      .replace(/_/g, "-");
  const sameLanguage = list.filter((voice) => {
    const code = codeOf(voice);
    return code === normalized || code.split("-")[0] === base;
  });
  if (!sameLanguage.length) return null;

  const exact = sameLanguage.filter((voice) => codeOf(voice) === normalized);

  if (preferredName) {
    const preferred = sameLanguage.find(
      (voice) => voice.name === preferredName
    );
    if (preferred) return preferred;
  }
  return (
    exact.find((voice) => voice.default) ||
    exact[0] ||
    sameLanguage.find((voice) => voice.default) ||
    sameLanguage[0]
  );
}

// Web Speech 通过 utterance 事件通知结束，不会返回可监听的播放句柄。
function speakWithWebSpeech(text, lang, callbacks = {}) {
  if (!hasWebSpeech()) return false;

  try {
    const utterance = new globalThis.SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    let voices = [];
    try {
      voices = globalThis.speechSynthesis.getVoices?.() || [];
    } catch {
      voices = [];
    }
    const voice = pickVoice(voices, lang, callbacks.voice);
    if (voice) {
      utterance.voice = voice;
      // 语音自带语言时以它为准，避免 lang 与 voice 不一致导致降级。
      if (voice.lang) utterance.lang = voice.lang;
    }
    if (callbacks.speed !== undefined) utterance.rate = callbacks.speed;
    utterance.onend = () => callbacks.onEnd?.("end");
    utterance.onerror = (event) =>
      callbacks.onEnd?.(
        ["interrupted", "canceled", "cancelled"].includes(event.error)
          ? "interrupted"
          : "error"
      );
    globalThis.speechSynthesis.speak(utterance);
    return true;
  } catch (err) {
    return false;
  }
}

// chrome.tts 兜底：只在 speechSynthesis 完全不可用时使用。
function speakWithChromeTts(text, lang, callbacks = {}, onEnd) {
  try {
    globalThis.chrome.tts.speak(
      text,
      {
        lang,
        ...(callbacks.voice && { voiceName: callbacks.voice }),
        ...(callbacks.speed !== undefined && { rate: callbacks.speed }),
        onEvent: (event) => {
          if (FINAL_CHROME_TTS_EVENTS.has(event?.type)) {
            onEnd(event.type);
          }
        },
      },
      () => {
        if (globalThis.chrome?.runtime?.lastError) onEnd("error");
      }
    );
    return true;
  } catch (err) {
    return false;
  }
}

export function canSpeak() {
  return hasWebSpeech() || hasChromeTts();
}

/**
 * 列出可用于朗读的音色（过滤掉远端合成音色，通常音质更不稳定）。
 * @param {string} [lang] 只返回匹配该语言的音色
 */
export function listVoices(lang) {
  let voices = [];
  try {
    voices = globalThis.speechSynthesis?.getVoices?.() || [];
  } catch {
    voices = [];
  }
  const base = normalizeLang(lang || "en-US")
    .toLowerCase()
    .split("-")[0];
  return voices
    .filter((voice) => voice?.localService !== false)
    .filter((voice) => {
      if (!lang) return true;
      const code = String(voice?.lang || "")
        .toLowerCase()
        .replace(/_/g, "-");
      return code.split("-")[0] === base;
    })
    .map((voice) => ({
      name: voice.name,
      lang: voice.lang,
      default: Boolean(voice.default),
    }));
}

export function speak(text, lang = "en-US", callbacks = {}) {
  const utteranceText = text?.trim();
  if (!utteranceText) return false;

  const normalizedLang = normalizeLang(lang);
  let ended = false;

  // 各个终态路径都可能回调，需保证只结束一次。
  const onEnd = (reason = "end") => {
    if (ended) return;
    ended = true;
    callbacks.onEnd?.(reason);
  };

  // 优先使用 speechSynthesis：可精确选择系统音色。
  if (hasWebSpeech()) {
    return speakWithWebSpeech(utteranceText, normalizedLang, {
      ...callbacks,
      onEnd,
    });
  }

  if (hasChromeTts()) {
    return speakWithChromeTts(utteranceText, normalizedLang, callbacks, onEnd);
  }

  return false;
}

export function stopSpeech() {
  try {
    globalThis.speechSynthesis?.cancel?.();
  } catch {
    // 忽略停止时的异常
  }
  globalThis.chrome?.tts?.stop?.();
}
