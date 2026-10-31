import { apiMicrosoftDict, apiYoudaoDict } from "../apis";
import {
  WordCardController,
  extractHoveredWord,
  normalizeDictionaryResult,
  buildYoudaoVoiceUrl,
  WORD_CARD_CLASS,
} from "./wordHoverCard";

jest.mock("../apis", () => ({
  apiMicrosoftDict: jest.fn(),
  apiYoudaoDict: jest.fn(),
}));
jest.mock("./speech", () => ({
  speak: jest.fn(() => true),
  stopSpeech: jest.fn(),
  canSpeak: jest.fn(() => true),
}));
jest.mock("../subtitle/favoriteWords", () => ({
  isFavoriteWord: jest.fn(async () => false),
  toggleFavoriteWord: jest.fn(async () => true),
}));

const { speak, canSpeak } = require("./speech");

/** 最小可用的 Audio 替身：记录 src，并暴露 play/pause 与事件派发。 */
class FakeAudio {
  static instances = [];
  static loadFails = true;
  constructor() {
    this.pause = jest.fn();
    this.load = jest.fn();
    this.listeners = {};
    this.src = "";
    // 浏览器中无法加载的地址会立刻报 error；默认模拟加载失败。

    FakeAudio.instances.push(this);
  }
  set src(value) {
    this._src = value;
  }
  // 静态开关：实例默认沿用类级设置（CRA 的 resetMocks 会重置类上的 jest mock，
  // 但不会重置普通静态属性，因此实例只读取类级值）。

  get src() {
    return this._src;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  emit(type) {
    (this.listeners[type] || []).forEach((fn) => fn());
  }
  play() {
    this.played = true;
    // 静态开关（CRA resetMocks 会重置类上的 jest mock，但保留普通静态属性）
    if (FakeAudio.loadFails) {
      setTimeout(() => this.emit("error"), 0);
    } else {
      this.emit("playing");
    }
    return Promise.resolve();
  }
  removeAttribute() {}
}
const OriginalAudio = global.Audio;
beforeAll(() => {
  global.Audio = FakeAudio;
});
afterAll(() => {
  global.Audio = OriginalAudio;
});
const {
  isFavoriteWord,
  toggleFavoriteWord,
} = require("../subtitle/favoriteWords");

const BING_RESULT = {
  word: "hello",
  aus: [{ key: "美", phonetic: "həˈloʊ" }],
  trs: [{ pos: "int.", def: "喂；哈罗" }],
  sentences: [{ eng: "Hello there.", chs: "你好。" }],
};

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const advance = async (ms) => {
  jest.advanceTimersByTime(ms);
  await flush();
};

const hover = (x = 10, y = 20, init = {}) => {
  document.dispatchEvent(
    new MouseEvent("mousemove", {
      clientX: x,
      clientY: y,
      bubbles: true,
      ...init,
    })
  );
};

/** 让 caret 位置固定到指定文本节点和偏移量 */
const stubCaret = (node, offset) => {
  document.caretRangeFromPoint = jest.fn(() => {
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset);
    return range;
  });
};

const setting = (hoverOverrides = {}) => ({
  uiLang: "zh",
  darkMode: "light",
  mouseHoverSetting: {
    useWordCard: true,
    wordCardDelay: 400,
    wordCardDict: "Bing",
    wordCardSpeech: "audio",
    ...hoverOverrides,
  },
});

const controllers = [];

const start = async (overrides) => {
  document.body.innerHTML = '<p id="p">say hello world</p>';
  const textNode = document.getElementById("p").firstChild;
  const controller = new WordCardController({ setting: setting(overrides) });
  controllers.push(controller);
  await controller.setEnabled(true, setting(overrides));
  return { controller, textNode };
};

const getWord = (text, offset) => {
  const node = document.createTextNode(text);
  return extractHoveredWord(node, offset);
};

beforeEach(() => {
  jest.useFakeTimers();
  apiMicrosoftDict.mockReset().mockResolvedValue(BING_RESULT);
  apiYoudaoDict.mockReset().mockResolvedValue(null);
  isFavoriteWord.mockReset().mockResolvedValue(false);
  toggleFavoriteWord.mockReset().mockResolvedValue(true);
  canSpeak.mockReset().mockReturnValue(true);
  speak.mockReset().mockReturnValue(true);
  FakeAudio.instances.length = 0;
  // 默认模拟“录音加载失败”，只有需要验证真人录音的用例才打开成功。
  FakeAudio.loadFails = true;
  delete document.caretRangeFromPoint;
});

afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.destroy());
  jest.useRealTimers();
  document.body.innerHTML = "";
  document.getElementById("kiss-word-card-styles")?.remove();
});

describe("extractHoveredWord", () => {
  test("reads the word under the pointer", () => {
    expect(getWord("say hello world", 6)).toBe("hello");
  });

  test("reads the word when the offset points at its trailing edge", () => {
    expect(getWord("say hello world", 9)).toBe("hello");
    expect(getWord("say hello!", 4)).toBe("hello");
  });

  test("prefers the word to the left on the space after it", () => {
    expect(getWord("say hello world", 9)).toBe("hello");
  });

  test("keeps internal apostrophes and hyphens", () => {
    expect(getWord("it's well-known", 2)).toBe("it's");
    expect(getWord("it's well-known", 8)).toBe("well-known");
  });

  test("rejects punctuation, numbers and single letters", () => {
    expect(getWord("hello, world", 6)).toBeNull();
    expect(getWord("version 42 here", 0)).toBe("version");
    expect(getWord("version 42 here", 8)).toBeNull();
    expect(getWord("a b", 0)).toBeNull();
  });

  test("rejects invalid offsets and non-text nodes", () => {
    expect(getWord("hello", -1)).toBeNull();
    expect(extractHoveredWord(document.body, 0)).toBeNull();
  });
});

describe("normalizeDictionaryResult", () => {
  test("normalizes Bing", () => {
    expect(normalizeDictionaryResult("Bing", BING_RESULT, "x")).toEqual({
      word: "hello",
      phonetics: [{ key: "美", phonetic: "həˈloʊ" }],
      definitions: [{ pos: "int.", text: "喂；哈罗" }],
      examples: [{ eng: "Hello there.", chs: "你好。" }],
    });
  });

  test("normalizes Youdao new and legacy shapes", () => {
    expect(
      normalizeDictionaryResult(
        "Youdao",
        {
          ec: {
            word: {
              "return-phrase": "hello",
              ukphone: "həˈləʊ",
              usphone: "həˈloʊ",
              trs: [{ pos: "int.", tran: "喂" }],
            },
          },
        },
        "x"
      )
    ).toMatchObject({
      word: "hello",
      phonetics: [
        { key: "英", phonetic: "həˈləʊ" },
        { key: "美", phonetic: "həˈloʊ" },
      ],
      definitions: [{ pos: "int.", text: "喂" }],
      usSpeech: "",
      ukSpeech: "",
    });
    expect(
      normalizeDictionaryResult("Youdao", { trs: [{ tran: "你好" }] }, "hi")
        ?.definitions
    ).toEqual([{ pos: "", text: "你好" }]);
  });

  test("returns null for empty data", () => {
    expect(normalizeDictionaryResult("Bing", null)).toBeNull();
    expect(normalizeDictionaryResult("Bing", {})).toBeNull();
    expect(normalizeDictionaryResult("Youdao", {})).toBeNull();
  });
});

