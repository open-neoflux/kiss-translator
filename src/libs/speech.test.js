import { canSpeak, speak, stopSpeech, listVoices, pickVoice } from "./speech";

const EN_VOICES = [
  { name: "Zarvox", lang: "en-US", default: false, localService: true },
  { name: "Samantha", lang: "en-US", default: true, localService: true },
  { name: "Daniel", lang: "en-GB", default: false, localService: true },
  { name: "Tingting", lang: "zh-CN", default: false, localService: true },
  { name: "Google US English", lang: "en-US", localService: false },
];

function MockUtterance(text) {
  this.text = text;
  this.lang = "";
  this.voice = null;
  this.rate = 1;
  this.onend = null;
  this.onerror = null;
}

describe("speech", () => {
  let speakMock;

  beforeEach(() => {
    speakMock = jest.fn();
    globalThis.speechSynthesis = {
      speak: speakMock,
      cancel: jest.fn(),
      getVoices: () => EN_VOICES,
    };
    globalThis.SpeechSynthesisUtterance = MockUtterance;
    delete globalThis.chrome;
  });

  afterEach(() => {
    delete globalThis.speechSynthesis;
    delete globalThis.SpeechSynthesisUtterance;
    delete globalThis.chrome;
  });

  describe("pickVoice", () => {
    test("prefers the configured voice", () => {
      expect(pickVoice(EN_VOICES, "en-US", "Zarvox").name).toBe("Zarvox");
    });

    test("falls back to the system default voice", () => {
      expect(pickVoice(EN_VOICES, "en-US").name).toBe("Samantha");
      expect(pickVoice(EN_VOICES, "en-US", "Missing").name).toBe("Samantha");
    });

    test("never picks a voice of another language", () => {
      expect(pickVoice(EN_VOICES, "en-GB").name).toBe("Daniel");
      expect(pickVoice(EN_VOICES, "en-US").name).not.toBe("Tingting");
    });

    test("returns null when nothing matches", () => {
      expect(pickVoice(EN_VOICES, "ja-JP")).toBeNull();
      expect(pickVoice([], "en-US")).toBeNull();
    });
  });

  describe("listVoices", () => {
    test("lists local voices for the language", () => {
      expect(listVoices("en")).toEqual([
        { name: "Zarvox", lang: "en-US", default: false },
        { name: "Samantha", lang: "en-US", default: true },
        { name: "Daniel", lang: "en-GB", default: false },
      ]);
    });
  });

  test("uses speechSynthesis with the system default voice", () => {
    expect(canSpeak()).toBe(true);
    expect(speak("search", "en")).toBe(true);
    const utterance = speakMock.mock.calls[0][0];
    expect(utterance.text).toBe("search");
    expect(utterance.lang).toBe("en-US");
    expect(utterance.voice.name).toBe("Samantha");
  });

  test("uses the configured voice when it exists", () => {
    expect(speak("search", "en-US", { voice: "Zarvox" })).toBe(true);
    expect(speakMock.mock.calls[0][0].voice.name).toBe("Zarvox");
  });

  test("ignores a configured voice of another language", () => {
    expect(speak("search", "en-US", { voice: "Tingting" })).toBe(true);
    expect(speakMock.mock.calls[0][0].voice.name).toBe("Samantha");
  });

  test("applies speed and reports the end event", () => {
    const onEnd = jest.fn();
    expect(speak("search", "en", { speed: 1.25, onEnd })).toBe(true);
    const utterance = speakMock.mock.calls[0][0];
    expect(utterance.rate).toBe(1.25);
    utterance.onend();
    utterance.onend();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith("end");
  });

  test("maps interrupted errors to the interrupted reason", () => {
    const onEnd = jest.fn();
    speak("search", "en-US", { onEnd });
    speakMock.mock.calls[0][0].onerror({ error: "canceled" });
    expect(onEnd).toHaveBeenCalledWith("interrupted");
  });

  test("falls back to chrome.tts when speechSynthesis is unavailable", () => {
    delete globalThis.speechSynthesis;
    delete globalThis.SpeechSynthesisUtterance;
    const chromeSpeak = jest.fn();
    globalThis.chrome = { tts: { speak: chromeSpeak } };

    expect(canSpeak()).toBe(true);
    expect(speak("search", "en")).toBe(true);
    expect(chromeSpeak).toHaveBeenCalledWith(
      "search",
      expect.objectContaining({ lang: "en-US", onEvent: expect.any(Function) }),
      expect.any(Function)
    );
  });

  test("returns false for empty text and unsupported environments", () => {
    expect(speak("   ")).toBe(false);
    delete globalThis.speechSynthesis;
    delete globalThis.SpeechSynthesisUtterance;
    expect(canSpeak()).toBe(false);
    expect(speak("search", "en")).toBe(false);
  });

  test("stopSpeech cancels the current utterance", () => {
    stopSpeech();
    expect(globalThis.speechSynthesis.cancel).toHaveBeenCalled();
  });
});
