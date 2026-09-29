import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ForMe } from "./ForMe";
import { ForSchool } from "./ForSchool";
import type { WaitlistRequest } from "./useWaitlistDialog";
import type { Side } from "./waitlist";
import "./waitlist.css";

/** How long the old side takes to leave before the dialog changes shape. */
const SWAP_OUT_MS = 120;
const SIDES: { value: Side; label: string }[] = [
  { value: "me", label: "For me" },
  { value: "school", label: "For my school" },
];

function SideSwitch({
  side,
  onChange,
}: {
  side: Side;
  onChange: (side: Side) => void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault();
    const other = side === "me" ? "school" : "me";
    onChange(other);
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-side="${other}"]`)
      ?.focus();
  }
  return (
    <div
      className="lp-wl-switch"
      role="radiogroup"
      aria-label="Who is joining"
      data-side={side}
      onKeyDown={onKeyDown}
    >
      <span className="lp-wl-switch-thumb" aria-hidden="true" />
      {SIDES.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          data-side={value}
          aria-checked={value === side}
          tabIndex={value === side ? 0 : -1}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

type PopupProps = {
  request: WaitlistRequest;
  trigger: RefObject<HTMLElement | null>;
  onSide: (side: Side) => void;
};

function WaitlistPopup({ request, trigger, onSide }: PopupProps) {
  const [side, setSide] = useState<Side>(request.side);
  const [shown, setShown] = useState<Side>(request.side);
  const [leaving, setLeaving] = useState(false);
  const popup = useRef<HTMLDivElement>(null);
  const wash = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const email = useRef<HTMLInputElement>(null);
  const swap = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The popup and its wash are sized to the content, so CSS can ease between sides.
  useLayoutEffect(() => {
    const content = body.current;
    const slot = content?.querySelector<HTMLElement>(".lp-wl-slot");
    if (!content || !slot || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      if (!popup.current || !wash.current) return;
      const frame = popup.current.offsetWidth - popup.current.clientWidth;
      const style = getComputedStyle(popup.current);
      const padX =
        parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY =
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      popup.current.style.width = `${content.offsetWidth + padX + frame}px`;
      popup.current.style.height = `${content.offsetHeight + padY}px`;
      wash.current.style.width = `${slot.offsetWidth}px`;
      wash.current.style.height = `${slot.offsetHeight}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(content);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [shown]);
  useEffect(() => () => clearTimeout(swap.current), []);

  function choose(next: Side) {
    if (next === side) return;
    clearTimeout(swap.current);
    setSide(next);
    onSide(next);
    if (next === shown) {
      setLeaving(false);
      return;
    }
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      setShown(next);
      return;
    }
    setLeaving(true);
    swap.current = setTimeout(() => {
      setShown(next);
      setLeaving(false);
    }, SWAP_OUT_MS);
  }

  const entry = { side: shown, source: request.source, plan: request.plan };
  return (
    <Dialog.Popup
      ref={popup}
      className="lp-wl-popup"
      data-side={side}
      data-wide={shown === "school" ? "" : undefined}
      initialFocus={(type) => (type === "touch" ? true : email.current)}
      finalFocus={trigger}
    >
      <div className="lp-wl-wash" ref={wash} aria-hidden="true">
        <span className="lp-wl-wash-school" />
      </div>
      <SideSwitch side={side} onChange={choose} />
      <div
        className="lp-wl-body"
        ref={body}
        data-leaving={leaving ? "" : undefined}
      >
        {shown === "me" ? (
          <ForMe entry={entry} inputRef={email} />
        ) : (
          <ForSchool entry={entry} />
        )}
      </div>
      <Dialog.Close className="lp-wl-close" aria-label="Close">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M1.5 1.5l9 9m0-9l-9 9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </Dialog.Close>
    </Dialog.Popup>
  );
}

type Props = Omit<PopupProps, "request"> & {
  open: boolean;
  request: WaitlistRequest | null;
  container: RefObject<HTMLElement | null>;
  onClose: () => void;
};

export function WaitlistDialog({
  open,
  request,
  trigger,
  container,
  onClose,
  onSide,
}: Props) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal container={container}>
        <Dialog.Backdrop className="lp-wl-backdrop" />
        <Dialog.Viewport className="lp-wl-viewport">
          {request && (
            <WaitlistPopup
              request={request}
              trigger={trigger}
              onSide={onSide}
            />
          )}
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
