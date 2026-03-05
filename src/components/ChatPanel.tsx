import { useState, useRef, useEffect, ChangeEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Send, MicOff, Plus, FileText, Loader2 } from "lucide-react";
import ChatMessage, { ChatMessageData } from "./ChatMessage";
import AIorb from "./AIorb";
import type { OrbState } from "./AIorb";
import { io, Socket } from "socket.io-client";
import { toast } from "sonner";
import { API_BASE, SOCKET_URL } from "@/lib/config";

const ChatPanel = () => {
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [input, setInput] = useState("");
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [currentAiResponse, setCurrentAiResponse] = useState("");

  const fetchTodayHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/memory`);
      const data = await res.json();
      if (data.history && data.history.length > 0) {
        setMessages(data.history.map((m: any, i: number) => ({
          id: `hist_${i}_${m.timestamp}`,
          // Fix: Map "assistant" from DB to "ai" for the UI
          role: m.role === "assistant" ? "ai" : "user",
          content: m.content,
          timestamp: new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        })));
      }
    } catch (err) {
      console.error("Failed to fetch today's history:", err);
    }
  };

  useEffect(() => {
    // 1. Initial Fetch
    fetchTodayHistory();

    // 2. Listen for refresh signals from Sidebar
    const handleRefresh = () => fetchTodayHistory();
    const handleArchiveLoad = (e: any) => {
      const { date, history } = e.detail;
      setMessages(history.map((m: any, i: number) => ({
        id: `arch_${i}_${m.timestamp}`,
        // Fix: Map "assistant" from DB to "ai" for the UI
        role: m.role === "assistant" ? "ai" : "user",
        content: m.content,
        timestamp: new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      })));
      toast.info(`Viewing archive for ${date}`);
    };

    window.addEventListener("refreshChat", handleRefresh);
    window.addEventListener("loadArchive", handleArchiveLoad);

    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    newSocket.on("chat_stream", (data) => {
      setOrbState("speaking");
      setCurrentAiResponse((prev) => prev + data.chunk);
    });

    newSocket.on("chat_stream_end", (data) => {
      setOrbState("idle");
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "ai",
          content: data.fullText,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        }
      ]);
      setCurrentAiResponse("");
    });

    newSocket.on("chat_error", (data) => {
      setOrbState("idle");
      setCurrentAiResponse("");
      toast.error(data.error);
    });

    newSocket.on("reminder_saved", (data) => {
      toast.success(`Reminder set: "${data.event}" for ${new Date(data.time).toLocaleString()}`, {
        icon: "🔔",
      });
    });

    newSocket.on("proactive_message", (data) => {
      setMessages((prev) => {
        // Prevent duplicate initial greetings if they already exist in history
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.content === data.content) return prev;

        return [
          ...prev,
          {
            id: `proactive_${Date.now()}`,
            role: "ai",
            content: data.content,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          }
        ];
      });
      toast("J sent you a message 💖", {
        description: data.content,
      });
    });

    newSocket.on("load_archive", (data) => {
      if (data.history) {
        setMessages(data.history.map((m: any, i: number) => ({
          id: `arch_${i}_${m.timestamp}`,
          // Fix: Map "assistant" from DB to "ai" for the UI
          role: m.role === "assistant" ? "ai" : "user",
          content: m.content,
          timestamp: new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        })));
        toast.info(`Viewing archive for ${data.date}`);
      }
    });

    return () => {
      newSocket.close();
      window.removeEventListener("refreshChat", handleRefresh);
      window.removeEventListener("loadArchive", handleArchiveLoad);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, currentAiResponse]);

  const handleSend = () => {
    if (!input.trim() || !socket) return;
    const userMsg: ChatMessageData = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setOrbState("thinking");
    setCurrentAiResponse("");

    socket.emit("chat_message", { message: userMsg.content });
  };

  const toggleRecording = () => {
    setIsRecording(!isRecording);
    setOrbState(isRecording ? "idle" : "listening");
  };

  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      toast.error("Please upload a PDF file.");
      return;
    }

    setIsUploading(true);
    setOrbState("thinking");

    const formData = new FormData();
    formData.append("document", file);

    try {
      const response = await fetch(`${API_BASE}/api/upload-pdf`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        toast.success(`Parsed ${file.name} successfully!`);

        const aiMsg: ChatMessageData = {
          id: Date.now().toString(),
          role: "ai",
          content: `I've analyzed your document: **${file.name}**. I've extracted the key dates and information. You can ask me anything about it now! \n\n**Summary:** ${data.result.summary}`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => [...prev, aiMsg]);
      } else {
        toast.error("Failed to process document.");
      }
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Error connecting to server.");
    } finally {
      setIsUploading(false);
      setOrbState("idle");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 flex justify-center py-8 md:py-12">
        <AIorb state={orbState} size={140} />
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 md:px-8 space-y-4 scrollbar-thin"
      >
        <AnimatePresence>
          {messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
          {currentAiResponse && (
            <ChatMessage
              key="streaming"
              message={{
                id: "streaming",
                role: "ai",
                content: currentAiResponse,
                timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              }}
            />
          )}
        </AnimatePresence>
      </div>

      <div className="flex-shrink-0 p-4 md:px-8 md:pb-6">
        <div className="glass-surface rounded-2xl flex items-center gap-3 px-4 py-3">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".pdf"
            className="hidden"
          />

          <div className="flex items-center gap-2">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={handleFileClick}
              disabled={isUploading}
              className="p-2.5 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              {isUploading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={toggleRecording}
              className={`p-2.5 rounded-xl transition-colors ${isRecording
                  ? "bg-destructive/20 text-destructive"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
            >
              {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
            </motion.button>
          </div>

          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask J anything..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />

          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={handleSend}
            disabled={!input.trim()}
            className="p-2.5 rounded-xl bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Send size={18} />
          </motion.button>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
