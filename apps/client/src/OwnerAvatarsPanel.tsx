import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Images, Trash2, RefreshCw, Upload, Crown, Sparkles } from "lucide-react";
import { ownerApi, catalogAvatarUrl, type AdminAvatarItem, type AvatarTier } from "./api";

/** Normaliza a ilustração: recorte quadrado + WEBP 512px. O círculo é do CSS, então
 * o Owner não precisa se preocupar com tamanho/enquadramento — o painel padroniza. */
async function toAvatarWebp(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read"));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode"));
    img.src = dataUrl;
  });
  const side = 512, crop = Math.min(image.width, image.height);
  const canvas = document.createElement("canvas");
  canvas.width = side; canvas.height = side;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(image, (image.width - crop) / 2, (image.height - crop) / 2, crop, crop, 0, 0, side, side);
  return canvas.toDataURL("image/webp", 0.82);
}

const TIERS: Array<{ id: AvatarTier; label: string }> = [
  { id: "COMMON", label: "Comum" }, { id: "SUPER", label: "SUPER" }, { id: "OWNER", label: "OWNER" }
];
const CATEGORIES = [
  { id: "PEOPLE", label: "Pessoas" }, { id: "ANIMALS", label: "Animais" }, { id: "CREATURES", label: "Criaturas" },
  { id: "OBJECTS", label: "Objetos" }, { id: "SEASONAL", label: "Sazonal" }, { id: "EVENT", label: "Evento" }
];
const tierTag = (t: AvatarTier) => t === "OWNER" ? "owner" : t === "SUPER" ? "super" : "common";

/**
 * AUDITORIA / gestão de avatares (ROOT_OWNER): o Owner sobe a ilustração (gerada
 * pela IA), escolhe tier e categoria. Vira dado — sem tocar no código. Permite
 * avatares sazonais/evento. O gating por tier é garantido no servidor.
 */
export function OwnerAvatarsPanel() {
  const [items, setItems] = useState<AdminAvatarItem[]>([]);
  const [draft, setDraft] = useState<{ tier: AvatarTier; category: string; label: string; dataUrl: string }>({ tier: "SUPER", category: "CREATURES", label: "", dataUrl: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try { setItems((await ownerApi.avatarsAdmin()).avatars); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar avatares."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  function flash(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3000); }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.dataUrl) { setError("Escolha a ilustração do avatar."); return; }
    if (draft.label.trim().length < 1) { setError("Dê um nome ao avatar."); return; }
    setBusy(true); setError("");
    try {
      await ownerApi.avatarUpload({ tier: draft.tier, category: draft.category, label: draft.label.trim(), dataUrl: draft.dataUrl });
      flash("Avatar publicado. Já está disponível no seletor.");
      setDraft((d) => ({ ...d, label: "", dataUrl: "" }));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível publicar."); }
    finally { setBusy(false); }
  }

  async function remove(slug: string) {
    setBusy(true); setError("");
    try { await ownerApi.avatarDelete(slug); flash("Avatar removido."); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível remover."); }
    finally { setBusy(false); }
  }

  const grouped = TIERS.map((t) => ({ tier: t, list: items.filter((i) => i.tier === t.id) }));

  return (
    <section className="owner-panel avatars-panel">
      <div className="owner-panel-head">
        <div><h2><Images size={19} /> Avatares da comunidade</h2><p className="muted">Escolha uma imagem, dê um nome e defina quem pode usá-la. O recorte e o tamanho são ajustados automaticamente.</p></div>
        <button className="text-button" onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> Atualizar</button>
      </div>

      <form className="avatar-upload-form comms-block" onSubmit={submit}>
        <div className="avatar-upload-grid">
          <label className="avatar-drop">
            {draft.dataUrl
              ? <img src={draft.dataUrl} alt="Prévia do avatar" className={"avatar-drop-preview tier-" + tierTag(draft.tier)} />
              : <span className="avatar-drop-empty"><Upload size={20} /><small>Escolher ilustração</small></span>}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Escolher ilustração do avatar" onChange={async (e) => {
              const file = e.target.files?.[0]; if (!file) return;
              setError("");
              try { const webp = await toAvatarWebp(file); setDraft((d) => ({ ...d, dataUrl: webp })); }
              catch { setError("Não foi possível preparar a imagem. Tente outro arquivo PNG, JPEG ou WebP."); }
            }} />
          </label>
          <div className="avatar-upload-fields">
            <label>Nome<input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value.slice(0, 60) })} placeholder="ex: Fênix Cósmica" /></label>
            <label>Nível<select value={draft.tier} onChange={(e) => setDraft({ ...draft, tier: e.target.value as AvatarTier })}>{TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
            <label>Categoria<select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
            <button className="primary" disabled={busy || !draft.dataUrl}><Upload size={15} /> Publicar avatar</button>
          </div>
        </div>
        <small className="muted">
          {draft.tier === "OWNER" ? <><Crown size={12} /> Avatar OWNER: exclusivo dos Owners, com contorno dourado.</>
            : draft.tier === "SUPER" ? <><Sparkles size={12} /> Avatar SUPER: disponível para assinantes ativos, com contorno colorido.</>
            : "Avatar comum: disponível para todos."}
        </small>
      </form>

      {grouped.map(({ tier, list }) => list.length > 0 && (
        <div className="comms-block" key={tier.id}>
          <div className="comms-block-head"><h3 className={"avatar-tier-title " + tierTag(tier.id)}>{tier.label} <span className="muted">· {list.length}</span></h3></div>
          <div className="avatar-admin-grid">
            {list.map((item) => (
              <figure key={item.slug} className="avatar-admin-cell">
                <img src={catalogAvatarUrl(item.slug)} alt={item.label} className={"avatar-admin-img tier-" + tierTag(item.tier)} loading="lazy" />
                <figcaption>{item.label}<small>{CATEGORIES.find((c) => c.id === item.category)?.label ?? item.category}</small></figcaption>
                <button type="button" className="avatar-admin-del" onClick={() => void remove(item.slug)} disabled={busy} aria-label={`Remover ${item.label}`}><Trash2 size={13} /></button>
              </figure>
            ))}
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="muted">Seu catálogo ainda está vazio. Escolha uma imagem acima para publicar o primeiro avatar.</p>}

      {notice && <p className="bot-notice">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
