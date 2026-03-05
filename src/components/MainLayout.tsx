import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Menu } from "lucide-react";
import AppSidebar from "../components/AppSidebar";

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout = ({ children }: MainLayoutProps) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <AnimatePresence>
        <AppSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      </AnimatePresence>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex-shrink-0 flex items-center h-14 px-4 border-b border-border/50 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-xl hover:bg-secondary transition-colors"
          >
            <Menu size={20} className="text-muted-foreground" />
          </button>
          <span className="ml-3 text-sm font-bold text-gradient-brand">J</span>
        </header>
        <main className="flex-1 min-h-0">{children}</main>
      </div>
    </div>
  );
};

export default MainLayout;
