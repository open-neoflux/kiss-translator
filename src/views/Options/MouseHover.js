import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import { useI18n } from "../../hooks/I18n";
import ShortcutInput from "./ShortcutInput";
import ServiceSelect from "./ServiceSelect";
import ScenePromptSelect from "./ScenePromptSelect";
import TextField from "@mui/material/TextField";
import { useMouseHoverSetting } from "../../hooks/MouseHover";
import { useApiList } from "../../hooks/Api";
import { useCallback, useMemo, useState, useEffect } from "react";
import { listVoices } from "../../libs/speech";
import {
  DEFAULT_MOUSEHOVER_KEY,
  DEFAULT_MOUSE_HOVER_BUBBLE_STYLE,
  DEFAULT_MOUSE_HOVER_HOLD_DELAY,
  DEFAULT_MOUSE_HOVER_SETTING,
  DEFAULT_WORD_CARD_DELAY,
  DEFAULT_WORD_CARD_SPEECH,
  OPT_DICT_ALL,
  OPT_WORD_CARD_SPEECH_AUDIO,
  OPT_WORD_CARD_SPEECH_AUTO,
  OPT_WORD_CARD_SPEECH_SYSTEM,
  GLOBAL_KEY,
  OPT_MOUSE_HOVER_DISPLAY_BILINGUAL,
  OPT_MOUSE_HOVER_DISPLAY_BUBBLE,
  OPT_MOUSE_HOVER_HOLD_BUTTON_LEFT,
  OPT_MOUSE_HOVER_HOLD_BUTTON_RIGHT,
  OPT_MOUSE_HOVER_TRANS_DISPLAY_BLOCK,
  OPT_MOUSE_HOVER_TRANS_DISPLAY_INLINE,
  OPT_MOUSE_HOVER_TRANS_AREA,
  OPT_MOUSE_HOVER_TRANS_PARAGRAPH,
  OPT_MOUSE_HOVER_TRANS_REGION,
} from "../../config";
import {
  SettingsAdvanced,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
  SettingsSelect,
  SettingsSwitch,
} from "./SettingsCard";

/**
 * Mouse hover translation settings panel.
 */
