import {
  GameMoveError,
  type GameContext,
  type GameModule,
  type GameMove,
} from "../types.js";
import { numberOption } from "../config.js";

type PatchShape = "square" | "wide" | "tall";

type PatchClue = {
  id: string;
  cell: number;
  size: number | null;
  shape: PatchShape | null;
};

type PatchPlacement = {
  clueId: string;
  row: number;
  col: number;
  height: number;
  width: number;
};

type PlayerBoard = {
  patches: PatchPlacement[];
  outcome: "win" | null;
  solvedAt: number | null;
  hintsUsed: number;
};

type PatchesState = {
  phase: "lobby" | "playing" | "results";
  gridSize: number;
  clues: PatchClue[];
  solution: PatchPlacement[];
  players: Record<string, PlayerBoard>;
  roundStartedAt: number;
  winnerId: string | null;
  totalRounds: number;
  currentRound: number;
  scores: Record<string, number>;
};

const GRID_SIZE = 6;
const HINT_PENALTY = 15;
const SOLVE_BASE = 100;
const SPEED_BONUS_MAX = 50;
const SPEED_DIVISOR_MS = 3_000;
const MIN_PATCH_COUNT = 7;
const MAX_PATCH_COUNT = 11;
const MAX_GENERATION_NODES = 50_000;
const ALLOWED_PATCH_SIZES = new Set([2, 3, 4, 5, 6, 8]);

type PatchDimensions = {
  height: number;
  width: number;
};

const PATCH_DIMENSIONS: PatchDimensions[] = [
  { height: 2, width: 4 },
  { height: 4, width: 2 },
  { height: 2, width: 3 },
  { height: 3, width: 2 },
  { height: 1, width: 5 },
  { height: 5, width: 1 },
  { height: 2, width: 2 },
  { height: 1, width: 4 },
  { height: 4, width: 1 },
  { height: 1, width: 3 },
  { height: 3, width: 1 },
  { height: 1, width: 2 },
  { height: 2, width: 1 },
  { height: 1, width: 6 },
  { height: 6, width: 1 },
];

const FALLBACK_SOLUTION: PatchPlacement[] = [
  { clueId: "a", row: 0, col: 0, height: 2, width: 2 },
  { clueId: "b", row: 0, col: 2, height: 1, width: 4 },
  { clueId: "c", row: 1, col: 2, height: 1, width: 4 },
  { clueId: "d", row: 2, col: 0, height: 3, width: 2 },
  { clueId: "e", row: 2, col: 2, height: 2, width: 3 },
  { clueId: "f", row: 2, col: 5, height: 2, width: 1 },
  { clueId: "g", row: 4, col: 2, height: 2, width: 4 },
  { clueId: "h", row: 5, col: 0, height: 1, width: 2 },
];

const cellsFor = (patch: PatchPlacement): number[] => {
  const cells: number[] = [];
  for (let row = patch.row; row < patch.row + patch.height; row++) {
    for (let col = patch.col; col < patch.col + patch.width; col++) {
      cells.push(row * GRID_SIZE + col);
    }
  }
  return cells;
};

const includesCell = (patch: PatchPlacement, cell: number): boolean =>
  cellsFor(patch).includes(cell);

const matchesShape = (patch: PatchPlacement, shape: PatchShape): boolean => {
  if (shape === "square") return patch.width === patch.height;
  if (shape === "wide") return patch.width > patch.height;
  return patch.height > patch.width;
};

const shapeFor = (patch: PatchPlacement): PatchShape => {
  if (patch.width === patch.height) return "square";
  return patch.width > patch.height ? "wide" : "tall";
};

const canPlaceDimensions = (
  occupied: boolean[],
  row: number,
  col: number,
  dimensions: PatchDimensions,
): boolean => {
  if (
    row + dimensions.height > GRID_SIZE ||
    col + dimensions.width > GRID_SIZE
  ) {
    return false;
  }
  for (let y = row; y < row + dimensions.height; y++) {
    for (let x = col; x < col + dimensions.width; x++) {
      if (occupied[y * GRID_SIZE + x]) return false;
    }
  }
  return true;
};

