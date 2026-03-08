<template>
  <article
    class="album-card"
    :class="{ selected }"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <!-- Cover -->
    <div class="cover-wrap">
      <img
        v-if="item.cover"
        :src="item.cover"
        :alt="item.title"
        class="cover"
        loading="lazy"
        @error="coverError = true"
      />
      <div v-if="!item.cover || coverError" class="cover-fallback">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(199,210,254,0.2)" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/><path d="M12 8v8"/></svg>
      </div>
      <!-- Hover overlay -->
      <div class="cover-overlay" :class="{ visible: hovered }">
        <div class="overlay-actions">
          <button class="ov-btn" title="Inspect" @click.stop="emit('inspect', item)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </button>
          <button class="ov-btn primary" title="Queue download" @click.stop="emit('queue', item)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </button>
        </div>
      </div>
      <!-- Track count badge -->
      <div v-if="item.trackCount" class="track-count-badge">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        {{ item.trackCount }} tracks
      </div>
    </div>

    <!-- Info -->
    <div class="card-info" @click="emit('inspect', item)">
      <div class="card-title" :title="item.title">{{ item.title }}</div>
      <div class="card-artist">{{ item.artist }}</div>
      <div v-if="item.service" class="card-service">{{ item.service }}</div>
    </div>
  </article>
</template>

<script setup lang="ts">
import type { SearchResult } from "~/types/music";

const props = defineProps<{
  item: SearchResult;
  selected?: boolean;
}>();

const emit = defineEmits<{
  inspect: [item: SearchResult];
  queue: [item: SearchResult];
}>();

const hovered = ref(false);
const coverError = ref(false);
</script>

<style scoped>
.album-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-radius: 12px;
  background: var(--panel);
  border: 1px solid rgba(199,210,254,0.07);
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.album-card:hover {
  transform: translateY(-4px);
  border-color: rgba(79,124,255,0.4);
  box-shadow: 0 8px 32px rgba(79,124,255,0.12), 0 0 0 1px rgba(79,124,255,0.15);
}

.album-card.selected {
  border-color: rgba(79,124,255,0.6);
  box-shadow: 0 0 0 2px rgba(79,124,255,0.3), 0 8px 32px rgba(79,124,255,0.18);
}

.cover-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  background: var(--surface-2);
  overflow: hidden;
  flex-shrink: 0;
}

.cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.3s ease;
}

.album-card:hover .cover { transform: scale(1.04); }

.cover-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(79,124,255,0.04), rgba(103,232,249,0.04));
}

.cover-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 40%, rgba(7,11,20,0.9));
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 10px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.cover-overlay.visible { opacity: 1; }

.overlay-actions { display: flex; gap: 8px; }

.ov-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid rgba(199,210,254,0.3);
  background: rgba(11,18,32,0.85);
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
  backdrop-filter: blur(4px);
}

.ov-btn:hover { background: rgba(79,124,255,0.2); border-color: rgba(79,124,255,0.6); }
.ov-btn.primary { background: var(--accent); border-color: var(--accent); color: #0B1220; }
.ov-btn.primary:hover { background: var(--accent-2); border-color: var(--accent-2); }

.card-info {
  padding: 0 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-artist {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-service {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent-2, #818cf8);
  opacity: 0.7;
}

.track-count-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: rgba(7,11,20,0.85);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(199,210,254,0.15);
  border-radius: 20px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text);
  pointer-events: none;
}
</style>