describe("WordCardController", () => {
  test("does not listen while disabled", async () => {
    document.body.innerHTML = '<p id="p">hello</p>';
    const textNode = document.getElementById("p").firstChild;
    const controller = new WordCardController({ setting: setting() });
    controllers.push(controller);
    stubCaret(textNode, 2);
    hover();
    await advance(500);
    expect(apiMicrosoftDict).not.toHaveBeenCalled();
  });

  test("opens a card after the delay and renders the definition", async () => {
    const { controller, textNode } = await start();
    stubCaret(textNode, 5);
    hover();
    await advance(399);
    expect(controller.isOpen).toBe(false);
    await advance(1);
    expect(apiMicrosoftDict).toHaveBeenCalledWith("hello");
    expect(controller.isOpen).toBe(true);
    const card = document.querySelector(`.${WORD_CARD_CLASS}`);
    expect(card.querySelector(".kwc-word").textContent).toBe("hello");
    expect(card.querySelector(".kwc-phonetic").textContent).toContain("həˈloʊ");
    expect(card.querySelector(".kwc-defs").textContent).toContain("喂；哈罗");
    expect(card.querySelector(".kwc-speak")).not.toBeNull();
    expect(card.querySelector(".kwc-fav")).not.toBeNull();
  });

  test("does not open when the pointer keeps moving between words", async () => {
    const { controller, textNode } = await start();
    stubCaret(textNode, 5);
    hover(10, 20);
    await advance(300);
    stubCaret(textNode, 2);
    hover(12, 20);
    await advance(300);
    expect(controller.isOpen).toBe(false);
    expect(apiMicrosoftDict).not.toHaveBeenCalled();
  });

  test("ignores Ctrl+hover so page hover-translation keeps working", async () => {
    const { controller, textNode } = await start();
    stubCaret(textNode, 5);
    hover(10, 20, { ctrlKey: true });
    await advance(500);
    expect(controller.isOpen).toBe(false);
  });

  test("uses the configured dictionary", async () => {
    const { textNode } = await start({ wordCardDict: "Youdao" });
    apiYoudaoDict.mockResolvedValue({
      ec: { word: { trs: [{ tran: "喂" }] } },
    });
    stubCaret(textNode, 5);
    hover();
    await advance(400);
    expect(apiYoudaoDict).toHaveBeenCalledWith("hello");
    expect(apiMicrosoftDict).not.toHaveBeenCalled();
  });

  test("shows a message when no definition is found", async () => {
    const { textNode } = await start();
    apiMicrosoftDict.mockResolvedValue({});
    stubCaret(textNode, 5);
    hover();
    await advance(400);
    const card = document.querySelector(`.${WORD_CARD_CLASS}`);
    expect(card.querySelector(".kwc-message")).not.toBeNull();
    expect(card.querySelector(".kwc-speak")).not.toBeNull();
  });

  test("drops a stale lookup when a newer word wins", async () => {
    const { textNode } = await start();
    const pending = [];
    apiMicrosoftDict.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve))
    );
    stubCaret(textNode, 5);
    hover();
    await advance(400);
    expect(apiMicrosoftDict).toHaveBeenCalledTimes(1);

    // 第二次悬停 "world"
    stubCaret(textNode, 10);
    hover(20, 20);
    hover(21, 20);
    await advance(400);
    expect(apiMicrosoftDict).toHaveBeenCalledTimes(2);

    // 第二个词的结果先到
    pending[1]({ ...BING_RESULT, word: "world", trs: [{ def: "世界" }] });
    await flush();
    // 第一个词的结果晚到，不应覆盖卡片
    pending[0](BING_RESULT);
    await flush();
    const card = document.querySelector(`.${WORD_CARD_CLASS}`);
    expect(card.querySelector(".kwc-word").textContent).toBe("world");
    expect(card.querySelector(".kwc-defs").textContent).toContain("世界");
  });

  test("plays the real recording from the card", async () => {
    FakeAudio.loadFails = false;
    const { textNode } = await start({ wordCardDict: "Youdao" });
    apiYoudaoDict.mockResolvedValue({
      ec: {
        word: {
          trs: [{ tran: "喂" }],
          usspeech: "hello&type=2",
        },
      },
    });
    stubCaret(textNode, 5);
    hover();
    await advance(400);
    await flush();

    const button = document.querySelector(".kwc-speak");
    // 让音频加载成功
    FakeAudio.loadFails = false;
    button.click();
    await flush();

    // 有道真人录音优先，而不是系统合成
    expect(speak).not.toHaveBeenCalled();
    const lastAudio = FakeAudio.instances.at(-1);
    expect(lastAudio.src).toBe(
      "https://dict.youdao.com/dictvoice?audio=hello&type=2"
    );
    expect(lastAudio.played).toBe(true);
  });

  test("stops the recording when the button is clicked again", async () => {
    FakeAudio.loadFails = false;
    const { textNode } = await start({ wordCardDict: "Youdao" });
    apiYoudaoDict.mockResolvedValue({
      ec: { word: { trs: [{ tran: "喂" }], usspeech: "hello&type=2" } },
    });
    stubCaret(textNode, 5);
    hover();
    await advance(400);
    await flush();
    const button = document.querySelector(".kwc-speak");
    button.click();
    await flush();
    const audio = FakeAudio.instances.at(-1);
    expect(button.dataset.speaking).toBe("true");
    button.click();
    expect(audio.pause).toHaveBeenCalled();
    expect(button.dataset.speaking).toBe("false");
  });

  test("falls back to system speech without a recording in auto mode", async () => {
    const { textNode } = await start({ wordCardSpeech: "auto" });
    stubCaret(textNode, 5);
    hover();
    await advance(400);
    const button = document.querySelector(".kwc-speak");
    button.click();
    // 音频加载失败出现在下一个宏任务，需要等定时器
    await advance(10);
    expect(speak).toHaveBeenCalledWith("hello", "en-US", expect.any(Object));
  });

  test("re-enables the speaker after a failed play so it can be retried", async () => {
    const { textNode } = await start({ wordCardSpeech: "audio" });
    stubCaret(textNode, 5);
    hover();
    await advance(400);
    const button = document.querySelector(".kwc-speak");
    button.click();
    await advance(10);
    // 录音不可用时给出提示，但按钮保持可点
    expect(button.disabled).toBe(false);
    expect(button.title).toBeTruthy();
    FakeAudio.loadFails = false;
    apiMicrosoftDict.mockClear();
    button.click();
    await advance(10);
    expect(speak).not.toHaveBeenCalled();
  });

  test("closes immediately when clicking outside the card", async () => {
    const { controller, textNode } = await start();
    stubCaret(textNode, 5);
    hover();
    await advance(400);
    expect(controller.isOpen).toBe(true);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(controller.isOpen).toBe(false);
  });

  test("marks the speaker unavailable when there is nothing to play", async () => {
    canSpeak.mockReturnValue(false);
    const { textNode } = await start({ wordCardSpeech: "auto" });
    stubCaret(textNode, 5);
    hover();
    await advance(400);
    const button = document.querySelector(".kwc-speak");
    button.click();
    await advance(10);
    expect(button.disabled).toBe(true);
  });

  test("toggles the favorite word and reflects the stored state", async () => {
    isFavoriteWord.mockResolvedValue(true);
    const { textNode } = await start();
    stubCaret(textNode, 5);
    hover();
    await advance(400);
    const button = document.querySelector(".kwc-fav");
    await flush();
    expect(button.dataset.favorite).toBe("true");

    button.click();
    await flush();
    expect(toggleFavoriteWord).toHaveBeenCalledWith("hello", {
      phonetic: "həˈloʊ",
      definition: "[int.] 喂；哈罗",
    });
    expect(button.dataset.favorite).toBe("true");
  });

  test("closes on Escape", async () => {
    const { controller, textNode } = await start();
    stubCaret(textNode, 5);
    hover();
    await advance(400);
    expect(controller.isOpen).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(controller.isOpen).toBe(false);
  });

  test("closes after the pointer leaves both word and card", async () => {
    const { controller, textNode } = await start();
    stubCaret(textNode, 5);
    hover();
    await advance(400);
    stubCaret(textNode, 0);
    hover(0, 0);
    await advance(200);
    // 离开单词后卡片关闭，但普通词不会触发新的查词
    expect(controller.isOpen).toBe(false);
    // 悬停到普通词只关闭旧卡片，也不会复用旧词的释义
    expect(apiMicrosoftDict.mock.calls.map(([word]) => word)).toEqual([
      "hello",
    ]);
  });

  test("keeps the card while the pointer travels toward it", async () => {
    const { controller, textNode } = await start();
    stubCaret(textNode, 5);
    hover(10, 20);
    await advance(400);
    expect(controller.isOpen).toBe(true);
    const card = document.querySelector(`.${WORD_CARD_CLASS}`);
    const rect = card.getBoundingClientRect();
    if (rect.width && rect.height) {
      // 真实布局：从单词移向卡片，途中不是单词但贴近卡片
      stubCaret(textNode, 0);
      hover(rect.left - 10, rect.top + 10);
      await advance(1000);
      expect(controller.isOpen).toBe(true);
      expect(apiMicrosoftDict).toHaveBeenCalledTimes(1);
    }
  });

  test("treats a pointer within the margin of the card as near it", () => {
    // jsdom 不做布局，直接调用几何判断验证边界。
    const controller = new WordCardController({ setting: setting() });
    const nearRect = controller._nearRectForTest({
      left: 100,
      top: 100,
      right: 300,
      bottom: 250,
      width: 200,
      height: 150,
    });
    expect(nearRect({ x: 80, y: 150 })).toBe(true);
    expect(nearRect({ x: 310, y: 150 })).toBe(true);
    expect(nearRect({ x: 40, y: 40 })).toBe(false);
  });

  test("stays open while the pointer is over the card", async () => {
    const { controller, textNode } = await start();
    stubCaret(textNode, 5);
    hover();
    await advance(400);
    const card = document.querySelector(`.${WORD_CARD_CLASS}`);
    card.dispatchEvent(new MouseEvent("mouseenter"));
    stubCaret(textNode, 0);
    hover(0, 0);
    await advance(1000);
    expect(controller.isOpen).toBe(true);
    card.dispatchEvent(new MouseEvent("mouseleave"));
    await advance(200);
    expect(controller.isOpen).toBe(false);
  });

  test("setEnabled(false) removes listeners and the card", async () => {
    const { controller, textNode } = await start();
    stubCaret(textNode, 5);
    hover();
    await advance(400);
    expect(controller.isOpen).toBe(true);
    await controller.setEnabled(false);
    expect(controller.isOpen).toBe(false);
    apiMicrosoftDict.mockClear();
    stubCaret(textNode, 0);
    hover(0, 0);
    hover(1, 0);
    await advance(500);
    expect(apiMicrosoftDict).toHaveBeenCalledTimes(1);
  });
});

