import type { DatabaseSync } from "node:sqlite";

export type FundWatchlistItem = {
  code: string;
  name: string | null;
  sortOrder: number;
  holdingShares: number | null;
  costPrice: number | null;
  createdAt: string;
  updatedAt: string;
};

export type FundWatchlistRepository = {
  list(): FundWatchlistItem[];
  upsert(input: { code: string; name?: string | null }): FundWatchlistItem;
  updateHoldings(code: string, input: { holdingShares: number | null; costPrice: number | null }): FundWatchlistItem;
  remove(code: string): boolean;
};

export function createFundWatchlistRepository(connection: DatabaseSync): FundWatchlistRepository {
  return {
    list() {
      return connection
        .prepare(
          `
            SELECT code, name, sort_order AS sortOrder,
                   holding_shares AS holdingShares, cost_price AS costPrice,
                   created_at AS createdAt, updated_at AS updatedAt
            FROM fund_watchlist
            ORDER BY sort_order ASC, created_at ASC
          `
        )
        .all() as FundWatchlistItem[];
    },

    upsert(input) {
      const nextSortOrder = getNextSortOrder(connection);
      connection
        .prepare(
          `
            INSERT INTO fund_watchlist (code, name, sort_order)
            VALUES (?, ?, ?)
            ON CONFLICT(code) DO UPDATE SET
              name = COALESCE(excluded.name, fund_watchlist.name),
              updated_at = datetime('now')
          `
        )
        .run(input.code, input.name ?? null, nextSortOrder);

      return getByCode(connection, input.code);
    },

    updateHoldings(code, input) {
      connection
        .prepare(
          `
            UPDATE fund_watchlist
            SET holding_shares = ?, cost_price = ?, updated_at = datetime('now')
            WHERE code = ?
          `
        )
        .run(input.holdingShares, input.costPrice, code);

      return getByCode(connection, code);
    },

    remove(code) {
      const result = connection.prepare("DELETE FROM fund_watchlist WHERE code = ?").run(code);
      return result.changes > 0;
    }
  };
}

function getNextSortOrder(connection: DatabaseSync) {
  const row = connection.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextSortOrder FROM fund_watchlist").get() as {
    nextSortOrder: number;
  };
  return row.nextSortOrder;
}

function getByCode(connection: DatabaseSync, code: string) {
  const item = connection
    .prepare(
      `
        SELECT code, name, sort_order AS sortOrder,
               holding_shares AS holdingShares, cost_price AS costPrice,
               created_at AS createdAt, updated_at AS updatedAt
        FROM fund_watchlist
        WHERE code = ?
      `
    )
    .get(code) as FundWatchlistItem | undefined;

  if (!item) {
    throw new Error(`fund_watchlist row not found after upsert: ${code}`);
  }

  return item;
}
