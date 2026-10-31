import { apiMicrosoftDict, apiYoudaoDict } from "../apis";
import {
  DEFAULT_WORD_CARD_DELAY,
  DEFAULT_WORD_CARD_SPEECH,
  OPT_DICT_BING,
  OPT_DICT_MAP,
  OPT_WORD_CARD_SPEECH_AUDIO,
  OPT_WORD_CARD_SPEECH_SYSTEM,
  WORD_CARD_SPEECH_OPTIONS,
  newI18n,
} from "../config";
import { getSettingWithDefault } from "./storage";
import { speak, canSpeak, stopSpeech } from "./speech";
import { isFavoriteWord, toggleFavoriteWord } from "../subtitle/favoriteWords";
import { logger } from "./log";

/**
 * @file wordHoverCard.js
 * @description 网页内的单词悬浮查词卡片。
 *
 * 鼠标在网页英文单词上停留一小段时间后，在该位置弹出一张小卡片，显示单词、
 * 音标与中文释义，并提供“播放读音”和“收藏单词”两个按钮。
 *
 * 与 Translator 的悬浮翻译相互独立：不依赖页面翻译是否开启，也不参与译文渲染。
 * 只在开关（mouseHoverSetting.useWordCard）打开时注册监听。
 */

/** 卡片根节点类名，同时也用于把卡片自身从悬停检测中排除 */
export const WORD_CARD_CLASS = "kiss-word-card";

// 有道发音音频的托管地址。type=1 为英音，type=2 为美音，返回 MP3 真人录音。
const YOUDAO_VOICE_URL = "https://dict.youdao.com/dictvoice";
// Google 词典的真人录音（美音），作为有道的后备音源。
const GOOGLE_VOICE_BASE =
  "https://ssl.gstatic.com/dictionary/static/sounds/20200429";

/** 构造 Google 词典的美音录音地址；本地录音可能不存在，失败时由调用方回退。 */
export function buildGoogleVoiceUrl(word) {
  const value = String(word || "")
    .trim()
    .toLowerCase();
  if (!value) return "";
  return `${GOOGLE_VOICE_BASE}/${encodeURIComponent(value)}--_us_1.mp3`;
}

/** 由有道返回的 usspeech / ukspeech（形如 "hello&type=2"）拼出音频地址。
 * 这些字段来自词典响应本身，比直接用词条拼 URL 更可靠（含特殊字符时同样成立）。
 */
export function buildYoudaoVoiceUrl(speech) {
  const value = typeof speech === "string" ? speech.trim() : "";
  if (!value) return "";
  return `${YOUDAO_VOICE_URL}?audio=${value}`;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** 播放图标：圆润喇叭 + 两道声波（18×18 网格，描边绘制） */
function createSpeakerIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "kwc-icon kwc-icon-play");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  [
    "M11 5.5 6.6 9H4.4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2.2l4.4 3.5z",
    "M15.2 9.2a4 4 0 0 1 0 5.6",
    "M17.9 6.5a8 8 0 0 1 0 11",
  ].forEach((d) => {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  });
  return svg;
}

/** 播放中图标：圆角停止方块，提示再次点击会停止 */
function createStopIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "kwc-icon kwc-icon-stop");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute(
    "d",
    "M9.2 7.5h5.6c.94 0 1.7.76 1.7 1.7v5.6c0 .94-.76 1.7-1.7 1.7H9.2c-.94 0-1.7-.76-1.7-1.7V9.2c0-.94.76-1.7 1.7-1.7z"
  );
  svg.appendChild(path);
  return svg;
}

const WORD_PATTERN = /^[A-Za-z][A-Za-z'’-]{1,30}$/;
const WORD_CHAR = /[A-Za-z'’-]/;

/** 与鼠标当前位置对应的单词：读取文本节点中光标两侧的连续字母 */
export function extractHoveredWord(node, offset) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.nodeValue || "";
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
    return null;
  }

  // 光标可能落在单词右侧（offset 指向单词后的第一个字符），优先向左看，
  // 左边没有字母时才向右看，避免把相邻两个单词拼在一起。
  let index = offset;
  if (index > 0 && WORD_CHAR.test(text[index - 1])) {
    index = offset - 1;
  } else if (!WORD_CHAR.test(text[index] || "")) {
    return null;
  }

  let start = index;
  let end = index + 1;
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
  while (end < text.length && WORD_CHAR.test(text[end])) end++;

  // 宽泛的字符集会让“a–b”这类跨词连字符越过节点边界；单词最终以两侧空白/
  // 标点为准，这里只校验形态，真正的语义判断交给词典。
  const word = text.slice(start, end).replace(/^[-'’]+|[-'’]+$/g, "");
  return WORD_PATTERN.test(word) ? word : null;
}

