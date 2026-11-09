import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { Ellipsis } from "lucide-react";
import type { ScriptButtonBarPosition } from "../../app/appOptions";
import { normalizeScriptButtonBarSize } from "../../app/appOptions";
import { getScriptButtonStatusStyle } from "../../app/scriptButtonModel";
import type { ScriptButton } from "../../app/scriptButtonModel";
import type { ScriptButtonLibraryState } from "../../app/useScriptButtonLibrary";
import { useEscapeLayer } from "../../app/escapeLayers";
import { useScriptButtonTooltip } from "./ScriptButtonTooltip";

type ScriptBarProps = {
  library: ScriptButtonLibraryState;
  position: ScriptButtonBarPosition;
  /** Width of a left / right bar. */
  size: number;
  onResize(size: number): void;
  disabled: boolean;
  onRun(button: ScriptButton): void;
  onButtonContextMenu(event: ReactMouseEvent, buttonId: string): void;
  /** The "N more" menu; the parent keeps it to block terminal input while it is open. */
  isOverflowOpen: boolean;
  onOverflowOpenChange(open: boolean): void;
};

/**
 * The script button bar next to the terminal. A horizontal bar shows as many buttons as fit and
 * puts the rest in a "more" menu; the measurement assumes a 6px gap, 12px padding and a 78px
 * "more" button (see shell.css).
 */