const markDimensions = (
  occupied: boolean[],
  row: number,
  col: number,
  dimensions: PatchDimensions,
  value: boolean,
): void => {
  for (let y = row; y < row + dimensions.height; y++) {
    for (let x = col; x < col + dimensions.width; x++) {
      occupied[y * GRID_SIZE + x] = value;
    }
  }
};

const generateSolution = (ctx: GameContext): PatchPlacement[] => {
  const occupied = Array<boolean>(GRID_SIZE * GRID_SIZE).fill(false);
  const placements: PatchPlacement[] = [];
  let visitedNodes = 0;

  const search = (): boolean => {
    visitedNodes += 1;
    if (visitedNodes > MAX_GENERATION_NODES) return false;

    const firstEmpty = occupied.indexOf(false);
    if (firstEmpty < 0) {
      const distinctSizes = new Set(
        placements.map((patch) => patch.height * patch.width),
      );
      return (
        placements.length >= MIN_PATCH_COUNT &&
        placements.length <= MAX_PATCH_COUNT &&
        distinctSizes.size >= 3 &&
        Array.from(distinctSizes).every((size) => ALLOWED_PATCH_SIZES.has(size))
      );
    }
    if (placements.length >= MAX_PATCH_COUNT) return false;

    const remainingCells = occupied.filter((value) => !value).length;
    if (
      placements.length + Math.ceil(remainingCells / 8) > MAX_PATCH_COUNT ||
      placements.length + Math.floor(remainingCells / 2) < MIN_PATCH_COUNT
    ) {
      return false;
    }

    const row = Math.floor(firstEmpty / GRID_SIZE);
    const col = firstEmpty % GRID_SIZE;
    const candidates = ctx.rng.shuffle(
      PATCH_DIMENSIONS.filter((dimensions) =>
        canPlaceDimensions(occupied, row, col, dimensions),
      ),
    );

    for (const dimensions of candidates) {
      markDimensions(occupied, row, col, dimensions, true);
      placements.push({
        clueId: "",
        row,
        col,
        height: dimensions.height,
        width: dimensions.width,
      });
      if (search()) return true;
      placements.pop();
      markDimensions(occupied, row, col, dimensions, false);
    }
    return false;
  };

  const generated = search() ? placements : FALLBACK_SOLUTION;
  return generated.map((patch, index) => ({
    ...patch,
    clueId: `patch-${index + 1}`,
  }));
};

const generateClues = (
  solution: PatchPlacement[],
  ctx: GameContext,
): PatchClue[] => {
  const availableShapes = Array.from(new Set(solution.map(shapeFor)));
  const shapeKindCount = Math.min(
    availableShapes.length,
    1 + ctx.rng.int(Math.min(2, availableShapes.length)),
  );
  const shapeOnlyKinds = new Set(
    ctx.rng.shuffle(availableShapes).slice(0, shapeKindCount),
  );
  const shapeOnlyCandidates = ctx.rng.shuffle(
    solution.filter((patch) => shapeOnlyKinds.has(shapeFor(patch))),
  );
  const shapeOnlyCount = Math.min(
    shapeOnlyCandidates.length,
    Math.max(1, Math.min(3, 1 + ctx.rng.int(Math.max(1, Math.floor(solution.length / 3))))),
  );
  const shapeOnlyIds = new Set(
    shapeOnlyCandidates.slice(0, shapeOnlyCount).map((patch) => patch.clueId),
  );
  const numberOnlyCandidates = ctx.rng.shuffle(
    solution.filter((patch) => !shapeOnlyIds.has(patch.clueId)),
  );
  const numberOnlyId = numberOnlyCandidates[0]?.clueId ?? null;

  return solution.map((patch) => {
    const patchCells = cellsFor(patch);
    const actualSize = patch.height * patch.width;
    const actualShape = shapeFor(patch);
    const isShapeOnly = shapeOnlyIds.has(patch.clueId);
    const showShape =
      isShapeOnly ||
      (shapeOnlyKinds.has(actualShape) &&
        patch.clueId !== numberOnlyId &&
        ctx.rng.int(2) === 0);
    return {
      id: patch.clueId,
      cell: patchCells[ctx.rng.int(patchCells.length)] ?? patchCells[0],
      size: isShapeOnly ? null : actualSize,
      shape: showShape ? actualShape : null,
    };
  });
};

