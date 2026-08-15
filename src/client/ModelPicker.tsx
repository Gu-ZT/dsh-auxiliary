/**
 * Provider-grouped model picker used by the auxiliary feature cards.
 *
 * The popup renders through a portal into `document.body`: fixed viewport
 * coordinates then stay relative to the viewport even when an ancestor of the
 * trigger applies a CSS transform (which would otherwise re-base `fixed`
 * children), and no settings card or scroll container clips it. The design
 * tokens the popup reads are defined on `body`, so the portal keeps inheriting
 * them. The component deliberately owns no model data or persistence behavior.
 *
 * @module dsh-auxiliary/client/ModelPicker
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { AuxRoute, ModelProviderGroup } from './api.js';

/** Props for the internal provider-grouped model picker. */
interface ModelPickerProps {
  /** Provider groups currently available from the Host catalog. */
  groups: readonly ModelProviderGroup[];
  /** Saved or drafted provider/model pair. */
  value: AuxRoute;
  /** Called with a complete provider/model pair after an option is chosen. */
  onChange: (value: AuxRoute) => void;
  /** Disables the trigger and all options while the owner is unavailable. */
  disabled?: boolean;
  /** Visible/accessibility label for this picker. */
  label: string;
  /** Placeholder shown when no route has been selected. */
  placeholder: string;
  /** Empty-state copy shown inside the listbox. */
  emptyLabel: string;
  /** Copy shown when the saved route is absent from the live catalog. */
  unavailableLabel: string;
  /** Accessible name for the listbox popup. */
  listLabel: string;
}

interface PopupPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

interface ModelChoice {
  group: ModelProviderGroup;
  model: ModelProviderGroup['models'][number];
}

const rootStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
};

const triggerStyle: CSSProperties = {
  alignItems: 'center',
  appearance: 'none',
  background: 'var(--dsw-alias-bg-layer-1)',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  boxSizing: 'border-box',
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
  display: 'flex',
  font: 'inherit',
  fontSize: 14,
  gap: 8,
  justifyContent: 'space-between',
  lineHeight: '20px',
  minHeight: 36,
  padding: '7px 10px',
  textAlign: 'left',
  width: '100%',
};

const triggerTextStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const triggerHintStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  flexShrink: 0,
  fontSize: 12,
  lineHeight: '18px',
};

const popupStyle = (position: PopupPosition): CSSProperties => ({
  background: 'var(--dsw-alias-bg-layer-1)',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  boxSizing: 'border-box',
  color: 'var(--dsw-alias-label-primary)',
  left: position.left,
  maxHeight: position.maxHeight,
  overflowY: 'auto',
  padding: 4,
  position: 'fixed',
  top: position.top,
  width: position.width,
  zIndex: 1000,
});

const groupStyle: CSSProperties = {
  margin: 0,
  padding: 0,
};

const groupLabelStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
  fontWeight: 500,
  lineHeight: '18px',
  padding: '6px 8px 4px',
};

const optionStyle: CSSProperties = {
  alignItems: 'center',
  appearance: 'none',
  background: 'transparent',
  border: 0,
  borderRadius: 6,
  boxSizing: 'border-box',
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
  display: 'flex',
  font: 'inherit',
  fontSize: 14,
  gap: 8,
  justifyContent: 'space-between',
  lineHeight: '20px',
  padding: '7px 8px',
  textAlign: 'left',
  width: '100%',
};

const optionCopyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
};

const optionNameStyle: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const optionDescriptionStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
  lineHeight: '18px',
  marginTop: 2,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const checkStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-primary)',
  flexShrink: 0,
  fontSize: 16,
  lineHeight: '20px',
  minWidth: 20,
  textAlign: 'center',
};

const emptyStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 13,
  lineHeight: '20px',
  padding: '14px 10px',
  textAlign: 'center',
};

const unavailableStyle: CSSProperties = {
  color: 'var(--dsw-alias-state-warn-label)',
  fontSize: 12,
  lineHeight: '18px',
  margin: '6px 0 0',
};

const initialPosition: PopupPosition = {
  top: 0,
  left: 0,
  width: 280,
  maxHeight: 320,
};

/** Format a route for a trigger whose catalog entry is stale. */
function routeLabel(value: AuxRoute): string {
  return `${value.provider ?? ''} / ${value.model ?? ''}`;
}

