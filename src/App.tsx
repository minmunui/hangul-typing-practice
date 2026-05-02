import {
  BookOpen,
  Check,
  CircleHelp,
  Eye,
  EyeOff,
  FileText,
  Gauge,
  Hand,
  Keyboard,
  ListRestart,
  Minus,
  Play,
  Plus,
  Settings2,
  Target,
  Timer,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FINGER_LABELS,
  FINGER_SHORT_LABELS,
  KEY_LOOKUP,
  KEYBOARD_ROWS,
  PRACTICE_STAGES,
  getCumulativeKeys,
  getTextsForStage,
  getWordsForStage,
  type FingerId,
  type KeySpec,
  type PracticeStage,
} from "./data/practice";

type PracticeMode = "keys" | "words" | "texts";
type PracticeScope = "cumulative" | "stage";
type SessionStatus = "idle" | "running" | "finished";
type PracticeInput = HTMLInputElement | HTMLTextAreaElement;

type Settings = {
  mode: PracticeMode;
  stageIndex: number;
  limitSeconds: number;
  itemGoal: number;
  showKeyboard: boolean;
  showFingers: boolean;
  scope: PracticeScope;
};

type Session = {
  status: SessionStatus;
  startedAt: number | null;
  endedAt: number | null;
  recordKey: string;
  totalTyped: number;
  correctTyped: number;
  mistakes: number;
  completed: number;
  queue: string[];
};

type BestRecord = {
  cpm: number;
  accuracy: number;
  completed: number;
};

const DEFAULT_SETTINGS: Settings = {
  mode: "keys",
  stageIndex: 0,
  limitSeconds: 60,
  itemGoal: 30,
  showKeyboard: true,
  showFingers: true,
  scope: "cumulative",
};

const DEFAULT_SESSION: Session = {
  status: "idle",
  startedAt: null,
  endedAt: null,
  recordKey: "",
  totalTyped: 0,
  correctTyped: 0,
  mistakes: 0,
  completed: 0,
  queue: [],
};

const IGNORED_CODES = new Set([
  "AltLeft",
  "AltRight",
  "Backspace",
  "CapsLock",
  "ControlLeft",
  "ControlRight",
  "Escape",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
  "Tab",
]);

const MODE_LABELS: Record<PracticeMode, string> = {
  keys: "자리",
  words: "낱말",
  texts: "짧은 글",
};

