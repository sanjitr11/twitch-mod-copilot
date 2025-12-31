'use client';

import { FlagWithMessage, SystemStatus } from '../types';
import { useMemo } from 'react';

interface StatsBarProps {
  flags: FlagWithMessage[];
  systemStatus: SystemStatus | null;
  isConnected: boolean;
}

export function StatsBar({ flags, systemStatus, isConnected }: StatsBarProps) {
  const stats = useMemo(() => {
    const now = Date.now();
    const fifteenMinutesAgo = now - 15 * 60 * 1000;

    const recentFlags = flags.filter((f) => f.created_at >= fifteenMinutesAgo);
    const flagsPerMinute = recentFlags.length / 15;

    const violationCounts: Record<string, number> = {};
    recentFlags.forEach((f) => {
      violationCounts[f.violation_type] = (violationCounts[f.violation_type] || 0) + 1;
    });

    const topViolations = Object.entries(violationCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);

    return { flagsPerMinute, topViolations, totalRecent: recentFlags.length };
  }, [flags]);

  return (
    <div className="bg-gray-800 text-white p-4 mb-4 rounded-lg shadow">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div>
          <p className="text-xs text-gray-400 mb-1">Connection</p>
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`}
            />
            <p className="text-sm font-semibold">{isConnected ? 'Live' : 'Offline'}</p>
          </div>
        </div>

        <div>
          <p className="text-xs text-gray-400 mb-1">Flags (15m)</p>
          <p className="text-xl font-bold">{stats.totalRecent}</p>
          <p className="text-xs text-gray-400">{stats.flagsPerMinute.toFixed(1)}/min</p>
        </div>

        <div>
          <p className="text-xs text-gray-400 mb-1">Sampling Rate</p>
          <p className="text-xl font-bold">
            {systemStatus ? `${(systemStatus.samplingRate * 100).toFixed(0)}%` : '-'}
          </p>
        </div>

        <div>
          <p className="text-xs text-gray-400 mb-1">Queue Depth</p>
          <p className="text-xl font-bold">{systemStatus?.queueDepth ?? '-'}</p>
        </div>

        <div>
          <p className="text-xs text-gray-400 mb-1">Mode</p>
          <p className="text-sm font-semibold">
            {systemStatus?.raidMode ? (
              <span className="text-red-400">RAID MODE</span>
            ) : (
              'Normal'
            )}
          </p>
        </div>
      </div>

      {stats.topViolations.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          <p className="text-xs text-gray-400 mb-2">Top Violations (15m)</p>
          <div className="flex gap-3">
            {stats.topViolations.map(([type, count]) => (
              <div key={type} className="text-xs">
                <span className="text-gray-300">{type.replace('_', ' ')}:</span>{' '}
                <span className="font-semibold">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
