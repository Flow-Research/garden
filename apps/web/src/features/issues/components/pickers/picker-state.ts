import { useState } from 'react'

/** Gives property pickers one controlled/uncontrolled state contract. */
export function usePickerOpen(
  controlledOpen?: boolean,
  controlledOnOpenChange?: (open: boolean) => void,
): readonly [boolean, (open: boolean) => void] {
  const [localOpen, setLocalOpen] = useState(false)
  return [
    controlledOpen ?? localOpen,
    controlledOnOpenChange ?? setLocalOpen,
  ] as const
}
