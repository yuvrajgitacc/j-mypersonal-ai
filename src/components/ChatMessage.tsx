import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface ChatMessageData {
  id: string;
  role: "user" | "ai";
  content: string;
  timestamp: string;
}

interface ChatMessageProps {
  message: ChatMessageData;
}

const ChatMessage = ({ message }: ChatMessageProps) => {
  const isAI = message.role === "ai";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex ${isAI ? "justify-start" : "justify-end"}`}
    >
      <div
        className={`max-w-[85%] md:max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
          isAI
            ? "glass-surface rounded-bl-md text-foreground"
            : "bg-primary/20 border border-primary/30 rounded-br-md text-foreground"
        }`}
      >
        {isAI && (
          <span className="text-xs font-semibold text-gradient-brand block mb-1">J</span>
        )}
        <div className="prose prose-sm prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-secondary/50 prose-pre:border prose-pre:border-border prose-li:my-0.5">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
        <span className="block text-[10px] text-muted-foreground mt-2 text-right">
          {message.timestamp}
        </span>
      </div>
    </motion.div>
  );
};

export default ChatMessage;
