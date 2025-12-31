'use client';

import { UserHistory } from '../types';
import { useEffect, useState } from 'react';

interface UserHistoryPanelProps {
  username: string | null;
  channel: string | null;
  onClose: () => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function UserHistoryPanel({ username, channel, onClose }: UserHistoryPanelProps) {
  const [history, setHistory] = useState<UserHistory | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!username || !channel) {
      setHistory(null);
      return;
    }

    setLoading(true);

    fetch(`${API_URL}/api/users/${username}/history?channel=${channel}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setHistory(data.data);
        }
      })
      .catch((error) => {
        console.error('Failed to fetch user history:', error);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [username, channel]);

  if (!username || !channel) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-lg border-l border-gray-300 p-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">User History</h2>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700 text-xl font-bold"
        >
          ×
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : history ? (
        <div className="space-y-4">
          <div>
            <p className="text-xl font-semibold text-gray-800">{username}</p>
            <p className="text-sm text-gray-500">#{channel}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-red-50 p-3 rounded border border-red-200">
              <p className="text-xs text-gray-600 mb-1">Total Flags</p>
              <p className="text-2xl font-bold text-red-700">{history.total_flags}</p>
            </div>

            <div className="bg-orange-50 p-3 rounded border border-orange-200">
              <p className="text-xs text-gray-600 mb-1">Total Actions</p>
              <p className="text-2xl font-bold text-orange-700">{history.total_actions}</p>
            </div>

            <div className="bg-purple-50 p-3 rounded border border-purple-200 col-span-2">
              <p className="text-xs text-gray-600 mb-1">Risk Score</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-purple-600 h-2 rounded-full transition-all"
                    style={{ width: `${history.risk_score * 100}%` }}
                  />
                </div>
                <span className="text-sm font-semibold text-purple-700">
                  {(history.risk_score * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </div>

          {history.last_violation_at && (
            <div>
              <p className="text-xs text-gray-600 mb-1">Last Violation</p>
              <p className="text-sm text-gray-800">
                {new Date(history.last_violation_at).toLocaleString()}
              </p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-gray-500">No history found</p>
      )}
    </div>
  );
}
