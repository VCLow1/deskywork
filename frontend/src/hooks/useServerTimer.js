// hooks/useServerTimer.js — Chronomètre synchronisé UTC côté serveur (résistant rechargements & coupures)
import { useState, useEffect, useMemo } from 'react';

export function formatHMSDuration(totalSeconds) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function useServerTimer({ startedAt = null, endAt = null, serverNow = null, active = true } = {}) {
  const driftMs = useMemo(() => {
    if (!serverNow) return 0;
    const sMs = new Date(serverNow).getTime();
    return Number.isFinite(sMs) ? sMs - Date.now() : 0;
  }, [serverNow]);

  const [nowServerMs, setNowServerMs] = useState(() => Date.now() + driftMs);

  useEffect(() => {
    setNowServerMs(Date.now() + driftMs);
    if (!active) return undefined;
    const id = setInterval(() => {
      setNowServerMs(Date.now() + driftMs);
    }, 1000);
    return () => clearInterval(id);
  }, [active, driftMs]);

  return useMemo(() => {
    const startMs = startedAt ? new Date(startedAt).getTime() : NaN;
    const endMs = endAt ? new Date(endAt).getTime() : NaN;

    const elapsedSeconds = Number.isFinite(startMs)
      ? Math.max(0, Math.floor((nowServerMs - startMs) / 1000))
      : 0;

    let remainingSeconds = 0;
    let overtimeSeconds = 0;
    let isOvertime = false;

    if (Number.isFinite(endMs)) {
      const diff = Math.floor((endMs - nowServerMs) / 1000);
      if (diff >= 0) {
        remainingSeconds = diff;
      } else {
        isOvertime = true;
        overtimeSeconds = Math.abs(diff);
      }
    }

    const totalPlannedSeconds = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? Math.floor((endMs - startMs) / 1000)
      : 0;

    const isEndingSoon = !isOvertime && Number.isFinite(endMs) && remainingSeconds > 0 && remainingSeconds <= 15 * 60;

    return {
      nowServerMs,
      elapsedSeconds,
      remainingSeconds,
      overtimeSeconds,
      totalPlannedSeconds,
      isEndingSoon,
      isOvertime,
      formattedElapsed: formatHMSDuration(elapsedSeconds),
      formattedRemaining: formatHMSDuration(remainingSeconds),
      formattedOvertime: `+${formatHMSDuration(overtimeSeconds)}`,
    };
  }, [startedAt, endAt, nowServerMs]);
}
