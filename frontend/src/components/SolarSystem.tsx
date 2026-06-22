import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import {
  checkHealth,
  sendTextChat,
  sendVoiceChat,
  type Message,
} from "../api";

const QUICK_PROMPTS = [
  "What is the Monthly Plan?",
  "Tell me about Rudrabhishekam",
  "Ganapathi Homam price and benefits",
  "Quarterly plan details",
  "Gruhapravesam ceremony info",
];

function NeuralCore({
  volume,
  speaking,
  listening,
}: {
  volume: number;
  speaking: boolean;
  listening: boolean;
}) {
  const pointsRef = useRef<THREE.Points>(null);

  const particles = useMemo(() => {
    const count = 800;
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const radius = 1.5 + Math.random() * 2.2;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
    }

    return positions;
  }, []);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(particles, 3));
    return geo;
  }, [particles]);

  useFrame(({ clock }) => {
    if (!pointsRef.current) return;

    const speed = speaking ? 0.14 : listening ? 0.1 : 0.04;
    pointsRef.current.rotation.y = clock.elapsedTime * speed;
    pointsRef.current.rotation.x =
      Math.sin(clock.elapsedTime * 0.3) * 0.08;

    const pulse = speaking
      ? 1.55
      : listening
        ? 1.25 + Math.min(volume / 100, 0.55)
        : 1 + Math.min(volume / 200, 0.3);

    pointsRef.current.scale.set(pulse, pulse, pulse);
  });

  const glow = speaking ? "#ffffff" : listening ? "#e8ff4a" : "#ccff00";

  return (
    <>
      <points ref={pointsRef} geometry={geometry}>
        <pointsMaterial
          size={0.045}
          color={glow}
          transparent
          opacity={0.95}
          sizeAttenuation
        />
      </points>
      <mesh>
        <sphereGeometry args={[0.18, 24, 24]} />
        <meshBasicMaterial color="#e8ff4a" />
      </mesh>
    </>
  );
}

function playAudio(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error("Audio playback failed"));
    audio.play().catch(reject);
  });
}

