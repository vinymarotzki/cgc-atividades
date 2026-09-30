/**
 * Recebe o webhook configurado manualmente no painel do SASI (admin.sasi.io)
 * pro canal 33397 — a API pública (api.sasi.io) não documenta um endpoint pra
 * registrar essa URL, então o cadastro em si é feito fora do código, direto
 * no painel, apontando pra esta rota.
 *
 * O formato do payload não é documentado, mas o evento "io.sasi.message" traz
 * a mensagem inteira em `data` (mesmo formato do `raw` da API). Os dois canais
 * são lidos direto desse corpo, porque ambos chegam por um provider SASI do
 * tipo "webhook" que não aparece em GET /provider/messages da PAT token:
 * - IDR (canal 36602) sempre foi assim (ver handleIdrChannelMessage /
 *   idr-store.ts);
 * - Atividades (canal 33397) passou a ser a partir de 02/09/2026, quando o
 *   canal deixou de entregar pro provider da PAT (1415) e ficou só no do
 *   webhook (1463) — ver ingestWebhookMessage em message-cache.ts.
 * Depois disso a rota ainda chama syncAllGroups (mesma função do cron), que
 * cobre o caso de o provider da PAT voltar a receber o canal.
 *
 * Segredo separado do cron (CGC_WEBHOOK_SECRET, não CGC_CRON_SECRET): a URL
 * do webhook fica cadastrada num painel de terceiro fora do nosso controle,
 * então convém poder trocar essa credencial sem mexer no GitHub Actions.
 * Aceita o secret tanto no header quanto na query string porque não dá pra
 * saber de antemão se o painel do SASI permite configurar header customizado
 * — uma URL com `?secret=` sempre funciona, mesmo no campo mais simples
 * "URL de destino".
 *
 * Aceita GET além de POST: alguns provedores fazem uma checagem (handshake)
 * na própria URL antes de aceitar o cadastro do webhook, e essa checagem às
 * vezes é um GET simples.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getDb, initDb } from "@/lib/db";
import { IDR_CHANNEL_ID } from "@/lib/cgc/idr-client";
import { mapMessageToIdrRecord } from "@/lib/cgc/idr-mapper";
import { storeIdrRecord } from "@/lib/cgc/idr-store";
import { ingestWebhookMessage, syncAllGroups } from "@/lib/cgc/message-cache";
import { resolveSasiToken } from "@/lib/sasi-api/client";
import type { SasiMessageRaw } from "@/lib/sasi-api/types";

export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CGC_WEBHOOK_SECRET?.trim();
  if (!secret) return false;

  const header = req.headers.get("x-webhook-secret")?.trim();
  const query = req.nextUrl.searchParams.get("secret")?.trim();
  return header === secret || query === secret;
}

/**
 * Prefixos de header que são artefato da infraestrutura da própria Vercel
 * (proxy interno, OIDC, cache), não informação enviada pelo SASI — incluem
 * tokens sensíveis da plataforma (ex. x-vercel-oidc-token) que não fazem
 * sentido parar gravados no nosso banco.
 */
const INFRA_HEADER_PREFIXES = ["x-vercel-", "x-real-ip", "x-forwarded-", "forwarded"];