function App() {
  const [settings, setSettings] = useStoredState<Settings>("hangul-typing-settings", DEFAULT_SETTINGS);
  const [best, setBest] = useStoredState<Record<string, BestRecord>>("hangul-typing-best", {});
  const [session, setSession] = useState<Session>(() => ({
    ...DEFAULT_SESSION,
    recordKey: makeRecordKey(settings),
    queue: createQueue(settings),
  }));
  const [typedInput, setTypedInput] = useState("");
  const [lastResult, setLastResult] = useState<"correct" | "wrong" | null>(null);
  const [pressedCode, setPressedCode] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef<PracticeInput>(null);
  const clearResultRef = useRef<number | null>(null);

  const currentTarget = session.queue[session.completed] ?? "";
  const elapsedMs = getElapsedMs(session, now);
  const remainingSeconds =
    settings.limitSeconds > 0
      ? Math.max(0, settings.limitSeconds - Math.floor(elapsedMs / 1000))
      : null;
  const cpm = elapsedMs > 0 ? Math.round(session.correctTyped / (elapsedMs / 60000)) : 0;
  const accuracy =
    session.totalTyped > 0 ? Math.round((session.correctTyped / session.totalTyped) * 100) : 100;
  const stageWords = useMemo(() => getWordsForStage(settings.stageIndex), [settings.stageIndex]);
  const stageTexts = useMemo(() => getTextsForStage(settings.stageIndex), [settings.stageIndex]);
  const allowedKeys = useMemo(() => getCumulativeKeys(settings.stageIndex), [settings.stageIndex]);
  const recordKey = makeRecordKey(settings);
  const bestForCurrent = best[recordKey];
  const itemCount = getVisibleItemCount(settings.mode, allowedKeys.length, stageWords.length, stageTexts.length);
  const itemUnit = getItemUnit(settings.mode);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    resetSession();
  }, [settings.mode, settings.stageIndex, settings.itemGoal, settings.scope]);

  useEffect(() => {
    if (session.status !== "finished" || !session.startedAt || !session.endedAt) {
      return;
    }

    const duration = session.endedAt - session.startedAt;
    const finalCpm = duration > 0 ? Math.round(session.correctTyped / (duration / 60000)) : 0;
    const finalAccuracy =
      session.totalTyped > 0 ? Math.round((session.correctTyped / session.totalTyped) * 100) : 100;

    setBest((records) => {
      const previous = records[session.recordKey];
      if (previous && (previous.cpm > finalCpm || (previous.cpm === finalCpm && previous.accuracy >= finalAccuracy))) {
        return records;
      }

      return {
        ...records,
        [session.recordKey]: {
          cpm: finalCpm,
          accuracy: finalAccuracy,
          completed: session.completed,
        },
      };
    });
  }, [
    session.status,
    session.startedAt,
    session.endedAt,
    session.correctTyped,
    session.totalTyped,
    session.completed,
    session.recordKey,
    setBest,
  ]);

  useEffect(() => {
    if (
      session.status === "running" &&
      settings.limitSeconds > 0 &&
      session.startedAt &&
      now - session.startedAt >= settings.limitSeconds * 1000
    ) {
      finishSession();
    }
  }, [now, session.status, session.startedAt, settings.limitSeconds]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [settings.mode, session.status, session.completed]);

  useEffect(() => {
    return () => {
      if (clearResultRef.current) {
        window.clearTimeout(clearResultRef.current);
      }
    };
  }, []);

  function updateSettings(patch: Partial<Settings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  function beginIfNeeded() {
    setSession((current) => {
      if (current.status !== "idle") {
        return current;
      }
      return { ...current, status: "running", startedAt: Date.now(), endedAt: null };
    });
  }

  function resetSession() {
    setSession({ ...DEFAULT_SESSION, recordKey: makeRecordKey(settings), queue: createQueue(settings) });
    setTypedInput("");
    setLastResult(null);
    setPressedCode(null);
  }

  function finishSession() {
    setSession((current) => {
      if (current.status === "finished") {
        return current;
      }

      const endedAt = Date.now();
      return { ...current, status: "finished", endedAt };
    });
  }

  function flashResult(result: "correct" | "wrong") {
    setLastResult(result);
    if (clearResultRef.current) {
      window.clearTimeout(clearResultRef.current);
    }
    clearResultRef.current = window.setTimeout(() => setLastResult(null), 260);
  }

  function completeItem(extraCorrect = 0) {
    setSession((current) => {
      const nextCompleted = current.completed + 1;
      const nextSession = {
        ...current,
        completed: nextCompleted,
        correctTyped: current.correctTyped + extraCorrect,
      };

      if (nextCompleted >= settings.itemGoal) {
        const endedAt = Date.now();
        return { ...nextSession, status: "finished", endedAt };
      }

      return nextSession;
    });
  }

  function handleKeyPractice(event: React.KeyboardEvent<PracticeInput>) {
    if (settings.mode !== "keys" || session.status === "finished") {
      return;
    }

    if (IGNORED_CODES.has(event.code) || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    event.preventDefault();
    beginIfNeeded();
    setPressedCode(event.code);
    window.setTimeout(() => setPressedCode(null), 130);

    const expected = KEY_LOOKUP[currentTarget];
    const isCorrect = !!expected && expected.code === event.code && expected.shifted === event.shiftKey;

    setSession((current) => ({
      ...current,
      totalTyped: current.totalTyped + 1,
      mistakes: current.mistakes + (isCorrect ? 0 : 1),
    }));

    if (isCorrect) {
      flashResult("correct");
      completeItem(1);
      return;
    }

    flashResult("wrong");
  }

  function handleTextPractice(value: string) {
    if (settings.mode === "keys" || session.status === "finished") {
      return;
    }

    beginIfNeeded();
    const previous = typedInput;
    const normalized = settings.mode === "words" ? value.replace(/\s/g, "") : value;
    setTypedInput(normalized);

    if (normalized.length > previous.length) {
      const added = normalized.slice(previous.length);
      let correctAdded = 0;
      let wrongAdded = 0;

      for (let index = 0; index < added.length; index += 1) {
        const targetIndex = previous.length + index;
        if (currentTarget[targetIndex] === added[index]) {
          correctAdded += 1;
        } else {
          wrongAdded += 1;
        }
      }

      setSession((current) => ({
        ...current,
        totalTyped: current.totalTyped + added.length,
        correctTyped: current.correctTyped + correctAdded,
        mistakes: current.mistakes + wrongAdded,
      }));

      if (wrongAdded > 0 || !currentTarget.startsWith(normalized)) {
        flashResult("wrong");
      }
    }

    if (normalized === currentTarget) {
      flashResult("correct");
      setTypedInput("");
      completeItem();
    }
  }

  const targetKey = KEY_LOOKUP[currentTarget];
  const activeCode = settings.mode === "keys" ? targetKey?.code : undefined;
  const activeShifted = settings.mode === "keys" ? targetKey?.shifted : false;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">한글 타자연습</p>
          <h1>자리부터 짧은 글까지 차근차근</h1>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" onClick={resetSession} title="다시 시작" type="button">
            <ListRestart size={20} />
          </button>
          <button
            className="primary-button"
            onClick={() => {
              beginIfNeeded();
              inputRef.current?.focus();
            }}
            type="button"
          >
            <Play size={18} />
            시작
          </button>
        </div>
      </header>

      <section className="status-grid" aria-label="연습 상태">
        <Metric
          icon={<Gauge size={18} />}
          label="속도"
          value={`${cpm}`}
          suffix="타/분"
          help="1분 동안 정확하게 친 글자 수입니다."
        />
        <Metric
          icon={<Check size={18} />}
          label="정확도"
          value={`${accuracy}`}
          suffix="%"
          help="전체 입력 중 맞게 입력한 비율입니다."
        />
        <Metric
          icon={<Target size={18} />}
          label="진행"
          value={`${Math.min(session.completed, settings.itemGoal)}`}
          suffix={`/ ${settings.itemGoal}`}
          help="목표 횟수 중 지금까지 끝낸 개수입니다."
        />
        <Metric
          icon={<Timer size={18} />}
          label={remainingSeconds === null ? "시간" : "남은 시간"}
          value={remainingSeconds === null ? formatClock(Math.floor(elapsedMs / 1000)) : formatClock(remainingSeconds)}
          suffix=""
          help="제한 시간이 있으면 남은 시간을, 없으면 연습한 시간을 보여줍니다."
        />
      </section>

      <div className="main-layout">
        <section className="practice-panel">
          <div className="practice-header">
            <div>
              <p className="section-label">
                {PRACTICE_STAGES[settings.stageIndex].name}
                <span>
                  {itemCount}개 {itemUnit}
                </span>
              </p>
              <div className="allowed-keys" aria-label="현재 단계 키">
                {allowedKeys.map((key) => (
                  <span key={key}>{key}</span>
                ))}
              </div>
            </div>
            {bestForCurrent ? (
              <div className="best-record">
                최고 {bestForCurrent.cpm}타/분 · {bestForCurrent.accuracy}%
              </div>
            ) : null}
          </div>

          <div className={`target-area ${lastResult ? `is-${lastResult}` : ""}`} aria-live="polite">
            {session.status === "finished" ? (
              <div className="finish-state">
                <p>완료</p>
                <strong>{session.completed}개 연습</strong>
              </div>
            ) : settings.mode === "keys" ? (
              <div className="key-target">
                <span className="target-char">{currentTarget}</span>
                {activeShifted ? <span className="shift-badge">Shift</span> : null}
              </div>
            ) : (
              <PracticeTextTarget mode={settings.mode} target={currentTarget} input={typedInput} />
            )}
          </div>

          {settings.mode === "keys" ? (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              className="key-capture"
              value=""
              onChange={() => undefined}
              onKeyDown={handleKeyPractice}
              disabled={session.status === "finished"}
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              aria-label="자리연습 입력"
            />
          ) : settings.mode === "texts" ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              className="text-input"
              value={typedInput}
              onChange={(event) => handleTextPractice(event.target.value)}
              disabled={session.status === "finished"}
              rows={3}
              autoComplete="off"
              spellCheck={false}
              aria-label="짧은 글 연습 입력"
              placeholder="입력"
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              className="word-input"
              value={typedInput}
              onChange={(event) => handleTextPractice(event.target.value)}
              disabled={session.status === "finished"}
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              aria-label="낱말연습 입력"
              placeholder="입력"
            />
          )}

          <div className="progress-track" aria-label="진행률">
            <span style={{ width: `${Math.min(100, (session.completed / settings.itemGoal) * 100)}%` }} />
          </div>
        </section>

        <aside className="settings-panel" aria-label="설정">
          <div className="panel-title">
            <Settings2 size={18} />
            <h2>연습 설정</h2>
          </div>

          <div className="setting-block">
            <LabelWithHelp label="연습 종류" help="자리, 낱말, 짧은 글 중에서 오늘 연습할 방식을 고릅니다." />
            <div className="mode-grid">
              <ChoiceButton
                active={settings.mode === "keys"}
                icon={<Keyboard size={20} />}
                label="자리"
                help="화면에 나온 한 글자 키를 정확히 누르는 기초 연습입니다."
                onClick={() => updateSettings({ mode: "keys" })}
              />
              <ChoiceButton
                active={settings.mode === "words"}
                icon={<BookOpen size={20} />}
                label="낱말"
                help="현재 단계까지 배운 자판으로 만들 수 있는 단어를 입력합니다."
                onClick={() => updateSettings({ mode: "words" })}
              />
              <ChoiceButton
                active={settings.mode === "texts"}
                icon={<FileText size={20} />}
                label="짧은 글"
                help="짧은 문장을 보며 띄어쓰기까지 천천히 입력합니다."
                onClick={() => updateSettings({ mode: "texts" })}
              />
            </div>
          </div>

          <div className="setting-block">
            <LabelWithHelp label="진도 단계" help="아래 단계로 갈수록 사용할 수 있는 자판이 늘어납니다." />
            <StageSelector currentIndex={settings.stageIndex} onChange={(stageIndex) => updateSettings({ stageIndex })} />
          </div>

          {settings.mode === "keys" ? (
            <SegmentedControl
              label="자리 범위"
              help="누적은 이전 단계 키까지 섞어서, 현재는 선택한 단계 키만 연습합니다."
              value={settings.scope}
              options={[
                { value: "cumulative", label: "누적" },
                { value: "stage", label: "현재" },
              ]}
              onChange={(scope) => updateSettings({ scope })}
            />
          ) : null}

          <div className="number-grid">
            <Stepper
              label="제한 시간"
              help="0초로 두면 시간 제한 없이 연습합니다."
              valueText={settings.limitSeconds === 0 ? "없음" : `${settings.limitSeconds}초`}
              presets={[
                { label: "없음", value: 0 },
                { label: "30초", value: 30 },
                { label: "1분", value: 60 },
                { label: "2분", value: 120 },
              ]}
              onDecrease={() => updateSettings({ limitSeconds: clamp(settings.limitSeconds - 10, 0, 600) })}
              onIncrease={() => updateSettings({ limitSeconds: clamp(settings.limitSeconds + 10, 0, 600) })}
              onPreset={(limitSeconds) => updateSettings({ limitSeconds })}
            />
            <Stepper
              label="목표 횟수"
              help="이 개수만큼 끝내면 연습이 자동으로 마무리됩니다."
              valueText={`${settings.itemGoal}개`}
              presets={[
                { label: "5개", value: 5 },
                { label: "10개", value: 10 },
                { label: "30개", value: 30 },
                { label: "50개", value: 50 },
              ]}
              onDecrease={() => updateSettings({ itemGoal: clamp(settings.itemGoal - 5, 5, 200) })}
              onIncrease={() => updateSettings({ itemGoal: clamp(settings.itemGoal + 5, 5, 200) })}
              onPreset={(itemGoal) => updateSettings({ itemGoal })}
            />
          </div>

          <div className="toggle-list">
            <ToggleButton
              checked={settings.showKeyboard}
              icon={settings.showKeyboard ? <Keyboard size={18} /> : <EyeOff size={18} />}
              label="키보드"
              help="화면 아래의 두벌식 키보드 그림을 보이거나 숨깁니다."
              onChange={() => updateSettings({ showKeyboard: !settings.showKeyboard })}
            />
            <ToggleButton
              checked={settings.showFingers}
              icon={settings.showFingers ? <Hand size={18} /> : <Eye size={18} />}
              label="운지법"
              help="각 키를 어느 손가락으로 누르면 좋은지 색으로 겹쳐 보여줍니다."
              onChange={() => updateSettings({ showFingers: !settings.showFingers })}
            />
          </div>
        </aside>
      </div>

      {settings.showKeyboard ? (
        <KeyboardView
          activeCode={activeCode}
          activeShifted={activeShifted}
          pressedCode={pressedCode}
          selectedStageIndex={settings.stageIndex}
          showFingers={settings.showFingers}
        />
      ) : null}
    </main>
  );
}