const generatePuzzle = (
  ctx: GameContext,
): { solution: PatchPlacement[]; clues: PatchClue[] } => {
  const solution = generateSolution(ctx);
  return { solution, clues: generateClues(solution, ctx) };
};

const scoreFor = (board: PlayerBoard, roundStartedAt: number): number => {
  if (board.outcome !== "win" || board.solvedAt == null) return 0;
  const base = Math.max(10, SOLVE_BASE - board.hintsUsed * HINT_PENALTY);
  const elapsed = Math.max(0, board.solvedAt - roundStartedAt);
  return base + Math.max(0, SPEED_BONUS_MAX - Math.floor(elapsed / SPEED_DIVISOR_MS));
};

const computeWinnerId = (state: PatchesState): string | null =>
  Object.entries(state.players)
    .filter(([, board]) => board.outcome === "win" && board.solvedAt != null)
    .sort(([, a], [, b]) => {
      const hints = a.hintsUsed - b.hintsUsed;
      return hints !== 0 ? hints : (a.solvedAt ?? Infinity) - (b.solvedAt ?? Infinity);
    })[0]?.[0] ?? null;

const accumulateScores = (state: PatchesState): Record<string, number> => {
  const scores = { ...state.scores };
  for (const [playerId, board] of Object.entries(state.players)) {
    scores[playerId] =
      (scores[playerId] ?? 0) + scoreFor(board, state.roundStartedAt);
  }
  return scores;
};

const allActivePlayersFinished = (state: PatchesState, ctx: GameContext): boolean =>
  ctx.activePlayers.length > 0 &&
  ctx.activePlayers.every((player) => state.players[player.id]?.outcome != null);

const withResultsIfComplete = (state: PatchesState, ctx: GameContext): PatchesState =>
  allActivePlayersFinished(state, ctx)
    ? {
        ...state,
        phase: "results",
        winnerId: computeWinnerId(state),
        scores: accumulateScores(state),
      }
    : state;

const parsePlacement = (payload: unknown): PatchPlacement => {
  const value = payload as { start?: unknown; end?: unknown } | null;
  if (!value || !Number.isInteger(value.start) || !Number.isInteger(value.end)) {
    throw new GameMoveError("Choose a rectangle on the grid");
  }
  const start = value.start as number;
  const end = value.end as number;
  if (start < 0 || end < 0 || start >= GRID_SIZE * GRID_SIZE || end >= GRID_SIZE * GRID_SIZE) {
    throw new GameMoveError("Patch must stay inside the grid");
  }
  const startRow = Math.floor(start / GRID_SIZE);
  const startCol = start % GRID_SIZE;
  const endRow = Math.floor(end / GRID_SIZE);
  const endCol = end % GRID_SIZE;
  return {
    clueId: "",
    row: Math.min(startRow, endRow),
    col: Math.min(startCol, endCol),
    height: Math.abs(endRow - startRow) + 1,
    width: Math.abs(endCol - startCol) + 1,
  };
};

