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

export const conversationTurns = sqliteTable("conversation_turns", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  sourceIds: text("source_ids").notNull().default("[]"),
  mode: text("mode").notNull().default("text"),
  createdAt: text("created_at").notNull(),
}, table => [index("idx_conversation_turns_user_created").on(table.userId, table.createdAt)]);
