import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Store, Plus, Eye, EyeOff, Coins, Ticket, Package, RefreshCw, ImagePlus, Sparkles } from "lucide-react";
import { ownerApi, type StoreProduct } from "./api";

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Draft = { code: string; title: string; description: string; price: string; credits: string; extraPasses: string; grantsItem: string; grantsItemQty: string; sortOrder: string; subscriptionDays: string; imageDataUrl: string };
const emptyDraft: Draft = { code: "", title: "", description: "", price: "", credits: "0", extraPasses: "0", grantsItem: "", grantsItemQty: "1", sortOrder: "10", subscriptionDays: "0", imageDataUrl: "" };

/** Reduz a imagem no navegador antes de enviar: o servidor aceita ~300 KB. */
async function toCompactDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Arquivo de imagem inválido."));
    el.src = raw;
  });
  const side = 512;
  const canvas = document.createElement("canvas");
  canvas.width = side; canvas.height = side;
  const ctx = canvas.getContext("2d");
  if (!ctx) return raw;
  // corta no centro, mantendo proporção, e exporta em WEBP (leve)
  const crop = Math.min(image.width, image.height);
  ctx.drawImage(image, (image.width - crop) / 2, (image.height - crop) / 2, crop, crop, 0, 0, side, side);
  return canvas.toDataURL("image/webp", 0.82);
}

/**
 * AUDITORIA / painel da loja: produtos editáveis em tempo real. O preço é lei do
 * servidor — o cliente nunca dita valor. Um produto pode conceder moedas, passes
 * e/ou um item de inventário (ex.: SKIP, o "Pular").
 */
