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

export type AgentRole = "teacher" | "classmate" | "inquirer";

export interface AgentProfile {
  id: string; // "agent_teacher" | "agent_classmate" | "agent_inquirer"
  role: AgentRole;
  name: string;
  persona: string;
  color: string; // hex
  avatarInitial: string;
}

export interface Outline {
  id: string;
  title: string;
  description: string;
  languageDirective: string;
  source: OutlineSource;
  outlines: KnowledgePoint[];
  agents: AgentProfile[];
  metadata: OutlineMetadata;
}

export interface GenerateOutlineRequest {
  requirement: string;
}

// --- Study chat types --- //

export type StudyRole = "user" | "assistant";

export interface StudyMessage {
  role: StudyRole;
  content: string;
  /** Discussion mode only: which cast member produced this assistant turn. */
  agentId?: string | null;
  /** Display name at render time. */
  agentName?: string | null;
  /** Avatar/bubble color (hex). */
  agentColor?: string | null;
  /** First character of the agent's name for the avatar bubble. */
  agentAvatarInitial?: string | null;
}

export interface StudyChatRequest {
  history: StudyMessage[];
  currentKpId?: string | null;
}

export interface StudyChatResponse {
  reply: string;
  isOpening: boolean;
}

// --- Discussion mode payloads (POST /{id}/discuss body) --- //

export interface DiscussionMessage {
  role: StudyRole;
  content: string;
  agentId?: string | null;
  agentName?: string | null;
}

export interface DiscussionRequest {
  history: DiscussionMessage[];
  currentKpId?: string | null;
}
