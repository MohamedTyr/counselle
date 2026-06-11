import { createContext, useContext, ReactNode, Context } from 'react';
import { JSX } from 'react/jsx-runtime';
import type { TShowToast } from '@librechat/client/common';
import useToast from '@librechat/client/hooks/useToast';

type ToastContextType = {
  showToast: ({ message, severity, showIcon, duration }: TShowToast) => void;
};

export const ToastContext: Context<ToastContextType> = createContext<ToastContextType>({
  showToast: () => ({}),
});

export function useToastContext(): ToastContextType {
  return useContext(ToastContext);
}

export default function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const { showToast } = useToast();

  return <ToastContext.Provider value={{ showToast }}>{children}</ToastContext.Provider>;
}
