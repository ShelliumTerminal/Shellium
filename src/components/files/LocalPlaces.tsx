import { useCallback, useEffect, useState } from "react";
import { Disc, Download, FileText, HardDrive, Home, Monitor, Network, RefreshCw, Usb } from "lucide-react";
import type { LocalDrive, LocalPlace } from "../../shellium-env";
import { formatSize } from "./fileModel";

type LocalPlacesProps = {
  cwd: string;
  busy: boolean;
  onNavigate: (path: string) => void;
};

const PLACE_ICONS = { home: Home, desktop: Monitor, documents: FileText, downloads: Download };
const DRIVE_ICONS = { fixed: HardDrive, volume: HardDrive, removable: Usb, network: Network, optical: Disc };

/** "C:\" -> "C:", "/Volumes/USB" stays as it is. */
function driveName(drive: LocalDrive) {
  return /^[A-Za-z]:\\$/.test(drive.path) ? drive.path.slice(0, 2) : drive.path;
}

/** Windows paths compare without case and with either slash. */
function comparable(value: string) {
  const normalized = value.replace(/\\/g, "/");
  return /^[A-Za-z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
}

function contains(parent: string, child: string) {
  const a = comparable(parent).replace(/\/+$/, "");
  const b = comparable(child);
  return a === "" ? b.startsWith("/") : b === a || b.startsWith(a + "/");
}

/**
 * Left sidebar of the local file pane: well-known folders and the drives / volumes of this computer
 * (`localFiles:places`), like Explorer's navigation pane. The entry that holds the current folder is
 * highlighted (the longest match, so Desktop wins over Home and C:).
 */
export default function LocalPlaces({ cwd, busy, onNavigate }: LocalPlacesProps) {
  const [places, setPlaces] = useState<LocalPlace[]>([]);
  const [drives, setDrives] = useState<LocalDrive[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    const api = window.shellium?.localFiles;
    if (!api?.places) {
      return;
    }
    setLoading(true);
    api.places()
      .then((result) => {
        setPlaces(result.places);
        setDrives(result.drives);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const current = [...places.map((place) => place.path), ...drives.map((drive) => drive.path)]
    .filter((path) => cwd && contains(path, cwd))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <nav className="ft-places" aria-label="Local drives and folders">
      {places.length > 0 && (
        <div className="ft-places-group">
          <div className="ft-places-head">Folders</div>
          {places.map((place) => {
            const Icon = PLACE_ICONS[place.kind];
            return (
              <button key={place.path} type="button" className={"ft-place" + (place.path === current ? " active" : "")}
                title={place.path} disabled={busy} onClick={() => onNavigate(place.path)}>
                <Icon aria-hidden="true" size={14} />
                <span className="ft-place-label">{place.label}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="ft-places-group">
        <div className="ft-places-head">
          Drives
          <button type="button" className="ft-places-refresh" onClick={load} disabled={loading} title="Refresh drives" aria-label="Refresh drives">
            <RefreshCw aria-hidden="true" size={12} className={loading ? "ft-spin" : undefined} />
          </button>
        </div>
        {drives.map((drive) => {
          const Icon = DRIVE_ICONS[drive.kind];
          const used = drive.totalBytes && drive.freeBytes !== undefined ? 1 - drive.freeBytes / drive.totalBytes : null;
          const space = drive.totalBytes && drive.freeBytes !== undefined
            ? `${formatSize(drive.freeBytes)} free of ${formatSize(drive.totalBytes)}` : "";
          return (
            <button key={drive.path} type="button" className={"ft-place ft-drive" + (drive.path === current ? " active" : "")}
              title={[drive.path, space].filter(Boolean).join(" - ")} disabled={busy} onClick={() => onNavigate(drive.path)}>
              <Icon aria-hidden="true" size={14} />
              <span className="ft-place-label">
                {drive.label} <span className="ft-place-name">({driveName(drive)})</span>
              </span>
              {used !== null && (
                <span className={"ft-drive-usage" + (used >= 0.9 ? " full" : "")} aria-hidden="true">
                  <span style={{ width: `${Math.round(used * 100)}%` }} />
                </span>
              )}
            </button>
          );
        })}
        {drives.length === 0 && !loading && <div className="ft-places-empty">No drives found</div>}
      </div>
    </nav>
  );
}
