/* Skill-model practice recommender — a JavaScript port adapted from CPOS
 *   https://github.com/Soham109/cpos  (src/engine/practice.rs, src/engine/target.rs)
 *   Copyright (c) 2026 Soham Aggarwal. MIT License — full text in third_party/cpos/LICENSE.
 *
 * What was ported: per-tag skill estimation (weighted 75th percentile of solved ratings, decayed by age and discounted
 * by wrong attempts), the curriculum of core topics with the rating where each starts to matter, the "weak tag" rule,
 * and the scoring for the Auto / Weakness / Push / Refresh / Upsolve / Explore modes, including reasons and the
 * tag/rating-band diversification.
 * What changed for cp-tracker: evidence comes from the tracker's own attempt log and platform syncs instead of the
 * Codeforces API (hints and editorials count like extra wrong attempts); the candidate pool is the tracker's sheet;
 * CPOS's contest-freshness and solve-count quality terms are dropped (the sheet is already curated); Plan mode is left
 * out because the sheet itself is the plan; and reasons never name a tag the sheet is deliberately hiding.
 * Plain script, no build step: exposes window.CPOSPractice.
 */
(function () {
  'use strict';
  const CURRICULUM = [
    ['implementation', 900], ['brute force', 1000], ['math', 1000], ['greedy', 1100], ['sortings', 1100],
    ['constructive algorithms', 1300], ['binary search', 1300], ['two pointers', 1400], ['strings', 1400],
    ['number theory', 1500], ['dp', 1500], ['dfs and similar', 1500], ['graphs', 1600], ['dsu', 1600], ['bitmasks', 1600],
    ['combinatorics', 1700], ['trees', 1700], ['data structures', 1700], ['shortest paths', 1800], ['hashing', 1800],
    ['expression parsing', 1900], ['divide and conquer', 1900], ['probabilities', 1900], ['geometry', 1900],
    ['matrices', 2000], ['ternary search', 2000], ['games', 2000], ['meet-in-the-middle', 2100], ['2-sat', 2300],
    ['flows', 2300], ['string suffix structures', 2300], ['fft', 2400], ['graph matchings', 2400],
  ];
  const ESSENTIAL = new Map(CURRICULUM);
  const MODES = {
    auto:     {label: 'Auto',     note: 'balanced mix: learning zone, weak topics, fresh topics',   w: {zone: 3.0, learn: 2.2, refresh: 0.4, novelty: 0.6, upsolve: 0.3, center: 200, sigma: 150}},
    weakness: {label: 'Weakness', note: 'attack the tags where your skill lags your level',          w: {zone: 2.4, learn: 3.6, refresh: 0.3, novelty: 0.4, upsolve: 0.3, center: 100, sigma: 130}},
    push:     {label: 'Push',     note: 'above your ceiling, on your strongest topics',              w: {zone: 3.6, learn: 0.4, refresh: 0.0, novelty: 0.0, upsolve: 0.0, center: 350, sigma: 140}},
    refresh:  {label: 'Refresh',  note: "topics you knew but haven't touched in a while",            w: {zone: 2.4, learn: 0.4, refresh: 3.4, novelty: 0.0, upsolve: 0.2, center: 0,   sigma: 130}},
    upsolve:  {label: 'Upsolve',  note: 'problems you attempted but never solved',                   w: {zone: 1.2, learn: 0.8, refresh: 0.0, novelty: 0.0, upsolve: 4.0, center: 100, sigma: 250}},
    explore:  {label: 'Explore',  note: "core topics you've never solved, at an entry level",        w: {zone: 2.2, learn: 0.4, refresh: 0.0, novelty: 3.6, upsolve: 0.0, center: -50, sigma: 140}},
  };
  const DAY = 864e5;

  // Weight of one solve as skill evidence: decays with age, discounted when the solve needed many wrong attempts.
  const solveWeight = (daysOld, waBeforeAc) => Math.max(0.05, Math.pow(0.5, daysOld / 240)) * (1 / (1 + 0.3 * waBeforeAc));
  function weightedPercentile(values, pct) {
    if (!values.length) return null;
    values = values.slice().sort((a, b) => a[0] - b[0]);
    const total = values.reduce((s, v) => s + v[1], 0);
    if (total <= 0) return values[values.length - 1][0];
    let acc = 0; const cut = total * pct;
    for (const [r, w] of values) { acc += w; if (acc >= cut) return r; }
    return values[values.length - 1][0];
  }

  /* history: Map(id -> {rating, tags[], firstAc (ms|null), attemptsBeforeAc, totalAttempts, lastTouch (ms)}) */
  function computeSkills(history, now) {
    const perTag = new Map(), meta = new Map(), overall = [];
    for (const h of history.values()) {
      const daysSince = Math.floor((now - h.lastTouch) / DAY), solved = h.firstAc != null;
      if (h.rating && solved) {
        const w = solveWeight(Math.max(0, Math.floor((now - h.firstAc) / DAY)), h.attemptsBeforeAc);
        overall.push([h.rating, w]);
        for (const t of h.tags) (perTag.get(t) || perTag.set(t, []).get(t)).push([h.rating, w]);
      }
      for (const t of h.tags) {
        const m = meta.get(t) || meta.set(t, {solved: 0, attemptedOnly: 0, daysSince: null}).get(t);
        if (solved) m.solved++; else m.attemptedOnly++;
        m.daysSince = m.daysSince == null ? daysSince : Math.min(m.daysSince, daysSince);
      }
    }
    const level = weightedPercentile(overall, 0.75);
    const skills = new Map();
    for (const [tag, samples] of perTag) {
      const m = meta.get(tag) || {solved: 0, attemptedOnly: 0, daysSince: null};
      skills.set(tag, {tag, skill: weightedPercentile(samples, 0.75) ?? 800, volume: samples.reduce((s, v) => s + v[1], 0), ...m, weak: false});
    }
    for (const [tag, m] of meta) if (m.solved === 0 && !skills.has(tag))   // attempted but never solved: deep weakness
      skills.set(tag, {tag, skill: Math.max(0, (level ?? 1000) - 300), volume: 0, ...m, weak: true});
    return {skills, level};
  }

  /* problems: [{id, rating, tags[] (lowercase), hidden (bool: don't name its tags), solved (bool)}]
     opts: {mode, count, level (practice rating floor), goal, now} */
  function recommend(problems, history, opts = {}) {
    const now = opts.now ?? Date.now(), mode = MODES[opts.mode] ? opts.mode : 'auto', w = MODES[mode].w, count = Math.max(1, opts.count ?? 8);
    const {skills, level: computed} = computeSkills(history, now);
    const level = Math.round(Math.max(computed ?? 0, opts.level ?? 0) || 1200), goal = opts.goal ?? 1600;
    for (const s of skills.values()) s.weak = s.solved === 0 || s.skill + 150 < level || (s.volume < 1 && s.attemptedOnly > 0);
    const hasHistory = history.size > 0;
    const anchorFor = tags => {
      let best = null;
      for (const t of tags) { if (!ESSENTIAL.has(t)) continue; const s = skills.get(t)?.skill ?? Math.max(0, level - 150); if (!best || s < best[0]) best = [s, t]; }
      return best || [level, null];
    };
    const scored = [];
    for (const p of problems) {
      if (p.solved || !p.rating) continue;
      const h = history.get(p.id), wasAttempted = !!h && h.firstAc == null;
      if (mode === 'upsolve' && !wasAttempted) continue;
      const floor = mode === 'refresh' ? level - 250 : mode === 'upsolve' ? 0 : mode === 'explore' ? level - 400 : level - 200;
      if (p.rating < floor || p.rating > level + 700) continue;
      const tags = p.tags || [];
      const [anchor, anchorTag] = anchorFor(tags), gap = p.rating - anchor;
      const zone = Math.exp(-((gap - w.center) ** 2) / (2 * w.sigma ** 2));
      let learn = 0, learnTag = null, novelty = 0, noveltyTag = null, refresh = 0, refreshTag = null;
      for (const t of tags) {
        const essential = ESSENTIAL.get(t); if (essential == null) continue;
        const s = skills.get(t);
        if (s) {
          const lag = Math.min(1, Math.max(0, (level - s.skill) / 300)), thin = Math.min(1, Math.max(0, 1 - s.volume / 4));
          const val = s.solved === 0 ? 1 : lag * 0.65 + thin * 0.35;
          if (val > learn) { learn = val; learnTag = s; }
          if (s.solved > 0 && s.volume >= 1) { const rusty = Math.min(1, Math.max(0, (s.daysSince ?? 0) / 120)); if (rusty > refresh) { refresh = rusty; refreshTag = s; } }
        } else if (essential <= goal + 200) { novelty = 1; noveltyTag ||= t; learn = Math.max(learn, 0.9); }
      }
      const upsolve = wasAttempted ? Math.max(0.15, Math.pow(0.5, ((now - h.lastTouch) / DAY) / 180)) : 0;
      const pushAffinity = mode === 'push' ? Math.max(0, ...tags.map(t => skills.get(t)).filter(Boolean).map(s => Math.min(1, s.volume / 4) * Math.min(1.2, s.skill / Math.max(1, level)))) : 0;
      let score = w.zone * zone + w.learn * learn + w.refresh * refresh + w.novelty * novelty + w.upsolve * upsolve + pushAffinity * 1.4;
      if (!hasHistory) score += Math.max(0, 1 - Math.abs(p.rating - 1200) / 400);
      const reasons = [];
      if (mode === 'upsolve' && wasAttempted) reasons.push(`unfinished: ${h.totalAttempts} attempt${h.totalAttempts === 1 ? '' : 's'}, last ${Math.floor((now - h.lastTouch) / DAY)}d ago`);
      if (noveltyTag) reasons.push(p.hidden ? 'a core topic you haven\'t solved yet' : `new core topic for you: ${noveltyTag}`);
      else if (learnTag && learn > 0.35) reasons.push(p.hidden ? `weak topic: skill ≈${learnTag.skill} vs level ${level}` : `weak topic ${learnTag.tag}: your skill ≈${learnTag.skill} vs level ${level}`);
      if (mode === 'refresh' && refreshTag) reasons.push(p.hidden ? `rusty topic: untouched for ${refreshTag.daysSince ?? 0}d` : `rusty: no ${refreshTag.tag} in ${refreshTag.daysSince ?? 0}d`);
      if (anchorTag && Math.abs(gap) >= 50) reasons.push(`${gap > 0 ? 'stretch' : 'consolidate'} at ${p.rating} (${gap > 0 ? '+' : ''}${Math.round(gap)}) vs your ${p.hidden ? 'skill in its weakest topic' : anchorTag} ≈${anchor}`);
      else reasons.push(`in your zone at ${p.rating} (level ≈${level})`);
      if (wasAttempted && mode !== 'upsolve') reasons.push("you've started this one");
      scored.push({id: p.id, rating: p.rating, score, reasons: reasons.slice(0, 3), primary: tags[0] || 'misc'});
    }
    scored.sort((a, b) => b.score - a.score);
    // diversify: cap repeats of the same leading tag and the same rating band, then backfill
    const cap = Math.max(2, Math.floor(count / 4)), tagSeen = new Map(), bandSeen = new Map(), picked = [], skipped = [];
    for (const r of scored) {
      if (picked.length >= count) break;
      const band = Math.floor(r.rating / 100), t = tagSeen.get(r.primary) || 0, b = bandSeen.get(band) || 0;
      if (t >= cap || b >= cap) { skipped.push(r); continue; }
      tagSeen.set(r.primary, t + 1); bandSeen.set(band, b + 1); picked.push(r);
    }
    for (const r of skipped) { if (picked.length >= count) break; picked.push(r); }
    const curriculum = [...skills.values()].filter(s => ESSENTIAL.has(s.tag)).sort((a, b) => a.skill - b.skill);
    return {
      mode, note: MODES[mode].note, level, goal, recs: picked,
      weak: curriculum.filter(s => s.weak).slice(0, 6),
      strong: curriculum.slice().reverse().filter(s => !s.weak && s.volume >= 1.5).slice(0, 3),
    };
  }
  window.CPOSPractice = {MODES, CURRICULUM, computeSkills, recommend};
})();
