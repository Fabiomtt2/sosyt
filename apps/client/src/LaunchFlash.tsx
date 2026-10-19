import { useEffect, useState } from "react";
import { Youtube } from "lucide-react";
import "./launch-flash.css";

const SESSION_KEY = "sos-youtuber.launch-flash.v1";
const DURATION_MS = 1900;

function shouldShowFlash(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  try {
    return window.sessionStorage.getItem(SESSION_KEY) !== "seen";
  } catch {
    // A restricted storage policy must never prevent the page from opening.
    return true;
  }
}

/** Decorative, once-per-tab opening. Render beside the Index, never instead of it. */
export function LaunchFlash() {
  const [visible, setVisible] = useState(shouldShowFlash);

  useEffect(() => {
    if (!visible) return;
    try {
      window.sessionStorage.setItem(SESSION_KEY, "seen");
    } catch {
      // Animation remains optional when browser storage is unavailable.
    }
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleMotionChange = () => {
      if (motion.matches) setVisible(false);
    };
    motion.addEventListener("change", handleMotionChange);
    const timer = window.setTimeout(() => setVisible(false), DURATION_MS);
    return () => {
      window.clearTimeout(timer);
      motion.removeEventListener("change", handleMotionChange);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="launch-flash" aria-hidden="true">
      <div className="launch-flash__wash" />
      <div className="launch-flash__beam" />
      <div className="launch-flash__brand">
        <div className="launch-flash__symbol">
          <Youtube size={48} />
        </div>
        <div className="launch-flash__wordmark">SOS YOUTUBER</div>
        <span className="launch-flash__caption">Criadores apoiam criadores.</span>
      </div>
    </div>
  );
}
