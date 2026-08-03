// 關卡狀態與判定——全部純邏輯、不碰 DOM，直接用 node --test 測（設計文件 §10、§12）。

// 數值全部集中在這裡（設計文件 §8）。
export const ECONOMY = {
	bonusCoins: 2,
	claimCoins: 25,
	claimCooldownMs: 4 * 60 * 60 * 1000, // 定時領取：每 4 小時一次（§8）
	clearCoins: 10,
	hintCost: 25,
	initialCoins: 50,
};

// 定時領取（§8）：不能累積——領取當下重設起點，離線多天回來也只有一份。
// lastClaimAt 是壞值或在未來（時鐘倒轉）→ 一律視同可領，避免冷卻永不結束；
// 調時鐘作弊不防，同「改 localStorage 本來就行」的既有取捨。
export function claimStatus(lastClaimAt, now = Date.now()) {
	if (!(lastClaimAt > 0) || lastClaimAt > now)
		return { ready: true, remainingMs: 0 };
	const remainingMs = ECONOMY.claimCooldownMs - (now - lastClaimAt);
	return { ready: remainingMs <= 0, remainingMs: Math.max(0, remainingMs) };
}

const MIN_WORD_LENGTH = 3;

// 目標字條目 → 佔用的格子座標與字母。
export function cellsOf({ word, row, col, dir }) {
	return [...word].map((letter, i) => ({
		r: dir === "across" ? row : row + i,
		c: dir === "across" ? col + i : col,
		letter,
	}));
}

const keyOf = (cell) => `${cell.r},${cell.c}`;

/**
 * 建立一關的遊戲狀態。
 * @param level  data/levels/<id>.json 的內容
 * @param saved  進行中進度 { foundWords, revealedCells, foundBonusWords }（皆為陣列）
 * @param rng    亂數來源，測試時可注入固定值
 */
// 認知複雜度剛好貼著上限 15（曾經超一分，靠拿掉還原 revealedCells 時那個恆真的狀態判斷省回來）。
// 再超的話請調整這裡的分支，不要拆函式——關卡狀態集中在單一 closure 是刻意設計（§10）。
export function createGame(level, saved = {}, rng = Math.random) {
	const foundWords = new Set(saved.foundWords ?? []);
	const foundBonusWords = new Set(saved.foundBonusWords ?? []);

	// 格子狀態：empty → filled（拼出）/ revealed（提示），單向轉移（§10）。
	const cells = new Map();
	for (const entry of level.words) {
		for (const cell of cellsOf(entry)) {
			if (!cells.has(keyOf(cell)))
				cells.set(keyOf(cell), { ...cell, state: "empty" });
		}
	}
	// revealed 一定要在 fillWord 之前還原。反過來的話，被提示揭示、之後又靠拼字補完整個字的格子
	// 會先被 fillWord 蓋成 filled，還原迴圈就跳過它——重開一次頁面 revealedCells 就空了。畫面上
	// 看不太出來（filled 與 revealed 只差配色），但過關卡片的［零提示過關］徽章與分享文案的
	//「全程沒用提示」都是靠「revealedCells 是否為空」判斷的，等於買過提示的人重整一次就照樣拿到
	//（UI 文件 §4-C）。fillWord 只動 empty，所以先標 revealed 兩邊就不會互蓋，重整前後也一致。
	for (const key of saved.revealedCells ?? []) {
		const cell = cells.get(key); // 上面剛建好，此時全部是 empty，不必再判狀態
		if (cell) cell.state = "revealed";
	}
	for (const entry of level.words) {
		if (foundWords.has(entry.word)) fillWord(entry);
	}

	function fillWord(entry) {
		for (const c of cellsOf(entry)) {
			const cell = cells.get(keyOf(c));
			if (cell.state === "empty") cell.state = "filled";
		}
	}

	const isComplete = (entry) =>
		cellsOf(entry).every((c) => cells.get(keyOf(c)).state !== "empty");

	const won = () => level.words.every((w) => foundWords.has(w.word));

	// 格子被填/揭示後，順便補滿的其他目標字也算找到（§8 邊界）。
	function sweepCompleted() {
		const completed = [];
		for (const entry of level.words) {
			if (!foundWords.has(entry.word) && isComplete(entry)) {
				foundWords.add(entry.word);
				completed.push({ word: entry.word, cells: cellsOf(entry) });
			}
		}
		return completed;
	}

	// 判定順序固定「先目標、後 bonus」（§10）。
	function submit(word) {
		word = word.toUpperCase();
		if (word.length < MIN_WORD_LENGTH) return { type: "invalid", word };

		const entry = level.words.find((w) => w.word === word);
		if (entry) {
			if (foundWords.has(word)) return { type: "duplicate", word };
			foundWords.add(word);
			fillWord(entry);
			const completedWords = sweepCompleted();
			return {
				type: "target",
				word,
				cells: cellsOf(entry),
				completedWords,
				won: won(),
			};
		}
		if (level.bonus.includes(word)) {
			if (foundBonusWords.has(word)) return { type: "duplicate", word };
			foundBonusWords.add(word);
			return { type: "bonus", word, coins: ECONOMY.bonusCoins };
		}
		return { type: "invalid", word };
	}

	// 提示：隨機揭示一格未填格（§8）。coins 由呼叫端持有，這裡只判斷夠不夠。
	function useHint(coins) {
		if (coins < ECONOMY.hintCost) return { ok: false, reason: "no-coins" };
		const empties = [...cells.values()].filter((c) => c.state === "empty");
		if (empties.length === 0) return { ok: false, reason: "no-empty" };
		const cell = empties[Math.floor(rng() * empties.length)];
		cell.state = "revealed";
		const completedWords = sweepCompleted();
		return {
			ok: true,
			cost: ECONOMY.hintCost,
			cell: { r: cell.r, c: cell.c, letter: cell.letter },
			completedWords,
			won: won(),
		};
	}

	// 存檔用快照（§9 levelState）。
	const getState = () => ({
		foundWords: [...foundWords],
		revealedCells: [...cells.values()]
			.filter((c) => c.state === "revealed")
			.map(keyOf),
		foundBonusWords: [...foundBonusWords],
	});

	return {
		level,
		submit,
		useHint,
		won,
		getState,
		getCells: () => [...cells.values()],
		isFound: (word) => foundWords.has(word),
	};
}
