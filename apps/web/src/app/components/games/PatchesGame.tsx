"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { color, radius } from "@conclave/ui-tokens";
import { GameLobby, HEAD_FONT, type GameViewProps } from "./gameUi";

type PatchShape = "square" | "wide" | "tall";
type Clue = {
  id: string;
  cell: number;
  size: number | null;
  shape: PatchShape | null;
};
type Placement = { clueId: string; row: number; col: number; height: number; width: number };
type PatchesPublic = {
  phase: "lobby" | "playing" | "results";
  gridSize: number;
  clues: Clue[];
  roundStartedAt: number | null;
  serverNow: number;
  currentRound: number;
  totalRounds: number;
  isFinalRound: boolean;
  standings: Array<{ playerId: string; playerName: string; patchesPlaced: number; outcome: "win" | null; hintsUsed: number }>;
  scores: Array<{ playerId: string; playerName: string; score: number }>;
  result: { winnerId: string | null; solution: Placement[] } | null;
};
type PatchesMe = { patches: Placement[]; outcome: "win" | null; hintsUsed: number };
type Drag = { start: number; end: number };

const CLUE_COLORS = [
  "#00a86b",
  "#2bb8ff",
  "#e2b43b",
  "#f98043",
  "#0798a7",
  "#895df4",
  "#ec5e86",
  "#7086d4",
];
const clueGeometry: Record<
  PatchShape,
  { width: string; height: string; borderRadius: number }
> = {
  square: { width: "58%", height: "58%", borderRadius: 5 },
  wide: { width: "78%", height: "43%", borderRadius: 5 },
  tall: { width: "43%", height: "78%", borderRadius: 5 },
};
const numberClueGeometry = {
  width: "58%",
  height: "58%",
  borderRadius: 5,
};

const formatElapsedTime = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : seconds.toString().padStart(2, "0");
};

