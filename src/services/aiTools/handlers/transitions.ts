import { useTimelineStore } from '../../../stores/timeline';
import type { ToolResult } from '../types';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

export async function handleAddTransition(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipAId = args.clipAId as string;
  const clipBId = args.clipBId as string;
  const type = (args.type as string) || 'crossDissolve';
  const duration = (args.duration as number) || 0.5;

  const clipA = timelineStore.clips.find(c => c.id === clipAId);
  const clipB = timelineStore.clips.find(c => c.id === clipBId);
  if (!clipA) return { success: false, error: `Clip not found: ${clipAId}` };
  if (!clipB) return { success: false, error: `Clip not found: ${clipBId}` };

  const { applyTransition, invalidateCache } = useTimelineStore.getState();
  applyTransition(clipAId, clipBId, type, duration);
  invalidateCache();

  return {
    success: true,
    data: { clipAId, clipBId, type, duration },
  };
}

export async function handleRemoveTransition(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const edge = args.edge as 'in' | 'out';

  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const { removeTransition, invalidateCache } = useTimelineStore.getState();
  removeTransition(clipId, edge);
  invalidateCache();

  return {
    success: true,
    data: { clipId, edge, removed: true },
  };
}
