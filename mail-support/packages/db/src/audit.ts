import type { Db } from "./client";
import type { ActorType } from "./generated/prisma/client";

export interface AuditEntry {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  /** Métadonnées uniquement : jamais le contenu d'un mail ni un secret. */
  details?: Record<string, unknown>;
  ip?: string | null;
}

/** Journalise une action. N'échoue jamais bruyamment (un audit raté ne doit pas casser le traitement). */
export async function audit(db: Pick<Db, "auditLog">, e: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorType: e.actorType,
        actorId: e.actorId ?? null,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        details: (e.details ?? undefined) as never,
        ip: e.ip ?? null,
      },
    });
  } catch (err) {
    console.error("audit: échec d'écriture", err);
  }
}
