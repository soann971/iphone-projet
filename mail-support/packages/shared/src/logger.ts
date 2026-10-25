import { pino } from "pino";

/** Champs jamais écrits dans les logs (secrets, contenu des mails). */
const REDACT = [
  "*.password",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.access_token",
  "*.refresh_token",
  "*.apiKey",
  "*.authorization",
  "req.headers.authorization",
  "req.headers.cookie",
  "*.bodyText",
  "*.bodyHtml",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: { paths: REDACT, censor: "[masqué]" },
  base: { service: process.env.SERVICE_NAME ?? "mail-support" },
});

export type Logger = typeof logger;