const useElapsedTime = (
  roundStartedAt: number | null,
  serverNow: number | null,
): number => {
  const [elapsed, setElapsed] = useState(0);
  const baseRef = useRef({ roundStartedAt, serverNow, at: Date.now() });

  useEffect(() => {
    if (roundStartedAt == null || serverNow == null) {
      setElapsed(0);
      return;
    }

    baseRef.current = { roundStartedAt, serverNow, at: Date.now() };
    const update = () => {
      const base = baseRef.current;
      if (base.roundStartedAt == null || base.serverNow == null) {
        setElapsed(0);
        return;
      }
      setElapsed(Math.max(0, base.serverNow - base.roundStartedAt + Date.now() - base.at));
    };
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [roundStartedAt, serverNow]);

  return elapsed;
};

const cellsFor = (patch: Placement, size: number): number[] => {
  const cells: number[] = [];
  for (let row = patch.row; row < patch.row + patch.height; row++) {
    for (let col = patch.col; col < patch.col + patch.width; col++) cells.push(row * size + col);
  }
  return cells;
};

export default function PatchesGame({ pub, me, players, isAdmin, readOnly = false, move }: GameViewProps<PatchesPublic, PatchesMe>) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragStartRef = useRef<number | null>(null);
  const elapsedMs = useElapsedTime(
    pub.phase === "playing" ? pub.roundStartedAt : null,
    pub.phase === "playing" ? pub.serverNow : null,
  );

  const shownPatches = pub.phase === "results" && me.patches.length === 0 ? pub.result?.solution ?? [] : me.patches;
  const clueColorById = useMemo(
    () => new Map(pub.clues.map((clue, index) => [clue.id, CLUE_COLORS[index % CLUE_COLORS.length]])),
    [pub.clues],
  );
  const patchByCell = useMemo(() => {
    const map = new Map<number, { patch: Placement; color: string }>();
    shownPatches.forEach((patch) => {
      const patchColor = clueColorById.get(patch.clueId) ?? CLUE_COLORS[0];
      for (const cell of cellsFor(patch, pub.gridSize)) map.set(cell, { patch, color: patchColor });
    });
    return map;
  }, [clueColorById, pub.gridSize, shownPatches]);
  const clueByCell = useMemo(() => new Map(pub.clues.map((clue) => [clue.cell, clue])), [pub.clues]);

  const runMove = async (type: string, payload?: unknown) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await move(type, payload);
      if (!result.success) setError(result.error ?? "That patch does not fit");
    } catch {
      setError("Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const cellFromEvent = (event: React.PointerEvent<HTMLDivElement>): number | null => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const col = Math.floor(((event.clientX - bounds.left) / bounds.width) * pub.gridSize);
    const row = Math.floor(((event.clientY - bounds.top) / bounds.height) * pub.gridSize);
    return row < 0 || col < 0 || row >= pub.gridSize || col >= pub.gridSize ? null : row * pub.gridSize + col;
  };

  const selectionCells = useMemo(() => {
    if (!drag) return new Set<number>();
    const startRow = Math.floor(drag.start / pub.gridSize);
    const startCol = drag.start % pub.gridSize;
    const endRow = Math.floor(drag.end / pub.gridSize);
    const endCol = drag.end % pub.gridSize;
    const cells = new Set<number>();
    for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row++) {
      for (let col = Math.min(startCol, endCol); col <= Math.max(startCol, endCol); col++) cells.add(row * pub.gridSize + col);
    }
    return cells;
  }, [drag, pub.gridSize]);

  if (pub.phase === "lobby") {
    return <GameLobby gameId="patches" title="Fill the grid with rectangles" blurb="Some clues reveal an area, some reveal a shape, and some reveal both." players={players} isAdmin={isAdmin} readOnly={readOnly} onStart={() => void runMove("start")} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div>
          <p style={{ fontFamily: HEAD_FONT, fontSize: 20, color: color.text, margin: 0 }}>Patches</p>
          <p style={{ color: color.textMuted, fontSize: 12.5, margin: "3px 0 0" }}>Drag to draw. Blank tiles reveal shape only.</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, color: color.textMuted, fontFamily: HEAD_FONT, fontSize: 10 }}>Elapsed</p>
          <p style={{ margin: "2px 0 0", color: color.text, fontFamily: HEAD_FONT, fontSize: 16 }}>{formatElapsedTime(elapsedMs)}</p>
          <p style={{ margin: "3px 0 0", color: color.textMuted, fontSize: 12 }}>{me.patches.length}/{pub.clues.length} patches</p>
        </div>
      </div>

      <div
        role="grid"
        aria-label="Patches puzzle grid"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${pub.gridSize}, minmax(0, 1fr))`,
          aspectRatio: "1",
          overflow: "hidden",
          padding: 3,
          borderRadius: radius.lg,
          border: "1px solid rgba(255,255,255,0.16)",
          background: "#15161b",
          boxShadow: "0 18px 48px rgba(0,0,0,0.24), inset 0 1px rgba(255,255,255,0.05)",
          touchAction: "none",
          userSelect: "none",
        }}
        onPointerDown={(event) => {
          if (readOnly || me.outcome || pub.phase !== "playing") return;
          const cell = cellFromEvent(event);
          if (cell == null) return;
          const placed = patchByCell.get(cell)?.patch;
          if (placed) {
            void runMove("remove", { cell });
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          dragStartRef.current = cell;
          setDrag({ start: cell, end: cell });
        }}
        onPointerMove={(event) => {
          if (dragStartRef.current == null) return;
          const cell = cellFromEvent(event);
          if (cell != null) setDrag({ start: dragStartRef.current, end: cell });
        }}
        onPointerUp={(event) => {
          const start = dragStartRef.current;
          const end = cellFromEvent(event);
          dragStartRef.current = null;
          setDrag(null);
          if (start != null && end != null) void runMove("place", { start, end });
        }}
        onPointerCancel={() => { dragStartRef.current = null; setDrag(null); }}
      >
        {Array.from({ length: pub.gridSize * pub.gridSize }, (_, cell) => {
          const clue = clueByCell.get(cell);
          const filled = patchByCell.get(cell);
          const clueColor = clue ? clueColorById.get(clue.id) ?? CLUE_COLORS[0] : null;
          const geometry = clue
            ? clue.shape
              ? clueGeometry[clue.shape]
              : numberClueGeometry
            : null;
          return (
            <div
              key={cell}
              role="gridcell"
              style={{
                position: "relative",
                display: "grid",
                placeItems: "center",
                minWidth: 0,
                minHeight: 0,
                background: filled?.color ?? (selectionCells.has(cell) ? "rgba(255,255,255,0.16)" : "#21232b"),
                borderRight: cell % pub.gridSize === pub.gridSize - 1 ? "none" : "1px dashed rgba(255,255,255,0.18)",
                borderBottom: Math.floor(cell / pub.gridSize) === pub.gridSize - 1 ? "none" : "1px dashed rgba(255,255,255,0.18)",
                transition: "background 100ms ease",
              }}
            >
              {clue && clueColor ? (
                <span
                  title={
                    clue.size == null
                      ? `${clue.shape} patch, size hidden`
                      : clue.shape == null
                        ? `${clue.size} cells, shape hidden`
                        : `${clue.size} cells, ${clue.shape} patch`
                  }
                  aria-label={
                    clue.size == null
                      ? `${clue.shape} patch, size hidden`
                      : clue.shape == null
                        ? `${clue.size} cells, shape hidden`
                        : `${clue.size} cells, ${clue.shape} patch`
                  }
                  style={{
                    position: "relative",
                    width: geometry?.width,
                    height: geometry?.height,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: geometry?.borderRadius,
                    background: clueColor,
                    color: "#fff",
                    fontFamily: HEAD_FONT,
                    fontWeight: 700,
                    fontSize: "clamp(12px, 3.5vw, 20px)",
                    lineHeight: 1,
                    boxShadow: `0 4px 10px ${clueColor}55`,
                    pointerEvents: "none",
                    zIndex: 1,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: geometry?.borderRadius,
                      border: `1px dashed ${clueColor}`,
                      background: `${clueColor}55`,
                      transform: "translate(16%, 16%)",
                      zIndex: -1,
                    }}
                  />
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: geometry?.borderRadius,
                      border: `1px dashed ${clueColor}`,
                      background: `${clueColor}33`,
                      transform: "translate(-12%, -12%)",
                      zIndex: -1,
                    }}
                  />
                  {clue.size ?? null}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? <p style={{ margin: 0, color: "#ff8c8c", fontSize: 12.5 }}>{error}</p> : null}
      {pub.phase === "playing" && !readOnly && !me.outcome ? (
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" disabled={busy} onClick={() => void runMove("hint")} style={{ flex: 1, minHeight: 36, border: 0, borderRadius: radius.md, background: "rgba(101,120,245,0.22)", color: "#dce2ff", fontWeight: 600, cursor: "pointer" }}>Hint {me.hintsUsed ? `(${me.hintsUsed})` : ""}</button>
          <button type="button" disabled={busy || me.patches.length === 0} onClick={() => void runMove("reset")} style={{ flex: 1, minHeight: 36, border: "1px solid rgba(255,255,255,0.14)", borderRadius: radius.md, background: "transparent", color: color.text, fontWeight: 600, cursor: "pointer" }}>Reset</button>
        </div>
      ) : null}

      {pub.phase === "results" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, textAlign: "center" }}>
          <p style={{ margin: 0, color: color.text, fontFamily: HEAD_FONT, fontSize: 16 }}>
            {pub.isFinalRound ? "Puzzle complete" : `Round ${pub.currentRound} complete`}
          </p>
          {pub.totalRounds > 1 && pub.scores.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, textAlign: "left" }}>
              {pub.scores.map((entry, index) => (
                <div key={entry.playerId} style={{ display: "flex", justifyContent: "space-between", padding: "6px 9px", borderRadius: radius.sm, background: index === 0 ? "rgba(101,120,245,0.18)" : "transparent", color: color.text, fontSize: 12.5 }}>
                  <span>{entry.playerName}</span><span>{entry.score} pts</span>
                </div>
              ))}
            </div>
          ) : null}
          {!pub.isFinalRound && isAdmin && !readOnly ? (
            <button type="button" disabled={busy} onClick={() => void runMove("nextRound")} style={{ minHeight: 38, border: 0, borderRadius: radius.md, background: "#6578f5", color: "#fff", fontFamily: HEAD_FONT, fontWeight: 700, cursor: "pointer", opacity: busy ? 0.5 : 1 }}>Next Round</button>
          ) : !pub.isFinalRound ? (
            <p style={{ margin: 0, color: color.textMuted, fontSize: 12 }}>Waiting for the host to start the next round...</p>
          ) : null}
        </div>
      ) : null}

      <div style={{ borderTop: "1px solid rgba(255,255,255,0.10)", paddingTop: 12 }}>
        <p style={{ margin: 0, color: color.textMuted, fontSize: 12, fontWeight: 600 }}>Players</p>
        {pub.standings.map((standing) => <div key={standing.playerId} style={{ display: "flex", justifyContent: "space-between", marginTop: 7, fontSize: 12.5, color: color.text }}><span>{standing.playerName}</span><span style={{ color: standing.outcome === "win" ? "#8ee7c5" : color.textMuted }}>{standing.outcome === "win" ? "Solved" : `${standing.patchesPlaced} patches`}</span></div>)}
      </div>
    </div>
  );
}
