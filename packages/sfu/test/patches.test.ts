import { describe, expect, it } from "vitest";
import { patchesModule } from "../server/games/modules/patches.js";
import { createRng } from "../server/games/rng.js";
import type { GameConfig, GameContext, GamePlayer, GameRng } from "../server/games/types.js";

const players: GamePlayer[] = [
  { id: "host", name: "Host" },
  { id: "alice", name: "Alice" },
];

const rng: GameRng = {
  next: () => 0.5,
  int: () => 0,
  shuffle: (items) => items.slice(),
  pick: (items) => items[0],
};

const context = (
  now: number,
  activePlayers = players,
  gameRng: GameRng = rng,
  config: GameConfig = {},
): GameContext => ({
  players,
  activePlayers,
  rng: gameRng,
  config,
  content: null,
  now,
  isAdmin: (playerId) => playerId === "host",
});

const start = (gameRng: GameRng = rng, config: GameConfig = {}) =>
  patchesModule.onMove(
    patchesModule.setup(context(0, players, gameRng, config)),
    { playerId: "host", type: "start", payload: undefined },
    context(1_000, players, gameRng, config),
  );

const payloadFor = (
  patch: ReturnType<typeof patchesModule.setup>["solution"][number],
  gridSize: number,
) => ({
  start: patch.row * gridSize + patch.col,
  end:
    (patch.row + patch.height - 1) * gridSize +
    patch.col +
    patch.width -
    1,
});

const solve = (
  state: ReturnType<typeof patchesModule.setup>,
  playerId: string,
  now: number,
) =>
  state.solution.reduce(
    (current, patch, index) =>
      patchesModule.onMove(
        current,
        {
          playerId,
          type: "place",
          payload: payloadFor(patch, current.gridSize),
        },
        context(now + index),
      ),
    state,
  );

