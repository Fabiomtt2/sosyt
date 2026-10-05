import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";

export type PaymentStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type PaymentConfirmation = {
  providerPaymentId: string;
  internalId?: string;
  status: PaymentStatus;
  amountCents: number;
  currency?: string;
  paymentMethod?: string;
};
export type PixResult = {
  providerPaymentId: string;
  status: PaymentStatus;
  qrCode?: string;
  qrCodeBase64?: string;
  ticketUrl?: string;
};

type ProviderPayment = {
  id?: number | string;
  external_reference?: string;
  transaction_amount?: number;
  currency_id?: string;
  payment_method_id?: string;
  status?: string;
  message?: string;
  point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string } };
};

function mapStatus(status?: string): PaymentStatus {
  if (status === "approved") return "APPROVED";
  if (status === "rejected") return "REJECTED";
  if (["cancelled", "refunded", "charged_back"].includes(status ?? "")) return "CANCELLED";
  return "PENDING";
}

function confirmation(payload: ProviderPayment): PaymentConfirmation {
  const cents = (payload.transaction_amount ?? NaN) * 100;
  return {
    providerPaymentId: String(payload.id ?? ""),
    internalId: payload.external_reference,
    status: mapStatus(payload.status),
    amountCents: Number.isFinite(cents) && Math.abs(cents - Math.round(cents)) < 1e-7 ? Math.round(cents) : -1,
    currency: payload.currency_id,
    paymentMethod: payload.payment_method_id
  };
}

export function verifyWebhookSignature(secret: string, dataId: string, requestId: string | undefined, signature: string | undefined): boolean {
  if (!requestId || !signature || !/^[A-Za-z0-9_-]{1,100}$/.test(dataId)) return false;
  const parts = new Map(signature.split(",").map((part) => {
    const [key, value] = part.trim().split("=");
    return [key, value];
  }));
  const ts = parts.get("ts");
  const hash = parts.get("v1");
  if (!ts || !/^\d{10,13}$/.test(ts) || !hash || !/^[a-f0-9]{64}$/i.test(hash)) return false;
  const millis = ts.length === 10 ? Number(ts) * 1000 : Number(ts);
  if (Math.abs(Date.now() - millis) > 10 * 60_000) return false;
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest();
  return timingSafeEqual(expected, Buffer.from(hash, "hex"));
}

export async function createPixPayment(config: Config, input: { paymentId: string; email: string; cpf: string; name: string }): Promise<PixResult> {
  if (!config.MERCADO_PAGO_ACCESS_TOKEN) {
    if (!config.PAYMENTS_DEV_MODE || config.NODE_ENV === "production") throw new Error("Pagamento Pix ainda não configurado.");
    return { providerPaymentId: `demo_${input.paymentId}`, status: "PENDING" };
  }
  const nameParts = input.name.trim().split(/\s+/);
  const response = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST", signal: AbortSignal.timeout(15_000),
    headers: {
      authorization: `Bearer ${config.MERCADO_PAGO_ACCESS_TOKEN}`,
      "content-type": "application/json", "x-idempotency-key": input.paymentId
    },
    body: JSON.stringify({
      transaction_amount: 20,
      description: "Pacote Conexão Youtube — 20 créditos + 1 passe extra",
      payment_method_id: "pix", external_reference: input.paymentId,
      notification_url: `${config.API_PUBLIC_URL}/payments/webhooks/mercado-pago`,
      payer: {
        email: input.email, first_name: nameParts[0], last_name: nameParts.slice(1).join(" ") || nameParts[0],
        identification: { type: "CPF", number: input.cpf }
      }
    })
  });
  const payload = await response.json() as ProviderPayment;
  if (!response.ok || !payload.id) throw new Error("Não foi possível gerar o Pix.");
  const verified = confirmation(payload);
  if (verified.internalId !== input.paymentId || verified.amountCents !== 2000 || verified.currency !== "BRL" || verified.paymentMethod !== "pix") {
    throw new Error("O pagamento retornado não corresponde ao pacote solicitado.");
  }
  const data = payload.point_of_interaction?.transaction_data;
  return {
    providerPaymentId: verified.providerPaymentId, status: verified.status,
    qrCode: data?.qr_code, qrCodeBase64: data?.qr_code_base64, ticketUrl: data?.ticket_url
  };
}

export async function fetchMercadoPagoPayment(config: Config, providerPaymentId: string): Promise<PaymentConfirmation> {
  if (!config.MERCADO_PAGO_ACCESS_TOKEN) throw new Error("Mercado Pago não configurado.");
  if (!/^\d{1,30}$/.test(providerPaymentId)) throw new Error("Identificador de pagamento inválido.");
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${providerPaymentId}`, {
    signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${config.MERCADO_PAGO_ACCESS_TOKEN}` }
  });
  const payload = await response.json() as ProviderPayment;
  if (!response.ok || !payload.id) throw new Error("Falha ao confirmar o pagamento.");
  return confirmation(payload);
}