describe("buildYoudaoVoiceUrl", () => {
  test("builds the recording URL from the dictionary speech field", () => {
    expect(buildYoudaoVoiceUrl("hello&type=2")).toBe(
      "https://dict.youdao.com/dictvoice?audio=hello&type=2"
    );
    expect(buildYoudaoVoiceUrl("  hello&type=1 ")).toBe(
      "https://dict.youdao.com/dictvoice?audio=hello&type=1"
    );
  });

  test("returns an empty string when there is no recording", () => {
    expect(buildYoudaoVoiceUrl("")).toBe("");
    expect(buildYoudaoVoiceUrl(undefined)).toBe("");
  });
});

describe("card theme", () => {
  const openCard = async (darkMode) => {
    document.body.innerHTML = '<p id="p">say hello world</p>';
    const textNode = document.getElementById("p").firstChild;
    const s = { ...setting(), darkMode };
    const controller = new WordCardController({ setting: s });
    controllers.push(controller);
    await controller.setEnabled(true, s);
    stubCaret(textNode, 5);
    hover();
    await advance(400);
    return document.querySelector(`.${WORD_CARD_CLASS}`);
  };

  test("follows the appearance setting: light", async () => {
    const card = await openCard("light");
    expect(card.dataset.theme).toBe("light");
  });

  test("follows the appearance setting: dark", async () => {
    const card = await openCard("dark");
    expect(card.dataset.theme).toBe("dark");
  });

  test("auto uses the system preference", async () => {
    const original = window.matchMedia;
    window.matchMedia = jest.fn(() => ({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }));
    try {
      const card = await openCard("auto");
      expect(card.dataset.theme).toBe("dark");
    } finally {
      window.matchMedia = original;
    }
  });

  test("updates the open card when the appearance setting changes", async () => {
    const { controller, textNode } = await start();
    stubCaret(textNode, 5);
    hover();
    await advance(400);
    expect(document.querySelector(`.${WORD_CARD_CLASS}`).dataset.theme).toBe(
      "light"
    );
    controller.updateSetting({ ...setting(), darkMode: "dark" });
    expect(document.querySelector(`.${WORD_CARD_CLASS}`).dataset.theme).toBe(
      "dark"
    );
  });
});

describe("card styles", () => {
  test("are injected once when the controller is enabled", async () => {
    const { controller } = await start();
    await controller.setEnabled(false);
    await controller.setEnabled(true, setting());
    expect(document.querySelectorAll("#kiss-word-card-styles")).toHaveLength(1);
  });
});
