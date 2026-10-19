import { useSyncExternalStore } from "react";
import { Mail } from "lucide-react";
import { api } from "./api";
import "./community-social.css";

type CommunityUnread = { mail: number; social: number; total: number };
let snapshot: CommunityUnread = { mail: 0, social: 0, total: 0 };
const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let pending = false;
let session: string | null = null;
const reset = () => { snapshot = { mail: 0, social: 0, total: 0 }; };
async function refresh() {
  const token = localStorage.getItem("conexao_token");
  if (session !== token) { session = token; reset(); for (const notify of subscribers) notify(); }
  if (pending || !token || document.hidden) return;
  pending = true;
  try {
    const [mail, social] = await Promise.all([api.mailUnread(), api.socialUnread()]);
    if (token !== localStorage.getItem("conexao_token") || !subscribers.size) return;
    if (snapshot.mail !== mail.unread || snapshot.social !== social.unread) {
      snapshot = { mail: mail.unread, social: social.unread, total: mail.unread + social.unread };
      for (const notify of subscribers) notify();
    }
  } catch { /* Keep the last confirmed count while the connection returns. */ }
  finally { pending = false; }
}
const updated = () => { void refresh(); };
function subscribe(notify: () => void) {
  subscribers.add(notify);
  if (subscribers.size === 1) {
    reset(); void refresh();
    timer = setInterval(updated, 5000);
    window.addEventListener("sos-community-updated", updated);
    document.addEventListener("visibilitychange", updated);
  }
  return () => {
    subscribers.delete(notify);
    if (!subscribers.size) {
      clearInterval(timer); timer = undefined;
      window.removeEventListener("sos-community-updated", updated);
      document.removeEventListener("visibilitychange", updated);
      session = null; reset();
    }
  };
}
export function useCommunityUnread() {
  return useSyncExternalStore(subscribe, () => snapshot);
}
export function CommunityLauncher({ onOpen, className = "", compact = true }: { onOpen: () => void; className?: string; compact?: boolean }) {
  const unread = useCommunityUnread();
  const label = "Abrir correio e amigos" + (unread.total ? " · " + unread.total + " novidades" : "");
  return <button type="button" className={"community-launcher " + className} onClick={onOpen} aria-label={label} title={label}>
    <Mail size={19}/>{!compact && <span>Correio e amigos</span>}
    {unread.total > 0 && <b aria-hidden="true">{unread.total > 99 ? "99+" : unread.total}</b>}
  </button>;
}