/** The provider-grouped model picker. */
export function ModelPicker({
  groups,
  value,
  onChange,
  disabled = false,
  label,
  placeholder,
  emptyLabel,
  unavailableLabel,
  listLabel,
}: ModelPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopupPosition>(initialPosition);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusOnOpen = useRef<'selected' | 'first' | 'last'>('selected');
  const id = useId();

  const choices = useMemo<ModelChoice[]>(
    () => groups.flatMap((group) => group.models.map((model) => ({ group, model }))),
    [groups],
  );
  const selectedChoice = choices.find(
    (choice) => choice.group.id === value.provider && choice.model.id === value.model,
  );
  const hasSavedRoute = (value.provider !== undefined && value.provider !== '')
    || (value.model !== undefined && value.model !== '');
  const stale = hasSavedRoute && selectedChoice === undefined;
  const triggerText = selectedChoice === undefined
    ? stale ? routeLabel(value) : placeholder
    : `${selectedChoice.group.name} / ${selectedChoice.model.name}`;

  const close = useCallback((restoreFocus: boolean): void => {
    setOpen(false);
    if (restoreFocus) {
      queueMicrotask(() => {
        triggerRef.current?.focus();
      });
    }
  }, []);

  const updatePosition = useCallback((): void => {
    const trigger = triggerRef.current;
    if (trigger === null) return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = Math.max(document.documentElement.clientWidth, window.innerWidth);
    const viewportHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
    const margin = 8;
    const width = Math.min(Math.max(rect.width, 280), Math.max(160, viewportWidth - margin * 2));
    const leftLimit = Math.max(margin, viewportWidth - width - margin);
    const left = Math.min(Math.max(margin, rect.left), leftLimit);
    const below = Math.max(80, viewportHeight - rect.bottom - margin);
    const above = Math.max(80, rect.top - margin);
    const openBelow = below >= above;
    const maxHeight = Math.min(360, openBelow ? below : above);
    const top = openBelow
      ? Math.min(viewportHeight - margin, rect.bottom + 4)
      : Math.max(margin, rect.top - maxHeight - 4);
    setPosition({ top, left, width, maxHeight });
  }, []);

  const focusChoice = useCallback((direction: 'next' | 'previous' | 'first' | 'last'): void => {
    if (choices.length === 0) {
      popupRef.current?.focus();
      return;
    }
    const currentIndex = optionRefs.current.findIndex((option) => option === document.activeElement);
    const targetIndex = direction === 'first'
      ? 0
      : direction === 'last'
        ? choices.length - 1
        : direction === 'next'
          ? (currentIndex + 1 + choices.length) % choices.length
          : (currentIndex - 1 + choices.length) % choices.length;
    optionRefs.current[targetIndex]?.focus();
  }, [choices.length]);

  const choose = useCallback((choice: ModelChoice): void => {
    onChange({ provider: choice.group.id, model: choice.model.id });
    close(true);
  }, [close, onChange]);

  const openPicker = useCallback((focus: 'selected' | 'first' | 'last'): void => {
    focusOnOpen.current = focus;
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    // Synchronously position before paint so the popup never flashes at the
    // initial (0,0) rect, and focus the first option without scrolling the
    // page (which would move the trigger away from the fixed popup).
    updatePosition();
    const frame = window.requestAnimationFrame(() => {
      if (choices.length === 0) {
        popupRef.current?.focus({ preventScroll: true });
        return;
      }
      const selectedIndex = choices.findIndex(
        (choice) => choice.group.id === value.provider && choice.model.id === value.model,
      );
      const focus = focusOnOpen.current === 'first'
        ? 0
        : focusOnOpen.current === 'last'
          ? choices.length - 1
          : selectedIndex >= 0 ? selectedIndex : 0;
      optionRefs.current[focus]?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [choices, open, updatePosition, value.model, value.provider]);

  // Re-measure after layout settles (fonts, option rows) so the popup tracks
  // the trigger even when the first paint changed the geometry.
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onOutsidePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      // The popup lives in a body portal, so containment must cover both roots.
      const inside = rootRef.current?.contains(target) === true
        || popupRef.current?.contains(target) === true;
      if (!inside) close(true);
    };
    document.addEventListener('pointerdown', onOutsidePointerDown, true);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('pointerdown', onOutsidePointerDown, true);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [close, open, updatePosition]);

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (open) return;
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker(event.key === 'ArrowDown' ? 'selected' : 'selected');
    } else if (event.key === 'ArrowUp' || event.key === 'End') {
      event.preventDefault();
      openPicker('last');
    } else if (event.key === 'Home') {
      event.preventDefault();
      openPicker('first');
    }
  };

  const onPopupKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!open) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusChoice('next');
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusChoice('previous');
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusChoice('first');
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusChoice('last');
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const index = optionRefs.current.findIndex((option) => option === document.activeElement);
      const choice = index >= 0 ? choices[index] : undefined;
      if (choice !== undefined) {
        event.preventDefault();
        choose(choice);
      }
    }
  };

  let optionIndex = 0;
  return (
    <div ref={rootRef} style={rootStyle}>
      <button
        ref={triggerRef}
        type="button"
        style={{ ...triggerStyle, opacity: disabled ? 0.45 : 1 }}
        disabled={disabled}
        aria-label={`${label}: ${triggerText}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-listbox` : undefined}
        title={triggerText}
        onClick={() => {
          if (open) close(false);
          else openPicker('selected');
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span style={triggerTextStyle}>{triggerText}</span>
        <span style={triggerHintStyle} aria-hidden="true">⌄</span>
      </button>
      {open ? createPortal(
        <div
          ref={popupRef}
          id={`${id}-listbox`}
          role="listbox"
          aria-label={listLabel}
          tabIndex={-1}
          style={popupStyle(position)}
          onKeyDown={onPopupKeyDown}
        >
          {choices.length === 0 ? (
            <div role="status" style={emptyStyle}>{emptyLabel}</div>
          ) : groups.map((group) => {
            const headingId = `${id}-${group.id}`;
            return (
              <div key={group.id} role="group" aria-labelledby={headingId} style={groupStyle}>
                <div id={headingId} style={groupLabelStyle}>{group.name}</div>
                {group.models.map((model) => {
                  const index = optionIndex++;
                  const selected = value.provider === group.id && value.model === model.id;
                  const option = { group, model };
                  return (
                    <button
                      key={`${group.id}/${model.id}`}
                      ref={(node) => { optionRefs.current[index] = node; }}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      tabIndex={-1}
                      disabled={disabled}
                      style={{ ...optionStyle, opacity: disabled ? 0.45 : 1 }}
                      onClick={() => { choose(option); }}
                    >
                      <span style={optionCopyStyle}>
                        <span style={optionNameStyle}>{model.name}</span>
                        {model.description !== undefined ? (
                          <span style={optionDescriptionStyle}>{model.description}</span>
                        ) : null}
                      </span>
                      <span style={checkStyle} aria-hidden="true">{selected ? '✓' : ''}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>,
        document.body,
      ) : null}
      {stale ? (
        <p role="status" style={unavailableStyle}>
          {unavailableLabel}: {routeLabel(value)}
        </p>
      ) : null}
    </div>
  );
}