/** 归一化词典返回值（有道 / 必应两种结构）为统一的 { phonetics, definitions, examples } */
export function normalizeDictionaryResult(dict, data, fallbackWord = "") {
  if (!data) return null;

  if (dict === OPT_DICT_BING) {
    if (!data.word && !data.trs?.length && !data.aus?.length) return null;
    return {
      word: data.word || fallbackWord,
      phonetics: (data.aus || [])
        .filter(({ phonetic }) => phonetic)
        .map(({ key, phonetic }) => ({ key: key || "", phonetic })),
      definitions: (data.trs || [])
        .filter(({ def }) => def)
        .map(({ pos, def }) => ({ pos: pos || "", text: def })),
      examples: (data.sentences || [])
        .filter(({ eng }) => eng)
        .slice(0, 2)
        .map(({ eng, chs }) => ({ eng, chs: chs || "" })),
    };
  }

  // 有道：data.ec.word 为新结构；旧结构退回 data.trs。
  const wordData = data?.ec?.word;
  if (!wordData && !data?.trs?.length) return null;
  const phonetics = [];
  if (wordData?.ukphone)
    phonetics.push({ key: "英", phonetic: wordData.ukphone });
  if (wordData?.usphone)
    phonetics.push({ key: "美", phonetic: wordData.usphone });
  const definitions = ((wordData?.trs || data?.trs || []) ?? [])
    .map(({ pos, tran, def }) => ({
      pos: pos || "",
      text: tran || def || "",
    }))
    .filter(({ text }) => text);
  if (!definitions.length) return null;
  return {
    word: wordData?.["return-phrase"] || fallbackWord,
    phonetics,
    definitions,
    examples: [],
    // 有道自带真人录音：美音优先，其次英音。
    usSpeech:
      data?.ec?.word?.usspeech || data?.simple?.word?.[0]?.usspeech || "",
    ukSpeech:
      data?.ec?.word?.ukspeech || data?.simple?.word?.[0]?.ukspeech || "",
  };
}

/**
 * 单词悬浮查词卡片控制器。
 *
 * 生命周期由 TranslatorManager 管理：页面启动时创建，SPA 重启或页面关闭时 destroy。
 */
export class WordCardController {
  #enabled = false;
  #setting = null;
  #isUserscript = false;
  #i18n = (key, defaultText = key) => defaultText;

  #card = null;
  #activeWord = null;
  #runId = 0;
  #openTimer = null;
  #closeTimer = null;
  #speaking = false;
  #audio = null;
  #audioUrl = null;

  #pointer = { x: 0, y: 0 };
  #inCard = false;
  // 触发本次卡片的单词位置：卡片以此为锚点，鼠标在“单词 → 卡片”的空隙里移动时
  // 不再重新查词（否则会反复重建卡片、打断播放）。
  #anchor = null;
  #lastLookup = null;

  #listeners = null;
  #destroyed = false;
  #theme = "light";
  #systemSchemeQuery = null;

  constructor({ setting = {}, isUserscript = false } = {}) {
    this.#setting = setting;
    this.#isUserscript = isUserscript;
    const uiLang = setting?.uiLang || "zh";
    this.#i18n = newI18n(uiLang);
  }

  get enabled() {
    return this.#enabled;
  }

  /** 测试钩子：返回“指针是否靠近给定矩形”的纯函数（jsdom 无布局）。 */
  _nearRectForTest(rect) {
    return (pointer) => this.#isNearRect(rect, pointer);
  }

  /** 是否仍处于页面内正在使用的状态（便于测试与调试） */
  get isOpen() {
    return Boolean(this.#card?.isConnected);
  }

  /**
   * 设置运行时配置（通常在 SPA 重启或设置变更后调用）。
   */
  updateSetting(setting = {}) {
    this.#setting = setting;
    this.#i18n = newI18n(setting?.uiLang || "zh");
    this.#applyTheme();
    this.#watchSystemScheme();
  }

  /** 设置里的外观模式：light 强制浅色、dark 强制深色、auto 跟随系统。 */
  #themeMode() {
    const mode = this.#setting?.darkMode;
    return mode === "dark" || mode === "light" ? mode : "auto";
  }

