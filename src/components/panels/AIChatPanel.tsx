// AI Chat Panel — Groq / Gemini / Lemonade agent chat

import { useState, useCallback, useRef, useEffect } from 'react';
import { apiKeyManager } from '../../services/apiKeyManager';
import { runAgentLoop, runGroqAgentLoop, runLemonadeAgentLoop } from '../../services/agentLoop';
import { checkLemonadeHealth, DEFAULT_LEMONADE_ENDPOINT, DEFAULT_LEMONADE_MODEL } from '../../services/lemonadeProvider';
import './AIChatPanel.css';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'progress' | 'error';
  content: string;
  timestamp: Date;
}

type Provider = 'groq' | 'gemini' | 'lemonade';

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function AIChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [geminiKey, setGeminiKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [provider, setProvider] = useState<Provider>('groq');
  const [lemonadeOk, setLemonadeOk] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const progressIdRef = useRef<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiKeyManager.getKeyByType('gemini'),
      apiKeyManager.getKeyByType('groq'),
      checkLemonadeHealth(DEFAULT_LEMONADE_ENDPOINT),
    ]).then(([gKey, grKey, health]) => {
      if (gKey) setGeminiKey(gKey);
      if (grKey) setGroqKey(grKey);
      setLemonadeOk(health.available);
      // Default: groq if key exists, else lemonade if available, else gemini
      if (grKey) setProvider('groq');
      else if (health.available) setProvider('lemonade');
      else setProvider('gemini');
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

    if (provider === 'groq' && !groqKey) {
      appendMessage({ role: 'error', content: 'Groq API anahtarı giriniz (Settings → API Keys).' });
      return;
    }
    if (provider === 'gemini' && !geminiKey) {
      appendMessage({ role: 'error', content: 'Gemini API anahtarı giriniz (Settings → API Keys).' });
      return;
    }
    if (provider === 'lemonade' && !lemonadeOk) {
      appendMessage({ role: 'error', content: 'Lemonade çalışmıyor. Lütfen başlatın veya başka provider seçin.' });
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

    const onProgress = (msg: string) => {
      if (progressIdRef.current) updateMessage(progressIdRef.current, msg);
    };

    let result;
    if (provider === 'groq') {
      result = await runGroqAgentLoop(text, groqKey, onProgress);
    } else if (provider === 'gemini') {
      result = await runAgentLoop(text, geminiKey, onProgress);
    } else {
      result = await runLemonadeAgentLoop(text, onProgress, DEFAULT_LEMONADE_ENDPOINT, DEFAULT_LEMONADE_MODEL);
    }

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
  }, [input, isRunning, provider, groqKey, geminiKey, lemonadeOk, appendMessage, updateMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  if (!loaded) return null;

  const activeKey = provider === 'groq' ? groqKey : provider === 'gemini' ? geminiKey : null;

  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-api-key-row">
        <button
          className={`ai-chat-provider-btn${provider === 'groq' ? ' ai-chat-provider-btn--active' : ''}`}
          onClick={() => setProvider('groq')}
          title="Groq (ücretsiz, hızlı)"
        >
          ⚡ Groq {groqKey ? '' : '(key yok)'}
        </button>
        <button
          className={`ai-chat-provider-btn${provider === 'gemini' ? ' ai-chat-provider-btn--active' : ''}`}
          onClick={() => setProvider('gemini')}
          title="Google Gemini"
        >
          ✨ Gemini {geminiKey ? '' : '(key yok)'}
        </button>
        <button
          className={`ai-chat-provider-btn${provider === 'lemonade' ? ' ai-chat-provider-btn--active' : ''}`}
          onClick={() => setProvider('lemonade')}
          title="Lemonade (yerel)"
        >
          🍋 Lemonade {lemonadeOk ? '(hazır)' : '(kapalı)'}
        </button>
        {activeKey === null || (provider !== 'lemonade' && !activeKey) ? (
          <input
            type="password"
            className="ai-chat-api-key-input"
            placeholder={provider === 'groq' ? 'gsk_... (console.groq.com)' : 'Gemini API anahtarı...'}
            value={provider === 'groq' ? groqKey : geminiKey}
            onChange={(e) => {
              if (provider === 'groq') {
                setGroqKey(e.target.value);
                apiKeyManager.storeKeyByType('groq', e.target.value);
              } else {
                setGeminiKey(e.target.value);
                apiKeyManager.storeKeyByType('gemini', e.target.value);
              }
            }}
          />
        ) : null}
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
