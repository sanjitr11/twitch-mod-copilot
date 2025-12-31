'use client';

import { FlagWithMessage, ChatMessage } from '../types';

interface FlagRowProps {
  flag: FlagWithMessage;
  context?: ChatMessage[];
  onDismiss: (id: number) => void;
  onAction: (id: number, action: string, username: string, channel: string) => void;
  onUserClick: (username: string, channel: string) => void;
}

export function FlagRow({ flag, context, onDismiss, onAction, onUserClick }: FlagRowProps) {
  const violationColors = {
    hate_speech: 'bg-red-100 text-red-800 border-red-300',
    harassment: 'bg-orange-100 text-orange-800 border-orange-300',
    sexual_content: 'bg-purple-100 text-purple-800 border-purple-300',
    spam: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    coordinated_attack: 'bg-pink-100 text-pink-800 border-pink-300',
    none: 'bg-gray-100 text-gray-800 border-gray-300',
  };

  const confidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return 'text-red-600 font-bold';
    if (confidence >= 0.7) return 'text-orange-600 font-semibold';
    return 'text-yellow-600';
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  return (
    <div className="border border-gray-300 rounded-lg p-4 mb-3 bg-white shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <button
              onClick={() => onUserClick(flag.username, flag.channel)}
              className="text-blue-600 font-semibold hover:underline"
            >
              {flag.username}
            </button>
            <span
              className={`px-2 py-1 text-xs rounded border ${violationColors[flag.violation_type]}`}
            >
              {flag.violation_type.replace('_', ' ')}
            </span>
            <span className={`text-sm ${confidenceColor(flag.confidence)}`}>
              {(flag.confidence * 100).toFixed(0)}%
            </span>
            <span className="text-xs text-gray-500">{formatTime(flag.received_at)}</span>
          </div>
          <p className="text-gray-800 mb-2">{flag.message_text}</p>
          <p className="text-sm text-gray-600 italic">{flag.reasoning}</p>
        </div>
      </div>

      {context && context.length > 0 && (
        <details className="mt-2 mb-3">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
            Context ({context.length} messages)
          </summary>
          <div className="mt-2 bg-gray-50 p-2 rounded text-xs space-y-1">
            {context.map((msg, idx) => (
              <div key={idx} className="text-gray-600">
                <span className="font-semibold">{msg.username}:</span> {msg.message_text}
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => onDismiss(flag.id)}
          className="px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded transition-colors"
        >
          Dismiss
        </button>
        <button
          onClick={() => onAction(flag.id, 'timeout_1h', flag.username, flag.channel)}
          className="px-3 py-1 text-sm bg-yellow-500 hover:bg-yellow-600 text-white rounded transition-colors"
        >
          Timeout 1h
        </button>
        <button
          onClick={() => onAction(flag.id, 'timeout_24h', flag.username, flag.channel)}
          className="px-3 py-1 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded transition-colors"
        >
          Timeout 24h
        </button>
        <button
          onClick={() => onAction(flag.id, 'ban', flag.username, flag.channel)}
          className="px-3 py-1 text-sm bg-red-500 hover:bg-red-600 text-white rounded transition-colors"
        >
          Ban
        </button>
      </div>
    </div>
  );
}
