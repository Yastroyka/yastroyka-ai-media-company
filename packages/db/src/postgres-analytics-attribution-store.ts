import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:@+-]{1,256}$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;

export const ANALYTICS_ATTRIBUTION_MODEL = 'LAST_TRACKED_CLICK' as const;
export const ANALYTICS_CAUSALITY = 'NON_CAUSAL_OBSERVED_ATTRIBUTION' as const;

export interface CreateAnalyticsSessionInput {
  readonly [key: string]: unknown;
  readonly sessionId: string;
  readonly startedAt: string;
}

export interface RecordAnalyticsClickInput {
  readonly clickId: string;
  readonly sessionId: string;
  readonly campaignId: string;
  readonly publicationId: string;
  readonly productId: string;
  readonly offerId: string;
  readonly clickedAt: string;
}

export interface RecordAnalyticsOrderLineInput {
  readonly [key: string]: unknown;
  readonly orderLineId: string;
  readonly sessionId: string;
  readonly externalOrderId: string;
  readonly externalOrderLineId: string;
  readonly productId: string;
  readonly offerId: string;
  readonly gmvMinor: number;
  readonly currency: string;
  readonly orderedAt: string;
}

export interface AnalyticsAttributionAssignment {
  readonly orderLineId: string;
  readonly clickId: string;
  readonly attributionModel: typeof ANALYTICS_ATTRIBUTION_MODEL;
  readonly causality: typeof ANALYTICS_CAUSALITY;
}

export interface AnalyticsAttributionPath {
  readonly productId: string;
  readonly offerId: string;
  readonly masterContentId: string;
  readonly campaignId: string;
  readonly publicationId: string;
  readonly clickId: string;
  readonly sessionId: string;
  readonly orderLineId: string;
  readonly externalOrderId: string;
  readonly externalOrderLineId: string;
  readonly gmvMinor: string;
  readonly currency: string;
  readonly clickedAt: string;
  readonly orderedAt: string;
  readonly attributionModel: typeof ANALYTICS_ATTRIBUTION_MODEL;
  readonly causality: typeof ANALYTICS_CAUSALITY;
}

export interface AnalyticsPublicationAttributionReport {
  readonly publicationId: string;
  readonly causality: typeof ANALYTICS_CAUSALITY;
  readonly paths: readonly AnalyticsAttributionPath[];
  readonly gmvByCurrency: Readonly<Record<string, string>>;
}

interface SessionRow {
  readonly id: string;
  readonly started_at: Date | string;
}

interface PublicationRow {
  readonly master_content_id: string;
  readonly status: string;
}

interface ClickRow {
  readonly id: string;
  readonly session_id: string;
  readonly campaign_id: string;
  readonly publication_id: string;
  readonly master_content_id: string;
  readonly product_id: string;
  readonly offer_id: string;
  readonly clicked_at: Date | string;
}

interface OrderLineRow {
  readonly id: string;
  readonly session_id: string;
  readonly external_order_id: string;
  readonly external_order_line_id: string;
  readonly product_id: string;
  readonly offer_id: string;
  readonly gmv_minor: string;
  readonly currency: string;
  readonly ordered_at: Date | string;
}

interface AttributionRow {
  readonly order_line_id: string;
  readonly click_id: string;
  readonly attribution_model: string;
  readonly causality_claim: boolean;
}

interface PathRow {
  readonly product_id: string;
  readonly offer_id: string;
  readonly master_content_id: string;
  readonly campaign_id: string;
  readonly publication_id: string;
  readonly click_id: string;
  readonly session_id: string;
  readonly order_line_id: string;
  readonly external_order_id: string;
  readonly external_order_line_id: string;
  readonly gmv_minor: string;
  readonly currency: string;
  readonly clicked_at: Date | string;
  readonly ordered_at: Date | string;
  readonly attribution_model: string;
  readonly causality_claim: boolean;
}

export class AnalyticsAttributionConflictError extends Error {
  constructor() {
    super('Analytics attribution state conflict.');
    this.name = 'AnalyticsAttributionConflictError';
  }
}

export class AnalyticsAttributionNotFoundError extends Error {
  constructor() {
    super('No eligible tracked click exists for this order line.');
    this.name = 'AnalyticsAttributionNotFoundError';
  }
}

function requireUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${field} must be a UUID.`);
  }
}

function requireSafeIdentifier(value: string, field: string): void {
  if (!SAFE_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${field} must be a safe identifier no longer than 256 characters.`);
  }
}