const validatePlacement = (state: PatchesState, board: PlayerBoard, patch: PatchPlacement): PatchPlacement => {
  const patchCells = cellsFor(patch);
  const clue = state.clues.filter((candidate) => patchCells.includes(candidate.cell));
  if (clue.length !== 1) {
    throw new GameMoveError("Every patch must contain exactly one clue");
  }
  if (board.patches.some((placed) => patchCells.some((cell) => includesCell(placed, cell)))) {
    throw new GameMoveError("Patches cannot overlap");
  }
  const [selectedClue] = clue;
  if (
    selectedClue.size != null &&
    patch.height * patch.width !== selectedClue.size
  ) {
    throw new GameMoveError(`This clue needs ${selectedClue.size} cells`);
  }
  if (
    selectedClue.shape != null &&
    !matchesShape(patch, selectedClue.shape)
  ) {
    throw new GameMoveError("That patch does not match the clue shape");
  }
  return { ...patch, clueId: selectedClue.id };
};

const boardIsComplete = (board: PlayerBoard, clueCount: number): boolean => {
  const covered = new Set(board.patches.flatMap(cellsFor));
  return (
    board.patches.length === clueCount &&
    covered.size === GRID_SIZE * GRID_SIZE
  );
};

const startPlaying = (
  state: PatchesState,
  ctx: GameContext,
  round: number,
): PatchesState => {
  const puzzle = generatePuzzle(ctx);
  const players: Record<string, PlayerBoard> = {};
  for (const player of ctx.activePlayers) {
    players[player.id] = { patches: [], outcome: null, solvedAt: null, hintsUsed: 0 };
  }
  return {
    ...state,
    phase: "playing",
    clues: puzzle.clues,
    solution: puzzle.solution,
    players,
    roundStartedAt: ctx.now,
    winnerId: null,
    currentRound: round,
  };
};

