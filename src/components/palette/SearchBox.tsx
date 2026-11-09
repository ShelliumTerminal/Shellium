import { Search } from "lucide-react";
import type { KeyboardEventHandler } from "react";

type SearchBoxProps = {
  value: string;
  onChange: (value: string) => void;
  matchCount?: number;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
};

export default function SearchBox({
  value,
  onChange,
  matchCount,
  onKeyDown,
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
    </div>
  );
}
