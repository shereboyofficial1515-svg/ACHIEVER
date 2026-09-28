import { useRef } from 'react';

// The admin platform favours density and speed over motion: dialogs appear instantly.
export function useDialogMotion() {
  return useRef(null);
}
