import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify } from "node:crypto";
import type { PaymentProvider, PaymentRuntimeConfig } from "./integrations.js";

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

export type PaymentProductCode = "COINS_LAUNCH" | "PASS_SINGLE";
export const PAYMENT_PRODUCTS: Record<PaymentProductCode,{ amountCents:number; creditsMillis:number; extraPasses:number; description:string; itemReference:string }> = {
  COINS_LAUNCH:{amountCents:2000,creditsMillis:10000,extraPasses:1,description:"Promoção de lançamento — 10 moedas + 1 passe bônus",itemReference:"coins-launch-10"},
  PASS_SINGLE:{amountCents:2000,creditsMillis:0,extraPasses:1,description:"Passe SOS YouTuber — 1 passe",itemReference:"pass-single"}
};

type MercadoPagoPayment = {
  id?: number | string;
  external_reference?: string;
  transaction_amount?: number;
  currency_id?: string;
  payment_method_id?: string;
  status?: string;
  point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string } };
};
type AsaasPayment = {
  id?: string;
  externalReference?: string;
  value?: number;
  status?: string;
  billingType?: string;
  invoiceUrl?: string;
};
type PagBankOrder = {
  id?: string;
  reference_id?: string;
  charges?: Array<{
    id?: string;
    status?: string;
    amount?: { value?: number; currency?: string };
    payment_method?: { type?: string };
    qr_code?: { id?: string; text?: string };
    links?: Array<{ rel?: string; href?: string }>;
  }>;
};

function mapMercadoPagoStatus(status?: string): PaymentStatus {
  if (status === "approved") return "APPROVED";
  if (status === "rejected") return "REJECTED";
  if (["cancelled","refunded","charged_back"].includes(status ?? "")) return "CANCELLED";
  return "PENDING";
}
function mapAsaasStatus(status?: string): PaymentStatus {
  if (["RECEIVED","RECEIVED_IN_CASH"].includes(status ?? "")) return "APPROVED";
  if (["REFUNDED","REFUND_REQUESTED","CHARGEBACK_REQUESTED","CHARGEBACK_DISPUTE","AWAITING_CHARGEBACK_REVERSAL"].includes(status ?? "")) return "CANCELLED";
  return "PENDING";
}
function mapPagBankStatus(status?: string): PaymentStatus {
  if (status === "PAID") return "APPROVED";
  if (status === "DECLINED") return "REJECTED";
  if (["CANCELED","CANCELLED"].includes(status ?? "")) return "CANCELLED";
  return "PENDING";
}

function mercadoPagoConfirmation(payload: MercadoPagoPayment): PaymentConfirmation {
  const cents=(payload.transaction_amount ?? NaN)*100;
  return {
    providerPaymentId:String(payload.id ?? ""),
    internalId:payload.external_reference,
    status:mapMercadoPagoStatus(payload.status),
    amountCents:Number.isFinite(cents) && Math.abs(cents-Math.round(cents))<1e-7 ? Math.round(cents) : -1,
    currency:payload.currency_id,
    paymentMethod:payload.payment_method_id
  };
}
function asaasConfirmation(payload: AsaasPayment): PaymentConfirmation {
  const cents=(payload.value ?? NaN)*100;
  return {
    providerPaymentId:String(payload.id ?? ""),
    internalId:payload.externalReference,
    status:mapAsaasStatus(payload.status),
    amountCents:Number.isFinite(cents) && Math.abs(cents-Math.round(cents))<1e-7 ? Math.round(cents) : -1,
    currency:"BRL",
    paymentMethod:(payload.billingType ?? "").toLowerCase()
  };
}
function pagBankConfirmation(payload: PagBankOrder): PaymentConfirmation {
  const charge=payload.charges?.[0];
  return {
    providerPaymentId:String(payload.id ?? ""),
    internalId:payload.reference_id,
    status:mapPagBankStatus(charge?.status),
    amountCents:Number.isInteger(charge?.amount?.value) ? charge!.amount!.value! : -1,
    currency:charge?.amount?.currency,
    paymentMethod:(charge?.payment_method?.type ?? "PIX").toLowerCase()
  };
}

function baseUrl(runtime: PaymentRuntimeConfig, provider: Exclude<PaymentProvider,"DISABLED">) {
  if (provider==="MERCADO_PAGO") return "https://api.mercadopago.com";
  if (provider==="ASAAS") return runtime.environment==="PRODUCTION" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
  return runtime.environment==="PRODUCTION" ? "https://api.pagseguro.com" : "https://sandbox.api.pagseguro.com";
}
function jsonHeaders(extra: Record<string,string>={}) {
  return { accept:"application/json","content-type":"application/json",...extra };
}

