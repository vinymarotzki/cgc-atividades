import { createClient } from "@libsql/client";

let client: ReturnType<typeof createClient> | null = null;

export function getDb() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (!url) {
      throw new Error("TURSO_DATABASE_URL is not defined");
    }

    client = createClient({
      url,
      authToken: authToken || undefined,
    });
  }
  return client;
}

async function runMigrations() {
  const db = getDb();

  // Grupos das Atividades do CGC. Guarda só o recorte de filtros repassado a
  // GET /provider/messages da API SASI. As colunas de filtro usam os mesmos
  // nomes dos query params do contrato. data_field_name/data_field_value não
  // são params da API: são o roteamento por campo da própria mensagem,
  // aplicado depois do mapeamento.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category_ids TEXT,
      team_name TEXT,
      channel_ids TEXT,
      app_ids TEXT,
      data_field_name TEXT,
      data_field_value TEXT,
      created_by_id TEXT,
      created_by_name TEXT,
      created_at TEXT NOT NULL
    )
  `);

  for (const column of ["data_field_name", "data_field_value"]) {
    try {
      await db.execute(`ALTER TABLE cgc_groups ADD COLUMN ${column} TEXT`);
    } catch {
      // Coluna já existe em schema mais antigo, ignora.
    }
  }

  // Status das Atividades do CGC. O token de provider da API SASI só tem
  // escopo READ_MESSAGES, então o status é acompanhado aqui. A chave é o id
  // da mensagem na API SASI.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_activity_status (
      message_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      group_id TEXT,
      user_id TEXT,
      user_name TEXT,
      updated_at TEXT NOT NULL
    )
  `);

  try {
    await db.execute(`ALTER TABLE cgc_activity_status ADD COLUMN group_id TEXT`);
  } catch {
    // Coluna já existe em schema mais antigo, ignora.
  }

  // Histórico das Atividades do CGC. Denormalizado de propósito: a mensagem
  // original vive na API SASI e pode mudar ou sair da janela de consulta,
  // então cada entrada guarda o retrato do que foi alterado.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_history (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      group_id TEXT,
      group_name TEXT,
      description TEXT,
      priority TEXT,
      deadline TEXT,
      old_status TEXT,
      new_status TEXT,
      observation TEXT,
      user_id TEXT,
      user_name TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_cgc_history_created ON cgc_history (created_at DESC)`
  );

  // Comentários das Atividades do CGC.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_observations (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      text TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_cgc_observations_message ON cgc_observations (message_id)`
  );

  // Total "solicitado" por grupo, sincronizado da API SASI (ver
  // group-totals.ts). last_message_id é a marca d'água: só mensagens mais
  // novas que ela entram na próxima sincronização.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_group_totals (
      group_id TEXT PRIMARY KEY,
      total INTEGER NOT NULL DEFAULT 0,
      last_message_id INTEGER,
      updated_at TEXT NOT NULL
    )
  `);

  // Cache local das atividades do CGC já mapeadas (ver message-cache.ts).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_message_cache (
      message_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      cached_at TEXT NOT NULL
    )
  `);

  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_cgc_message_cache_group ON cgc_message_cache (group_id)`
  );

  // Marca d'água + TTL da sincronização do cache acima. Tabela própria (em
  // vez de reusar cgc_group_totals) porque a contagem "solicitada" da tela
  // de seleção e o cache de atividades têm cadências diferentes.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_message_cache_sync (
      group_id TEXT PRIMARY KEY,
      last_message_id INTEGER,
      synced_at TEXT NOT NULL
    )
  `);

  // Registro bruto de cada chamada recebida em /api/cgc/webhook — o formato
  // que o SASI manda não é documentado, então isso serve tanto de auditoria
  // quanto de forma de descobrir campos úteis (ex.: um "authorization" no
  // corpo) sem precisar adivinhar. Guarda tudo que a rota recebeu, autorizado
  // ou não (o rejeitado tem body_json nulo, só method/headers).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_webhook_log (
      id TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      authorized INTEGER NOT NULL,
      headers_json TEXT NOT NULL,
      query_json TEXT NOT NULL,
      body_json TEXT,
      body_raw TEXT,
      received_at TEXT NOT NULL
    )
  `);

  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_cgc_webhook_log_received ON cgc_webhook_log (received_at DESC)`
  );
}

let dbReadyPromise: Promise<void> | null = null;

export function initDb(): Promise<void> {
  if (!dbReadyPromise) {
    dbReadyPromise = runMigrations().catch((error) => {
      dbReadyPromise = null;
      throw error;
    });
  }
  return dbReadyPromise;
}
