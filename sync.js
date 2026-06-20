import db from './db.js';

const ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719';
const ODDS_API_SPORT = 'soccer_fifa_world_cup';

const STAGE_LABELS = {
  'group-stage': 'Phase de groupes',
  'round-of-16': '8es de finale',
  'quarterfinals': 'Quarts de finale',
  'semifinals': 'Demi-finales',
  'third-place': 'Match pour la 3e place',
  final: 'Finale',
};

const SQL_UPSERT_MATCH = `
  INSERT INTO matches (external_id, home_team, away_team, home_flag, away_flag, commence_time, stage, group_name, venue, home_score, away_score, status, updated_at)
  VALUES (@external_id, @home_team, @away_team, @home_flag, @away_flag, @commence_time, @stage, @group_name, @venue, @home_score, @away_score, @status, datetime('now'))
  ON CONFLICT(external_id) DO UPDATE SET
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    status = excluded.status,
    stage = excluded.stage,
    group_name = excluded.group_name,
    venue = excluded.venue,
    updated_at = datetime('now')
`;

const SQL_UPSERT_ODDS = `
  INSERT INTO match_odds (match_id, bookmaker, home_odds, draw_odds, away_odds, updated_at)
  VALUES (@match_id, @bookmaker, @home_odds, @draw_odds, @away_odds, datetime('now'))
  ON CONFLICT(match_id, bookmaker) DO UPDATE SET
    home_odds = excluded.home_odds,
    draw_odds = excluded.draw_odds,
    away_odds = excluded.away_odds,
    updated_at = datetime('now')
`;

export function americanToDecimal(american) {
  if (american == null) return null;
  const str = String(american).replace('+', '');
  const n = parseInt(str, 10);
  if (isNaN(n)) return null;
  if (n > 0) return Math.round((1 + n / 100) * 100) / 100;
  return Math.round((1 + 100 / Math.abs(n)) * 100) / 100;
}

function normalizeTeam(name) {
  return name?.trim().toLowerCase().replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o').replace(/[ùúûü]/g, 'u')
    .replace(/ç/g, 'c').replace(/ñ/g, 'n').replace(/ø/g, 'o') || '';
}

function mapEspnStatus(status) {
  const state = status?.type?.state;
  if (state === 'post') return 'finished';
  if (state === 'in') return 'live';
  return 'scheduled';
}

function extractGroup(altNote) {
  if (!altNote) return null;
  const m = altNote.match(/Group ([A-L])/i);
  return m ? `Groupe ${m[1]}` : null;
}

export async function syncEspnMatches() {
  const res = await fetch(ESPN_URL);
  if (!res.ok) throw new Error(`ESPN API error: ${res.status}`);
  const data = await res.json();
  let count = 0;

  await db.transaction(async (tx) => {
    const upsertMatch = tx.prepare(SQL_UPSERT_MATCH);
    const upsertOdds = tx.prepare(SQL_UPSERT_ODDS);
    const getMatchId = tx.prepare('SELECT id FROM matches WHERE external_id = ?');

    for (const event of data.events || []) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const home = comp.competitors?.find((c) => c.homeAway === 'home');
      const away = comp.competitors?.find((c) => c.homeAway === 'away');
      if (!home || !away) continue;

      const homeTeam = home.team?.displayName || home.team?.name;
      const awayTeam = away.team?.displayName || away.team?.name;
      const stageSlug = event.season?.type ? event.season?.slug || event.season?.type?.slug : null;
      const stage = STAGE_LABELS[stageSlug] || stageSlug || 'Coupe du Monde';

      const match = {
        external_id: String(event.id),
        home_team: homeTeam,
        away_team: awayTeam,
        home_flag: home.team?.logo || null,
        away_flag: away.team?.logo || null,
        commence_time: event.date,
        stage,
        group_name: extractGroup(comp.altGameNote),
        venue: comp.venue?.fullName || null,
        home_score: home.score != null ? parseInt(home.score, 10) : null,
        away_score: away.score != null ? parseInt(away.score, 10) : null,
        status: mapEspnStatus(comp.status),
      };

      await upsertMatch.run(match);
      count++;

      const oddsData = comp.odds?.[0];
      if (oddsData?.moneyline) {
        const ml = oddsData.moneyline;
        const bookmaker = oddsData.provider?.displayName || oddsData.provider?.name || 'DraftKings';
        const homeOdds = americanToDecimal(ml.home?.current?.odds ?? ml.home?.close?.odds);
        const awayOdds = americanToDecimal(ml.away?.current?.odds ?? ml.away?.close?.odds);
        const drawOdds = americanToDecimal(ml.draw?.current?.odds ?? ml.draw?.close?.odds ?? oddsData.drawOdds?.moneyLine);

        if (homeOdds && awayOdds) {
          const row = await getMatchId.get(String(event.id));
          if (row) {
            await upsertOdds.run({
              match_id: row.id,
              bookmaker,
              home_odds: homeOdds,
              draw_odds: drawOdds,
              away_odds: awayOdds,
            });
          }
        }
      }
    }
  });

  return { matches: count };
}