  #resolvedDark() {
    const mode = this.#themeMode();
    if (mode !== "auto") return mode === "dark";
    try {
      return (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
      );
    } catch {
      return false;
    }
  }

  // 把最终主题写进卡片根节点，样式按 data-theme 选择颜色变量。
  #applyTheme() {
    const theme = this.#resolvedDark() ? "dark" : "light";
    if (this.#card) this.#card.dataset.theme = theme;
    this.#theme = theme;
  }

  // 仅在跟随系统（auto）时监听系统配色变化，避免强制模式下的无谓回调。
  #watchSystemScheme() {
    if (
      this.#themeMode() !== "auto" ||
      typeof window.matchMedia !== "function"
    ) {
      this.#unwatchSystemScheme();
      return;
    }
    if (this.#systemSchemeQuery) return;
    try {
      const query = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => this.#applyTheme();
      query.addEventListener?.("change", onChange);
      this.#systemSchemeQuery = { query, onChange };
    } catch {
      // 极旧环境没有 matchMedia 监听能力，保持一次性解析结果即可。
    }
  }

  #unwatchSystemScheme() {
    const current = this.#systemSchemeQuery;
    if (!current) return;
    current.query.removeEventListener?.("change", current.onChange);
    this.#systemSchemeQuery = null;
  }

  /**
   * 打开/关闭单词卡片。幂等。
   * 首次开启时需要从存储读取配置；传入 setting 可跳过读取。
   */
  async setEnabled(enabled, setting) {
    if (this.#destroyed) return;
    const next = Boolean(enabled);
    if (next === this.#enabled) {
      if (setting) this.updateSetting(setting);
      return;
    }

    if (!next) {
      this.#enabled = false;
      this.#removeListeners();
      this.#dismiss();
      return;
    }

    let resolved = setting;
    if (!resolved) {
      try {
        resolved = await getSettingWithDefault();
      } catch (err) {
        logger.child("word-card").warn("load setting failed", err);
        resolved = this.#setting;
      }
    }
    if (this.#destroyed) return;
    this.updateSetting(resolved || {});
    this.#enabled = true;
    ensureWordCardStyles();
    this.#addListeners();
  }

  destroy() {
    this.#destroyed = true;
    this.#enabled = false;
    this.#unwatchSystemScheme();
    this.#removeListeners();
    this.#dismiss();
  }

  // --- 监听 ---------------------------------------------------------------

  #addListeners() {
    if (this.#listeners) return;
    const controller = new AbortController();
    this.#listeners = controller;
    const options = { signal: controller.signal };

    document.addEventListener("mousemove", this.#handleMouseMove, {
      ...options,
      capture: true,
      passive: true,
    });
    document.addEventListener("scroll", this.#handleViewportChange, {
      ...options,
      capture: true,
      passive: true,
    });
    document.addEventListener("keydown", this.#handleKeyDown, {
      ...options,
      capture: true,
    });
    document.addEventListener("mousedown", this.#handleOutsideInteraction, {
      ...options,
      capture: true,
    });
    document.addEventListener("click", this.#handleOutsideInteraction, {
      ...options,
      capture: true,
    });
    // 页面滚动会让卡片与单词脱节。
    window.addEventListener("wheel", this.#handleViewportChange, {
      ...options,
      passive: true,
    });
    window.addEventListener("blur", this.#dismiss, options);
  }

  #removeListeners() {
    this.#listeners?.abort();
    this.#listeners = null;
    this.#clearTimers();
  }

  // --- 事件处理 -----------------------------------------------------------

  #handleMouseMove = (event) => {
    this.#pointer = { x: event.clientX, y: event.clientY };

    if (event.target instanceof Node && this.#card?.contains(event.target)) {
      // 指针进入卡片：取消待关闭任务
      this.#clearCloseTimer();
      return;
    }

    // 卡片已打开且指针正移向它（单词与卡片之间有一段空隙）：保持卡片不动，
    // 否则指针只从空隙上掠过就会关闭卡片和正在播放的音频。
    if (this.isOpen && !this.#inCard && this.#pointerNearCard()) {
      this.#clearCloseTimer();
      this.#activeWord = null;
      return;
    }

    const target = event.composedPath?.()[0] ?? event.target;
    const word = this.#resolveWord(target, event);
    const changed = word !== this.#activeWord;
    this.#activeWord = word;

    if (!word) {
      // 移出了所有单词：保留“离开再回来”的宽限，再关闭卡片。
      this.#clearOpenTimer();
      this.#scheduleClose();
      return;
    }
    if (changed) this.#anchor = { x: event.clientX, y: event.clientY };
    // 一旦指针落在新单词上，就取消“离开卡片/旧单词”的待关闭任务。
    // 只有单词真正发生变化时才重新计时，鼠标在同一单词内移动不会重置。
    this.#clearCloseTimer();
    if (!changed && (this.#openTimer !== null || this.isOpen)) return;

    // 切换到新单词时先撤掉旧卡片，避免新词查词期间继续展示旧词释义。
    if (this.isOpen) this.#dismissCard();

    this.#clearOpenTimer();
    this.#openTimer = setTimeout(() => {
      this.#openTimer = null;
      if (this.#activeWord !== word || this.#destroyed) return;
      void this.#lookupAndShow(word);
    }, this.#delay());
  };

  #handleViewportChange = () => {
    if (this.isOpen) this.#dismiss();
  };

  #handleKeyDown = (event) => {
    if (event.key === "Escape" && this.isOpen) {
      this.#dismiss();
    }
  };

  // 卡片外的按下/点击立即关闭（卡片自身的按钮会 stopPropagation）。
  #handleOutsideInteraction = (event) => {
    if (this.#card?.contains(event.target)) return;
    this.#dismiss();
  };

  // 指针离开卡片时延迟关闭，允许用户把鼠标移到卡片上的按钮
  #handleCardLeave = () => {
    this.#inCard = false;
    this.#scheduleClose();
  };

  #handleCardEnter = () => {
    this.#inCard = true;
    this.#clearCloseTimer();
  };

  /**
   * 指针是否正靠近已打开的卡片（朝向最近的一角且仍在视野内）。
   * 用于容忍“单词 → 卡片”之间的空隙，避免为穿过空隙的移动重新查词。
   */
  #pointerNearCard() {
    const card = this.#card;
    if (!card?.isConnected) return false;
    return this.#isNearRect(card.getBoundingClientRect(), this.#pointer);
  }

  // 纯几何判断，便于在无布局环境（jsdom）中单独验证。
  #isNearRect(rect, pointer) {
    if (!rect?.width || !rect?.height) return false;
    const { x, y } = pointer;
    const margin = 28;
    const nearestX = Math.max(rect.left, Math.min(x, rect.right));
    const nearestY = Math.max(rect.top, Math.min(y, rect.bottom));
    return Math.hypot(x - nearestX, y - nearestY) <= margin;
  }

  // --- 单词识别 -----------------------------------------------------------

  #resolveWord(target, event) {
    // 扩展自身 UI、译文容器的字形与原文无关，不应查词
    if (!(target instanceof Node)) return null;
    if (
      target.nodeType === Node.ELEMENT_NODE &&
      target.closest?.(
        ".notranslate, .kiss-translate-wrapper, .kiss-translate-original, .kiss-translate-highlight"
      )
    ) {
      return null;
    }
    if (event.ctrlKey || event.metaKey) return null;

    const caret = this.#caretOffset(event);
    if (!caret) return null;
    if (
      caret.node.parentElement?.closest?.(
        ".notranslate, .kiss-translate-wrapper, .kiss-translate-original, .kiss-translate-highlight"
      )
    ) {
      return null;
    }
    return extractHoveredWord(caret.node, caret.offset);
  }

  /**
   * 使用 caretPositionFromPoint / caretRangeFromPoint 找到指针所在的文本节点与字符偏移量。
   *
   * 浏览器在命中译文包装层（.kiss-translate-wrapper）内部的原文文本时，
   * caret 可能落到包装层上的其他节点；因此这里直接采用 caret 所在的文本节点，
   * 而不是要求它等于 mousemove 的目标节点。
   */
  #caretOffset(event) {
    const x = event.clientX;
    const y = event.clientY;
    try {
      if (typeof document.caretPositionFromPoint === "function") {
        const position = document.caretPositionFromPoint(x, y);
        if (position?.offsetNode?.nodeType === Node.TEXT_NODE) {
          return { node: position.offsetNode, offset: position.offset };
        }
      }
      if (typeof document.caretRangeFromPoint === "function") {
        const range = document.caretRangeFromPoint(x, y);
        const node = range?.startContainer;
        if (node?.nodeType === Node.TEXT_NODE) {
          return { node, offset: range.startOffset };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  #delay() {
    const value = Number(this.#setting?.mouseHoverSetting?.wordCardDelay);
    return Number.isFinite(value) && value >= 0
      ? value
      : DEFAULT_WORD_CARD_DELAY;
  }

  #dictionary() {
    const dict = this.#setting?.mouseHoverSetting?.wordCardDict;
    return OPT_DICT_MAP.has(dict) ? dict : OPT_DICT_BING;
  }

  // --- 查词与渲染 ---------------------------------------------------------

  async #lookupAndShow(word) {
    this.#clearCloseTimer();
    if (this.#anchor) this.#position(this.#ensureCard());
    const runId = ++this.#runId;
    const dict = this.#dictionary();
    const card = this.#ensureCard();
    this.#renderLoading(card, word);

    let result = null;
    try {
      const raw =
        dict === OPT_DICT_BING
          ? await apiMicrosoftDict(word)
          : await apiYoudaoDict(word);
      result = normalizeDictionaryResult(dict, raw, word);
    } catch (err) {
      logger.child("word-card").info("lookup failed", word, err);
    }

    if (runId !== this.#runId || this.#destroyed || this.#activeWord !== word) {
      return;
    }
    if (!result) {
      this.#renderMessage(
        card,
        word,
        this.#i18n("favorite_word_definition_not_found", "No definition found.")
      );
      return;
    }
    this.#lastLookup = result;
    this.#renderResult(card, result);
    this.#position(card);
  }

  #ensureCard() {
    if (this.#card?.isConnected) return this.#card;
    const card = document.createElement("div");
    card.className = `${WORD_CARD_CLASS} notranslate`;
    card.dataset.theme = this.#resolvedDark() ? "dark" : "light";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-live", "polite");
    card.addEventListener("mouseenter", this.#handleCardEnter);
    card.addEventListener("mouseleave", this.#handleCardLeave);
    card.addEventListener("mousedown", (event) => event.stopPropagation());
    document.body.appendChild(card);
    this.#card = card;
    this.#position(card);
    return card;
  }

  #renderHeader(word) {
    const title = document.createElement("span");
    title.className = "kwc-word";
    title.textContent = word;
    return title;
  }

  #renderLoading(card, word) {
    card.replaceChildren();
    const header = document.createElement("div");
    header.className = "kwc-head";
    header.appendChild(this.#renderHeader(word));
    card.appendChild(header);

    const loading = document.createElement("div");
    loading.className = "kwc-message";
    loading.textContent = this.#i18n(
      "favorite_word_lookup_loading",
      "Looking up…"
    );
    card.appendChild(loading);
    this.#position(card);
  }

  #renderMessage(card, word, text) {
    card.replaceChildren();
    const header = document.createElement("div");
    header.className = "kwc-head";
    header.appendChild(this.#renderHeader(word));
    card.appendChild(header);

    const message = document.createElement("div");
    message.className = "kwc-message";
    message.textContent = text;
    card.appendChild(message);

    card.appendChild(this.#renderActions(word, null));
    this.#position(card);
  }

  #renderResult(card, result) {
    const { word, phonetics = [], definitions = [], examples = [] } = result;
    card.replaceChildren();

    const header = document.createElement("div");
    header.className = "kwc-head";
    header.appendChild(this.#renderHeader(word || this.#activeWord));
    if (phonetics.length) {
      const phonetic = document.createElement("span");
      phonetic.className = "kwc-phonetic";
      phonetic.textContent = phonetics
        .map(({ key, phonetic: value }) => `${key ? `${key} ` : ""}/${value}/`)
        .join(" ");
      header.appendChild(phonetic);
    }
    card.appendChild(header);

    const list = document.createElement("ul");
    list.className = "kwc-defs";
    definitions.slice(0, 6).forEach(({ pos, text }) => {
      const item = document.createElement("li");
      if (pos) {
        const tag = document.createElement("span");
        tag.className = "kwc-pos";
        tag.textContent = pos;
        item.appendChild(tag);
      }
      item.appendChild(document.createTextNode(text));
      list.appendChild(item);
    });
    card.appendChild(list);

    if (examples.length) {
      const exampleBox = document.createElement("div");
      exampleBox.className = "kwc-examples";
      examples.forEach(({ eng, chs }) => {
        const line = document.createElement("div");
        line.className = "kwc-example";
        line.textContent = eng;
        exampleBox.appendChild(line);
        if (chs) {
          const translation = document.createElement("div");
          translation.className = "kwc-example-trans";
          translation.textContent = chs;
          exampleBox.appendChild(translation);
        }
      });
      card.appendChild(exampleBox);
    }

    const definitionText = definitions
      .map(({ pos, text }) => `${pos ? `[${pos}] ` : ""}${text}`)
      .join("; ");
    card.appendChild(
      this.#renderActions(result.word || this.#activeWord, {
        phonetic: (phonetics[0] && phonetics[0].phonetic) || "",
        definition: definitionText.slice(0, 500),
      })
    );
  }

  #renderActions(word, wordData) {
    const actions = document.createElement("div");
    actions.className = "kwc-actions";
    if (!word) return actions;

    const speakButton = document.createElement("button");
    speakButton.type = "button";
    speakButton.className = "kwc-speak";
    // 内联 SVG：未播放显示喇叭，播放中切换为停止方块（CSS 按 data-speaking 切换）。
    speakButton.appendChild(createSpeakerIcon());
    speakButton.appendChild(createStopIcon());
    speakButton.setAttribute(
      "aria-label",
      this.#i18n("word_card_speak", "Play pronunciation")
    );
    speakButton.title = this.#i18n("word_card_speak", "Play pronunciation");
    speakButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.#toggleSpeak(word, speakButton);
    });
    actions.appendChild(speakButton);

    const favButton = document.createElement("button");
    favButton.type = "button";
    favButton.className = "kwc-fav";
    favButton.setAttribute("aria-label", this.#i18n("collect", "Favorite"));
    favButton.title = this.#i18n("collect", "Favorite");
    const renderFav = (isFav) => {
      favButton.textContent = String.fromCodePoint(isFav ? 0x2665 : 0x2661);
      favButton.dataset.favorite = String(isFav);
      favButton.setAttribute("aria-pressed", String(isFav));
    };
    renderFav(false);
    if (wordData) {
      isFavoriteWord(word)
        .then((isFav) => {
          if (favButton.isConnected) renderFav(isFav);
        })
        .catch(() => {});
    }
    favButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!wordData) return;
      favButton.disabled = true;
      try {
        renderFav(await toggleFavoriteWord(word, wordData));
      } catch (err) {
        logger.child("word-card").info("toggle favorite failed", err);
      } finally {
        favButton.disabled = false;
      }
    });
    actions.appendChild(favButton);

    return actions;
  }

  // --- 发音 ---------------------------------------------------------------

  #setSpeaking(button, speaking) {
    this.#speaking = speaking;
    if (button) button.dataset.speaking = String(speaking);
  }

  // 恢复按钮的可用状态与提示（播放失败或重新播放时使用）。
  #resetSpeakButton(button) {
    button.disabled = false;
    button.title = this.#i18n("word_card_speak", "Play pronunciation");
  }

  #speechMode() {
    const mode = this.#setting?.mouseHoverSetting?.wordCardSpeech;
    return WORD_CARD_SPEECH_OPTIONS.includes(mode)
      ? mode
      : DEFAULT_WORD_CARD_SPEECH;
  }

  /** 按优先级列出候选发音地址：有道词典录音优先，其次 Google 词典录音。 */
  #audioCandidates(word) {
    const word_ = String(word || "").trim();
    const candidates = [];
    const youdao = buildYoudaoVoiceUrl(this.#lastLookup?.usSpeech);
    if (youdao) candidates.push(youdao);
    if (/^[a-z][a-z'-]*$/i.test(word_)) {
      candidates.push(buildGoogleVoiceUrl(word_));
    }
    return candidates;
  }

  /**
   * 播放发音。
   *
   * 默认使用真人录音（有道/Google 词典）。系统合成（chrome.tts /
   * speechSynthesis）音色机械，只有在用户选择“系统语音合成”或选择“自动”且
   * 所有录音都不可用时才会使用。
   */
  async #toggleSpeak(word, button) {
    // 正在播放：再次点击即停止。
    if (this.#speaking) {
      this.#stopAudio();
      stopSpeech();
      this.#setSpeaking(button, false);
      return;
    }

    const mode = this.#speechMode();
    button.dataset.loading = "true";
    this.#resetSpeakButton(button);
    try {
      if (mode !== OPT_WORD_CARD_SPEECH_SYSTEM) {
        for (const url of this.#audioCandidates(word)) {
          if (await this.#playAudio(url, button)) return;
          if (this.#destroyed || !button.isConnected) return;
        }
      }
    } catch (err) {
      logger.child("word-card").info("audio pronunciation failed", word, err);
    } finally {
      delete button.dataset.loading;
    }

    if (mode === OPT_WORD_CARD_SPEECH_AUDIO) {
      // 只使用录音：本次没有可用录音时提示，但按钮保持可点——音源可能恢复，
      // 也可能用户已经改了发音来源设置。
      button.title = this.#i18n(
        "word_card_speech_unavailable",
        "No recording available"
      );
      return;
    }
    this.#playSystemSpeech(word, button);
  }

  // 播放一段音频。返回 false 表示本次播放失败，可继续尝试下一个音源。
  #playAudio(url, button) {
    return new Promise((resolve) => {
      this.#stopAudio();
      const audio = new Audio();
      audio.preload = "auto";
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      audio.addEventListener(
        "playing",
        () => {
          if (this.#audio !== audio) return;
          this.#setSpeaking(button, true);
          finish(true);
        },
        { once: true }
      );
      audio.addEventListener(
        "ended",
        () => {
          if (this.#audio === audio) {
            this.#setSpeaking(button, false);
            this.#stopAudio();
          }
        },
        { once: true }
      );
      audio.addEventListener(
        "error",
        () => {
          if (this.#audio === audio) {
            this.#setSpeaking(button, false);
            this.#stopAudio();
          }
          finish(false);
        },
        { once: true }
      );
      this.#audio = audio;
      audio.src = url;
      // 先加载再播放：preload 能让“播放”在音频就绪后立即开始，听起来更干脆。
      const playPromise = audio.play?.();
      if (playPromise?.catch) {
        playPromise.catch(() => {
          finish(false);
          if (this.#audio === audio) this.#stopAudio();
        });
      }
    });
  }

  #stopAudio() {
    const audio = this.#audio;
    this.#audio = null;
    if (!audio) return;
    try {
      audio.pause();
      audio.removeAttribute("src");
      audio.load?.();
    } catch {
      // 忽略停止时的异常
    }
  }

  #playSystemSpeech(word, button) {
    if (!canSpeak()) {
      button.disabled = true;
      return;
    }
    const started = speak(word, "en-US", {
      voice: this.#setting?.mouseHoverSetting?.wordCardVoice || "",
      onEnd: () => {
        if (button.isConnected) this.#setSpeaking(button, false);
      },
    });
    if (started) this.#setSpeaking(button, true);
  }

  // --- 定位与关闭 ---------------------------------------------------------

  #position(card) {
    const gap = 10;
    const viewportGap = 8;
    // 以触发单词的位置为锚点，而不是当前鼠标位置：鼠标移向卡片时它不会再跑开。
    const anchor = this.#anchor || this.#pointer;
    const { x, y } = anchor;
    let left = x + gap;
    let top = y + gap;

    // 先放在单词右下方，放不下再翻到上方
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    const rect = card.getBoundingClientRect();
    if (top + rect.height > window.innerHeight - viewportGap) {
      top = y - rect.height - gap;
    }
    const maxLeft = window.innerWidth - rect.width - viewportGap;
    left = Math.max(viewportGap, Math.min(left, maxLeft));
    top = Math.max(viewportGap, top);

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  #scheduleClose() {
    this.#clearOpenTimer();
    if (!this.isOpen || this.#inCard) return;
    this.#clearCloseTimer();
    this.#closeTimer = setTimeout(() => {
      this.#closeTimer = null;
      if (this.#inCard) return;
      this.#dismiss();
    }, 200);
  }

  #dismiss() {
    this.#clearTimers();
    this.#activeWord = null;
    this.#anchor = null;
    this.#dismissCard();
  }

  // 只关闭卡片本身，保留当前悬停单词（切换到新单词时使用）。
  #dismissCard() {
    this.#inCard = false;
    this.#runId += 1;
    if (this.#speaking) {
      stopSpeech();
      this.#speaking = false;
    }
    this.#stopAudio();
    this.#lastLookup = null;
    this.#card?.remove();
    this.#card = null;
  }

  #clearTimers() {
    this.#clearOpenTimer();
    this.#clearCloseTimer();
  }

  #clearOpenTimer() {
    if (this.#openTimer !== null) {
      clearTimeout(this.#openTimer);
      this.#openTimer = null;
    }
  }

  #clearCloseTimer() {
    if (this.#closeTimer !== null) {
      clearTimeout(this.#closeTimer);
      this.#closeTimer = null;
    }
  }
}

