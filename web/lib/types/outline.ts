/**
 * Outline TS types — mirror of `deeptutor/outline/models.py`.
 *
 * JSON shape is camelCase (aligned with Pydantic aliases).
 * Update both sides in lockstep when the schema evolves.
 */

export type OutlineSourceType = "topic" | "document";

export interface OutlineSource {
  type: OutlineSourceType;
  topic: string;
  documentRefs: string[];
}

export interface KnowledgePoint {
  id: string;
  order: number;
  title: string;
  description: string;
  keyPoints: string[];
  teachingObjective: string | null;
  estimatedDuration: number | null; // seconds
  languageNote: string | null;
}

export interface OutlineMetadata {
  createdAt: string; // ISO-8601
  updatedAt: string;
  llmModel: string | null;
  schemaVersion: number;
}

export interface Outline {
  id: string;
  title: string;
  description: string;
  languageDirective: string;
  source: OutlineSource;
  outlines: KnowledgePoint[];
  metadata: OutlineMetadata;
}

export interface GenerateOutlineRequest {
  requirement: string;
}
