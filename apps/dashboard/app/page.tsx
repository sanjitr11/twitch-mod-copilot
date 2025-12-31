'use client';

import { useEffect, useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { FlagWithMessage, SystemStatus, ChatMessage } from './types';
import { FlagRow } from './components/FlagRow';
import { UserHistoryPanel } from './components/UserHistoryPanel';
import { StatsBar } from './components/StatsBar';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function Dashboard() {
  const { isConnected, lastMessage } = useWebSocket(WS_URL);
  const [flags, setFlags] = useState<FlagWithMessage[]>([]);
  const [flagContexts, setFlagContexts] = useState<Map<number, ChatMessage[]>>(new Map());
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [selectedUser, setSelectedUser] = useState<{ username: string; channel: string } | null>(
    null
  );

  // Load initial flags
  useEffect(() => {
    fetch(`${API_URL}/api/flags?status=pending&limit=50`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setFlags(data.data);
        }
      })
      .catch((error) => {
        console.error('Failed to fetch initial flags:', error);
      });
  }, []);

  // Handle WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'flag.created') {
      const { flag, message, context } = lastMessage.data;
      const flagWithMessage: FlagWithMessage = { ...flag, ...message };

      setFlags((prev) => [flagWithMessage, ...prev]);

      if (context && flag.id) {
        setFlagContexts((prev) => new Map(prev).set(flag.id, context));
      }
    } else if (lastMessage.type === 'system.status') {
      setSystemStatus(lastMessage.data);
    }
  }, [lastMessage]);

  const handleDismiss = async (id: number) => {
    try {
      const res = await fetch(`${API_URL}/api/flags/${id}/dismiss`, {
        method: 'POST',
      });

      if (res.ok) {
        setFlags((prev) => prev.filter((f) => f.id !== id));
      }
    } catch (error) {
      console.error('Failed to dismiss flag:', error);
    }
  };

  const handleAction = async (id: number, action: string, username: string, channel: string) => {
    try {
      const res = await fetch(`${API_URL}/api/flags/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, username, channel }),
      });

      if (res.ok) {
        setFlags((prev) => prev.filter((f) => f.id !== id));
      }
    } catch (error) {
      console.error('Failed to execute action:', error);
    }
  };

  const handleUserClick = (username: string, channel: string) => {
    setSelectedUser({ username, channel });
  };

  const handleClearAll = async () => {
    if (!confirm(`Are you sure you want to dismiss all ${flags.length} pending flags?`)) {
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/flags/dismiss-all`, {
        method: 'POST',
      });

      if (res.ok) {
        setFlags([]);
      }
    } catch (error) {
      console.error('Failed to clear all flags:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-7xl mx-auto p-4">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Twitch Moderation Co-Pilot
          </h1>
          <p className="text-gray-600">Human-in-the-loop chat moderation dashboard</p>
        </div>

        <StatsBar flags={flags} systemStatus={systemStatus} isConnected={isConnected} />

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">
              Pending Flags ({flags.length})
            </h2>
            {flags.length > 0 && (
              <button
                onClick={handleClearAll}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-medium rounded transition-colors"
              >
                Clear All Flags
              </button>
            )}
          </div>

          {flags.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg">No pending flags</p>
              <p className="text-sm mt-2">Monitoring chat for violations...</p>
            </div>
          ) : (
            <div className="space-y-2">
              {flags.map((flag) => (
                <FlagRow
                  key={flag.id}
                  flag={flag}
                  context={flagContexts.get(flag.id)}
                  onDismiss={handleDismiss}
                  onAction={handleAction}
                  onUserClick={handleUserClick}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <UserHistoryPanel
        username={selectedUser?.username || null}
        channel={selectedUser?.channel || null}
        onClose={() => setSelectedUser(null)}
      />
    </div>
  );
}