function Metric({
  icon,
  label,
  value,
  suffix,
  help,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix: string;
  help: string;
}) {
  return (
    <div className="metric">
      <div className="metric-icon">{icon}</div>
      <div>
        <LabelWithHelp label={label} help={help} compact />
        <strong>
          {value}
          {suffix ? <small>{suffix}</small> : null}
        </strong>
      </div>
    </div>
  );
}

function PracticeTextTarget({
  mode,
  target,
  input,
}: {
  mode: Exclude<PracticeMode, "keys">;
  target: string;
  input: string;
}) {
  return (
    <div className={mode === "texts" ? "text-target" : "word-target"} aria-label="연습 문구">
      {[...target].map((char, index) => {
        const typed = input[index];
        const state = typed === undefined ? "pending" : typed === char ? "match" : "miss";
        const isSpace = char === " ";

        return (
          <span className={`${state} ${isSpace ? "space-char" : ""}`} key={`${char}-${index}`}>
            {isSpace ? " " : char}
          </span>
        );
      })}
    </div>
  );
}

function KeyboardView({
  activeCode,
  activeShifted,
  pressedCode,
  selectedStageIndex,
  showFingers,
}: {
  activeCode?: string;
  activeShifted: boolean;
  pressedCode: string | null;
  selectedStageIndex: number;
  showFingers: boolean;
}) {
  return (
    <section className="keyboard-panel" aria-label="두벌식 키보드">
      <div className="keyboard-panel-header">
        <div>
          <strong>선택한 단계의 자판 범위</strong>
          <span>색이 진한 키를 중심으로 연습합니다.</span>
        </div>
        <KeyboardLegend />
      </div>
      {KEYBOARD_ROWS.map((row, rowIndex) => (
        <div className={`keyboard-row row-${rowIndex}`} key={rowIndex}>
          {row.map((key) => {
            const isActive = activeCode === key.code;
            const isPressed = pressedCode === key.code;
            const stageStatus = getKeyStageStatus(key, selectedStageIndex);

            return (
              <div
                className={[
                  "keyboard-key",
                  `finger-${key.finger}`,
                  `stage-${stageStatus}`,
                  isActive ? "is-active" : "",
                  isPressed ? "is-pressed" : "",
                  showFingers ? "show-finger" : "",
                ].join(" ")}
                key={key.code}
              >
                <span className="latin">{key.keyLabel}</span>
                {key.shifted ? <span className="shifted">{key.shifted}</span> : null}
                <strong>{activeShifted && isActive && key.shifted ? key.shifted : key.hangul}</strong>
                {showFingers ? <em title={FINGER_LABELS[key.finger]}>{FINGER_SHORT_LABELS[key.finger]}</em> : null}
              </div>
            );
          })}
        </div>
      ))}
      {showFingers ? <FingerLegend /> : null}
    </section>
  );
}

