export type ViolationType =
  | 'hate_speech'
  | 'harassment'
  | 'sexual_content'
  | 'spam'
  | 'coordinated_attack'
  | 'none';

export type RecommendedAction = 'flag' | 'timeout_1h' | 'timeout_24h' | 'ban' | 'none';

export type FlagStatus = 'pending' | 'dismissed' | 'actioned';

export interface Flag {
  id: number;
  message_id: string;
  violation_type: ViolationType;
  confidence: number;
  reasoning: string;
  recommended_action: RecommendedAction;
  status: FlagStatus;
  created_at: number;
  reviewed_at?: number;
}

export interface Message {
  id: string;
  channel: string;
  username: string;
  message_text: string;
  received_at: number;
  sampled_reason?: string;
}

export interface FlagWithMessage extends Flag, Message {}

export interface ChatMessage {
  username: string;
  message_text: string;
  received_at: number;
}

export interface SystemStatus {
  queueDepth: number;
  samplingRate: number;
  raidMode: boolean;
}

export interface UserHistory {
  channel: string;
  username: string;
  total_flags: number;
  total_actions: number;
  last_violation_at?: number;
  risk_score: number;
}

export interface WebSocketMessage {
  type: 'flag.created' | 'system.status' | 'connection';
  data: any;
}