export const patchesModule: GameModule<PatchesState> = {
  id: "patches",
  name: "Patches",
  description: "Fit every clue into one perfect rectangle",
  minPlayers: 1,
  maxPlayers: 32,
  tickMs: 500,
  hasLeaderboard: true,
  options: [
    {
      id: "rounds",
      type: "number",
      label: "Rounds",
      min: 1,
      max: 5,
      default: 1,
      presets: [1, 3, 5],
    },
  ],

  setup(ctx): PatchesState {
    return {
      phase: "lobby",
      gridSize: GRID_SIZE,
      clues: [],
      solution: [],
      players: {},
      roundStartedAt: 0,
      winnerId: null,
      totalRounds: numberOption(ctx.config, "rounds", 1),
      currentRound: 0,
      scores: {},
    };
  },

  onMove(state, move: GameMove, ctx): PatchesState {
    if (move.type === "start") {
      if (!ctx.isAdmin(move.playerId)) throw new GameMoveError("Only the host can start");
      if (state.phase !== "lobby") throw new GameMoveError("Already running");
      if (ctx.activePlayers.length < 1) throw new GameMoveError("Need at least 1 player");
      return startPlaying(state, ctx, 1);
    }

    if (move.type === "nextRound") {
      if (!ctx.isAdmin(move.playerId)) {
        throw new GameMoveError("Only the host can advance rounds");
      }
      if (state.phase !== "results") {
        throw new GameMoveError("Round is not finished yet");
      }
      if (state.currentRound >= state.totalRounds) {
        throw new GameMoveError("All rounds are complete");
      }
      return startPlaying(state, ctx, state.currentRound + 1);
    }

    if (state.phase !== "playing") throw new GameMoveError("Not accepting moves right now");
    const board = state.players[move.playerId];
    if (!board) throw new GameMoveError("You are not in this round");
    if (board.outcome) throw new GameMoveError("You already finished");

    if (move.type === "place") {
      const patch = validatePlacement(state, board, parsePlacement(move.payload));
      const nextBoard = { ...board, patches: [...board.patches, patch] };
      if (boardIsComplete(nextBoard, state.clues.length)) {
        nextBoard.outcome = "win";
        nextBoard.solvedAt = ctx.now;
      }
      return withResultsIfComplete(
        { ...state, players: { ...state.players, [move.playerId]: nextBoard } },
        ctx,
      );
    }

    if (move.type === "remove") {
      const value = move.payload as { cell?: unknown } | null;
      const cell = value?.cell;
      if (
        typeof cell !== "number" ||
        !Number.isInteger(cell) ||
        cell < 0 ||
        cell >= GRID_SIZE * GRID_SIZE
      ) {
        throw new GameMoveError("Choose a placed patch to remove");
      }
      const patches = board.patches.filter((patch) => !includesCell(patch, cell));
      if (patches.length === board.patches.length) throw new GameMoveError("No patch there to remove");
      return { ...state, players: { ...state.players, [move.playerId]: { ...board, patches } } };
    }

    if (move.type === "reset") {
      return { ...state, players: { ...state.players, [move.playerId]: { ...board, patches: [] } } };
    }

    if (move.type === "hint") {
      const nextPatch = state.solution.find(
        (patch) =>
          !board.patches.some((placed) => placed.clueId === patch.clueId) &&
          !board.patches.some((placed) =>
            cellsFor(patch).some((cell) => includesCell(placed, cell)),
          ),
      );
      if (!nextPatch) {
        throw new GameMoveError("Remove a conflicting patch before using a hint");
      }
      const nextBoard = {
        ...board,
        patches: [...board.patches, nextPatch],
        hintsUsed: board.hintsUsed + 1,
      };
      if (boardIsComplete(nextBoard, state.clues.length)) {
        nextBoard.outcome = "win";
        nextBoard.solvedAt = ctx.now;
      }
      return withResultsIfComplete(
        { ...state, players: { ...state.players, [move.playerId]: nextBoard } },
        ctx,
      );
    }

    throw new GameMoveError(`Unknown move: ${move.type}`);
  },

  onTick(state, ctx): PatchesState {
    if (state.phase !== "playing") return state;
    return withResultsIfComplete(state, ctx);
  },

  getPhase: (state) => state.phase,

  publicView(state, ctx) {
    const standings = Object.entries(state.players)
      .map(([playerId, board]) => ({
        playerId,
        playerName: ctx.players.find((player) => player.id === playerId)?.name ?? "Unknown",
        patchesPlaced: board.patches.length,
        outcome: board.outcome,
        hintsUsed: board.hintsUsed,
        solvedAt: board.solvedAt,
      }))
      .sort((a, b) => {
        if (a.outcome !== b.outcome) return a.outcome === "win" ? -1 : 1;
        if (a.outcome === "win") return (a.solvedAt ?? Infinity) - (b.solvedAt ?? Infinity);
        return b.patchesPlaced - a.patchesPlaced;
      });
    const scoreEntries = Object.entries(state.scores)
      .map(([playerId, score]) => ({
        playerId,
        playerName:
          ctx.players.find((player) => player.id === playerId)?.name ??
          "Unknown",
        score,
      }))
      .sort((a, b) => b.score - a.score);
    const scoreboard = ctx.players
      .map((player) => ({
        id: player.id,
        name: player.name,
        score: state.scores[player.id] ?? 0,
      }))
      .sort((a, b) => b.score - a.score);
    return {
      phase: state.phase,
      gridSize: state.gridSize,
      clues: state.clues,
      roundStartedAt: state.phase === "lobby" ? null : state.roundStartedAt,
      serverNow: ctx.now,
      currentRound: state.currentRound,
      totalRounds: state.totalRounds,
      isFinalRound: state.currentRound >= state.totalRounds,
      standings,
      scores: scoreEntries,
      scoreboard,
      result: state.phase === "results" ? { winnerId: state.winnerId, solution: state.solution } : null,
    };
  },

  playerView(state, playerId) {
    const board = state.players[playerId];
    return board ?? { patches: [], outcome: null, solvedAt: null, hintsUsed: 0 };
  },

  isFinished: (state) =>
    state.phase === "results" && state.currentRound >= state.totalRounds,
};