function KeyboardLegend() {
  return (
    <div className="keyboard-legend" aria-label="자판 색상 설명">
      <span className="legend-current">이번 단계</span>
      <span className="legend-learned">이미 배움</span>
      <span className="legend-locked">나중 단계</span>
    </div>
  );
}

function FingerLegend() {
  const fingers = Object.keys(FINGER_LABELS) as FingerId[];

  return (
    <div className="finger-legend">
      {fingers.map((finger) => (
        <span className={`finger-dot finger-${finger}`} key={finger}>
          {FINGER_LABELS[finger]}
        </span>
      ))}
    </div>
  );
}

function LabelWithHelp({
  label,
  help,
  compact = false,
}: {
  label: string;
  help: string;
  compact?: boolean;
}) {
  return (
    <span className={compact ? "label-with-help is-compact" : "label-with-help"}>
      <span>{label}</span>
      <HelpTip text={help} />
    </span>
  );
}

function HelpTip({ text }: { text: string }) {
  return (
    <span className="help-tip" tabIndex={0} aria-label={text}>
      <CircleHelp size={15} />
      <span className="tooltip" role="tooltip">
        {text}
      </span>
    </span>
  );
}

function ChoiceButton({
  active,
  icon,
  label,
  help,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  help: string;
  onClick: () => void;
}) {
  return (
    <div className={`choice-shell ${active ? "is-selected" : ""}`}>
      <button className="choice-button" onClick={onClick} type="button" aria-pressed={active}>
        {icon}
        <strong>{label}</strong>
      </button>
      <HelpTip text={help} />
    </div>
  );
}