/** 注入卡片样式（每个页面只注入一次） */
function ensureWordCardStyles() {
  if (document.getElementById("kiss-word-card-styles")) return;
  const style = document.createElement("style");
  style.id = "kiss-word-card-styles";
  // 颜色全部走 CSS 变量：浅色为默认，深色仅在系统偏好深色时覆盖。
  // 使用媒体查询而非一次性读取，系统主题切换时卡片会实时跟随。
  const c = WORD_CARD_CLASS;
  style.textContent = `
    .${c} {
      --kwc-bg: #ffffff;
      --kwc-fg: #1f2329;
      --kwc-muted: #5b6472;
      --kwc-accent: #0b76d0;
      --kwc-accent-soft: rgba(11, 118, 208, 0.1);
      --kwc-line: rgba(0, 0, 0, 0.1);
      --kwc-btn-border: rgba(0, 0, 0, 0.14);
      --kwc-btn-bg: rgba(0, 0, 0, 0.03);
      --kwc-btn-hover: rgba(0, 0, 0, 0.08);
      --kwc-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
      --kwc-heart: #e0395c;
      --kwc-heart-soft: rgba(224, 57, 92, 0.12);
      color-scheme: light;
    }
    .${c}[data-theme="dark"] {
      --kwc-bg: #1f2329;
      --kwc-fg: #f2f4f8;
      --kwc-muted: #9aa4b2;
      --kwc-accent: #4fc3f7;
      --kwc-accent-soft: rgba(79, 195, 247, 0.14);
      --kwc-line: rgba(255, 255, 255, 0.12);
      --kwc-btn-border: rgba(255, 255, 255, 0.18);
      --kwc-btn-bg: rgba(255, 255, 255, 0.06);
      --kwc-btn-hover: rgba(255, 255, 255, 0.14);
      --kwc-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
      --kwc-heart: #ff6b81;
      --kwc-heart-soft: rgba(255, 107, 129, 0.16);
      color-scheme: dark;
    }
    .${c} {
      position: fixed;
      z-index: 2147483647;
      box-sizing: border-box;
      width: max-content;
      max-width: min(320px, calc(100vw - 16px));
      max-height: 60vh;
      overflow-y: auto;
      padding: 10px 12px 8px;
      border-radius: 12px;
      border: 1px solid var(--kwc-line);
      background: var(--kwc-bg);
      color: var(--kwc-fg);
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
      text-align: left;
      box-shadow: var(--kwc-shadow);
      pointer-events: auto;
      user-select: text;
      -webkit-user-select: text;
      animation: kwc-in 120ms ease-out;
      transition: background-color 160ms ease, color 160ms ease;
    }
    @keyframes kwc-in {
      from { opacity: 0; transform: translateY(2px) scale(0.985); }
      to { opacity: 1; transform: none; }
    }
    .${c} .kwc-head {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 6px;
    }
    .${c} .kwc-word {
      font-size: 17px;
      font-weight: 700;
      letter-spacing: 0.1px;
      color: var(--kwc-accent);
      word-break: break-word;
    }
    .${c} .kwc-phonetic {
      font-size: 12px;
      color: var(--kwc-muted);
    }
    .${c} .kwc-defs {
      margin: 0;
      padding-left: 16px;
    }
    .${c} .kwc-defs li {
      margin: 2px 0;
    }
    .${c} .kwc-pos {
      color: var(--kwc-accent);
      margin-right: 4px;
    }
    .${c} .kwc-message {
      color: var(--kwc-muted);
      font-style: italic;
    }
    .${c} .kwc-examples {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid var(--kwc-line);
      font-size: 12px;
    }
    .${c} .kwc-example-trans {
      color: var(--kwc-muted);
      margin-bottom: 4px;
    }
    .${c} .kwc-actions {
      display: flex;
      gap: 6px;
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid var(--kwc-line);
    }
    .${c} .kwc-actions button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 3px;
      min-width: 34px;
      height: 32px;
      padding: 0 9px;
      border: 1px solid var(--kwc-btn-border);
      border-radius: 8px;
      background: var(--kwc-btn-bg);
      color: inherit;
      font-size: 15px;
      line-height: 1;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease,
        color 120ms ease;
    }
    .${c} .kwc-actions button:hover:not(:disabled) {
      background: var(--kwc-btn-hover);
    }
    .${c} .kwc-actions button:focus-visible {
      outline: 2px solid var(--kwc-accent);
      outline-offset: 1px;
    }
    .${c} .kwc-actions button:disabled {
      opacity: 0.45;
      cursor: default;
    }

    /* 播放按钮：统一直线描边风格，未播放为喇叭，播放中切换为停止方块。 */
    .${c} .kwc-speak {
      color: var(--kwc-accent);
    }
    .${c} .kwc-speak:hover:not(:disabled) {
      background: var(--kwc-accent-soft);
    }
    .${c} .kwc-speak svg {
      width: 20px;
      height: 20px;
      display: block;
      overflow: visible;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .${c} .kwc-speak .kwc-icon {
      transition: opacity 120ms ease, transform 120ms ease;
    }
    .${c} .kwc-speak .kwc-icon-stop,
    .${c} .kwc-speak[data-speaking="true"] .kwc-icon-play {
      opacity: 0;
      transform: scale(0.7);
      display: none;
    }
    .${c} .kwc-speak[data-speaking="true"] .kwc-icon-stop {
      display: block;
      opacity: 1;
      transform: none;
    }
    .${c} .kwc-speak[data-speaking="true"] {
      color: var(--kwc-heart);
      border-color: var(--kwc-heart);
      background: var(--kwc-heart-soft);
    }
    .${c} .kwc-speak[data-loading="true"] {
      opacity: 0.65;
    }
    @media (prefers-reduced-motion: reduce) {
      .${c} { animation: none; transition: none; }
      .${c} .kwc-speak .kwc-icon { transition: none; }
    }

    /* 收藏：未收藏为空心，已收藏为实心并着色。 */
    .${c} .kwc-fav[data-favorite="true"] {
      color: var(--kwc-heart);
      border-color: var(--kwc-heart);
      background: var(--kwc-heart-soft);
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}
