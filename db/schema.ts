import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const userProfiles = sqliteTable("user_profiles", {
  userId: text("user_id").primaryKey(),
  email: text("email"),
  name: text("name").notNull(),
  netWorthEur: real("net_worth_eur").notNull(),
  expectations: text("expectations").notNull(),
  bankConnected: integer("bank_connected", { mode: "boolean" }).notNull().default(true),
  preferredLanguage: text("preferred_language", { enum: ["de", "en"] }).notNull().default("de"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [index("idx_user_profiles_updated_at").on(table.updatedAt)]);
