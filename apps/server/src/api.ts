import express, { Router } from 'express';
import { DatabaseService } from './database';
import { ActionHandler } from './action-handler';

export function createApiRouter(db: DatabaseService, actionHandler: ActionHandler): Router {
  const router = express.Router();

  // GET /api/flags?status=pending&limit=50
  router.get('/flags', (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const limit = parseInt(req.query.limit as string) || 50;

      const flags = db.getFlags(status, limit);

      res.json({
        success: true,
        data: flags,
        count: flags.length,
      });
    } catch (error) {
      console.error('[API] Error fetching flags:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch flags',
      });
    }
  });

  // POST /api/flags/:id/dismiss
  router.post('/flags/:id/dismiss', (req, res) => {
    try {
      const flagId = parseInt(req.params.id);
      db.updateFlagStatus(flagId, 'dismissed', Date.now());

      res.json({
        success: true,
        message: 'Flag dismissed',
      });
    } catch (error) {
      console.error('[API] Error dismissing flag:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to dismiss flag',
      });
    }
  });

  // POST /api/flags/dismiss-all
  router.post('/flags/dismiss-all', (req, res) => {
    try {
      const count = db.dismissAllPendingFlags(Date.now());

      res.json({
        success: true,
        message: `Dismissed ${count} pending flag(s)`,
        count,
      });
    } catch (error) {
      console.error('[API] Error dismissing all flags:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to dismiss all flags',
      });
    }
  });

  // POST /api/flags/:id/action
  // Body: { username, channel }
  // The action (ban / timeout / escalate) is now selected by the LLM based on
  // the flag's violation context — no action field required from the caller.
  router.post('/flags/:id/action', async (req, res) => {
    try {
      const flagId = parseInt(req.params.id);
      const { username, channel } = req.body;

      if (!username || !channel) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: username, channel',
        });
      }

      await actionHandler.executeAction(flagId, username, channel);

      res.json({
        success: true,
        message: `Action executed for flag ${flagId}`,
      });
    } catch (error) {
      console.error('[API] Error executing action:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to execute action',
      });
    }
  });

  // GET /api/users/:username/history
  router.get('/users/:username/history', (req, res) => {
    try {
      const username = req.params.username;
      const channel = req.query.channel as string;

      if (!channel) {
        return res.status(400).json({
          success: false,
          error: 'Missing channel parameter',
        });
      }

      const history = db.getUserHistory(channel, username);

      res.json({
        success: true,
        data: history || {
          channel,
          username,
          total_flags: 0,
          total_actions: 0,
          risk_score: 0,
        },
      });
    } catch (error) {
      console.error('[API] Error fetching user history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch user history',
      });
    }
  });

  return router;
}
