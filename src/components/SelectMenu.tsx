import React, { useCallback, useEffect, useId, useRef, useState } from 'react';

export interface SelectMenuOption {
  value: string;
  label: string;
  description?: string;
}

interface SelectMenuProps {
  id: string;
  value: string;
  options: SelectMenuOption[];
  placeholder: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export const SelectMenu: React.FC<SelectMenuProps> = ({
  id,
  value,
  options,
  placeholder,
  onChange,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isRendered, setIsRendered] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const activeIndexRef = useRef(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const closeTimerRef = useRef<number>();
  const generatedId = useId();
  const listboxId = `${id}-${generatedId.replace(/:/g, '')}-listbox`;
  const selectedOption = options.find((option) => option.value === value);
  const selectedIndex = options.findIndex((option) => option.value === value);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    closeTimerRef.current = window.setTimeout(() => setIsRendered(false), 140);
  }, []);

  const selectOption = useCallback((nextValue: string) => {
    onChange(nextValue);
    closeMenu();
    triggerRef.current?.focus();
  }, [closeMenu, onChange]);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [closeMenu, isOpen]);

  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
      setIsRendered(false);
    }
  }, [disabled]);

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);

  useEffect(() => {
    if (isOpen && activeIndex >= 0) {
      optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, isOpen]);

  const openMenu = (initialIndex = selectedIndex >= 0 ? selectedIndex : 0) => {
    window.clearTimeout(closeTimerRef.current);
    activeIndexRef.current = initialIndex;
    setActiveIndex(initialIndex);
    setIsRendered(true);
    setIsOpen(true);
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        openMenu(event.key === 'ArrowDown' ? Math.max(selectedIndex, 0) : options.length - 1);
      } else {
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = (activeIndexRef.current + direction + options.length) % options.length;
        activeIndexRef.current = nextIndex;
        setActiveIndex(nextIndex);
      }
    } else if (isOpen && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0 : options.length - 1;
      activeIndexRef.current = nextIndex;
      setActiveIndex(nextIndex);
    } else if (isOpen && event.key === 'Enter' && activeIndexRef.current >= 0) {
      event.preventDefault();
      selectOption(options[activeIndexRef.current].value);
    }
  };

  return (
    <div className="select-menu" ref={rootRef}>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className="select-menu-trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => isOpen ? closeMenu() : openMenu()}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={`select-menu-value${selectedOption ? '' : ' is-placeholder'}`}>
          {selectedOption?.label ?? placeholder}
        </span>
        <svg className="select-menu-chevron" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 6 3 3 3-3" />
        </svg>
      </button>

      {isRendered && (
        <div id={listboxId} className={`select-menu-popover${isOpen ? '' : ' is-closing'}`} role="listbox" aria-labelledby={id}>
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                id={`${listboxId}-option-${index}`}
                ref={(node) => { optionRefs.current[index] = node; }}
                type="button"
                tabIndex={-1}
                className={`select-menu-option${isSelected ? ' is-selected' : ''}${index === activeIndex ? ' is-active' : ''}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => selectOption(option.value)}
                onPointerMove={() => {
                  activeIndexRef.current = index;
                  setActiveIndex(index);
                }}
              >
                <span className="select-menu-option-copy">
                  <span className="select-menu-option-label">{option.label}</span>
                  {option.description && <span className="select-menu-option-description">{option.description}</span>}
                </span>
                <svg className="select-menu-check" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m3.5 8 3 3 6-6" />
                </svg>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