function StageSelector({
  currentIndex,
  onChange,
}: {
  currentIndex: number;
  onChange: (stageIndex: number) => void;
}) {
  return (
    <div className="stage-list">
      <div className="stage-map-legend" aria-label="단계 지도 색상 설명">
        <span className="legend-current">새로 배우는 자리</span>
        <span className="legend-learned">앞 단계 자리</span>
      </div>
      {PRACTICE_STAGES.map((stage, index) => (
        <StageButton
          active={currentIndex === index}
          key={stage.id}
          stageIndex={index}
          stage={stage}
          onClick={() => onChange(index)}
        />
      ))}
    </div>
  );
}

function StageButton({
  active,
  stageIndex,
  stage,
  onClick,
}: {
  active: boolean;
  stageIndex: number;
  stage: PracticeStage;
  onClick: () => void;
}) {
  return (
    <button className={`stage-button ${active ? "is-selected" : ""}`} onClick={onClick} type="button" aria-pressed={active}>
      <span className="stage-title-row">
        <strong>{stage.name}</strong>
        <em>{stage.keys.join(" ")}</em>
      </span>
      <MiniKeyboardMap stageIndex={stageIndex} />
    </button>
  );
}

function MiniKeyboardMap({ stageIndex }: { stageIndex: number }) {
  return (
    <span className="mini-keyboard-map" aria-hidden="true">
      {KEYBOARD_ROWS.map((row, rowIndex) => (
        <span className={`mini-row mini-row-${rowIndex}`} key={rowIndex}>
          {row.map((key) => (
            <span className={`mini-key stage-${getKeyStageStatus(key, stageIndex)}`} key={key.code}>
              {getMiniKeyLabel(key, stageIndex)}
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

function SegmentedControl<T extends string>({
  label,
  help,
  options,
  value,
  onChange,
}: {
  label: string;
  help: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented-field">
      <LabelWithHelp label={label} help={help} />
      <div className="segmented-control">
        {options.map((option) => (
          <button
            className={value === option.value ? "is-selected" : ""}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Stepper({
  label,
  help,
  valueText,
  presets,
  onDecrease,
  onIncrease,
  onPreset,
}: {
  label: string;
  help: string;
  valueText: string;
  presets: Array<{ label: string; value: number }>;
  onDecrease: () => void;
  onIncrease: () => void;
  onPreset: (value: number) => void;
}) {
  return (
    <div className="stepper-field">
      <LabelWithHelp label={label} help={help} />
      <div className="stepper-control">
        <button onClick={onDecrease} type="button" aria-label={`${label} 줄이기`}>
          <Minus size={18} />
        </button>
        <strong>{valueText}</strong>
        <button onClick={onIncrease} type="button" aria-label={`${label} 늘리기`}>
          <Plus size={18} />
        </button>
      </div>
      <div className="preset-list">
        {presets.map((preset) => (
          <button key={`${label}-${preset.value}`} onClick={() => onPreset(preset.value)} type="button">
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleButton({
  checked,
  icon,
  label,
  help,
  onChange,
}: {
  checked: boolean;
  icon: React.ReactNode;
  label: string;
  help: string;
  onChange: () => void;
}) {
  return (
    <div className={`toggle-shell ${checked ? "is-on" : ""}`}>
      <button className="toggle-button" onClick={onChange} type="button" aria-pressed={checked}>
        {icon}
        <span>{label}</span>
      </button>
      <HelpTip text={help} />
    </div>
  );
}

function createQueue(settings: Settings) {
  const source =
    settings.mode === "keys"
      ? settings.scope === "stage"
        ? PRACTICE_STAGES[settings.stageIndex].keys
        : getCumulativeKeys(settings.stageIndex)
      : settings.mode === "words"
        ? getWordsForStage(settings.stageIndex)
        : getTextsForStage(settings.stageIndex);
  const fallback =
    settings.mode === "keys"
      ? getCumulativeKeys(settings.stageIndex)
      : settings.mode === "words"
        ? ["엄마"]
        : ["엄마 이마"];
  const pool = source.length > 0 ? source : fallback;
  const queue: string[] = [];

  while (queue.length < settings.itemGoal) {
    const nextBatch = shuffle(pool);
    if (queue.length > 0 && nextBatch.length > 1 && queue[queue.length - 1] === nextBatch[0]) {
      [nextBatch[0], nextBatch[1]] = [nextBatch[1], nextBatch[0]];
    }
    queue.push(...nextBatch);
  }

  return queue.slice(0, settings.itemGoal);
}

function makeRecordKey(settings: Settings) {
  return `${settings.mode}-${settings.stageIndex}`;
}

function getVisibleItemCount(mode: PracticeMode, keys: number, words: number, texts: number) {
  if (mode === "keys") {
    return keys;
  }

  if (mode === "words") {
    return words;
  }

  return texts;
}

function getItemUnit(mode: PracticeMode) {
  if (mode === "keys") {
    return "키";
  }

  return MODE_LABELS[mode];
}

function getKeyStageStatus(key: KeySpec, selectedStageIndex: number) {
  const stages = [getJamoStageIndex(key.hangul), key.shifted ? getJamoStageIndex(key.shifted) : -1].filter(
    (index) => index >= 0,
  );

  if (stages.includes(selectedStageIndex)) {
    return "current";
  }

  if (stages.some((index) => index < selectedStageIndex)) {
    return "learned";
  }

  return "locked";
}

function getMiniKeyLabel(key: KeySpec, selectedStageIndex: number) {
  if (key.shifted && getJamoStageIndex(key.shifted) === selectedStageIndex) {
    return key.shifted;
  }

  return key.hangul;
}

function getJamoStageIndex(jamo: string) {
  return PRACTICE_STAGES.findIndex((stage) => stage.keys.includes(jamo));
}

function shuffle<T>(items: T[]) {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

function useStoredState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored ? { ...fallback, ...JSON.parse(stored) } : fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}

function getElapsedMs(session: Session, now: number) {
  if (!session.startedAt) {
    return 0;
  }

  return (session.endedAt ?? now) - session.startedAt;
}

function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export default App;