export default function ScriptBar({
  library,
  position,
  size,
  onResize,
  disabled,
  onRun,
  onButtonContextMenu,
  isOverflowOpen,
  onOverflowOpenChange,
}: ScriptBarProps) {
  const [visibleCount, setVisibleCount] = useState(Number.MAX_SAFE_INTEGER);
  const [overflowMaxHeight, setOverflowMaxHeight] = useState<number | null>(null);
  const barRef = useRef<HTMLElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  const tooltip = useScriptButtonTooltip();
  const barTooltipSide = position === "top" ? "bottom" : position === "bottom" ? "top" : position === "left" ? "right" : "left";
  const activeButtons = library.activeButtons;
  const isHorizontal = position === "bottom" || position === "top";
  const visibleButtons = isHorizontal ? activeButtons.slice(0, visibleCount) : activeButtons;
  const overflowButtons = isHorizontal ? activeButtons.slice(visibleCount) : [];
  const barStyle = isHorizontal ? undefined : ({ "--script-bar-size": `${size}px` } as CSSProperties);
  const overflowMenuStyle = overflowMaxHeight === null
    ? undefined
    : ({ "--script-overflow-menu-max-height": `${overflowMaxHeight}px` } as CSSProperties);

  useEscapeLayer(() => onOverflowOpenChange(false), isOverflowOpen);

  useEffect(() => {
    if (!isOverflowOpen) {
      return;
    }

    const closeMenu = () => onOverflowOpenChange(false);

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest(".sh-scriptbar-overflow")) {
        return;
      }

      closeMenu();
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [isOverflowOpen, onOverflowOpenChange]);

  useLayoutEffect(() => {
    if (!isOverflowOpen || !isHorizontal) {
      setOverflowMaxHeight(null);
      return;
    }

    const overflowContainer = overflowRef.current;
    if (!overflowContainer) {
      return;
    }

    const rect = overflowContainer.getBoundingClientRect();
    const viewportPadding = 12;
    const availableHeight = position === "top"
      ? window.innerHeight - rect.bottom - viewportPadding
      : rect.top - viewportPadding;

    setOverflowMaxHeight(Math.max(96, Math.floor(availableHeight)));
  }, [isHorizontal, isOverflowOpen, position, overflowButtons.length]);

  useLayoutEffect(() => {
    if (!isHorizontal) {
      setVisibleCount(Number.MAX_SAFE_INTEGER);
      onOverflowOpenChange(false);
      return;
    }

    const bar = barRef.current;
    const measure = measureRef.current;

    if (!bar || !measure) {
      return;
    }

    const measureButtons = () => {
      const categorySelect = bar.querySelector<HTMLElement>(".sh-scriptbar-category");
      const measuredButtons = Array.from(measure.querySelectorAll<HTMLElement>("button[data-script-button-measure]"));
      const gap = 6;
      const sidePadding = 12;
      const categoryWidth = categorySelect?.offsetWidth ?? 0;
      const moreButtonWidth = 78;
      const totalButtonsWidth = measuredButtons.reduce((total, button, index) => total + button.offsetWidth + (index > 0 ? gap : 0), 0);
      const baseWidth = categoryWidth + gap + sidePadding;
      const availableWithoutMenu = Math.max(0, bar.clientWidth - baseWidth);

      if (totalButtonsWidth <= availableWithoutMenu) {
        setVisibleCount(activeButtons.length);
        onOverflowOpenChange(false);
        return;
      }

      const availableWithMenu = Math.max(0, bar.clientWidth - baseWidth - moreButtonWidth - gap);
      let usedWidth = 0;
      let nextVisibleCount = 0;

      for (const button of measuredButtons) {
        const nextWidth = usedWidth + button.offsetWidth + (nextVisibleCount > 0 ? gap : 0);

        if (nextWidth > availableWithMenu) {
          break;
        }

        usedWidth = nextWidth;
        nextVisibleCount += 1;
      }

      setVisibleCount(nextVisibleCount);
    };

    measureButtons();

    const resizeObserver = new ResizeObserver(measureButtons);
    resizeObserver.observe(bar);
    // The measure row changes width when button text re-renders in another font (the bundled
    // UI font finishing loading, or a new UI font size) even though the bar itself does not.
    resizeObserver.observe(measure);
    return () => resizeObserver.disconnect();
    // onOverflowOpenChange is a state setter wrapper; re-measuring on its identity is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeButtons, isHorizontal]);

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (isHorizontal) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = size;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      onResize(normalizeScriptButtonBarSize(position === "left" ? startWidth + delta : startWidth - delta));
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  return (
    <nav
      className={`sh-scriptbar sh-scriptbar-at-${position} ${isHorizontal ? "sh-scriptbar-h" : "sh-scriptbar-v"}`}
      aria-label="Script buttons" style={barStyle} ref={barRef}>
      {!isHorizontal && (
        <button
          className="sh-scriptbar-resizer"
          type="button"
          aria-label="Resize script button bar"
          onPointerDown={handleResizePointerDown}
        />
      )}
      <select
        className="sh-scriptbar-category"
        aria-label="Script button category"
        value={library.selectedCategory?.id ?? ""}
        onChange={(event) => {
          library.setSelectedCategoryId(event.target.value);
          onOverflowOpenChange(false);
        }}
      >
        {library.categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
      {activeButtons.length === 0 && <span className="sh-scriptbar-empty">No script buttons in this category</span>}
      {visibleButtons.map((button) => (
        <button
          key={button.id}
          type="button"
          className="sh-script"
          disabled={disabled}
          title={button.showTooltip ? undefined : button.label}
          {...tooltip.bind(button, barTooltipSide)}
          onClick={() => onRun(button)}
          onContextMenu={(event) => onButtonContextMenu(event, button.id)}
        >
          <span className="sh-script-dot" style={getScriptButtonStatusStyle(button.color)} aria-hidden="true" />
          <span className="sh-script-label">{button.label}</span>
        </button>
      ))}
      {overflowButtons.length > 0 && (
        <div className="sh-scriptbar-overflow" ref={overflowRef}>
          <button
            className="sh-scriptbar-more"
            type="button"
            aria-haspopup="menu"
            aria-expanded={isOverflowOpen}
            onClick={() => {
              tooltip.hide();
              onOverflowOpenChange(!isOverflowOpen);
            }}
          >
            <Ellipsis size={15} />
            {overflowButtons.length} more
          </button>
          {isOverflowOpen && (
            <div className="sh-scriptbar-menu" style={overflowMenuStyle} role="menu" aria-label="More script buttons">
              {overflowButtons.map((button) => (
                <button
                  key={button.id}
                  type="button"
                  role="menuitem"
                  disabled={disabled}
                  title={button.showTooltip ? undefined : button.label}
                  {...tooltip.bind(button, "left")}
                  onClick={() => {
                    onOverflowOpenChange(false);
                    onRun(button);
                  }}
                  onContextMenu={(event) => onButtonContextMenu(event, button.id)}
                >
                  <span className="sh-script-dot" style={getScriptButtonStatusStyle(button.color)} aria-hidden="true" />
                  <span className="sh-script-label">{button.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {isHorizontal && (
        <div className="sh-scriptbar-measure" ref={measureRef} aria-hidden="true">
          {activeButtons.map((button) => (
            <button key={button.id} type="button" className="sh-script" data-script-button-measure tabIndex={-1}>
              <span className="sh-script-dot" style={getScriptButtonStatusStyle(button.color)} aria-hidden="true" />
              <span className="sh-script-label">{button.label}</span>
            </button>
          ))}
        </div>
      )}
      {tooltip.tooltip}
    </nav>
  );
}
