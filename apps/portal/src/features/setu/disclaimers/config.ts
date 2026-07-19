import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import {
  DisclaimersConfigSchema,
  DEFAULT_DISCLAIMERS_CONFIG,
  type DisclaimersConfig,
  type DisclaimerSection,
} from '@cmt/shared-domain/setu';

type Db = FirebaseFirestore.Firestore;

const CONFIG_COLLECTION = 'app_config';
const CONFIG_DOC = 'disclaimers';

/** Current disclaimers content. Falls back to the seed DEFAULT when the doc is
 *  absent or fails validation, so the feature works before any admin edit. */
export async function getDisclaimersConfig(db: Db): Promise<DisclaimersConfig> {
  const snap = await db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC).get();
  if (!snap.exists) return { ...DEFAULT_DISCLAIMERS_CONFIG };
  const parsed = DisclaimersConfigSchema.safeParse(snap.data());
  return parsed.success ? parsed.data : { ...DEFAULT_DISCLAIMERS_CONFIG };
}

/** Editable disclaimer content (everything a publish can change). */
export interface DisclaimerContent {
  intro: string;
  sections: DisclaimerSection[];
  acknowledgement: string;
}

// Compare only the content (intro + id/title/body + acknowledgement) —
// bookkeeping fields (version/updatedAt/updatedBy) never trigger a version bump.
function sameContent(a: DisclaimerContent, b: DisclaimerContent): boolean {
  const norm = (c: DisclaimerContent) =>
    JSON.stringify({
      intro: c.intro,
      sections: c.sections.map((s) => ({ id: s.id, title: s.title, body: s.body })),
      acknowledgement: c.acknowledgement,
    });
  return norm(a) === norm(b);
}

/**
 * Publish new disclaimer content. Bumps `version` by 1 and writes when the
 * content (intro, sections, or acknowledgement) differs from the current; a
 * no-op (returns current unchanged) when identical, so re-publishing the same
 * text never forces a needless re-accept. Runs in a transaction so version can't
 * race between two publishes.
 */
export async function setDisclaimersConfig(
  db: Db,
  content: DisclaimerContent,
  actorMid: string,
): Promise<DisclaimersConfig> {
  const ref = db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC);
  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    const parsed = snap.exists ? DisclaimersConfigSchema.safeParse(snap.data()) : null;
    const current: DisclaimersConfig =
      parsed && parsed.success ? parsed.data : { ...DEFAULT_DISCLAIMERS_CONFIG };

    if (sameContent(current, content)) return current;

    const next: DisclaimersConfig = {
      version: current.version + 1,
      intro: content.intro,
      sections: content.sections,
      acknowledgement: content.acknowledgement,
    };
    txn.set(
      ref,
      {
        version: next.version,
        intro: next.intro,
        sections: next.sections,
        acknowledgement: next.acknowledgement,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorMid,
      },
      { merge: true },
    );
    return next;
  });
}
