import { watch, type Ref } from 'vue'

export function useOverlayExclusion(primary: Ref<boolean>, secondary: Ref<boolean>): void {
  watch(
    [primary, secondary],
    ([primaryOpen, secondaryOpen], [wasPrimaryOpen, wasSecondaryOpen]) => {
      if (primaryOpen && !wasPrimaryOpen) secondary.value = false
      else if (secondaryOpen && !wasSecondaryOpen) primary.value = false
    },
    { immediate: true }
  )
}