describe("patches game module", () => {
  it("starts a 6 by 6 Patches board for active players", () => {
    const playing = start();
    expect(playing.phase).toBe("playing");
    expect(playing.gridSize).toBe(6);
    expect(playing.clues.length).toBeGreaterThanOrEqual(7);
    expect(playing.clues.length).toBeLessThanOrEqual(11);
    expect(Object.keys(playing.players)).toEqual(["host", "alice"]);
  });

  it("requires exactly one matching clue for each patch", () => {
    const playing = start();
    const clueCells = playing.clues.slice(0, 2).map((clue) => clue.cell);
    expect(() =>
      patchesModule.onMove(
        playing,
        {
          playerId: "host",
          type: "place",
          payload: { start: clueCells[0], end: clueCells[1] },
        },
        context(2_000),
      ),
    ).toThrow("exactly one clue");
    const numberedClue = playing.clues.find((clue) => clue.size != null);
    expect(numberedClue).toBeDefined();
    expect(() =>
      patchesModule.onMove(
        playing,
        {
          playerId: "host",
          type: "place",
          payload: { start: numberedClue!.cell, end: numberedClue!.cell },
        },
        context(2_000),
      ),
    ).toThrow(`needs ${numberedClue!.size} cells`);
  });

  it("allows a patch to be removed and reset", () => {
    const playing = start();
    const firstPatch = playing.solution[0];
    const placed = patchesModule.onMove(
      playing,
      {
        playerId: "host",
        type: "place",
        payload: payloadFor(firstPatch, playing.gridSize),
      },
      context(2_000),
    );
    const removed = patchesModule.onMove(
      placed,
      {
        playerId: "host",
        type: "remove",
        payload: { cell: firstPatch.row * playing.gridSize + firstPatch.col },
      },
      context(3_000),
    );
    expect(removed.players.host.patches).toHaveLength(0);
  });

  it("generates varied valid puzzles using every supported size", () => {
    const allowedSizes = new Set([2, 3, 4, 5, 6, 8]);
    const seenSizes = new Set<number>();
    const seenNumberClueSizes = new Set<number>();
    const seenShapeOnlyKinds = new Set<string>();
    const layouts = new Set<string>();

    for (let seed = 1; seed <= 100; seed++) {
      const playing = start(createRng(seed));
      const covered = new Set<number>();
      const clueIds = new Set<string>();

      for (const patch of playing.solution) {
        const size = patch.height * patch.width;
        expect(allowedSizes.has(size)).toBe(true);
        expect(patch.row).toBeGreaterThanOrEqual(0);
        expect(patch.col).toBeGreaterThanOrEqual(0);
        expect(patch.row + patch.height).toBeLessThanOrEqual(playing.gridSize);
        expect(patch.col + patch.width).toBeLessThanOrEqual(playing.gridSize);
        expect(clueIds.has(patch.clueId)).toBe(false);
        clueIds.add(patch.clueId);
        seenSizes.add(size);
        for (let row = patch.row; row < patch.row + patch.height; row++) {
          for (let col = patch.col; col < patch.col + patch.width; col++) {
            const cell = row * playing.gridSize + col;
            expect(covered.has(cell)).toBe(false);
            covered.add(cell);
          }
        }
      }

      expect(covered.size).toBe(playing.gridSize * playing.gridSize);
      expect(playing.clues).toHaveLength(playing.solution.length);
      const shapeOnlyClues = playing.clues.filter((clue) => clue.size == null);
      expect(shapeOnlyClues.length).toBeGreaterThan(0);
      expect(shapeOnlyClues.length).toBeLessThan(playing.clues.length);
      const visibleShapeKinds = new Set(
        playing.clues.flatMap((clue) => (clue.shape ? [clue.shape] : [])),
      );
      expect(visibleShapeKinds.size).toBeGreaterThan(0);
      expect(visibleShapeKinds.size).toBeLessThanOrEqual(2);
      for (const clue of playing.clues) {
        expect(clue.size != null || clue.shape != null).toBe(true);
        if (clue.size != null) seenNumberClueSizes.add(clue.size);
        const patch = playing.solution.find((candidate) => candidate.clueId === clue.id);
        expect(patch).toBeDefined();
        const clueRow = Math.floor(clue.cell / playing.gridSize);
        const clueCol = clue.cell % playing.gridSize;
        expect(clueRow).toBeGreaterThanOrEqual(patch!.row);
        expect(clueRow).toBeLessThan(patch!.row + patch!.height);
        expect(clueCol).toBeGreaterThanOrEqual(patch!.col);
        expect(clueCol).toBeLessThan(patch!.col + patch!.width);
      }
      for (const clue of shapeOnlyClues) {
        seenShapeOnlyKinds.add(clue.shape!);
      }
      layouts.add(
        playing.solution
          .map((patch) => `${patch.row},${patch.col},${patch.height},${patch.width}`)
          .join("|"),
      );
    }

    expect(seenSizes).toEqual(allowedSizes);
    expect(seenNumberClueSizes).toEqual(allowedSizes);
    expect(seenShapeOnlyKinds).toEqual(new Set(["square", "wide", "tall"]));
    expect(layouts.size).toBeGreaterThan(10);
  });

  it("replays the same generated puzzle from the same seed", () => {
    const first = start(createRng(42));
    const second = start(createRng(42));

    expect(second.solution).toEqual(first.solution);
    expect(second.clues).toEqual(first.clues);
  });

  it("places a solution patch as a hint", () => {
    const hinted = patchesModule.onMove(
      start(),
      { playerId: "host", type: "hint", payload: undefined },
      context(2_000),
    );
    expect(hinted.players.host.patches).toHaveLength(1);
    expect(hinted.players.host.hintsUsed).toBe(1);
  });

  it("moves to results once all active players solve", () => {
    const hostDone = solve(start(), "host", 2_000);
    const everyoneDone = solve(hostDone, "alice", 3_000);
    expect(everyoneDone.phase).toBe("results");
    expect(everyoneDone.winnerId).toBe("host");
  });

  it("supports configured rounds and lets the host advance after results", () => {
    const gameRng = createRng(7);
    const config = { rounds: 3 };
    const firstRound = start(gameRng, config);
    const hostDone = solve(firstRound, "host", 2_000);
    const results = solve(hostDone, "alice", 3_000);

    expect(results.currentRound).toBe(1);
    expect(results.totalRounds).toBe(3);
    expect(patchesModule.isFinished!(results)).toBe(false);
    expect(results.scores.host).toBeGreaterThan(0);

    const nextRound = patchesModule.onMove(
      results,
      { playerId: "host", type: "nextRound", payload: undefined },
      context(4_000, players, gameRng, config),
    );
    expect(nextRound.phase).toBe("playing");
    expect(nextRound.currentRound).toBe(2);
    expect(nextRound.scores).toEqual(results.scores);
  });

  it("does not let a disconnected unfinished board block completion", () => {
    const hostDone = solve(start(), "host", 2_000);
    const completed = patchesModule.onTick!(hostDone, context(3_000, [players[0]]));
    expect(completed.phase).toBe("results");
  });
});
