import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Store, Plus, Eye, EyeOff, Coins, Ticket, Package, RefreshCw } from "lucide-react";
import { ownerApi, type StoreProduct } from "./api";

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Draft = { code: string; title: string; description: string; price: string; credits: string; extraPasses: string; grantsItem: string; grantsItemQty: string; sortOrder: string };
const emptyDraft: Draft = { code: "", title: "", description: "", price: "", credits: "0", extraPasses: "0", grantsItem: "", grantsItemQty: "1", sortOrder: "10" };

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
      grantsItem: p.grantsItem ?? "", grantsItemQty: String(p.grantsItemQty || 1), sortOrder: String(p.sortOrder)
    });
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
        sortOrder: Number(draft.sortOrder || 10)
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

      <div className="table-scroll">
        <table><thead><tr><th>Item</th><th>Preço</th><th>Concede</th><th>Estado</th>{canEdit && <th></th>}</tr></thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.code}>
                <td><strong>{p.title}</strong><small>{p.code}{p.description ? " · " + p.description : ""}</small></td>
                <td><strong>{money(p.amountCents)}</strong></td>
                <td className="store-grants">
                  {p.creditsMillis > 0 && <span><Coins size={13} /> {p.creditsMillis / 1000} moedas</span>}
                  {p.extraPasses > 0 && <span><Ticket size={13} /> {p.extraPasses} passe{p.extraPasses > 1 ? "s" : ""}</span>}
                  {p.grantsItem && <span><Package size={13} /> {p.grantsItemQty}× {p.grantsItem}</span>}
                </td>
                <td>{p.active ? <span className="table-status on">Na loja</span> : <span className="table-status off">Oculto</span>}</td>
                {canEdit && <td className="store-row-actions">
                  <button className="text-button" onClick={() => startEdit(p)}>Editar</button>
                  <button className="text-button" onClick={() => void toggle(p)} disabled={busy}>
                    {p.active ? <><EyeOff size={13} /> Ocultar</> : <><Eye size={13} /> Publicar</>}
                  </button>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!products.length && <p className="muted">Nenhum item cadastrado.</p>}
      </div>

      {canEdit && (
        <form className="store-form" onSubmit={submit}>
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
          </div>
          <label className="store-form-wide">Descrição<input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="O que o participante recebe" /></label>
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