function requireExactIsoTimestamp(value: string, field: string): void {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${field} must be an exact ISO-8601 UTC timestamp.`);
  }
}

function normalizeDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AnalyticsAttributionConflictError();
  }
  return date.toISOString();
}

function requireGmvMinor(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('gmvMinor must be a non-negative safe integer.');
  }
}

function requireCurrency(value: string): void {
  if (!CURRENCY_PATTERN.test(value)) {
    throw new Error('currency must be a three-letter uppercase code.');
  }
}

function assertSessionMatches(row: SessionRow, input: CreateAnalyticsSessionInput): void {
  if (row.id !== input.sessionId || normalizeDate(row.started_at) !== input.startedAt) {
    throw new AnalyticsAttributionConflictError();
  }
}

function assertClickMatches(
  row: ClickRow,
  input: RecordAnalyticsClickInput,
  masterContentId: string,
): void {
  if (
    row.id !== input.clickId ||
    row.session_id !== input.sessionId ||
    row.campaign_id !== input.campaignId ||
    row.publication_id !== input.publicationId ||
    row.master_content_id !== masterContentId ||
    row.product_id !== input.productId ||
    row.offer_id !== input.offerId ||
    normalizeDate(row.clicked_at) !== input.clickedAt
  ) {
    throw new AnalyticsAttributionConflictError();
  }
}

function assertOrderLineMatches(row: OrderLineRow, input: RecordAnalyticsOrderLineInput): void {
  if (
    row.id !== input.orderLineId ||
    row.session_id !== input.sessionId ||
    row.external_order_id !== input.externalOrderId ||
    row.external_order_line_id !== input.externalOrderLineId ||
    row.product_id !== input.productId ||
    row.offer_id !== input.offerId ||
    row.gmv_minor !== String(input.gmvMinor) ||
    row.currency !== input.currency ||
    normalizeDate(row.ordered_at) !== input.orderedAt
  ) {
    throw new AnalyticsAttributionConflictError();
  }
}

async function requireSession(
  database: Sequelize,
  transaction: Transaction,
  sessionId: string,
): Promise<void> {
  const rows = await database.query<{ readonly id: string }>(
    `SELECT id FROM analytics_sessions WHERE id = :sessionId FOR SHARE;`,
    {
      replacements: { sessionId },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  if (rows[0] === undefined) {
    throw new AnalyticsAttributionConflictError();
  }
}

export class PostgresAnalyticsAttributionStore {
  constructor(private readonly database: Sequelize) {}

  async createSession(input: CreateAnalyticsSessionInput): Promise<void> {
    requireUuid(input.sessionId, 'sessionId');
    requireExactIsoTimestamp(input.startedAt, 'startedAt');

    await this.database.transaction(async (transaction) => {
      await this.database.query(
        `
          INSERT INTO analytics_sessions (id, started_at)
          VALUES (:sessionId, :startedAt)
          ON CONFLICT (id) DO NOTHING;
        `,
        { replacements: input, transaction },
      );

      const rows = await this.database.query<SessionRow>(
        `SELECT id, started_at FROM analytics_sessions WHERE id = :sessionId FOR SHARE;`,
        {
          replacements: { sessionId: input.sessionId },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      const row = rows[0];
      if (row === undefined) {
        throw new AnalyticsAttributionConflictError();
      }
      assertSessionMatches(row, input);
    });
  }

  async recordClick(input: RecordAnalyticsClickInput): Promise<void> {
    requireUuid(input.clickId, 'clickId');
    requireUuid(input.sessionId, 'sessionId');
    requireUuid(input.campaignId, 'campaignId');
    requireUuid(input.publicationId, 'publicationId');
    requireSafeIdentifier(input.productId, 'productId');
    requireSafeIdentifier(input.offerId, 'offerId');
    requireExactIsoTimestamp(input.clickedAt, 'clickedAt');

    await this.database.transaction(async (transaction) => {
      await requireSession(this.database, transaction, input.sessionId);

      const campaignRows = await this.database.query<{ readonly id: string }>(
        `SELECT id FROM campaigns WHERE id = :campaignId FOR SHARE;`,
        {
          replacements: { campaignId: input.campaignId },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      if (campaignRows[0] === undefined) {
        throw new AnalyticsAttributionConflictError();
      }

      const publicationRows = await this.database.query<PublicationRow>(
        `
          SELECT master_content_id, status
          FROM publications
          WHERE id = :publicationId
          FOR SHARE;
        `,
        {
          replacements: { publicationId: input.publicationId },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      const publication = publicationRows[0];
      if (publication === undefined || publication.status !== 'PUBLISHED') {
        throw new AnalyticsAttributionConflictError();
      }
      requireUuid(publication.master_content_id, 'masterContentId');

      await this.database.query(
        `
          INSERT INTO analytics_clicks (
            id, session_id, campaign_id, publication_id, master_content_id,
            product_id, offer_id, clicked_at
          )
          VALUES (
            :clickId, :sessionId, :campaignId, :publicationId, :masterContentId,
            :productId, :offerId, :clickedAt
          )
          ON CONFLICT (id) DO NOTHING;
        `,
        {
          replacements: { ...input, masterContentId: publication.master_content_id },
          transaction,
        },
      );

      const rows = await this.database.query<ClickRow>(
        `
          SELECT
            id, session_id, campaign_id, publication_id, master_content_id,
            product_id, offer_id, clicked_at
          FROM analytics_clicks
          WHERE id = :clickId
          FOR SHARE;
        `,
        {
          replacements: { clickId: input.clickId },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      const row = rows[0];
      if (row === undefined) {
        throw new AnalyticsAttributionConflictError();
      }
      assertClickMatches(row, input, publication.master_content_id);
    });
  }

  async recordOrderLine(input: RecordAnalyticsOrderLineInput): Promise<void> {
    requireUuid(input.orderLineId, 'orderLineId');
    requireUuid(input.sessionId, 'sessionId');
    requireSafeIdentifier(input.externalOrderId, 'externalOrderId');
    requireSafeIdentifier(input.externalOrderLineId, 'externalOrderLineId');
    requireSafeIdentifier(input.productId, 'productId');
    requireSafeIdentifier(input.offerId, 'offerId');
    requireGmvMinor(input.gmvMinor);
    requireCurrency(input.currency);
    requireExactIsoTimestamp(input.orderedAt, 'orderedAt');

    await this.database.transaction(async (transaction) => {
      await requireSession(this.database, transaction, input.sessionId);

      await this.database.query(
        `
          INSERT INTO analytics_order_lines (
            id, session_id, external_order_id, external_order_line_id,
            product_id, offer_id, gmv_minor, currency, ordered_at
          )
          VALUES (
            :orderLineId, :sessionId, :externalOrderId, :externalOrderLineId,
            :productId, :offerId, :gmvMinor, :currency, :orderedAt
          )
          ON CONFLICT (id) DO NOTHING;
        `,
        { replacements: input, transaction },
      );

      const rows = await this.database.query<OrderLineRow>(
        `
          SELECT
            id, session_id, external_order_id, external_order_line_id,
            product_id, offer_id, gmv_minor, currency, ordered_at
          FROM analytics_order_lines
          WHERE id = :orderLineId
          FOR SHARE;
        `,
        {
          replacements: { orderLineId: input.orderLineId },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      const row = rows[0];
      if (row === undefined) {
        throw new AnalyticsAttributionConflictError();
      }
      assertOrderLineMatches(row, input);
    });
  }

  async attributeLastTrackedClick(orderLineId: string): Promise<AnalyticsAttributionAssignment> {
    requireUuid(orderLineId, 'orderLineId');

    return this.database.transaction(async (transaction) => {
      const existingRows = await this.database.query<AttributionRow>(
        `
          SELECT order_line_id, click_id, attribution_model, causality_claim
          FROM analytics_attributions
          WHERE order_line_id = :orderLineId
          FOR SHARE;
        `,
        {
          replacements: { orderLineId },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      const existing = existingRows[0];
      if (existing !== undefined) {
        if (
          existing.attribution_model !== ANALYTICS_ATTRIBUTION_MODEL ||
          existing.causality_claim !== false
        ) {
          throw new AnalyticsAttributionConflictError();
        }
        return {
          orderLineId: existing.order_line_id,
          clickId: existing.click_id,
          attributionModel: ANALYTICS_ATTRIBUTION_MODEL,
          causality: ANALYTICS_CAUSALITY,
        };
      }

      const orderRows = await this.database.query<OrderLineRow>(
        `
          SELECT
            id, session_id, external_order_id, external_order_line_id,
            product_id, offer_id, gmv_minor, currency, ordered_at
          FROM analytics_order_lines
          WHERE id = :orderLineId
          FOR UPDATE;
        `,
        {
          replacements: { orderLineId },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      const orderLine = orderRows[0];
      if (orderLine === undefined) {
        throw new AnalyticsAttributionConflictError();
      }

      const clickRows = await this.database.query<ClickRow>(
        `
          SELECT
            id, session_id, campaign_id, publication_id, master_content_id,
            product_id, offer_id, clicked_at
          FROM analytics_clicks
          WHERE session_id = :sessionId
            AND product_id = :productId
            AND offer_id = :offerId
            AND clicked_at <= :orderedAt
          ORDER BY clicked_at DESC, id DESC
          LIMIT 1
          FOR SHARE;
        `,
        {
          replacements: {
            sessionId: orderLine.session_id,
            productId: orderLine.product_id,
            offerId: orderLine.offer_id,
            orderedAt: normalizeDate(orderLine.ordered_at),
          },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      const click = clickRows[0];
      if (click === undefined) {
        throw new AnalyticsAttributionNotFoundError();
      }

      await this.database.query(
        `
          INSERT INTO analytics_attributions (
            order_line_id, click_id, attribution_model, causality_claim
          )
          VALUES (:orderLineId, :clickId, :model, false);
        `,
        {
          replacements: {
            orderLineId,
            clickId: click.id,
            model: ANALYTICS_ATTRIBUTION_MODEL,
          },
          transaction,
        },
      );

      return {
        orderLineId,
        clickId: click.id,
        attributionModel: ANALYTICS_ATTRIBUTION_MODEL,
        causality: ANALYTICS_CAUSALITY,
      };
    });
  }

  async queryPublicationAttribution(
    publicationId: string,
  ): Promise<AnalyticsPublicationAttributionReport> {
    requireUuid(publicationId, 'publicationId');

    const rows = await this.database.query<PathRow>(
      `
        SELECT
          click.product_id,
          click.offer_id,
          click.master_content_id,
          click.campaign_id,
          click.publication_id,
          click.id AS click_id,
          click.session_id,
          line.id AS order_line_id,
          line.external_order_id,
          line.external_order_line_id,
          line.gmv_minor::text AS gmv_minor,
          line.currency,
          click.clicked_at,
          line.ordered_at,
          attribution.attribution_model,
          attribution.causality_claim
        FROM analytics_attributions AS attribution
        JOIN analytics_clicks AS click ON click.id = attribution.click_id
        JOIN analytics_order_lines AS line ON line.id = attribution.order_line_id
        WHERE click.publication_id = :publicationId
        ORDER BY line.ordered_at ASC, line.id ASC;
      `,
      {
        replacements: { publicationId },
        type: QueryTypes.SELECT,
      },
    );

    const gmvByCurrency: Record<string, bigint> = {};
    const paths = rows.map((row): AnalyticsAttributionPath => {
      if (
        row.attribution_model !== ANALYTICS_ATTRIBUTION_MODEL ||
        row.causality_claim !== false ||
        row.product_id.length === 0 ||
        row.offer_id.length === 0
      ) {
        throw new AnalyticsAttributionConflictError();
      }

      const amount = BigInt(row.gmv_minor);
      if (amount < 0n) {
        throw new AnalyticsAttributionConflictError();
      }
      gmvByCurrency[row.currency] = (gmvByCurrency[row.currency] ?? 0n) + amount;

      return {
        productId: row.product_id,
        offerId: row.offer_id,
        masterContentId: row.master_content_id,
        campaignId: row.campaign_id,
        publicationId: row.publication_id,
        clickId: row.click_id,
        sessionId: row.session_id,
        orderLineId: row.order_line_id,
        externalOrderId: row.external_order_id,
        externalOrderLineId: row.external_order_line_id,
        gmvMinor: row.gmv_minor,
        currency: row.currency,
        clickedAt: normalizeDate(row.clicked_at),
        orderedAt: normalizeDate(row.ordered_at),
        attributionModel: ANALYTICS_ATTRIBUTION_MODEL,
        causality: ANALYTICS_CAUSALITY,
      };
    });

    return {
      publicationId,
      causality: ANALYTICS_CAUSALITY,
      paths,
      gmvByCurrency: Object.fromEntries(
        Object.entries(gmvByCurrency).map(([currency, amount]) => [currency, amount.toString()]),
      ),
    };
  }
}

export function createPostgresAnalyticsAttributionStore(
  database: Sequelize,
): PostgresAnalyticsAttributionStore {
  return new PostgresAnalyticsAttributionStore(database);
}
