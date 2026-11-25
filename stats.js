// 체험전 통계: 끝난 판(정상 종료 + ESC 종료)을 한 줄씩 data/stats.jsonl 에 쌓아 둠
// 나중에 /stats.html 에서 보거나 /api/stats.csv 로 받아서 엑셀로 볼 수 있어요.
import fs from 'fs';
import path from 'path';

// 서버가 어디서 돌든(Render는 UTC) 날짜·시간은 한국 시간 기준
const TZ = process.env.STATS_TZ || 'Asia/Seoul';
const fmtDate = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtTime = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
export const localDate = (t = Date.now()) => fmtDate.format(t);
export const localTime = (t = Date.now()) => fmtTime.format(t);

export const GAME_NAMES = {
  dogfight: '노을 공중전', sumo: '구슬 스모', boat: '보트 레이스', dash: '허들 달리기', maze: '협동 미로',
};

export function createStats(dataDir) {
  const file = path.join(dataDir, 'stats.jsonl');
  let games = [];
  try {
    games = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { games = []; }

  // 한 판 기록. entry: { game, startedAt, ended: 'finished'|'quit', settings, players:[...], best? }
  function log(entry) {
    if (!entry.players.some((p) => p.human)) return null; // 사람 없이 AI만 돈 판은 안 셈
    const end = Date.now();
    const start = entry.startedAt || end;
    const rec = {
      id: `${end.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      date: localDate(start),
      start: localTime(start),
      end: localTime(end),
      sec: Math.round((end - start) / 1000),
      game: entry.game,
      ended: entry.ended,
      settings: entry.settings || {},
      humans: entry.players.filter((p) => p.human).length,
      players: entry.players,
      best: entry.best || null,
      extra: entry.extra || null,
    };
    games.push(rec);
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.appendFileSync(file, JSON.stringify(rec) + '\n');
    } catch (e) { console.error('통계 저장 실패:', e.message); }
    return rec;
  }

  // 하루 요약 (TV 구석 + 통계 페이지 위쪽)
  function summary(date = localDate()) {
    const list = games.filter((g) => g.date === date);
    const byGame = {};
    for (const k of Object.keys(GAME_NAMES)) byGame[k] = { plays: 0, humans: 0, quit: 0 };
    let humans = 0;
    const names = new Set();
    let topKill = null;
    const bestByGame = {};
    for (const g of list) {
      const b = byGame[g.game] || (byGame[g.game] = { plays: 0, humans: 0, quit: 0 });
      b.plays++; b.humans += g.humans; if (g.ended === 'quit') b.quit++;
      humans += g.humans;
      const bv = g.best;
      if (bv && g.ended === 'finished' && typeof bv.value === 'number') {
        const cur = bestByGame[g.game];
        const better = bv.better === 'low' ? (cur ? bv.value < cur.value : true) : (cur ? bv.value > cur.value : true);
        if (better) bestByGame[g.game] = bv;
      }
      for (const p of g.players) {
        if (!p.human) continue;
        names.add(p.name);
        if (g.game === 'dogfight' && g.ended === 'finished' && (!topKill || p.kills > topKill.kills)) topKill = { name: p.name, kills: p.kills };
      }
    }
    return { date, plays: list.length, humans, uniqueNames: names.size, byGame, topKill, bestByGame };
  }

  const days = () => [...new Set(games.map((g) => g.date))].sort();

  function csv() {
    const head = ['날짜', '시작', '끝', '걸린 초', '게임', '종료', '사람 수', '설정', '자리', '이름', '사람/AI', '순위', '결과', '세부'];
    const rows = [head];
    for (const g of games) {
      const set = Object.entries(g.settings).map(([k, v]) => `${k}=${v}`).join(' ');
      for (const p of g.players) {
        rows.push([g.date, g.start, g.end, g.sec, GAME_NAMES[g.game] || g.game, g.ended === 'quit' ? 'ESC 종료' : '정상 종료',
          g.humans, set, p.slot + 1, p.name, p.human ? '사람' : 'AI', p.place ?? '', p.main ?? '', p.sub ?? '']);
      }
    }
    const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n'); // BOM: 엑셀에서 한글 안 깨지게
  }

  return { log, summary, days, csv, all: () => games };
}