export function OwnerStorePanel({ canEdit }: { canEdit: boolean }) {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try { setProducts((await ownerApi.storeProducts()).products); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar a loja."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function startEdit(p: StoreProduct) {
    setEditing(p.code);
    setDraft({
      code: p.code, title: p.title, description: p.description,
      price: (p.amountCents / 100).toFixed(2).replace(".", ","),
      credits: String(p.creditsMillis / 1000), extraPasses: String(p.extraPasses),
      grantsItem: p.grantsItem ?? "", grantsItemQty: String(p.grantsItemQty || 1), sortOrder: String(p.sortOrder),
      subscriptionDays: String(p.subscriptionDays || 0), imageDataUrl: p.imageDataUrl ?? ""
    });
    requestAnimationFrame(() => document.getElementById("store-product-editor")?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const amountCents = Math.round(Number(draft.price.replace(/\./g, "").replace(",", ".")) * 100);
      await ownerApi.saveStoreProduct({
        code: draft.code.trim().toUpperCase(), title: draft.title.trim(), description: draft.description.trim(),
        amountCents, credits: Number(draft.credits || 0), extraPasses: Number(draft.extraPasses || 0),
        grantsItem: draft.grantsItem.trim() ? draft.grantsItem.trim().toUpperCase() : undefined,
        grantsItemQty: draft.grantsItem.trim() ? Number(draft.grantsItemQty || 1) : 0,
        sortOrder: Number(draft.sortOrder || 10),
        subscriptionDays: Number(draft.subscriptionDays || 0),
        imageDataUrl: draft.imageDataUrl
      });
      setDraft(emptyDraft); setEditing(undefined);
      setNotice("Salvo — já está valendo na loja.");
      window.setTimeout(() => setNotice(""), 2600);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }

  async function toggle(p: StoreProduct) {
    setBusy(true);
    try { setProducts((await ownerApi.setStoreProductActive(p.code, !p.active)).products); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao alterar."); }
    finally { setBusy(false); }
  }

  return (
    <section className="owner-panel store-admin-panel">
      <div className="owner-panel-head">
        <div><h2><Store size={19} /> Loja</h2><p className="muted">Preço, moedas, passes e itens. O servidor confirma cada compra — o cliente nunca define valor.</p></div>
        <button className="text-button" onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> Atualizar</button>
      </div>

      <div className="store-admin-products">
        {products.map((p) => (
          <article className="store-admin-product" key={p.code}>
            <div className="store-admin-product-head">
              {p.imageDataUrl
                ? <img className="store-thumb" src={p.imageDataUrl} alt="" />
                : <span className="store-thumb store-thumb-empty">NOVO<br/>ITEM</span>}
              <div className="store-admin-product-title">
                <h3>{p.title}</h3>
                <small>{p.code}</small>
              </div>
              <span className={`table-status ${p.active ? "on" : "off"}`}>{p.active ? "Na loja" : "Oculto"}</span>
            </div>
            {p.description && <p className="store-admin-description">{p.description}</p>}
            <div className="store-admin-product-details">
              <div><span className="store-admin-detail-label">Preço</span><strong className="store-admin-price">{money(p.amountCents)}</strong></div>
              <div><span className="store-admin-detail-label">O participante recebe</span>
                <div className="store-grants">
                  {p.creditsMillis > 0 && <span><Coins size={14} /> {p.creditsMillis / 1000} moedas</span>}
                  {p.extraPasses > 0 && <span><Ticket size={14} /> {p.extraPasses} passe{p.extraPasses > 1 ? "s" : ""}</span>}
                  {p.grantsItem && <span><Package size={14} /> {p.grantsItemQty}× {p.grantsItem}</span>}
                  {p.subscriptionDays > 0 && <span><Sparkles size={14} /> assinatura de {p.subscriptionDays} dias</span>}
                </div>
              </div>
            </div>
            {canEdit && <div className="store-admin-product-actions">
              <button type="button" className="secondary" onClick={() => startEdit(p)}>Editar item</button>
              <button type="button" className="text-button" onClick={() => void toggle(p)} disabled={busy}>
                {p.active ? <><EyeOff size={15} /> Ocultar da loja</> : <><Eye size={15} /> Publicar na loja</>}
              </button>
            </div>}
          </article>
        ))}
        {!products.length && <p className="muted">Nenhum item cadastrado.</p>}
      </div>

      {canEdit && (
        <form id="store-product-editor" className="store-form" onSubmit={submit}>
          <h3>{editing ? `Editando ${editing}` : "Novo item"}</h3>
          <div className="store-form-grid">
            <label>Código<input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="COINS_10" required disabled={Boolean(editing)} /></label>
            <label>Título<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="10 moedas" required /></label>
            <label>Preço (R$)<input value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} placeholder="20,00" inputMode="decimal" required /></label>
            <label>Moedas<input value={draft.credits} onChange={(e) => setDraft({ ...draft, credits: e.target.value })} inputMode="numeric" /></label>
            <label>Passes<input value={draft.extraPasses} onChange={(e) => setDraft({ ...draft, extraPasses: e.target.value })} inputMode="numeric" /></label>
            <label>Item concedido<input value={draft.grantsItem} onChange={(e) => setDraft({ ...draft, grantsItem: e.target.value })} placeholder="SKIP" /></label>
            <label>Qtd. do item<input value={draft.grantsItemQty} onChange={(e) => setDraft({ ...draft, grantsItemQty: e.target.value })} inputMode="numeric" /></label>
            <label>Ordem<input value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })} inputMode="numeric" /></label>
            <label>Assinatura (dias)<input value={draft.subscriptionDays} onChange={(e) => setDraft({ ...draft, subscriptionDays: e.target.value })} inputMode="numeric" placeholder="0 = não é assinatura" /></label>
          </div>
          <label className="store-form-wide">Descrição<input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="O que o participante recebe" /></label>
          <div className="store-image-row">
            {draft.imageDataUrl
              ? <img className="store-image-preview" src={draft.imageDataUrl} alt="Pré-visualização" />
              : <span className="store-thumb store-thumb-empty large">NOVO<br/>ITEM</span>}
            <div>
              <label className="store-upload">
                <ImagePlus size={15} /> Enviar ilustração
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={async (e) => {
                  const file = e.target.files?.[0]; if (!file) return;
                  setError("");
                  try { setDraft((d) => ({ ...d, imageDataUrl: "" })); const compact = await toCompactDataUrl(file); setDraft((d) => ({ ...d, imageDataUrl: compact })); }
                  catch (cause) { setError(cause instanceof Error ? cause.message : "Imagem inválida."); }
                  finally { e.target.value = ""; }
                }} />
              </label>
              <small className="muted">Recortada em quadrado e otimizada aqui no navegador. Vale em todas as telas na hora.</small>
              {draft.imageDataUrl && <button type="button" className="text-button" onClick={() => setDraft({ ...draft, imageDataUrl: "" })}>Remover</button>}
            </div>
          </div>
          <div className="store-form-actions">
            <button className="primary" disabled={busy}><Plus size={15} /> {editing ? "Salvar alterações" : "Criar item"}</button>
            {editing && <button type="button" className="secondary" onClick={() => { setEditing(undefined); setDraft(emptyDraft); }}>Cancelar</button>}
          </div>
        </form>
      )}

      {notice && <p className="bot-notice">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
