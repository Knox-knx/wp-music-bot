// codes by: @LouisPy
import cron from 'node-cron';
import { formatLocalDate } from '../services/adService.js';

const MAX_CONSECUTIVE_FAILURES = 3;

export function createAdScheduler({
  config,
  logger,
  adService,
  sendAdToGroup,
  isGroupAvailable,
  now = () => Date.now(),
}) {
  let task = null;
  let running = false;
  let enabled = false;
  const groupFailures = new Map();

  function groupSkipped(groupId) {
    const failures = (groupFailures.get(groupId) ?? 0) + 1;
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      groupFailures.delete(groupId);
      adService.db?.setGroupAdEnabled(groupId, false);
      logger.warn(
        { groupId, failures },
        'ad: group failed too many times in a row; advertisements disabled for it'
      );
      return true;
    }
    groupFailures.set(groupId, failures);
    return false;
  }

  function groupDelivered(groupId) {
    groupFailures.delete(groupId);
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      if (!config.ads.enabled || !adService.isEnabled()) return;
      const dateStr = formatLocalDate(new Date(now()));
      adService.ensureDailySchedule(dateStr);
      const ad = adService.getAdConfig();
      if (!ad.message) return;

      const due = adService.getDueSlots(dateStr, now());
      for (const slot of due) {
        if (!adService.claimSlot(slot)) continue;
        const groups = adService.getActiveGroups();
        const results = [];
        for (const group of groups) {
          try {
            if (!(await isGroupAvailable(group.id))) {
              results.push({ status: 'failed', groupId: group.id });
              if (groupSkipped(group.id)) continue;
              logger.warn({ groupId: group.id }, 'ad: group unavailable, skipped');
              continue;
            }
            await sendAdToGroup(group.id, ad.message);
            groupDelivered(group.id);
            adService.db?.recordDelivery?.({
              scheduleId: slot.id,
              groupId: group.id,
              status: 'sent',
              error: null,
            });
            results.push({ status: 'sent', groupId: group.id });
          } catch (err) {
            adService.db?.recordDelivery?.({
              scheduleId: slot.id,
              groupId: group.id,
              status: 'failed',
              error: String(err?.message ?? err).slice(0, 500),
            });
            logger.warn({ err, groupId: group.id }, 'ad: delivery failed');
            results.push({ status: 'failed', groupId: group.id });
            groupSkipped(group.id);
          }
        }
        adService.completeSlot(slot, results);
      }
    } catch (err) {
      logger.error({ err }, 'ad scheduler tick failed');
    } finally {
      running = false;
    }
  }

  function start() {
    if (task) return;
    task = cron.schedule('* * * * *', () => {
      tick().catch((err) => logger.error({ err }, 'ad scheduler error'));
    });
    enabled = true;
    logger.info('ad scheduler started (every minute)');
  }

  function stop() {
    if (task) {
      task.stop();
      task = null;
    }
    groupFailures.clear();
    enabled = false;
    logger.info('ad scheduler stopped');
  }

  return { start, stop, tick, isEnabled: () => enabled };
}