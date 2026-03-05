import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, Mail, Calendar, Edit3, Save, X, Loader2, FileText, Trash2, Eye, Info, Archive } from "lucide-react";
import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

interface Document {
  id: string;
  filename: string;
  summary: string;
  uploadDate: string;
}

const ProfilePage = () => {
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [profile, setProfile] = useState({
    name: "User",
    email: "user@example.com",
    memberSince: "March 2026",
  });

  // Document Manager States
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isArchiveOn, setIsArchiveOn] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);

  const [editForm, setEditForm] = useState({ ...profile });

  useEffect(() => {
    fetchProfile();
    fetchDocuments();
  }, []);

  const fetchProfile = async () => {
    try {
      const response = await fetch("http://localhost:3001/api/profile");
      const data = await response.json();
      setProfile(data);
      setEditForm(data);
    } catch (error) {
      console.error("Error fetching profile:", error);
      toast.error("Failed to load profile details.");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDocuments = async () => {
    try {
      const response = await fetch("http://localhost:3001/api/docs");
      const data = await response.json();
      setDocuments(data);
    } catch (error) {
      console.error("Error fetching documents:", error);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("http://localhost:3001/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const data = await response.json();
      if (data.success) {
        setProfile(data.profile);
        setIsEditing(false);
        toast.success("Profile updated successfully!");
        // Notify other components (like sidebar) to refresh
        window.dispatchEvent(new Event("profileUpdated"));
      } else {
        toast.error("Failed to update profile.");
      }
    } catch (error) {
      console.error("Error updating profile:", error);
      toast.error("Error connecting to server.");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteDocument = async (id: string) => {
    try {
      const response = await fetch(`http://localhost:3001/api/docs/${id}?archive=${isArchiveOn}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (data.success) {
        setDocuments(documents.filter(doc => doc.id !== id));
        toast.success(isArchiveOn ? "Document archived & removed!" : "Document deleted permanently.");
      }
    } catch (error) {
      toast.error("Failed to delete document.");
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-4 md:p-8 space-y-6 pb-20">
        <div className="flex items-center gap-4">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => navigate("/")}
            className="p-2 rounded-xl bg-secondary hover:bg-secondary/80 transition-colors"
          >
            <ChevronLeft size={18} className="text-muted-foreground" />
          </motion.button>
          <h2 className="text-xl font-bold text-foreground">Profile</h2>
        </div>

        {/* Profile Card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-surface rounded-2xl p-6 flex flex-col items-center gap-4"
        >
          <div className="w-20 h-20 rounded-2xl bg-primary/15 flex items-center justify-center">
            <User size={36} className="text-primary" />
          </div>
          
          {isEditing ? (
            <div className="w-full space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground ml-1">Full Name</label>
                <input 
                  value={editForm.name}
                  onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                  className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Your Name"
                />
              </div>
              <div className="flex gap-2">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => { setIsEditing(false); setEditForm(profile); }}
                  className="px-4 py-2 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
                >
                  <X size={14} />
                </motion.button>
              </div>
            </div>
          ) : (
            <>
              <div className="text-center">
                <h3 className="text-lg font-bold text-foreground">{profile.name}</h3>
                <p className="text-sm text-muted-foreground">Free Plan Member</p>
              </div>
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/15 text-primary text-sm font-medium hover:bg-primary/25 transition-colors"
              >
                <Edit3 size={14} />
                Edit Profile
              </motion.button>
            </>
          )}
        </motion.div>

        {/* Account Info */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-surface rounded-2xl p-5 space-y-4"
        >
          <h4 className="text-sm font-semibold text-foreground">Account Details</h4>
          
          <div className="flex items-center gap-3 py-2">
            <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
              <Mail size={14} className="text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground">Email Notification Address</p>
              {isEditing ? (
                <input 
                  value={editForm.email}
                  onChange={(e) => setEditForm({...editForm, email: e.target.value})}
                  className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="your-email@example.com"
                />
              ) : (
                <p className="text-sm text-foreground">{profile.email}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 py-2">
            <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
              <Calendar size={14} className="text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Member Since</p>
              <p className="text-sm text-foreground">{profile.memberSince}</p>
            </div>
          </div>
        </motion.div>

        {/* Usage */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-surface rounded-2xl p-5 space-y-4"
        >
          <h4 className="text-sm font-semibold text-foreground">Usage</h4>
          <div className="space-y-3">
            {[
              { label: "Messages Today", value: 12, max: 50 },
              { label: "Voice Minutes", value: 8, max: 30 },
            ].map((item) => (
              <div key={item.label} className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="text-foreground font-mono">{item.value}/{item.max}</span>
                </div>
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(item.value / item.max) * 100}%` }}
                    transition={{ duration: 1, ease: "easeOut" }}
                    className="h-full bg-primary rounded-full"
                  />
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Document Manager */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="glass-surface rounded-2xl p-5 space-y-6"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText size={18} className="text-primary" />
              <h4 className="text-sm font-semibold text-foreground">Document Library</h4>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/50">
                <Archive size={12} className={isArchiveOn ? "text-primary" : "text-muted-foreground"} />
                <span className="text-[10px] font-medium text-foreground uppercase tracking-tight">Archive Logic</span>
                <Switch 
                  checked={isArchiveOn} 
                  onCheckedChange={setIsArchiveOn}
                  className="scale-75"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {documents.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <Info size={24} className="mx-auto text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">No documents uploaded yet. J is waiting to learn!</p>
              </div>
            ) : (
              documents.map((doc) => (
                <div key={doc.id} className="group p-3 rounded-xl bg-secondary/30 border border-border hover:bg-secondary/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <FileText size={14} className="text-primary" />
                      </div>
                      <div className="overflow-hidden">
                        <p className="text-sm font-medium text-foreground truncate">{doc.filename}</p>
                        <p className="text-[10px] text-muted-foreground">{new Date(doc.uploadDate).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <motion.button
                        whileTap={{ scale: 0.9 }}
                        onClick={() => setSelectedDoc(doc)}
                        className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10"
                      >
                        <Eye size={14} />
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.9 }}
                        onClick={() => deleteDocument(doc.id)}
                        className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 size={14} />
                      </motion.button>
                    </div>
                  </div>
                  
                  {/* Summary Preview (Collapsible) */}
                  <AnimatePresence>
                    {selectedDoc?.id === doc.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 pt-3 border-t border-border/50">
                          <p className="text-[11px] leading-relaxed text-muted-foreground italic">
                            "{doc.summary}"
                          </p>
                          <motion.button 
                            onClick={() => setSelectedDoc(null)}
                            className="mt-2 text-[10px] text-primary font-medium"
                          >
                            Close Preview
                          </motion.button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default ProfilePage;