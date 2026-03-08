<template>
  <div class="job-card" :class="{ active }">
    <!-- Header -->
    <div class="job-card-header">
      <span class="status-chip" :class="job.status">{{ job.status }}</span>
      <span class="job-id">{{ job.id.slice(0, 8) }}</span>
      <button
        v-if="job.status !== 'completed' && job.status !== 'error' && job.status !== 'cancelled'"
        class="inspect-btn"
        @click="emit('inspect', job)"
      >Inspect →</button>
    </div>

    <!-- URL -->
    <div class="job-url">{{ truncateUrl(job.url) }}</div>

    <!-- Track info -->
    <div v-if="job.trackInfo" class="track-info-row">
      <div class="track-counter">
        <span class="track-counter-current">{{ job.trackInfo.current }}</span>
        <span class="track-counter-sep">/</span>
        <span class="track-counter-total">{{ job.trackInfo.total }}</span>
      </div>
      <div class="track-name">{{ job.trackInfo.name }}</div>
      <div class="track-dots">
        <span
          v-for="i in job.trackInfo.total"
          :key="i"
          class="track-dot"
          :class="{
            done: i < job.trackInfo.current,
            active: i === job.trackInfo.current,
          }"
        />
      </div>
    </div>

    <!-- Progress bar -->
    <div class="progress-bar">
      <div class="progress-bar-fill" :style="{ width: job.progress + '%' }" />
    </div>

    <!-- Footer row -->
    <div class="job-card-footer">
      <span class="job-progress-pct">{{ job.progress }}%</span>
      <span v-if="job.message" class="job-msg">{{ job.message }}</span>
      <div class="job-actions">
        <button
          v-if="job.status === 'processing' || job.status === 'fetching'"
          class="act-btn"
          title="Pause"
          @click="emit('pause', job)"
        >⏸</button>
        <button
          v-if="job.control?.paused"
          class="act-btn"
          title="Resume"
          @click="emit('resume', job)"
        >▶</button>
        <button
          v-if="job.status === 'error'"
          class="act-btn retry"
          title="Retry"
          @click="emit('retry', job)"
        >↺</button>
        <button
          v-if="job.status !== 'completed'"
          class="act-btn cancel"
          title="Cancel"
          @click="emit('cancel', job)"
        >✕</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { DownloadJob } from "~/types/music";

const props = defineProps<{
  job: DownloadJob;
  active?: boolean;
}>();

const emit = defineEmits<{
  inspect: [job: DownloadJob];
  pause:   [job: DownloadJob];
  resume:  [job: DownloadJob];
  retry:   [job: DownloadJob];
  cancel:  [job: DownloadJob];
}>();

function truncateUrl(url: string) {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname.slice(0, 40);
  } catch {
    return url.slice(0, 50);
  }
}
</script>

<style scoped>
.job-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  background: rgba(9,14,26,0.7);
  border: 1px solid rgba(199,210,254,0.07);
  border-radius: 10px;
  transition: border-color 0.2s, box-shadow 0.2s;
  animation: fadeSlideUp 0.3s ease;
}

@keyframes fadeSlideUp {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

.job-card:hover {
  border-color: rgba(79,124,255,0.25);
}

.job-card.active {
  border-color: rgba(79,124,255,0.45);
  box-shadow: 0 0 0 1px rgba(79,124,255,0.2), 0 4px 20px rgba(79,124,255,0.08);
}

.job-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.job-id {
  font-size: 10px;
  font-family: "JetBrains Mono", monospace;
  color: var(--muted);
}

.inspect-btn {
  margin-left: auto;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid rgba(79,124,255,0.3);
  background: rgba(79,124,255,0.08);
  color: var(--accent-2);
  cursor: pointer;
  transition: all 0.15s;
}

.inspect-btn:hover {
  background: rgba(79,124,255,0.18);
  border-color: rgba(79,124,255,0.5);
}

.job-url {
  font-size: 11px;
  color: var(--muted);
  font-family: "JetBrains Mono", monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-card-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.job-progress-pct {
  font-size: 10px;
  font-family: "JetBrains Mono", monospace;
  color: var(--muted);
  min-width: 30px;
}

.job-msg {
  flex: 1;
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-actions { display: flex; gap: 4px; margin-left: auto; }

.act-btn {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid rgba(199,210,254,0.12);
  background: rgba(9,14,26,0.8);
  color: var(--muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 11px;
  transition: all 0.15s;
}

.act-btn:hover { background: rgba(79,124,255,0.12); color: var(--text); border-color: rgba(79,124,255,0.3); }
.act-btn.retry:hover { color: #fbbf24; border-color: rgba(251,191,36,0.3); background: rgba(251,191,36,0.08); }
.act-btn.cancel:hover { color: #fca5a5; border-color: rgba(252,165,165,0.3); background: rgba(252,165,165,0.08); }

/* Track info */
.track-info-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: rgba(79,124,255,0.05);
  border: 1px solid rgba(79,124,255,0.12);
  border-radius: 8px;
}

.track-counter {
  display: flex;
  align-items: baseline;
  gap: 1px;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.track-counter-current { color: var(--accent-2, #818cf8); }
.track-counter-sep { color: var(--muted); font-weight: 400; }
.track-counter-total { color: var(--muted); font-weight: 400; }

.track-name {
  flex: 1;
  font-size: 11px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-dots {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.track-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(199,210,254,0.1);
  transition: all 0.3s ease;
}

.track-dot.done {
  background: rgba(79,124,255,0.6);
  box-shadow: 0 0 4px rgba(79,124,255,0.3);
}

.track-dot.active {
  background: var(--accent-2, #818cf8);
  box-shadow: 0 0 6px rgba(129,140,248,0.5);
  animation: dotPulse 1.2s ease infinite;
}

@keyframes dotPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.3); }
}
</style>
