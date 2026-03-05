import { motion, AnimatePresence } from "framer-motion";
import { API_BASE } from "@/lib/config";
import { useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  MessageSquare,
  Settings,
  User,
  Sparkles,
  X,
  History,
  Clock,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface AppSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const navItems = [
  { icon: MessageSquare, label: "Chat", path: "/" },
  { icon: User, label: "Profile", path: "/profile" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

const AppSidebar = ({ isOpen, onClose }: AppSidebarProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [userName, setUserName] = useState("User");
  const [archiveDates, setArchiveDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);

  useEffect(() => {
    fetchProfile();
    fetchArchiveDates();
    // Listen for profile updates
    window.addEventListener("profileUpdated", fetchProfile);
    return () => window.removeEventListener("profileUpdated", fetchProfile);
  }, []);

  const fetchProfile = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/profile`);
      const data = await response.json();
      if (data.name) setUserName(data.name);
    } catch (error) {
      console.error("Sidebar profile fetch error:", error);
    }
  };

  const fetchArchiveDates = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/memory/archive/dates`);
      const data = await response.json();
      setArchiveDates(data);
    } catch (error) {
      console.error("Archive dates fetch error:", error);
    }
  };

  const handleNav = (path: string) => {
    if (path === "/") {
      setSelectedDate(null);
      window.dispatchEvent(new CustomEvent("refreshChat"));
    }
    navigate(path);
    onClose();
  };

  const loadArchive = async (date: string) => {
    setSelectedDate(date);
    try {
      const response = await fetch(`${API_BASE}/api/memory/archive/${date}`);
      const history = await response.json();

      // Dispatch a custom event for ChatPanel to catch
      window.dispatchEvent(new CustomEvent("loadArchive", { detail: { date, history } }));

      navigate("/");
      onClose();
    } catch (error) {
      console.error("Load archive error:", error);
    }
  };

  return (
    <>
      {/* Backdrop for mobile */}
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-background/60 backdrop-blur-sm z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ x: isOpen ? 0 : -280 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="fixed top-0 left-0 h-full w-[260px] z-50 glass-surface-strong flex flex-col md:relative md:!translate-x-0 md:!transform-none"
        style={{ willChange: "transform" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center">
              <Sparkles size={18} className="text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-foreground">J</h1>
              <p className="text-[10px] text-muted-foreground tracking-widest uppercase">AI Secretary</p>
            </div>
          </div>
          <button onClick={onClose} className="md:hidden p-1.5 rounded-lg hover:bg-secondary transition-colors">
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto scrollbar-thin">
          {navItems.map((item) => {
            const active = location.pathname === item.path && !selectedDate;
            return (
              <motion.button
                key={item.path}
                whileHover={{ x: 4 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleNav(item.path)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  }`}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
                {active && (
                  <motion.div
                    layoutId="active-nav"
                    className="ml-auto w-1.5 h-1.5 rounded-full bg-primary"
                  />
                )}
              </motion.button>
            );
          })}

          {/* Archive Collapsible Section */}
          <div className="pt-4">
            <motion.button
              whileHover={{ x: 4 }}
              onClick={() => setIsArchiveOpen(!isArchiveOpen)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${isArchiveOpen || selectedDate
                  ? "text-foreground bg-secondary/40"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                }`}
            >
              <History size={18} />
              <span className="flex-1 text-left">Filing Cabinet</span>
              {isArchiveOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </motion.button>

            <AnimatePresence>
              {isArchiveOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="pt-1 pb-2 pl-4 space-y-1">
                    {archiveDates.length === 0 ? (
                      <p className="px-9 py-2 text-[11px] text-muted-foreground italic">No past chats yet.</p>
                    ) : (
                      archiveDates.map((date) => (
                        <motion.button
                          key={date}
                          whileHover={{ x: 4 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => loadArchive(date)}
                          className={`w-full flex items-center gap-3 px-5 py-2 rounded-xl text-[12px] transition-all ${selectedDate === date
                              ? "text-primary font-semibold"
                              : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                          <Clock size={12} />
                          <span>{new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                        </motion.button>
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
              <User size={14} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{userName}</p>
            </div>
          </div>
        </div>
      </motion.aside>
    </>
  );
};

export default AppSidebar;
