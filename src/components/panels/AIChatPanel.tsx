// AI Chat Panel — Gemini-powered agentic video editor

import { useState, useCallback, useRef, useEffect } from 'react';
import { apiKeyManager } from '../../services/apiKeyManager';
import { runAgentLoop } from '../../services/agentLoop';
import './AIChatPanel.css';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'progress' | 'error';
  content: string;
  timestamp: Date;
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function AIChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const progressIdRef = useRef<string | null>(null);

  useEffect(() => {
    apiKeyManager.getKeyByType('gemini').then((key) => {
      if (key) setApiKey(key);
      setApiKeyLoaded(true);
    });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSaveApiKey = useCallback(async (key: string) => {
    await apiKeyManager.storeKeyByType('gemini', key);
  }, []);

  const appendMessage = useCallback((msg: Omit<Message, 'id' | 'timestamp'>) => {
    const full: Message = { ...msg, id: generateId(), timestamp: new Date() };
    setMessages((prev) => [...prev, full]);
    return full.id;
  }, []);

  const updateMessage = useCallback((id: string, content: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content } : m))
    );
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isRunning) return;
    if (!apiKey) {
      appendMessage({ role: 'error', content: 'Gemini API anahtarı giriniz.' });
      return;
    }

    setInput('');
    appendMessage({ role: 'user', content: text });
    setIsRunning(true);

    const progressId = generateId();
    progressIdRef.current = progressId;
    setMessages((prev) => [
      ...prev,
      { id: progressId, role: 'progress', content: '⏳ Çalışıyor...', timestamp: new Date() },
    ]);

    const result = await runAgentLoop(text, apiKey, (progressMsg) => {
      if (progressIdRef.current) {
        updateMessage(progressIdRef.current, progressMsg);
      }
    });

    // Remove progress message
    setMessages((prev) => prev.filter((m) => m.id !== progressIdRef.current));
    progressIdRef.current = null;
    setIsRunning(false);

    if (result.error) {
      appendMessage({ role: 'error', content: result.error });
    } else {
      appendMessage({
        role: 'assistant',
        content: result.text || `✅ Tamamlandı — ${result.stepsUsed} adım uygulandı.`,
      });
    }
  }, [input, isRunning, apiKey, appendMessage, updateMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  if (!apiKeyLoaded) return null;

  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-api-key-row">
        <input
          type="password"
          className="ai-chat-api-key-input"
          placeholder="Gemini API anahtarı (Google AI Studio)"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            handleSaveApiKey(e.target.value);
          }}
        />
      </div>

      <div className="ai-chat-messages">
        {messages.length === 0 && (
          <div className="ai-chat-empty">
            <p>Bir komut yazın. Örneğin:</p>
            <ul>
              <li>"Bu klipten 60 saniyelik bir video yap"</li>
              <li>"2. dakikadaki sahneyi sil"</li>
              <li>"Tüm kesmelere crossfade ekle"</li>
              <li>"Medya kütüphanesindeki kliplerden bir tanıtım videosu oluştur"</li>
            </ul>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`ai-chat-message ai-chat-message--${msg.role}`}>
            <span className="ai-chat-message-content">{msg.content}</span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="ai-chat-input-row">
        <textarea
          className="ai-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Komut yazın..."
          disabled={isRunning}
          rows={2}
        />
        <button
          className="ai-chat-send-btn"
          onClick={handleSend}
          disabled={isRunning || !input.trim()}
        >
          {isRunning ? '⏳' : '→'}
        </button>
      </div>
    </div>
  );
}
