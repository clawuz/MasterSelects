// Text clip actions slice - extracted from clipSlice

import type { TimelineClip, TextClipProperties } from '../../types';
import type { TextClipActions, SliceCreator } from './types';
import { DEFAULT_TRANSFORM, DEFAULT_TEXT_PROPERTIES, DEFAULT_TEXT_DURATION } from './constants';
import { textRenderer } from '../../services/textRenderer';
import { googleFontsService } from '../../services/googleFontsService';
import { engine } from '../../engine/WebGPUEngine';
import { layerBuilder } from '../../services/layerBuilder';
import { generateTextClipId } from './helpers/idGenerator';
import { useMediaStore } from '../mediaStore';
import { Logger } from '../../services/logger';

const log = Logger.create('TextClipSlice');

export const createTextClipSlice: SliceCreator<TextClipActions> = (set, get) => ({
  addTextClip: async (trackId, startTime, duration = DEFAULT_TEXT_DURATION, skipMediaItem = false) => {
    const { clips, tracks, updateDuration, invalidateCache } = get();
    const track = tracks.find(t => t.id === trackId);

    if (!track || track.type !== 'video') {
      log.warn('Text clips can only be added to video tracks');
      return null;
    }

    const clipId = generateTextClipId();
    await googleFontsService.loadFont(DEFAULT_TEXT_PROPERTIES.fontFamily, DEFAULT_TEXT_PROPERTIES.fontWeight);

    const canvas = textRenderer.createCanvas(1920, 1080);
    textRenderer.render(DEFAULT_TEXT_PROPERTIES, canvas);

    const textClip: TimelineClip = {
      id: clipId,
      trackId,
      name: 'Text',
      file: new File([], 'text-clip.txt', { type: 'text/plain' }),
      startTime,
      duration,
      inPoint: 0,
      outPoint: duration,
      source: { type: 'text', textCanvas: canvas, naturalDuration: duration },
      transform: { ...DEFAULT_TRANSFORM },
      effects: [],
      textProperties: { ...DEFAULT_TEXT_PROPERTIES },
      isLoading: false,
    };

    if (!skipMediaItem) {
      const mediaStore = useMediaStore.getState();
      const textFolderId = mediaStore.getOrCreateTextFolder();
      const mediaItemId = mediaStore.createTextItem('Text', textFolderId);
      textClip.mediaFileId = mediaItemId;
      textClip.source = { ...textClip.source!, mediaFileId: mediaItemId };
    }

    set({ clips: [...clips, textClip] });
    updateDuration();
    invalidateCache();

    log.debug('Created text clip', { clipId });
    return clipId;
  },

  updateTextProperties: (clipId, props) => {
    const { clips, selectedClipIds, invalidateCache } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip?.textProperties) return;

    // Collect all text clips to update: primary + any other selected text clips
    const targetIds = new Set<string>([clipId]);
    if (selectedClipIds && selectedClipIds.size > 1 && selectedClipIds.has(clipId)) {
      for (const id of selectedClipIds) {
        const c = clips.find(cl => cl.id === id);
        if (c?.textProperties) targetIds.add(id);
      }
    }

    const updatedClips = clips.map(c => {
      if (!targetIds.has(c.id) || !c.textProperties) return c;
      const newProps: TextClipProperties = { ...c.textProperties, ...props };
      const canvas = c.source?.textCanvas || textRenderer.createCanvas(1920, 1080);
      textRenderer.render(newProps, canvas);
      const texMgr = engine.getTextureManager();
      if (texMgr) texMgr.updateCanvasTexture(canvas);
      return {
        ...c,
        textProperties: newProps,
        source: { ...c.source!, textCanvas: canvas },
        name: newProps.text.substring(0, 20) || 'Text',
      };
    });

    set({ clips: updatedClips });
    invalidateCache();

    try {
      layerBuilder.invalidateCache();
      const layers = layerBuilder.buildLayersFromStore();
      engine.render(layers);
    } catch (e) {
      log.debug('Direct render after text update failed', e);
    }

    if (props.fontFamily || props.fontWeight) {
      const primaryClip = clips.find(c => c.id === clipId);
      const fontFamily = props.fontFamily || primaryClip?.textProperties?.fontFamily || '';
      const fontWeight = props.fontWeight || primaryClip?.textProperties?.fontWeight || 400;
      googleFontsService.loadFont(fontFamily, fontWeight).then(() => {
        const { clips: currentClips, invalidateCache: inv } = get();
        for (const id of targetIds) {
          const currentClip = currentClips.find(cl => cl.id === id);
          if (!currentClip?.textProperties) continue;
          const currentCanvas = currentClip.source?.textCanvas;
          if (currentCanvas) {
            textRenderer.render(currentClip.textProperties, currentCanvas);
            engine.getTextureManager()?.updateCanvasTexture(currentCanvas);
          }
        }
        inv();

        try {
          layerBuilder.invalidateCache();
          const layers = layerBuilder.buildLayersFromStore();
          engine.render(layers);
        } catch (e) {
          log.debug('Direct render after font load failed', e);
        }
      });
    }
  },
});
