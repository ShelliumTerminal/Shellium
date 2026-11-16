import { CornerDownLeft, Search, Zap } from "lucide-react";
import type { KeyboardEventHandler } from "react";

type SearchBoxProps = {
  value: string;
  onChange: (value: string) => void;
  matchCount?: number;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  /** Nothing matches but the text reads as user@host:port: offered as a quick connect (Enter). */
  quickConnect?: { label: string; onConnect(): void } | null;
};

export default function SearchBox({
  value,
  onChange,
  matchCount,
  onKeyDown,
  quickConnect,
}: SearchBoxProps) {
  return (
    <div className="pl-search">
      <Search size={15} aria-hidden="true" />
      <input
        autoFocus
        type="text"
        placeholder="Search host, IP, tag or description..."
        aria-label="Search hosts"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {value.trim() && matchCount !== undefined && (
        <span className="pl-search-count">
          {matchCount === 1 ? "1 match" : `${matchCount} matches`}
        </span>
      )}
      {quickConnect && (
        <button
          type="button"
          className="pl-quick-connect"
          title={`Connect to ${quickConnect.label} without saving it (Enter)`}
          onClick={quickConnect.onConnect}
        >
          <Zap size={13} aria-hidden="true" />
          Quick connect
          <CornerDownLeft size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