export async function syncOddsApi() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return { skipped: true, reason: 'ODDS_API_KEY non configurée' };

  const regions = process.env.ODDS_REGIONS || 'eu,uk';
  const url = `https://api.the-odds-api.com/v4/sports/${ODDS_API_SPORT}/odds?regions=${regions}&markets=h2h&oddsFormat=decimal&apiKey=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`The Odds API error: ${res.status} ${text}`);
  }

  const events = await res.json();
  let oddsCount = 0;

  await db.transaction(async (tx) => {
    const upsertMatch = tx.prepare(SQL_UPSERT_MATCH);
    const upsertOdds = tx.prepare(SQL_UPSERT_ODDS);
    const findMatchByTeams = tx.prepare(`
      SELECT * FROM matches
      WHERE lower(home_team) = lower(?) AND lower(away_team) = lower(?)
      AND commence_time::text LIKE ?
      LIMIT 1
    `);
    const getMatchByExternal = tx.prepare('SELECT * FROM matches WHERE external_id = ?');
    const updateOddsApiId = tx.prepare('UPDATE matches SET odds_api_id = ? WHERE id = ?');

    for (const event of events) {
      const day = event.commence_time?.slice(0, 10);
      let match = await findMatchByTeams.get(event.home_team, event.away_team, `${day}%`);

      if (!match) {
        match = await findMatchByTeams.get(event.away_team, event.home_team, `${day}%`);
      }

      if (!match) {
        await upsertMatch.run({
          external_id: `odds-${event.id}`,
          home_team: event.home_team,
          away_team: event.away_team,
          home_flag: null,
          away_flag: null,
          commence_time: event.commence_time,
          stage: 'Coupe du Monde',
          group_name: null,
          venue: null,
          home_score: null,
          away_score: null,
          status: 'scheduled',
        });
        match = await getMatchByExternal.get(`odds-${event.id}`);
      }

      if (match && event.id) await updateOddsApiId.run(event.id, match.id);

      for (const bookmaker of event.bookmakers || []) {
        const h2h = bookmaker.markets?.find((m) => m.key === 'h2h');
        if (!h2h) continue;

        const outcomes = {};
        for (const o of h2h.outcomes) {
          if (o.name === 'Draw') outcomes.draw = o.price;
          else if (o.name === event.home_team || normalizeTeam(o.name) === normalizeTeam(event.home_team)) outcomes.home = o.price;
          else if (o.name === event.away_team || normalizeTeam(o.name) === normalizeTeam(event.away_team)) outcomes.away = o.price;
        }

        if (outcomes.home && outcomes.away && match) {
          await upsertOdds.run({
            match_id: match.id,
            bookmaker: bookmaker.title,
            home_odds: outcomes.home,
            draw_odds: outcomes.draw ?? null,
            away_odds: outcomes.away,
          });
          oddsCount++;
        }
      }
    }
  });

  return {
    events: events.length,
    odds: oddsCount,
    remaining: res.headers.get('x-requests-remaining'),
    used: res.headers.get('x-requests-used'),
  };
}

export async function settleBets() {
  const finished = await db.prepare(`
    SELECT * FROM matches WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
  `).all();

  let settled = 0;

  const getOutcome = (m) => {
    if (m.home_score > m.away_score) return 'home';
    if (m.home_score < m.away_score) return 'away';
    return 'draw';
  };

  for (const match of finished) {
    await db.transaction(async (tx) => {
      const result = getOutcome(match);
      const pending = await tx.prepare(`
        SELECT b.*, lm.points as member_points
        FROM bets b
        JOIN league_members lm ON lm.league_id = b.league_id AND lm.user_id = b.user_id
        WHERE b.match_id = ? AND b.status = 'pending'
      `).all(match.id);

      for (const bet of pending) {
        if (bet.outcome === result) {
          const payout = Math.round(bet.stake * bet.odds * 100) / 100;
          await tx.prepare('UPDATE bets SET status = ?, payout = ? WHERE id = ?').run('won', payout, bet.id);
          await tx.prepare('UPDATE league_members SET points = points + ? WHERE league_id = ? AND user_id = ?')
            .run(payout, bet.league_id, bet.user_id);
        } else {
          await tx.prepare('UPDATE bets SET status = ?, payout = 0 WHERE id = ?').run('lost', bet.id);
        }
        settled++;
      }
    });
  }

  return settled;
}

export async function syncAll() {
  const espn = await syncEspnMatches();
  const odds = await syncOddsApi();
  const settled = await settleBets();
  return { espn, odds, settled };
}