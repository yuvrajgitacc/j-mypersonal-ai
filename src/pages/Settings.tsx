import { useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  Brain,
  Volume2,
  UserCog,
  Palette,
  Bell,
  Shield,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

interface SettingSectionProps {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}

const SettingSection = ({ icon: Icon, title, description, children }: SettingSectionProps) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    className="glass-surface rounded-2xl p-5 space-y-4"
  >
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
        <Icon size={18} className="text-primary" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
    <div className="space-y-3">{children}</div>
  </motion.div>
);

const Toggle = ({ label, defaultOn = false }: { label: string; defaultOn?: boolean }) => {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-secondary-foreground">{label}</span>
      <button
        onClick={() => setOn(!on)}
        className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
          on ? "bg-primary" : "bg-secondary"
        }`}
      >
        <motion.div
          animate={{ x: on ? 20 : 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="w-5 h-5 rounded-full bg-foreground"
        />
      </button>
    </div>
  );
};

const Slider = ({ label, defaultValue = 50 }: { label: string; defaultValue?: number }) => {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <span className="text-sm text-secondary-foreground">{label}</span>
        <span className="text-xs text-muted-foreground font-mono">{value}%</span>
      </div>
      <div className="relative h-2 bg-secondary rounded-full overflow-hidden">
        <motion.div
          className="absolute top-0 left-0 h-full bg-primary rounded-full"
          style={{ width: `${value}%` }}
        />
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
        />
      </div>
    </div>
  );
};

const SelectOption = ({ label, options, defaultValue }: { label: string; options: string[]; defaultValue: string }) => {
  const [selected, setSelected] = useState(defaultValue);
  return (
    <div className="space-y-2">
      <span className="text-sm text-secondary-foreground">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <motion.button
            key={opt}
            whileTap={{ scale: 0.95 }}
            onClick={() => setSelected(opt)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              selected === opt
                ? "bg-primary/20 text-primary border border-primary/30"
                : "bg-secondary text-muted-foreground hover:text-foreground border border-transparent"
            }`}
          >
            {opt}
          </motion.button>
        ))}
      </div>
    </div>
  );
};

const SettingsPage = () => {
  const navigate = useNavigate();

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-4 md:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => navigate("/")}
            className="p-2 rounded-xl bg-secondary hover:bg-secondary/80 transition-colors"
          >
            <ChevronLeft size={18} className="text-muted-foreground" />
          </motion.button>
          <div>
            <h2 className="text-xl font-bold text-foreground">Settings</h2>
            <p className="text-xs text-muted-foreground">Customize your J experience</p>
          </div>
        </div>

        {/* Personality */}
        <SettingSection icon={Brain} title="AI Personality" description="Adjust how J communicates">
          <SelectOption
            label="Communication Style"
            options={["Professional", "Casual", "Concise", "Detailed"]}
            defaultValue="Professional"
          />
          <SelectOption
            label="Personality"
            options={["Friendly", "Formal", "Witty", "Empathetic"]}
            defaultValue="Friendly"
          />
          <Slider label="Creativity Level" defaultValue={65} />
        </SettingSection>

        {/* Voice */}
        <SettingSection icon={Volume2} title="Voice Settings" description="Configure voice interactions">
          <SelectOption
            label="Voice Type"
            options={["Nova", "Echo", "Alloy", "Onyx"]}
            defaultValue="Nova"
          />
          <Slider label="Speech Speed" defaultValue={50} />
          <Slider label="Voice Volume" defaultValue={75} />
          <Toggle label="Auto-detect language" defaultOn />
        </SettingSection>

        {/* Appearance */}
        <SettingSection icon={Palette} title="Appearance" description="Visual preferences">
          <SelectOption
            label="Orb Theme"
            options={["Default", "Warm", "Cool", "Monochrome"]}
            defaultValue="Default"
          />
          <Toggle label="Particle effects" defaultOn />
          <Toggle label="Smooth animations" defaultOn />
        </SettingSection>

        {/* Notifications */}
        <SettingSection icon={Bell} title="Notifications" description="Manage alerts and reminders">
          <Toggle label="Push notifications" />
          <Toggle label="Sound effects" defaultOn />
          <Toggle label="Daily summary" />
        </SettingSection>

        {/* Account */}
        <SettingSection icon={Shield} title="Account" description="Manage your account">
          <Toggle label="Two-factor authentication" />
          <div className="pt-2">
            <motion.button
              whileTap={{ scale: 0.97 }}
              className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
            >
              Delete Account
            </motion.button>
          </div>
        </SettingSection>

        <div className="h-8" />
      </div>
    </div>
  );
};

export default SettingsPage;
