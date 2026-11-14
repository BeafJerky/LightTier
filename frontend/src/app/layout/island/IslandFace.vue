<script setup lang="ts">
withDefaults(
  defineProps<{
    mood?: 'calm' | 'sleepy' | 'happy' | 'worried' | 'excited' | 'concerned'
    animate?: boolean
  }>(),
  { mood: 'calm', animate: true }
)
</script>

<template>
  <span
    class="island-face"
    :class="[`mood-${mood}`, { 'is-animated': animate }]"
    aria-hidden="true"
  >
    <span class="island-face-eye left"></span>
    <span class="island-face-eye right"></span>
    <span class="island-face-mouth"></span>
  </span>
</template>

<style scoped>
.island-face {
  position: relative;
  display: block;
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  background: rgb(var(--theme-accent-primary-rgb, 232, 160, 160), 0.22);
  border-radius: 50%;
}

.island-face-eye {
  position: absolute;
  top: 9px;
  width: 2.5px;
  height: 2.5px;
  background: var(--theme-text-primary, #4a3728);
  border-radius: 50%;
}

.island-face-eye.left {
  left: 7px;
}

.island-face-eye.right {
  right: 7px;
}

.island-face-mouth {
  position: absolute;
  bottom: 6px;
  left: 50%;
  width: 7px;
  height: 4px;
  border: 1.5px solid var(--theme-text-primary, #4a3728);
  border-top: none;
  border-right-color: transparent;
  border-left-color: transparent;
  border-radius: 0 0 7px 7px;
  transform: translateX(-50%);
}

.mood-sleepy .island-face-eye {
  top: 10px;
  height: 1.5px;
  border-radius: 1px;
}

.mood-sleepy .island-face-mouth {
  width: 4px;
  height: 2px;
}

.mood-happy .island-face-mouth {
  width: 9px;
  height: 5px;
}

.mood-worried .island-face-mouth {
  bottom: 4px;
  transform: translateX(-50%) rotate(180deg);
}

.mood-worried .island-face-eye {
  width: 2px;
  height: 2px;
}

.mood-excited .island-face-eye {
  top: 8px;
  width: 3.5px;
  height: 3.5px;
}

.mood-excited .island-face-mouth {
  bottom: 5px;
  width: 5px;
  height: 5px;
  border: 1.5px solid var(--theme-text-primary, #4a3728);
  border-radius: 50%;
}

.mood-concerned .island-face-mouth {
  bottom: 7px;
  width: 7px;
  height: 0;
  border-bottom: none;
  border-radius: 0;
}

.is-animated {
  animation: island-breathe 5.6s ease-in-out infinite;
}

.is-animated .island-face-eye {
  animation: island-blink 8.4s ease-in-out infinite;
  transform-origin: center;
}

@keyframes island-breathe {
  0%,
  100% {
    transform: scale(1);
  }

  50% {
    transform: scale(1.022);
  }
}

@keyframes island-blink {
  0%,
  92%,
  100% {
    transform: scaleY(1);
  }

  95% {
    transform: scaleY(0.12);
  }
}

@media (prefers-reduced-motion: reduce) {
  .is-animated,
  .is-animated .island-face-eye {
    animation: none;
  }
}
</style>