export default function MouseHoverSetting() {
  const i18n = useI18n();
  // Global mouse hover translation settings.
  const { mouseHoverSetting, updateMouseHoverSetting } = useMouseHoverSetting();
  const { enabledApis } = useApiList();
  // 系统音色列表是异步填充的（getVoices 首次可能为空），voiceschanged 后刷新。
  const [voices, setVoices] = useState(() => listVoices("en"));
  useEffect(() => {
    const synth = globalThis.speechSynthesis;
    if (!synth?.addEventListener) return undefined;
    const refresh = () => setVoices(listVoices("en"));
    synth.addEventListener("voiceschanged", refresh);
    return () => synth.removeEventListener("voiceschanged", refresh);
  }, []);

  // Update the primary trigger shortcut.
  const handleShortcutInput = useCallback(
    (val) => {
      updateMouseHoverSetting({ mouseHoverKey: val });
    },
    [updateMouseHoverSetting]
  );

  // Update the alternative trigger shortcut.
  const handleAltShortcutInput = useCallback(
    (val) => {
      updateMouseHoverSetting({ mouseHoverKey2: val });
    },
    [updateMouseHoverSetting]
  );

  // Enable holding the left mouse button for the primary trigger.
  const handleHoldKeyChange = useCallback(
    (checked) => {
      updateMouseHoverSetting({ mouseHoverKeyHold: checked });
    },
    [updateMouseHoverSetting]
  );

  // Enable holding the left mouse button for the alternative trigger.
  const handleAltHoldKeyChange = useCallback(
    (checked) => {
      updateMouseHoverSetting({ mouseHoverKey2Hold: checked });
    },
    [updateMouseHoverSetting]
  );

  // Match the runtime fallback for invalid or non-positive hold delays.
  const handleHoldDelayChange = useCallback(
    (e) => {
      const value = Number(e.target.value);
      updateMouseHoverSetting({
        mouseHoverHoldDelay:
          Number.isFinite(value) && value > 0
            ? value
            : DEFAULT_MOUSE_HOVER_HOLD_DELAY,
      });
    },
    [updateMouseHoverSetting]
  );

  // Update the translation scope used by either hold trigger.
  const handleTransModeChange = useCallback(
    (e) => {
      updateMouseHoverSetting({ mouseHoverTransMode: e.target.value });
    },
    [updateMouseHoverSetting]
  );

  // Update the translation layout used by either hold trigger.
  const handleTransDisplayChange = useCallback(
    (e) => {
      updateMouseHoverSetting({ mouseHoverTransDisplay: e.target.value });
    },
    [updateMouseHoverSetting]
  );

  // Suppress navigation after translating a link or button with a hold trigger.
  const handlePreventClickChange = useCallback(
    (checked) => {
      updateMouseHoverSetting({ mouseHoverPreventClick: checked });
    },
    [updateMouseHoverSetting]
  );

  // Update blacklist patterns used by mouse hover translation.
  const handleBlacklistChange = useCallback(
    (e) => {
      const { value } = e.target;
      updateMouseHoverSetting({ blacklist: value });
    },
    [updateMouseHoverSetting]
  );

  // 系统语音音色列表：只列出本地音色，首项为“跟随系统默认”。
  const voiceOptions = useMemo(() => {
    const defaultVoice = voices.find((voice) => voice.default);
    return [
      {
        value: "",
        label: i18n(
          "word_card_voice_default",
          defaultVoice ? `系统默认（${defaultVoice.name}）` : "系统默认"
        ),
      },
      ...voices
        .filter((voice) => voice.name !== defaultVoice?.name)
        .map((voice) => ({ value: voice.name, label: voice.name })),
    ];
  }, [i18n, voices]);

  const handleBubbleStyleChange = useCallback(
    (e) => {
      updateMouseHoverSetting({ bubbleStyle: e.target.value });
    },
    [updateMouseHoverSetting]
  );

  // 单词卡片：弹出延迟，非法或负值回落到默认值。
  const handleWordCardDelayChange = useCallback(
    (e) => {
      const value = Number(e.target.value);
      updateMouseHoverSetting({
        wordCardDelay:
          Number.isFinite(value) && value >= 0
            ? value
            : DEFAULT_WORD_CARD_DELAY,
      });
    },
    [updateMouseHoverSetting]
  );

  // Switch the hold trigger between the left and the right mouse button.
  // The context-menu suppression choice is remembered: it only applies in
  // right-button mode, keeps its default (on) for untouched settings, and is
  // restored as-is when switching back to the right button.
  const handleHoldButtonChange = useCallback(
    (value) => {
      updateMouseHoverSetting({ mouseHoverHoldButton: value });
    },
    [updateMouseHoverSetting]
  );

  // Toggle native context-menu suppression for the right-button hold trigger.
  const handleSuppressContextMenuChange = useCallback(
    (checked) => {
      updateMouseHoverSetting({ mouseHoverSuppressContextMenu: checked });
    },
    [updateMouseHoverSetting]
  );

  // Revert the translation when the browser (e.g. Edge mouse gestures) takes
  // over the right-button hold, so a drawn gesture leaves no translation behind.
  const handleRevertOnGestureChange = useCallback(
    (checked) => {
      updateMouseHoverSetting({ mouseHoverHoldRevertOnGesture: checked });
    },
    [updateMouseHoverSetting]
  );

  // Normalize the current mouse hover settings.
  const {
    useMouseHover = true,
    mouseHoverKey = DEFAULT_MOUSEHOVER_KEY,
    mouseHoverKey2 = [],
    mouseHoverKeyHold = false,
    mouseHoverKey2Hold = false,
    mouseHoverHoldButton = OPT_MOUSE_HOVER_HOLD_BUTTON_LEFT,
    mouseHoverHoldDelay = DEFAULT_MOUSE_HOVER_HOLD_DELAY,
    mouseHoverSuppressContextMenu = DEFAULT_MOUSE_HOVER_SETTING.mouseHoverSuppressContextMenu,
    mouseHoverHoldRevertOnGesture = DEFAULT_MOUSE_HOVER_SETTING.mouseHoverHoldRevertOnGesture,
    mouseHoverTransMode = OPT_MOUSE_HOVER_TRANS_AREA,
    mouseHoverTransDisplay = OPT_MOUSE_HOVER_TRANS_DISPLAY_BLOCK,
    mouseHoverPreventClick = false,
    blacklist = "",
    displayMode = OPT_MOUSE_HOVER_DISPLAY_BILINGUAL,
    bubbleStyle = DEFAULT_MOUSE_HOVER_BUBBLE_STYLE,
    useWordCard = DEFAULT_MOUSE_HOVER_SETTING.useWordCard,
    wordCardDelay = DEFAULT_WORD_CARD_DELAY,
    wordCardDict = DEFAULT_MOUSE_HOVER_SETTING.wordCardDict,
    wordCardSpeech = DEFAULT_WORD_CARD_SPEECH,
    wordCardVoice = "",
  } = mouseHoverSetting;

  const isRightButtonHold =
    mouseHoverHoldButton === OPT_MOUSE_HOVER_HOLD_BUTTON_RIGHT;

  return (
    <Box>
      <SettingsSection title={i18n("touch_controls")}>
        <SettingsCard>
          <SettingsRow
            label={i18n("touch_mode")}
            description={i18n("touch_help")}
          >
            <SettingsSegmented
              value={mouseHoverSetting.touchMode || "tap"}
              label={i18n("touch_mode")}
              onChange={(touchMode) => updateMouseHoverSetting({ touchMode })}
              items={[
                { value: "tap", label: i18n("touch_tap") },
                { value: "swipe", label: i18n("touch_swipe") },
              ]}
            />
          </SettingsRow>
          <SettingsRow label={i18n("touch_direction")}>
            <SettingsSegmented
              value={mouseHoverSetting.touchDirection || "right"}
              label={i18n("touch_direction")}
              onChange={(touchDirection) =>
                updateMouseHoverSetting({ touchDirection })
              }
              items={[
                { value: "right", label: i18n("touch_right") },
                { value: "left", label: i18n("touch_left") },
              ]}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={i18n("touch_mouse")}>
        <SettingsCard>
          <SettingsRow label={i18n("use_mousehover_translation")}>
            <SettingsSwitch
              checked={useMouseHover}
              label={i18n("use_mousehover_translation")}
              onChange={(checked) =>
                updateMouseHoverSetting({ useMouseHover: checked })
              }
            />
          </SettingsRow>
          <SettingsRow
            label={i18n("trigger_trans_shortcut")}
            description={i18n("mousehover_key_help")}
          >
            <ShortcutInput
              compact
              value={mouseHoverKey}
              onChange={handleShortcutInput}
              label={i18n("trigger_trans_shortcut")}
            />
          </SettingsRow>
          <SettingsRow
            label={i18n("mousehover_hold_key")}
            description={i18n("mousehover_hold_key_helper")}
          >
            <SettingsSwitch
              checked={mouseHoverKeyHold}
              label={i18n("mousehover_hold_key")}
              onChange={handleHoldKeyChange}
            />
          </SettingsRow>
          <SettingsRow label={i18n("mousehover_display_mode")}>
            <SettingsSegmented
              value={displayMode}
              label={i18n("mousehover_display_mode")}
              onChange={(value) =>
                updateMouseHoverSetting({ displayMode: value })
              }
              items={[
                {
                  value: OPT_MOUSE_HOVER_DISPLAY_BILINGUAL,
                  label: i18n("mousehover_display_bilingual"),
                },
                {
                  value: OPT_MOUSE_HOVER_DISPLAY_BUBBLE,
                  label: i18n("mousehover_display_bubble"),
                },
              ]}
            />
          </SettingsRow>
          {displayMode === OPT_MOUSE_HOVER_DISPLAY_BUBBLE && (
            <SettingsRow
              label={i18n("translate_service")}
              description={i18n("mousehover_bubble_api_helper")}
            >
              <ServiceSelect
                scene={mouseHoverSetting}
                apis={[
                  {
                    apiSlug: GLOBAL_KEY,
                    apiName: i18n("mousehover_follow_page_rule"),
                  },
                  ...enabledApis,
                ]}
                label={i18n("translate_service")}
                onChange={(apiSlug) =>
                  updateMouseHoverSetting({
                    apiSlug: apiSlug || GLOBAL_KEY,
                  })
                }
              />
            </SettingsRow>
          )}
          {displayMode === OPT_MOUSE_HOVER_DISPLAY_BUBBLE && (
            <SettingsRow label={i18n("translation_prompt", "翻译提示词")}>
              <ScenePromptSelect
                scene={mouseHoverSetting}
                apis={enabledApis}
                label={i18n("translation_prompt", "翻译提示词")}
                value={mouseHoverSetting.promptSlug}
                onChange={(promptSlug) =>
                  updateMouseHoverSetting({ promptSlug })
                }
              />
            </SettingsRow>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={i18n("use_word_card")}>
        <SettingsCard>
          <SettingsRow
            label={i18n("use_word_card")}
            description={i18n("use_word_card_help")}
          >
            <SettingsSwitch
              checked={Boolean(useWordCard)}
              label={i18n("use_word_card")}
              onChange={(checked) =>
                updateMouseHoverSetting({ useWordCard: checked })
              }
            />
          </SettingsRow>
          {useWordCard && (
            <>
              <SettingsRow
                label={i18n("word_card_dict")}
                description={i18n(
                  "settings_single_word_dictionary_description"
                )}
              >
                <SettingsSegmented
                  value={wordCardDict}
                  label={i18n("word_card_dict")}
                  onChange={(value) =>
                    updateMouseHoverSetting({ wordCardDict: value })
                  }
                  items={OPT_DICT_ALL.map((dict) => ({
                    value: dict,
                    label: dict,
                  }))}
                />
              </SettingsRow>
              <SettingsRow
                label={i18n("word_card_delay")}
                description={i18n("word_card_delay_help")}
              >
                <TextField
                  hiddenLabel
                  size="small"
                  variant="filled"
                  type="number"
                  value={wordCardDelay}
                  onChange={handleWordCardDelayChange}
                  inputProps={{ min: 0, max: 3000, step: 50 }}
                  sx={{ width: 120 }}
                />
              </SettingsRow>
              <SettingsRow
                label={i18n("word_card_speech")}
                description={i18n("word_card_speech_help")}
              >
                <SettingsSegmented
                  value={wordCardSpeech}
                  label={i18n("word_card_speech")}
                  onChange={(value) =>
                    updateMouseHoverSetting({ wordCardSpeech: value })
                  }
                  items={[
                    {
                      value: OPT_WORD_CARD_SPEECH_AUDIO,
                      label: i18n("word_card_speech_audio"),
                    },
                    {
                      value: OPT_WORD_CARD_SPEECH_AUTO,
                      label: i18n("word_card_speech_auto"),
                    },
                    {
                      value: OPT_WORD_CARD_SPEECH_SYSTEM,
                      label: i18n("word_card_speech_system"),
                    },
                  ]}
                />
              </SettingsRow>
              {/* 系统音色：仅在会用到系统合成时提供选择 */}
              {wordCardSpeech !== OPT_WORD_CARD_SPEECH_AUDIO && (
                <SettingsRow
                  label={i18n("word_card_voice")}
                  description={i18n("word_card_voice_help")}
                >
                  <SettingsSelect
                    value={wordCardVoice}
                    label={i18n("word_card_voice")}
                    onChange={(value) =>
                      updateMouseHoverSetting({ wordCardVoice: value })
                    }
                    options={voiceOptions}
                  />
                </SettingsRow>
              )}
            </>
          )}
        </SettingsCard>
      </SettingsSection>

      {(mouseHoverKeyHold || mouseHoverKey2Hold) && (
        <SettingsSection>
          <SettingsCard>
            <SettingsRow
              label={i18n("mousehover_hold_button")}
              description={i18n("mousehover_hold_button_helper")}
            >
              <SettingsSegmented
                value={mouseHoverHoldButton}
                label={i18n("mousehover_hold_button")}
                onChange={handleHoldButtonChange}
                items={[
                  {
                    value: OPT_MOUSE_HOVER_HOLD_BUTTON_LEFT,
                    label: i18n("mousehover_hold_button_left"),
                  },
                  {
                    value: OPT_MOUSE_HOVER_HOLD_BUTTON_RIGHT,
                    label: i18n("mousehover_hold_button_right"),
                  },
                ]}
              />
            </SettingsRow>
            <SettingsRow
              label={i18n("mousehover_hold_delay")}
              description={i18n("mousehover_hold_delay_helper")}
            >
              <TextField
                hiddenLabel
                size="small"
                variant="filled"
                type="number"
                inputProps={{
                  min: 1,
                  step: 50,
                  "aria-label": i18n("mousehover_hold_delay"),
                }}
                name="mouseHoverHoldDelay"
                value={mouseHoverHoldDelay}
                onChange={handleHoldDelayChange}
              />
            </SettingsRow>
            <SettingsRow
              label={i18n("mousehover_hold_scope")}
              description={i18n("mousehover_hold_scope_helper")}
            >
              <TextField
                select
                hiddenLabel
                size="small"
                variant="filled"
                className="kt-settings-select"
                name="mouseHoverTransMode"
                value={mouseHoverTransMode}
                inputProps={{ "aria-label": i18n("mousehover_hold_scope") }}
                onChange={handleTransModeChange}
              >
                <MenuItem value={OPT_MOUSE_HOVER_TRANS_PARAGRAPH}>
                  {i18n("mousehover_hold_scope_paragraph")}
                </MenuItem>
                <MenuItem value={OPT_MOUSE_HOVER_TRANS_REGION}>
                  {i18n("mousehover_hold_scope_region")}
                </MenuItem>
                <MenuItem value={OPT_MOUSE_HOVER_TRANS_AREA}>
                  {i18n("mousehover_hold_scope_area")}
                </MenuItem>
              </TextField>
            </SettingsRow>
            <SettingsRow
              label={i18n("mousehover_hold_display")}
              description={i18n("mousehover_hold_display_helper")}
            >
              <TextField
                select
                hiddenLabel
                size="small"
                variant="filled"
                className="kt-settings-select"
                name="mouseHoverTransDisplay"
                value={mouseHoverTransDisplay}
                inputProps={{ "aria-label": i18n("mousehover_hold_display") }}
                onChange={handleTransDisplayChange}
              >
                <MenuItem value={OPT_MOUSE_HOVER_TRANS_DISPLAY_BLOCK}>
                  {i18n("mousehover_hold_display_block")}
                </MenuItem>
                <MenuItem value={OPT_MOUSE_HOVER_TRANS_DISPLAY_INLINE}>
                  {i18n("mousehover_hold_display_inline")}
                </MenuItem>
              </TextField>
            </SettingsRow>
            <SettingsRow
              label={i18n("mousehover_hold_suppress_menu")}
              description={i18n("mousehover_hold_suppress_menu_helper")}
            >
              <SettingsSwitch
                checked={isRightButtonHold && mouseHoverSuppressContextMenu}
                disabled={!isRightButtonHold}
                label={i18n("mousehover_hold_suppress_menu")}
                onChange={handleSuppressContextMenuChange}
              />
            </SettingsRow>
            <SettingsRow
              label={i18n("mousehover_hold_revert_on_gesture")}
              description={i18n("mousehover_hold_revert_on_gesture_helper")}
            >
              <SettingsSwitch
                checked={isRightButtonHold && mouseHoverHoldRevertOnGesture}
                disabled={!isRightButtonHold}
                label={i18n("mousehover_hold_revert_on_gesture")}
                onChange={handleRevertOnGestureChange}
              />
            </SettingsRow>
            <SettingsRow
              label={i18n("mousehover_hold_prevent_click")}
              description={
                isRightButtonHold
                  ? i18n("mousehover_hold_prevent_click_left_only")
                  : mouseHoverPreventClick
                    ? i18n("mousehover_hold_prevent_click_helper")
                    : undefined
              }
            >
              <SettingsSwitch
                checked={!isRightButtonHold && mouseHoverPreventClick}
                disabled={isRightButtonHold}
                label={i18n("mousehover_hold_prevent_click")}
                onChange={handlePreventClickChange}
              />
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      )}

      <SettingsAdvanced label={i18n("settings_detailed_controls")}>
        <Stack spacing={2} sx={{ py: 1 }}>
          <SettingsCard>
            <SettingsRow
              label={`${i18n("trigger_trans_shortcut")} 2`}
              description={i18n("mousehover_key_help")}
            >
              <ShortcutInput
                compact
                value={mouseHoverKey2}
                onChange={handleAltShortcutInput}
                label={`${i18n("trigger_trans_shortcut")} 2`}
              />
            </SettingsRow>
            <SettingsRow
              label={`${i18n("mousehover_hold_key")} 2`}
              description={i18n("mousehover_hold_key_helper")}
            >
              <SettingsSwitch
                checked={mouseHoverKey2Hold}
                label={`${i18n("mousehover_hold_key")} 2`}
                onChange={handleAltHoldKeyChange}
              />
            </SettingsRow>
          </SettingsCard>
          {displayMode === OPT_MOUSE_HOVER_DISPLAY_BUBBLE && (
            <TextField
              size="small"
              label={i18n("mousehover_bubble_style")}
              helperText={i18n("mousehover_bubble_style_helper")}
              name="bubbleStyle"
              value={bubbleStyle}
              onChange={handleBubbleStyleChange}
              maxRows={12}
              multiline
            />
          )}
        </Stack>
      </SettingsAdvanced>

      <SettingsSection title={i18n("blacklist")}>
        <TextField
          fullWidth
          size="small"
          label={i18n("blacklist")}
          helperText={i18n("pattern_helper")}
          name="blacklist"
          value={blacklist}
          onChange={handleBlacklistChange}
          maxRows={10}
          multiline
        />
      </SettingsSection>
    </Box>
  );
}