function isInfraHeader(name: string): boolean {
  return INFRA_HEADER_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * Nomes de campo (chave de objeto, comparação case-insensitive) que carregam
 * credencial — vistos na prática no payload real do SASI: `data.accessToken`
 * é um JWT quase permanente com escopo `providers:notify:all`, e
 * `deliveryCallback.headers.Authorization` é outro Bearer (de escopo
 * diferente, pro callback de status). Mascarados antes de gravar: o
 * cgc_webhook_log existe pra auditoria/descoberta de formato, não pra virar
 * um segundo cofre de credenciais em texto puro.
 */
const SENSITIVE_KEYS = new Set([
  "accesstoken",
  "authorization",
  "secret",
  // Dados pessoais do remetente (telefone, e-mail, data de nascimento) —
  // o formato do payload já é conhecido, não precisam ficar no log.
  "profilefields",
  "profileprops",
  "customprops",
]);

/**
 * `config.callbackUrl` (e qualquer outra URL ecoada pelo SASI) carrega o
 * próprio `?secret=` do webhook em texto puro — a chave não é sensível, o
 * valor da string é.
 */
function redactSecretInText(text: string): string {
  return text.replace(/([?&]secret=)[^&\s"]*/gi, "$1[REDACTED]");
}

function redactSensitive(value: unknown): unknown {
  if (typeof value === "string") return redactSecretInText(value);
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : redactSensitive(val);
    }
    return out;
  }
  return value;
}

/**
 * Grava a chamada crua (headers relevantes, query, corpo — com credenciais
 * mascaradas) em cgc_webhook_log antes de qualquer outra coisa — o formato
 * que o SASI manda não é documentado, então isso é o jeito de descobrir na
 * prática o que vem aí sem precisar adivinhar. Best-effort: nunca derruba o
 * recebimento do webhook.
 */
async function logWebhookCall(req: NextRequest, authorized: boolean, bodyRaw: string | null) {
  try {
    await initDb();
    const db = getDb();

    const headers = redactSensitive(
      Object.fromEntries(
        Array.from(req.headers.entries()).filter(([key]) => !isInfraHeader(key))
      )
    ) as Record<string, string>;

    let bodyJson: string | null = null;
    if (bodyRaw) {
      try {
        bodyJson = JSON.stringify(redactSensitive(JSON.parse(bodyRaw)));
      } catch {
        // Corpo não é JSON — fica só em body_raw.
      }
    }

    await db.execute({
      sql: `INSERT INTO cgc_webhook_log
              (id, method, authorized, headers_json, query_json, body_json, body_raw, received_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        uuidv4(),
        req.method,
        authorized ? 1 : 0,
        JSON.stringify(headers),
        JSON.stringify(redactSensitive(Object.fromEntries(req.nextUrl.searchParams))),
        bodyJson,
        bodyJson || !bodyRaw ? null : redactSecretInText(bodyRaw),
        new Date().toISOString(),
      ],
    });
  } catch (error) {
    console.error(`[cgc-webhook-log] falha ao gravar chamada recebida: ${error}`);
  }
}

/**
 * Extrai a mensagem de um evento "io.sasi.message". Qualquer outro tipo de
 * evento (io.sasi.app, io.sasi.profile) ou corpo que não seja JSON vira null.
 */
function parseMessageEvent(bodyRaw: string): SasiMessageRaw | null {
  let parsed: { type?: string; data?: SasiMessageRaw };
  try {
    parsed = JSON.parse(bodyRaw);
  } catch {
    console.warn("[cgc-webhook] corpo não é JSON, ignorando");
    return null;
  }

  console.log(`[cgc-webhook] evento type=${parsed.type} channel=${parsed.data?.channel?.id} id=${parsed.data?.id}`);

  if (parsed.type !== "io.sasi.message") return null;
  return parsed.data ?? null;
}

/**
 * Canal 36602 (IDR) chega só aqui dentro — provider SASI separado (tipo
 * "webhook"), não aparece em GET /provider/messages da PAT token normal, tem
 * que ser lido do corpo do próprio evento "io.sasi.message". Grava direto no
 * Turso do cgc-idr (ver idr-store.ts). Best-effort: nunca derruba o webhook.
 */
async function handleIdrChannelMessage(data: SasiMessageRaw): Promise<void> {
  if (String(data.channel?.id ?? "") !== IDR_CHANNEL_ID) return;

  try {
    const record = mapMessageToIdrRecord({ id: data.id, raw: data });
    if (record) {
      await storeIdrRecord(record);
      console.log("[cgc-webhook-idr] snapshot de IDR gravado");
    } else {
      console.warn("[cgc-webhook-idr] mensagem do canal IDR não gerou registro");
    }
  } catch (error) {
    console.error(`[cgc-webhook-idr] falha ao gravar snapshot de IDR: ${error}`);
  }
}

/**
 * Atividades (canal 33397): grava a mensagem do corpo direto no cache dos
 * grupos em que ela casa. Best-effort como o IDR — uma falha aqui ainda deixa
 * o syncAllGroups logo depois tentar pelo caminho da API.
 */
async function handleCgcChannelMessage(data: SasiMessageRaw): Promise<string[]> {
  try {
    const groups = await ingestWebhookMessage(data);
    if (groups.length > 0) {
      console.log(`[cgc-webhook-cgc] mensagem ${data.id} gravada em: ${groups.join(", ")}`);
    } else if (String(data.channel?.id ?? "") !== IDR_CHANNEL_ID) {
      console.warn(`[cgc-webhook-cgc] mensagem ${data.id} (canal ${data.channel?.id}) não casou com nenhum grupo`);
    }
    return groups;
  } catch (error) {
    console.error(`[cgc-webhook-cgc] falha ao gravar mensagem ${data.id}: ${error}`);
    return [];
  }
}

async function handle(req: NextRequest) {
  const bodyRaw = await req.text().catch(() => null);
  const authorized = isAuthorized(req);
  console.log(`[cgc-webhook] ${req.method} authorized=${authorized} bytes=${bodyRaw?.length ?? 0}`);

  await logWebhookCall(req, authorized, bodyRaw || null);

  if (!authorized) {
    console.warn("[cgc-webhook] 401 não autorizado");
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const message = bodyRaw ? parseMessageEvent(bodyRaw) : null;
  let ingestedInto: string[] = [];
  if (message) {
    await handleIdrChannelMessage(message);
    ingestedInto = await handleCgcChannelMessage(message);
  }

  const token = resolveSasiToken(null);
  if (!token) {
    console.error("[cgc-webhook] SASI_API_TOKEN não configurado");
    return NextResponse.json({ error: "SASI_API_TOKEN não configurado." }, { status: 500 });
  }

  const result = await syncAllGroups(token);
  console.log("[cgc-webhook] sync concluído", JSON.stringify(result));
  return NextResponse.json({ received: true, ingestedInto, ...result });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
