import axios from "axios";

const baseURL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? "/api" : "http://localhost:8000");

export const api = axios.create({
  baseURL,
  timeout: 120000,
});

export type Message = {
  role: "user" | "assistant";
  content: string;
};

export type ChatResponse = {
  success: boolean;
  language: string;
  reply: string;
  audio_url: string;
};

export type VoiceResponse = ChatResponse & {
  text: string;
};

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await api.get("/health", { timeout: 5000 });
    return res.data?.ok === true;
  } catch {
    return false;
  }
}

export async function sendTextChat(
  text: string,
  history: Message[]
): Promise<ChatResponse> {
  const res = await api.post<ChatResponse>("/chat", { text, history });
  return {
    ...res.data,
    audio_url: `${baseURL}${res.data.audio_url}`,
  };
}

export async function sendVoiceChat(
  audioBlob: Blob,
  history: Message[],
  filename = "voice.webm"
): Promise<VoiceResponse> {
  const formData = new FormData();
  formData.append("file", audioBlob, filename);
  formData.append("history", JSON.stringify(history));

  const res = await api.post<VoiceResponse>("/voice", formData);
  return {
    ...res.data,
    audio_url: `${baseURL}${res.data.audio_url}`,
  };
}