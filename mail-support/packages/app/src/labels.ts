import { CATEGORIES, gmailLabelName } from "@ms/shared";

export const LABEL_REVIEW = "Support/À valider";
export const LABEL_AUTO = "Support/Réponse auto";
export const LABEL_DONE = "Support/Traité";

export const ALL_LABELS = [...CATEGORIES.map(gmailLabelName), LABEL_REVIEW, LABEL_AUTO, LABEL_DONE];