export function verifyWebhookSignature(secret: string, dataId: string, requestId: string | undefined, signature: string | undefined): boolean {
  if (!requestId || !signature || !/^[A-Za-z0-9_-]{1,100}$/.test(dataId)) return false;
  const parts=new Map(signature.split(",").map((part)=>{ const [key,value]=part.trim().split("="); return [key,value]; }));
  const ts=parts.get("ts"), hash=parts.get("v1");
  if (!ts || !/^\d{10,13}$/.test(ts) || !hash || !/^[a-f0-9]{64}$/i.test(hash)) return false;
  const millis=ts.length===10 ? Number(ts)*1000 : Number(ts);
  if (Math.abs(Date.now()-millis)>10*60_000) return false;
  const manifest=`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const expected=createHmac("sha256",secret).update(manifest).digest();
  return timingSafeEqual(expected,Buffer.from(hash,"hex"));
}
export function verifyAsaasWebhookToken(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  const a=Buffer.from(expected), b=Buffer.from(actual);
  return a.length===b.length && timingSafeEqual(a,b);
}
export function verifyPagBankWebhookSignature(rawBody: Buffer, signatureHeader: string | string[] | undefined, publicKeyBase64: string): boolean {
  const signatures=(Array.isArray(signatureHeader) ? signatureHeader : (signatureHeader ?? "").split(",")).map((value)=>value.trim()).filter(Boolean);
  if (!signatures.length || !publicKeyBase64) return false;
  const lines=publicKeyBase64.match(/.{1,64}/g) ?? [];
  const key=createPublicKey(["-----BEGIN PUBLIC KEY-----",...lines,"-----END PUBLIC KEY-----"].join("\n"));
  return signatures.some((signature)=>{
    try { return cryptoVerify("sha256",rawBody,key,Buffer.from(signature,"base64")); }
    catch { return false; }
  });
}
export async function fetchPagBankWebhookPublicKey(runtime: PaymentRuntimeConfig): Promise<string> {
  if (!runtime.pagBankToken) throw new Error("PagBank não configurado.");
  const base=baseUrl(runtime,"PAGBANK");
  const headers={ authorization:`Bearer ${runtime.pagBankToken}`,accept:"application/json" };
  for (const endpoint of [`${base}/public-keys/webhook`,`${base}/public-keys?type=webhook`]) {
    const response=await fetch(endpoint,{signal:AbortSignal.timeout(15_000),headers});
    const payload=await response.json().catch(()=>({})) as { public_key?: string };
    if (response.ok && payload.public_key) return payload.public_key;
  }
  throw new Error("Não foi possível obter a chave pública de webhook do PagBank.");
}

export async function ensureAsaasWebhook(runtime: PaymentRuntimeConfig): Promise<{ id:string; created:boolean }> {
  if (!runtime.asaasApiKey || !runtime.asaasWebhookToken) throw new Error("Asaas ainda não possui API key e token de webhook configurados.");
  const base=baseUrl(runtime,"ASAAS");
  const headers=jsonHeaders({access_token:runtime.asaasApiKey,"user-agent":"SOS-YouTuber/0.1.0"});
  const url=`${runtime.apiPublicUrl}/payments/webhooks/asaas`;
  const listResponse=await fetch(`${base}/webhooks?offset=0&limit=100`,{signal:AbortSignal.timeout(15_000),headers});
  const listed=await listResponse.json().catch(()=>({})) as { data?:Array<{id?:string;url?:string}> };
  if (!listResponse.ok) throw new Error("Não foi possível consultar os webhooks do Asaas.");
  const existing=listed.data?.find((item)=>item.url===url);
  const body={
    name:"SOS YouTuber · pagamentos",
    url,
    sendType:"SEQUENTIALLY",
    enabled:true,
    interrupted:false,
    authToken:runtime.asaasWebhookToken,
    events:["PAYMENT_RECEIVED","PAYMENT_REFUNDED"]
  };
  const response=await fetch(existing?.id ? `${base}/webhooks/${encodeURIComponent(existing.id)}` : `${base}/webhooks`,{
    method:existing?.id ? "PUT" : "POST",
    signal:AbortSignal.timeout(15_000),
    headers,
    body:JSON.stringify(body)
  });
  const payload=await response.json().catch(()=>({})) as { id?:string };
  if (!response.ok || !payload.id) throw new Error("As credenciais foram salvas, mas não foi possível configurar o webhook do Asaas.");
  return {id:payload.id,created:!existing?.id};
}

async function createMercadoPagoPix(runtime: PaymentRuntimeConfig, input: { paymentId:string; email:string; cpf:string; name:string; productCode:PaymentProductCode }): Promise<PixResult> {
  if (!runtime.mercadoPagoAccessToken) throw new Error("Mercado Pago ainda não configurado.");
  const nameParts=input.name.trim().split(/\s+/);
  const product=PAYMENT_PRODUCTS[input.productCode];
  const response=await fetch(`${baseUrl(runtime,"MERCADO_PAGO")}/v1/payments`,{
    method:"POST",signal:AbortSignal.timeout(15_000),
    headers:jsonHeaders({authorization:`Bearer ${runtime.mercadoPagoAccessToken}`,"x-idempotency-key":input.paymentId}),
    body:JSON.stringify({
      transaction_amount:product.amountCents/100,
      description:product.description,
      payment_method_id:"pix",
      external_reference:input.paymentId,
      notification_url:`${runtime.apiPublicUrl}/payments/webhooks/mercado-pago`,
      payer:{email:input.email,first_name:nameParts[0],last_name:nameParts.slice(1).join(" ")||nameParts[0],identification:{type:"CPF",number:input.cpf}}
    })
  });
  const payload=await response.json() as MercadoPagoPayment;
  if (!response.ok || !payload.id) throw new Error("Não foi possível gerar o Pix pelo Mercado Pago.");
  const verified=mercadoPagoConfirmation(payload);
  assertPackage(verified,input.paymentId);
  const data=payload.point_of_interaction?.transaction_data;
  return {providerPaymentId:verified.providerPaymentId,status:verified.status,qrCode:data?.qr_code,qrCodeBase64:data?.qr_code_base64,ticketUrl:data?.ticket_url};
}

async function asaasHeaders(runtime: PaymentRuntimeConfig) {
  if (!runtime.asaasApiKey) throw new Error("Asaas ainda não configurado.");
  return jsonHeaders({access_token:runtime.asaasApiKey,"user-agent":"SOS-YouTuber/0.1.0"});
}
async function findOrCreateAsaasCustomer(runtime: PaymentRuntimeConfig, input: { paymentId:string; email:string; cpf:string; name:string }) {
  const headers=await asaasHeaders(runtime), base=baseUrl(runtime,"ASAAS");
  const lookup=await fetch(`${base}/customers?cpfCnpj=${encodeURIComponent(input.cpf)}&limit=1`,{signal:AbortSignal.timeout(15_000),headers});
  const found=await lookup.json().catch(()=>({})) as { data?: Array<{id?:string}> };
  if (lookup.ok && found.data?.[0]?.id) return found.data[0].id;
  const created=await fetch(`${base}/customers`,{
    method:"POST",signal:AbortSignal.timeout(15_000),headers,
    body:JSON.stringify({name:input.name,cpfCnpj:input.cpf,email:input.email,externalReference:`sosyt:${input.cpf}`,notificationDisabled:true})
  });
  const payload=await created.json().catch(()=>({})) as {id?:string};
  if (!created.ok || !payload.id) throw new Error("Não foi possível cadastrar o pagador no Asaas.");
  return payload.id;
}
async function createAsaasPix(runtime: PaymentRuntimeConfig, input: { paymentId:string; email:string; cpf:string; name:string; productCode:PaymentProductCode }): Promise<PixResult> {
  const headers=await asaasHeaders(runtime), base=baseUrl(runtime,"ASAAS");
  const product=PAYMENT_PRODUCTS[input.productCode];
  const customer=await findOrCreateAsaasCustomer(runtime,input);
  const dueDate=new Date(Date.now()+24*60*60_000).toISOString().slice(0,10);
  const created=await fetch(`${base}/payments`,{
    method:"POST",signal:AbortSignal.timeout(15_000),headers,
    body:JSON.stringify({customer,billingType:"PIX",value:product.amountCents/100,dueDate,description:product.description,externalReference:input.paymentId})
  });
  const payment=await created.json().catch(()=>({})) as AsaasPayment;
  if (!created.ok || !payment.id) throw new Error("Não foi possível gerar a cobrança Pix no Asaas.");
  const verified=asaasConfirmation(payment);
  assertPackage(verified,input.paymentId);
  const qrResponse=await fetch(`${base}/payments/${encodeURIComponent(payment.id)}/pixQrCode`,{signal:AbortSignal.timeout(15_000),headers});
  const qr=await qrResponse.json().catch(()=>({})) as { encodedImage?:string; payload?:string };
  if (!qrResponse.ok) throw new Error("Cobrança criada, mas o Asaas não retornou o QR Code Pix.");
  return {providerPaymentId:payment.id,status:verified.status,qrCode:qr.payload,qrCodeBase64:qr.encodedImage,ticketUrl:payment.invoiceUrl};
}

async function createPagBankPix(runtime: PaymentRuntimeConfig, input: { paymentId:string; email:string; cpf:string; name:string; productCode:PaymentProductCode }): Promise<PixResult> {
  if (!runtime.pagBankToken) throw new Error("PagBank ainda não configurado.");
  const product=PAYMENT_PRODUCTS[input.productCode];
  const expires=new Date(Date.now()+60*60_000).toISOString();
  const response=await fetch(`${baseUrl(runtime,"PAGBANK")}/orders`,{
    method:"POST",signal:AbortSignal.timeout(15_000),
    headers:jsonHeaders({authorization:`Bearer ${runtime.pagBankToken}`}),
    body:JSON.stringify({
      reference_id:input.paymentId,
      customer:{name:input.name,email:input.email,tax_id:input.cpf},
      items:[{reference_id:product.itemReference,name:product.description,quantity:1,unit_amount:product.amountCents}],
      notification_urls:[`${runtime.apiPublicUrl}/payments/webhooks/pagbank`],
      charges:[{
        reference_id:input.paymentId,
        description:product.description,
        amount:{value:product.amountCents,currency:"BRL"},
        payment_method:{type:"PIX",pix:{expiration_date:expires}}
      }]
    })
  });
  const order=await response.json().catch(()=>({})) as PagBankOrder;
  if (!response.ok || !order.id) throw new Error("Não foi possível gerar o Pix pelo PagBank.");
  const verified=pagBankConfirmation(order);
  assertPackage(verified,input.paymentId);
  const charge=order.charges?.[0];
  const ticketUrl=charge?.links?.find((item)=>["QRCODE.PNG","PAY","SELF"].includes(item.rel ?? ""))?.href;
  return {providerPaymentId:order.id,status:verified.status,qrCode:charge?.qr_code?.text,ticketUrl};
}

function assertPackage(result: PaymentConfirmation, paymentId: string) {
  if (result.internalId!==paymentId || result.amountCents!==2000 || result.currency!=="BRL" || result.paymentMethod!=="pix") {
    throw new Error("O pagamento retornado não corresponde ao pacote solicitado.");
  }
}

export async function createPixPayment(runtime: PaymentRuntimeConfig, input: { paymentId:string; email:string; cpf:string; name:string; productCode:PaymentProductCode }): Promise<PixResult> {
  if (runtime.provider==="MERCADO_PAGO") return createMercadoPagoPix(runtime,input);
  if (runtime.provider==="ASAAS") return createAsaasPix(runtime,input);
  if (runtime.provider==="PAGBANK") return createPagBankPix(runtime,input);
  throw new Error("Pagamento Pix ainda não configurado pelo Owner.");
}

export async function fetchProviderPayment(runtime: PaymentRuntimeConfig, provider: string, providerPaymentId: string): Promise<PaymentConfirmation> {
  if (provider==="MERCADO_PAGO") {
    if (!runtime.mercadoPagoAccessToken) throw new Error("Mercado Pago não configurado.");
    if (!/^\d{1,30}$/.test(providerPaymentId)) throw new Error("Identificador de pagamento inválido.");
    const response=await fetch(`${baseUrl(runtime,"MERCADO_PAGO")}/v1/payments/${providerPaymentId}`,{
      signal:AbortSignal.timeout(15_000),headers:{authorization:`Bearer ${runtime.mercadoPagoAccessToken}`}
    });
    const payload=await response.json() as MercadoPagoPayment;
    if (!response.ok || !payload.id) throw new Error("Falha ao confirmar o pagamento no Mercado Pago.");
    return mercadoPagoConfirmation(payload);
  }
  if (provider==="ASAAS") {
    const headers=await asaasHeaders(runtime);
    const response=await fetch(`${baseUrl(runtime,"ASAAS")}/payments/${encodeURIComponent(providerPaymentId)}`,{signal:AbortSignal.timeout(15_000),headers});
    const payload=await response.json().catch(()=>({})) as AsaasPayment;
    if (!response.ok || !payload.id) throw new Error("Falha ao confirmar o pagamento no Asaas.");
    return asaasConfirmation(payload);
  }
  if (provider==="PAGBANK") {
    if (!runtime.pagBankToken) throw new Error("PagBank não configurado.");
    const response=await fetch(`${baseUrl(runtime,"PAGBANK")}/orders/${encodeURIComponent(providerPaymentId)}`,{
      signal:AbortSignal.timeout(15_000),headers:{authorization:`Bearer ${runtime.pagBankToken}`,accept:"application/json"}
    });
    const payload=await response.json().catch(()=>({})) as PagBankOrder;
    if (!response.ok || !payload.id) throw new Error("Falha ao confirmar o pagamento no PagBank.");
    return pagBankConfirmation(payload);
  }
  throw new Error("Provedor de pagamento não suportado.");
}
