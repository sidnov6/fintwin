import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const userProfiles = sqliteTable("user_profiles", {
  userId: text("user_id").primaryKey(),
  email: text("email"),
  name: text("name").notNull(),
  netWorthEur: real("net_worth_eur").notNull().default(0),
  expectations: text("expectations").notNull().default(""),
  bankConnected: integer("bank_connected", { mode: "boolean" }).notNull().default(true),
  preferredLanguage: text("preferred_language", { enum: ["de", "en"] }).notNull().default("de"),
  onboardingDone: integer("onboarding_done", { mode: "boolean" }).notNull().default(false),
  voiceAutoplay: integer("voice_autoplay", { mode: "boolean" }).notNull().default(true),
  sampleLoaded: integer("sample_loaded", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [index("idx_user_profiles_updated_at").on(table.updatedAt)]);

export const conversationTurns = sqliteTable("conversation_turns", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content").notNull(),
  sourceIds: text("source_ids").notNull().default("[]"),
  mode: text("mode").notNull().default("text"),
  cards: text("cards").notNull().default("[]"),
  suggestions: text("suggestions").notNull().default("[]"),
  meta: text("meta").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, table => [index("idx_conversation_turns_user_created").on(table.userId, table.createdAt)]);

export const userFacts = sqliteTable("user_facts", {
  userId: text("user_id").notNull(),
  key: text("key").notNull(),
  valueJson: text("value_json").notNull(),
  source: text("source").notNull(),
  note: text("note"),
  updatedAt: text("updated_at").notNull(),
}, table => [primaryKey({ columns: [table.userId, table.key] })]);

export const userMemories = sqliteTable("user_memories", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  text: text("text").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [index("idx_user_memories_user").on(table.userId, table.createdAt)]);

export const userNextSteps = sqliteTable("user_next_steps", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  text: text("text").notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
}, table => [index("idx_user_next_steps_user").on(table.userId, table.createdAt)]);

export const scenarioRuns = sqliteTable("scenario_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(),
  inputsJson: text("inputs_json").notNull(),
  outputsJson: text("outputs_json").notNull(),
  createdAt: text("created_at").notNull(),
});
