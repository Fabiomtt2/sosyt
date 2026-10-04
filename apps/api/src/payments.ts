import type { Config } from "./config.js";

export type PixResult = {
  providerPaymentId: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  qrCode?: string;
  qrCodeBase64?: string;
  ticketUrl?: string;
};

function mapStatus(status?: string): PixResult["status"] {
  if (status === "approved") return "APPROVED";
  if (["rejected"].includes(status ?? "")) return "REJECTED";
  if (["cancelled", "refunded", "charged_back"].includes(status ?? "")) return "CANCELLED";
  return "PENDING";
}

export async function createPixPayment(
  config: Config,
  input: { paymentId: string; email: string; cpf: string; name: string }
): Promise<PixResult> {
  if (!config.MERCADO_PAGO_ACCESS_TOKEN) {
    if (!config.PAYMENTS_DEV_MODE) throw new Error("Pagamento Pix ainda não configurado.");
    return { providerPaymentId: `demo_${input.paymentId}`, status: "PENDING" };
  }

  const nameParts = input.name.trim().split(/\s+/);
  const response = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.MERCADO_PAGO_ACCESS_TOKEN}`,
      "content-type": "application/json",
      "x-idempotency-key": input.paymentId
    },
    body: JSON.stringify({
      transaction_amount: 20,
      description: "Pacote Conexão Youtube — 20 créditos + 1 passe extra",
      payment_method_id: "pix",
      external_reference: input.paymentId,
      notification_url: `${config.API_PUBLIC_URL}/payments/webhooks/mercado-pago`,
      payer: {
        email: input.email,
        first_name: nameParts[0],
        last_name: nameParts.slice(1).join(" ") || nameParts[0],
        identification: { type: "CPF", number: input.cpf }
      }
    })
  });
  const payload = (await response.json()) as {
    id?: number;
    status?: string;
    message?: string;
    point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string } };
  };
  if (!response.ok || !payload.id) throw new Error(payload.message ?? "Não foi possível gerar o Pix.");
  const data = payload.point_of_interaction?.transaction_data;
  return {
    providerPaymentId: String(payload.id),
    status: mapStatus(payload.status),
    qrCode: data?.qr_code,
    qrCodeBase64: data?.qr_code_base64,
    ticketUrl: data?.ticket_url
  };
}

export async function fetchMercadoPagoPayment(config: Config, providerPaymentId: string): Promise<{ internalId?: string; status: PixResult["status"] }> {
  if (!config.MERCADO_PAGO_ACCESS_TOKEN) throw new Error("Mercado Pago não configurado.");
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(providerPaymentId)}`, {
    headers: { authorization: `Bearer ${config.MERCADO_PAGO_ACCESS_TOKEN}` }
  });
  const payload = (await response.json()) as { external_reference?: string; status?: string; message?: string };
  if (!response.ok) throw new Error(payload.message ?? "Falha ao confirmar o pagamento.");
  return { internalId: payload.external_reference, status: mapStatus(payload.status) };
}