function getRecorderMimeType(): string {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

function RadarWidget() {
  return (
    <div className="hud-radar">
      <div className="hud-radar-sweep" />
      <div className="hud-radar-grid" />
      <div className="hud-radar-center" />
    </div>
  );
}

function SpectrumWidget({ active }: { active: boolean }) {
  return (
    <div className="hud-spectrum">
      {Array.from({ length: 24 }).map((_, i) => (
        <span
          key={i}
          className={`hud-spectrum-bar ${active ? "hud-spectrum-bar--live" : ""}`}
          style={{ animationDelay: `${i * 0.05}s` }}
        />
      ))}
    </div>
  );
}

function HexWidget() {
  return (
    <svg className="hud-hex" viewBox="0 0 120 120" aria-hidden="true">
      <polygon
        points="60,8 108,34 108,86 60,112 12,86 12,34"
        fill="none"
        stroke="rgba(204,255,0,0.35)"
        strokeWidth="1"
      />
      <polygon
        points="60,22 94,42 94,78 60,98 26,78 26,42"
        fill="none"
        stroke="rgba(255,255,255,0.2)"
        strokeWidth="0.8"
      />
      <line x1="60" y1="8" x2="60" y2="112" stroke="rgba(255,255,255,0.15)" />
      <line x1="12" y1="34" x2="108" y2="86" stroke="rgba(255,255,255,0.12)" />
      <line x1="108" y1="34" x2="12" y2="86" stroke="rgba(255,255,255,0.12)" />
      <circle cx="60" cy="60" r="4" fill="#ccff00" />
    </svg>
  );
}

export default function SolarSystem() {
  const [volume, setVolume] = useState(0);
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState("Ready");
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [showInput, setShowInput] = useState(true);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef("audio/webm");
  const inputRef = useRef<HTMLInputElement>(null);
  const spaceHeldRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);

  const lastAssistant = messages.filter((m) => m.role === "assistant").at(-1);
  const activeVisualizer = speaking || listening || loading;

  useEffect(() => {
    checkHealth().then(setConnected);
    const interval = setInterval(() => {
      checkHealth().then(setConnected);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let audioContext: AudioContext | null = null;
    let rafId = 0;

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        streamRef.current = stream;
        audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);

        const detect = () => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          setVolume(sum / data.length);
          rafId = requestAnimationFrame(detect);
        };

        detect();
      })
      .catch(() => {
        setError("Microphone access needed for voice mode. Text chat still works.");
      });

    return () => {
      cancelAnimationFrame(rafId);
      audioContext?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const processResponse = useCallback(
    async (userText: string, reply: string, audioUrl: string) => {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: userText },
        { role: "assistant", content: reply },
      ]);
      setStatus("Speaking...");
      setSpeaking(true);
      try {
        await playAudio(audioUrl);
      } catch {
        setError("Reply received but audio could not play. Read the text panel.");
      } finally {
        setSpeaking(false);
        setStatus("Ready");
      }
    },
    []
  );

  const handleTextSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setError("");
    setLoading(true);
    setStatus("Processing...");
    const sent = trimmed;
    setText("");

    try {
      const res = await sendTextChat(sent, messages);
      await processResponse(sent, res.reply, res.audio_url);
    } catch (err) {
      console.error(err);
      setText(sent);
      setError(
        connected
          ? "Request failed. Try again."
          : "Backend offline. Start server: uvicorn app:app --reload --port 8000"
      );
      setStatus("Ready");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [text, loading, messages, processResponse, connected]);

  const sendRecordedAudio = useCallback(
    async (blob: Blob) => {
      setError("");
      setLoading(true);
      setStatus("Understanding...");

      const ext = mimeTypeRef.current.includes("ogg") ? "ogg" : "webm";

      try {
        const res = await sendVoiceChat(blob, messages, `voice.${ext}`);
        await processResponse(res.text, res.reply, res.audio_url);
      } catch (err) {
        console.error(err);
        setError(
          connected
            ? "Voice request failed. Speak clearly and try again."
            : "Backend offline. Start the Python server first."
        );
        setStatus("Ready");
      } finally {
        setLoading(false);
      }
    },
    [messages, processResponse, connected]
  );

  const startRecording = useCallback(async () => {
    if (loading || listening) return;

    try {
      const stream =
        streamRef.current ||
        await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = getRecorderMimeType();
      mimeTypeRef.current = mimeType || "audio/webm";

      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );

      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        setListening(false);

        const blob = new Blob(chunksRef.current, {
          type: mimeTypeRef.current,
        });

        if (blob.size > 500) {
          await sendRecordedAudio(blob);
        } else {
          setStatus("Ready");
          setError("Too short. Hold Space or mic button while speaking.");
        }
      };

      recorder.start(200);
      setListening(true);
      setStatus("Listening...");
      setError("");
    } catch (err) {
      console.error(err);
      setError("Could not access microphone.");
    }
  }, [loading, listening, sendRecordedAudio]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      e.preventDefault();
      if (!spaceHeldRef.current) {
        spaceHeldRef.current = true;
        startRecording();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      e.preventDefault();
      spaceHeldRef.current = false;
      stopRecording();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [startRecording, stopRecording]);

  const focusSearch = () => {
    setShowInput(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const clearSession = () => {
    setMessages([]);
    setError("");
    setStatus("Ready");
    setText("");
    focusSearch();
  };

  return (
    <div className="hud-shell">
      <div className="hud-scene">
        <Canvas camera={{ position: [0, 0, 7], fov: 55 }} dpr={[1, 2]}>
          <color attach="background" args={["#000000"]} />
          <ambientLight intensity={0.35} />
          <pointLight position={[0, 0, 0]} intensity={18} color="#ccff00" />
          <Stars
            radius={120}
            depth={80}
            count={6000}
            factor={4}
            saturation={0}
            fade
            speed={0.6}
          />
          <NeuralCore
            volume={volume}
            speaking={speaking}
            listening={listening}
          />
          <EffectComposer>
            <Bloom
              intensity={1.8}
              luminanceThreshold={0}
              luminanceSmoothing={0.85}
            />
          </EffectComposer>
        </Canvas>
        <div className="hud-ring hud-ring--outer" />
        <div className="hud-ring hud-ring--inner" />
        <div className="hud-ring hud-ring--ticks" />
      </div>

      <div className="hud-overlay">
        <div className="hud-corner hud-top-left">
          <div className="hud-signal">
            <span className={`hud-dot ${connected ? "hud-dot--on" : ""}`} />
            <span className="hud-label">
              {connected ? "ONLINE" : "OFFLINE"}
            </span>
          </div>
          <div className="hud-bars">
            <span style={{ width: "72%" }} />
            <span style={{ width: "48%" }} />
            <span style={{ width: "88%" }} />
          </div>
        </div>

        <div className="hud-corner hud-mid-left">
          <p className="hud-widget-title">Quick prompts</p>
          <ul className="hud-prompt-list">
            {QUICK_PROMPTS.map((prompt) => (
              <li key={prompt}>
                <button
                  type="button"
                  className="hud-prompt-btn"
                  disabled={loading}
                  onClick={() => {
                    setText(prompt);
                    focusSearch();
                  }}
                >
                  <span className="hud-prompt-icon" />
                  {prompt}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="hud-corner hud-bottom-left">
          <HexWidget />
        </div>

        <div className="hud-corner hud-top-right">
          <RadarWidget />
        </div>

        <div className="hud-corner hud-mid-right">
          <p className="hud-widget-title">Venixa response</p>
          <div className="hud-info-panel">
            {loading && <p className="hud-info-line">Processing your request...</p>}
            {!loading && lastAssistant && (
              <p className="hud-info-line">{lastAssistant.content}</p>
            )}
            {!loading && !lastAssistant && (
              <p className="hud-info-line hud-muted">
                Spiritual services assistant. Ask about poojas, homams, and
                subscription plans in English, Telugu, Hindi, Tamil, or Kannada.
              </p>
            )}
            {error && <p className="hud-error-line">{error}</p>}
          </div>
        </div>

        <div className="hud-corner hud-bottom-right">
          <SpectrumWidget active={activeVisualizer} />
        </div>

        <div className="hud-bottom-center">
          <div className="hud-command-bar">
            <button
              type="button"
              className="hud-cmd-btn"
              onClick={clearSession}
              disabled={loading}
            >
              + New task
            </button>
            <button
              type="button"
              className="hud-cmd-btn hud-cmd-btn--active"
              onClick={focusSearch}
            >
              Search
            </button>
            <button
              type="button"
              className="hud-cmd-btn"
              disabled={loading}
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              onMouseLeave={stopRecording}
              onTouchStart={(e) => {
                e.preventDefault();
                startRecording();
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                stopRecording();
              }}
            >
              Voice
            </button>
          </div>

          {showInput && (
            <form
              className="hud-search-row"
              onSubmit={(e) => {
                e.preventDefault();
                handleTextSubmit();
              }}
            >
              <input
                ref={inputRef}
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type your question and press Enter..."
                disabled={loading}
                className="hud-search-input"
                autoComplete="off"
              />
              <button
                type="submit"
                className="hud-search-send"
                disabled={loading || !text.trim()}
              >
                Send
              </button>
            </form>
          )}

          <div className="hud-status-row">
            <span className="hud-status-item">
              {listening ? "● Recording" : speaking ? "● Speaking" : `● ${status}`}
            </span>
          </div>

          <p className="hud-start-label">
            {listening ? "RELEASE SPACE TO SEND" : "PRESS SPACE TO START"}
          </p>
        </div>
      </div>
    </div>
  );
}
