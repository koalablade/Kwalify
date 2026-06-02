#!/usr/bin/env python3
"""One-shot patch: Cinematic Moment Engine refactor in index.html."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "artifacts/api-server/public/index.html"
text = HTML.read_text(encoding="utf-8")

# ── 1. DOM: cinema stack ──
old_dom = """<video id="cinema" muted loop playsinline autoplay preload="auto" aria-hidden="true"></video>
<div id="cinemaFallback" data-scene="abstract_light_field" aria-hidden="true"></div>
<div id="worldPhysics" class="world-physics" aria-hidden="true"></div>
<div id="worldFocus" class="world-focus" aria-hidden="true"></div>
<div id="sceneFrameHint" data-perception="" aria-hidden="true"></div>"""

new_dom = """<video id="cinema" muted loop playsinline autoplay preload="auto" aria-hidden="true"></video>
<img id="cinemaStill" alt="" aria-hidden="true" />
<div id="cinemaFallback" data-scene="open_highway_daylight" aria-hidden="true"></div>
<div id="sceneAtmosphere" class="scene-atmosphere" aria-hidden="true"></div>"""

if old_dom not in text:
    raise SystemExit("DOM block not found")
text = text.replace(old_dom, new_dom)

# ── 2. CSS: replace SceneRendererCore block through moment-result header rules ──
start = text.index("    /* ── SceneRendererCore (single scene system) ── */")
end = text.index("    /* ── Master lock: moment UI ── */")
new_css = r'''    /* ── Cinematic Moment Engine (scene + one atmosphere layer) ── */
    html, body { background:#060608; }
    #cinema, #cinemaStill, #cinemaFallback {
      position:fixed; inset:0; width:100%; height:100%; object-fit:cover;
      z-index:0; pointer-events:none; background:#060608;
    }
    #cinema { opacity:0; transition:opacity .45s ease; }
    #cinemaStill { opacity:0; transition:opacity .5s ease; }
    #cinemaFallback { display:block; transition:opacity .5s ease; }
    #cinemaFallback.hidden, #cinemaStill.hidden { display:none !important; opacity:0 !important; }
    body.scene-video #cinema { opacity:1 !important; }
    body.scene-still #cinemaStill { opacity:1 !important; display:block !important; }
    body.scene-still #cinemaFallback { opacity:0 !important; }
    body.scene-composite #cinemaFallback { opacity:1 !important; }

    #cinema, #cinemaStill, #cinemaFallback {
      filter:brightness(var(--scene-bright,1)) contrast(var(--scene-contrast,1.05)) saturate(var(--scene-sat,.98));
    }
    body.scene-camera-lock #cinema,
    body.scene-camera-lock #cinemaStill,
    body.scene-camera-lock #cinemaFallback {
      animation:none !important;
      transition:filter .6s ease, opacity .4s ease;
    }
    body:not(.scene-camera-lock).scene-camera-drift #cinema,
    body:not(.scene-camera-lock).scene-camera-drift #cinemaStill,
    body:not(.scene-camera-lock).scene-camera-drift #cinemaFallback {
      animation:cameraDrift 48s ease-in-out infinite;
    }
    @keyframes cameraDrift {
      0%,100% { transform:scale(1.04) translate(0,0); }
      50% { transform:scale(1.06) translate(-0.4%,0.2%); }
    }

    /* Structured still composites (only when no video/still asset) */
    #cinemaFallback[data-scene="night_drive"] {
      background:linear-gradient(180deg,#0a1020 0%,#060810 42%,#020306 100%),
        radial-gradient(ellipse 140% 35% at 50% 88%,rgba(255,210,120,.22) 0%,transparent 50%),
        radial-gradient(ellipse 80% 50% at 20% 40%,rgba(60,90,140,.25) 0%,transparent 70%);
    }
    #cinemaFallback[data-scene="petrol_station_2am"] {
      background:linear-gradient(180deg,#12101a 0%,#08060c 55%,#030208 100%),
        radial-gradient(circle at 72% 38%,rgba(255,80,40,.35) 0%,transparent 28%),
        radial-gradient(circle at 28% 42%,rgba(40,180,255,.2) 0%,transparent 32%);
    }
    #cinemaFallback[data-scene="sunset_coast"] {
      background:linear-gradient(180deg,#4a2810 0%,#1a1008 38%,#080604 100%),
        radial-gradient(ellipse 100% 45% at 50% 18%,rgba(255,160,80,.45) 0%,transparent 55%);
    }
    #cinemaFallback[data-scene="urban_midnight_walk"] {
      background:linear-gradient(180deg,#0c1018 0%,#06080e 50%,#020204 100%),
        radial-gradient(ellipse 90% 30% at 50% 100%,rgba(120,160,255,.12) 0%,transparent 45%),
        linear-gradient(90deg,transparent 0%,rgba(255,255,255,.06) 50%,transparent 100%);
    }
    #cinemaFallback[data-scene="train_journey"] {
      background:linear-gradient(90deg,#0a0c12 0%,#141820 45%,#0a0c12 100%),
        linear-gradient(180deg,rgba(255,255,255,.08) 0%,transparent 22%),
        radial-gradient(ellipse 60% 80% at 18% 50%,rgba(180,200,220,.15) 0%,transparent 70%);
    }
    #cinemaFallback[data-scene="summer_afternoon_drift"] {
      background:linear-gradient(180deg,#6a5020 0%,#2a1c08 40%,#100c06 100%),
        radial-gradient(ellipse 90% 55% at 50% 25%,rgba(255,220,140,.35) 0%,transparent 60%);
    }
    #cinemaFallback[data-scene="rainy_city_interior"] {
      background:linear-gradient(180deg,#10141c 0%,#080a10 55%,#040508 100%),
        radial-gradient(ellipse 70% 40% at 80% 30%,rgba(100,200,255,.18) 0%,transparent 50%),
        radial-gradient(ellipse 50% 60% at 15% 55%,rgba(255,255,255,.05) 0%,transparent 45%);
    }
    #cinemaFallback[data-scene="memory_road"] {
      background:linear-gradient(180deg,#3a3020 0%,#1a140c 45%,#080604 100%),
        radial-gradient(ellipse 100% 40% at 50% 70%,rgba(200,160,100,.2) 0%,transparent 55%);
    }
    #cinemaFallback[data-scene="club_exit_dawn"] {
      background:linear-gradient(180deg,#283858 0%,#141820 48%,#060608 100%),
        radial-gradient(ellipse 80% 35% at 50% 15%,rgba(140,180,255,.25) 0%,transparent 50%);
    }
    #cinemaFallback[data-scene="open_highway_daylight"] {
      background:linear-gradient(180deg,#5a7a9a 0%,#2a3a4a 35%,#101418 100%),
        radial-gradient(ellipse 120% 40% at 50% 100%,rgba(255,255,240,.15) 0%,transparent 48%);
    }

    :root {
      --scene-bright:1; --scene-contrast:1.05; --scene-sat:.98;
      --scene-vignette:.42; --scene-grain:.04;
    }
    #sceneAtmosphere {
      position:fixed; inset:0; z-index:1; pointer-events:none;
      opacity:1;
    }
    #sceneAtmosphere::before {
      content:''; position:absolute; inset:0;
      background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.75' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      background-size:160px 160px;
      mix-blend-mode:overlay;
      opacity:var(--scene-grain);
    }
    #sceneAtmosphere::after {
      content:''; position:absolute; inset:0;
      background:radial-gradient(ellipse 75% 65% at 50% 45%, transparent 35%, rgba(0,0,0,calc(var(--scene-vignette)*.55)) 100%);
      opacity:.65;
    }
    #worldFocus, #sceneFrameHint, #worldPhysics { display:none !important; }

    body.moment-compose .bg,
    body.moment-thinking .bg,
    body.moment-locked .bg,
    body.moment-reveal .bg { opacity:0 !important; visibility:hidden !important; }

    .moment-app .page, #appView.moment-app .moment-shell { position:relative; z-index:2; }
    .moment-shell, .compose-layer, .result-surface, .vibe-focus, .input-moment, .result-layer.visible .result-surface {
      filter:none !important;
      -webkit-font-smoothing:antialiased;
    }
    body.moment-compose .compose-layer {
      opacity:1 !important; visibility:visible !important;
      pointer-events:auto !important; filter:none !important;
    }
    body.moment-thinking .compose-layer,
    body.moment-locked .compose-layer {
      opacity:.72 !important; filter:none !important;
      pointer-events:none !important;
      transition:opacity .5s ease !important;
    }
    body.moment-reveal .compose-layer {
      opacity:0 !important; visibility:hidden !important;
      pointer-events:none !important;
      transition:opacity .7s ease !important;
    }

'''
text = text[:start] + new_css + text[end:]

# Remove duplicate moment-app rules until listen-overlay - trim old block between new_css end and Master lock
# The splice kept "Master lock" section - need to remove orphaned old CSS between compose-layer and Master lock
orphan_start = text.find("    body.moment-compose .compose-layer {\n      opacity:1 !important", start)
if orphan_start != -1 and orphan_start < text.find("    /* ── Master lock: moment UI ── */"):
    # find second occurrence - keep only first in new_css
    master = text.find("    /* ── Master lock: moment UI ── */")
    dup = text.find("    body.moment-compose .compose-layer {", start + 100)
    if dup != -1 and dup < master:
        text = text[:dup] + text[master:]

# ── 3. JS: replace scene renderer block ──
js_start = text.index("/* ── SceneRendererCore ── */")
js_end = text.index("/* ── Mode selector ── */")
new_js = r'''/* ── Cinematic Moment Engine ── */
const SCENE_DEBUG=false;
const SCENE_SKIP_VIDEO=false;
const EMOTION_INPUT_DEBOUNCE_MS=140;
const LOCK_TRANSITION_MS=380;
const REVEAL_PAUSE_MS=750;
const DEFAULT_SCENE='open_highway_daylight';
let _currentSceneId=DEFAULT_SCENE;
let _emotionInputTimer=null;
let _momentTimer=null;
let _cinemaVideoOk=null;
let _cinemaGoAt=0;

const CINEMATIC_SCENES=[
  'night_drive','petrol_station_2am','sunset_coast','urban_midnight_walk','train_journey',
  'summer_afternoon_drift','rainy_city_interior','memory_road','club_exit_dawn','open_highway_daylight',
];

function getSceneFromInput(text){
  const t=(text||'').toLowerCase();
  if(t.includes('petrol')||t.includes('gas station')||t.includes('forecourt')||t.includes('2am')||t.includes('2 am')) return 'petrol_station_2am';
  if(t.includes('train')||t.includes('leaving')||t.includes('journey')) return 'train_journey';
  if(t.includes('sunset')||t.includes('coast')||t.includes('beach')) return 'sunset_coast';
  if(t.includes('club')||t.includes('afterparty')||t.includes('dawn')||t.includes('afterglow')) return 'club_exit_dawn';
  if(t.includes('memory')||t.includes('nostalg')||t.includes('country')) return 'memory_road';
  if(t.includes('rain')&&t.includes('window')) return 'rainy_city_interior';
  if(t.includes('apartment')||t.includes('interior')) return 'rainy_city_interior';
  if(t.includes('city')||t.includes('london')||t.includes('neon')||t.includes('walk')) return 'urban_midnight_walk';
  if(t.includes('sun')||t.includes('summer')||t.includes('afternoon')||t.includes('happy')) return 'summer_afternoon_drift';
  if(t.includes('highway')||t.includes('motorway')||t.includes('open road')) return 'open_highway_daylight';
  if(t.includes('rain')||t.includes('lonely')||t.includes('drive')||t.includes('night')||t.includes('tunnel')) return 'night_drive';
  return DEFAULT_SCENE;
}

function getEmotionForce(text){
  const t=(text||'').toLowerCase();
  return {
    warmth:t.includes('sun')||t.includes('happy')||t.includes('bright')?1:t.includes('rain')||t.includes('night')||t.includes('lonely')?-1:0,
    motion:t.includes('drive')||t.includes('train')||t.includes('motion')?1:t.includes('calm')||t.includes('still')?-1:0,
    intensity:t.includes('loud')||t.includes('chaos')||t.includes('fast')?1:t.includes('soft')||t.includes('quiet')?-1:0,
  };
}

function applyWorldEmotion(force){
  const f=force||{warmth:0,motion:0,intensity:0};
  const root=document.documentElement;
  const w=Number(f.warmth)||0;
  const i=Number(f.intensity)||0;
  root.style.setProperty('--scene-bright', String(1+w*0.04-Math.max(0,-i)*0.03));
  root.style.setProperty('--scene-contrast', String(1.04+Math.abs(i)*0.03));
  root.style.setProperty('--scene-sat', String(0.96+w*0.05));
  root.style.setProperty('--scene-grain', String(Math.min(0.06,0.035+Math.abs(i)*0.01)));
  root.style.setProperty('--scene-vignette', String(Math.min(0.5,0.4+Math.max(0,-w)*0.04)));
}

function _clearMomentTimer(){
  if(_momentTimer){ clearTimeout(_momentTimer); _momentTimer=null; }
}

function _setSceneMode(mode){
  document.body.classList.remove('scene-video','scene-still','scene-composite');
  if(mode) document.body.classList.add(mode);
}

function ensureCompositeScene(sceneId){
  sceneId=sceneId||DEFAULT_SCENE;
  _currentSceneId=sceneId;
  document.body.dataset.scene=sceneId;
  const fb=$('cinemaFallback');
  const still=$('cinemaStill');
  const cinema=$('cinema');
  if(fb){ fb.dataset.scene=sceneId; fb.classList.remove('hidden'); }
  if(still){ still.classList.add('hidden'); still.removeAttribute('src'); }
  if(cinema){ cinema.style.opacity='0'; }
  _setSceneMode('scene-composite');
  if(SCENE_DEBUG) console.log('Scene:', sceneId, 'composite still');
}

function showStillScene(sceneId, src){
  const still=$('cinemaStill');
  const fb=$('cinemaFallback');
  const cinema=$('cinema');
  if(!still){ ensureCompositeScene(sceneId); return; }
  still.onload=()=>{
    _setSceneMode('scene-still');
    if(fb) fb.classList.add('hidden');
    if(cinema) cinema.style.opacity='0';
    still.classList.remove('hidden');
    if(SCENE_DEBUG) console.log('Scene:', sceneId, 'still', src);
  };
  still.onerror=()=>{ ensureCompositeScene(sceneId); };
  still.src=src;
}

function renderScene(sceneId){
  const cinema=$('cinema');
  sceneId=sceneId||DEFAULT_SCENE;
  _currentSceneId=sceneId;
  document.body.dataset.scene=sceneId;
  const fb=$('cinemaFallback');
  if(fb) fb.dataset.scene=sceneId;

  if(SCENE_SKIP_VIDEO||_cinemaVideoOk===false){
    tryStillThenComposite(sceneId);
    return;
  }

  if(!cinema){
    tryStillThenComposite(sceneId);
    return;
  }

  const videoSources=[
    '/cinema/'+sceneId+'.mp4',
    '/cinema/'+sceneId+'/base.mp4',
  ];
  let vi=0;
  function tryVideo(){
    if(vi>=videoSources.length){
      tryStillThenComposite(sceneId);
      return;
    }
    const src=videoSources[vi++];
    cinema.onloadeddata=()=>{
      _cinemaVideoOk=true;
      _setSceneMode('scene-video');
      if(fb) fb.classList.add('hidden');
      $('cinemaStill')?.classList.add('hidden');
      cinema.style.opacity='1';
      cinema.play().catch(()=>{});
      if(SCENE_DEBUG) console.log('Scene:', sceneId, 'video', src);
    };
    cinema.onerror=()=>tryVideo();
    cinema.src=src;
    cinema.load();
  }
  tryVideo();
}

function tryStillThenComposite(sceneId){
  const stillSources=[
    '/cinema/'+sceneId+'/still.jpg',
    '/cinema/'+sceneId+'/still.webp',
    '/cinema/'+sceneId+'.jpg',
    '/cinema/'+sceneId+'.webp',
  ];
  let si=0;
  const still=$('cinemaStill');
  if(!still){ ensureCompositeScene(sceneId); return; }
  function next(){
    if(si>=stillSources.length){
      _cinemaVideoOk=false;
      ensureCompositeScene(sceneId);
      return;
    }
    showStillScene(sceneId, stillSources[si++]);
  }
  next();
}

function sceneCoreOnInput(text){
  clearTimeout(_emotionInputTimer);
  _emotionInputTimer=setTimeout(()=>applyWorldEmotion(getEmotionForce(text||'')), EMOTION_INPUT_DEBOUNCE_MS);
}

function sceneCoreInit(){
  renderScene(DEFAULT_SCENE);
  applyWorldEmotion({warmth:0,motion:0,intensity:0});
  document.body.classList.remove('scene-camera-lock');
  document.body.classList.add('scene-camera-drift');
}

function _clearAtmosphere(){
  clearTimeout(_emotionInputTimer);
  _clearMomentTimer();
  document.body.classList.remove('scene-camera-lock','world-settled');
  document.body.classList.add('scene-camera-drift');
  renderScene(DEFAULT_SCENE);
  applyWorldEmotion({warmth:0,motion:0,intensity:0});
}

function _applyAtmosphere(vibe){
  applyWorldEmotion(getEmotionForce(vibe||''));
}

function _cinematicTitleFromVibe(vibe){
  const v=(vibe||'').trim();
  if(!v) return '';
  return v.charAt(0).toUpperCase()+v.slice(1);
}

function _shortVibeSummary(vibe, ep, mu, expl, count){
  return _aestheticMomentLine(vibe, ep);
}

'''
text = text[:js_start] + new_js + text[js_end:]

# ── 4. setMomentState & result flow ──
text = text.replace(
    "['compose','listening','result'].forEach(s=>{",
    "['compose','thinking','locked','reveal'].forEach(s=>{",
)
text = text.replace("const RESULT_PRE_MS=180;\nconst RESULT_REVEAL_MS=1000;\nconst RESULT_STABLE_MS=480;\nconst CINEMA_CREDITS_MS=1100;\nconst EMOTION_SETTLE_MS=200;\nlet _cinemaGoAt=0;",
                    "const RESULT_REVEAL_MS=900;\nconst RESULT_STABLE_MS=400;")

old_present = """function presentResultLayer(){
  const rc=$('resultCard');
  const surface=$('resultSurface');
  if(!rc) return;
  rc.classList.remove('visible','revealing');
  surface?.classList.remove('result-revealed','result-stable');
  void rc.offsetWidth;
  setMomentState('result');
  setTimeout(()=>{
    _applyRevealTiming(surface);
    rc.classList.add('visible','revealing');
    requestAnimationFrame(()=>{
      surface?.classList.add('result-revealed');
      setTimeout(()=>surface?.classList.add('result-stable'), RESULT_REVEAL_MS+RESULT_STABLE_MS);
    });
  }, RESULT_PRE_MS);
}"""

new_present = """function presentResultLayer(){
  const rc=$('resultCard');
  const surface=$('resultSurface');
  if(!rc) return;
  rc.classList.remove('visible','revealing');
  surface?.classList.remove('result-revealed','result-stable');
  void rc.offsetWidth;
  _applyRevealTiming(surface);
  rc.classList.add('visible','revealing');
  requestAnimationFrame(()=>{
    surface?.classList.add('result-revealed');
    setTimeout(()=>surface?.classList.add('result-stable'), RESULT_REVEAL_MS+RESULT_STABLE_MS);
  });
}"""

text = text.replace(old_present, new_present)

old_settle = """function presentResultWithSettle(vibe){
  vibe=vibe||lastVibe||_activeGenVibe||'';
  document.body.classList.remove('world-settled');
  applyScenePerception(_currentSceneId, getEmotionForce(vibe));
  presentResultLayer();
  setTimeout(()=>document.body.classList.add('world-settled'), 300);
  setTimeout(()=>document.body.classList.add('perception-lock'), 700);
  setTimeout(()=>{
    document.body.classList.remove('perception-depth');
    document.body.classList.add('perception-stable');
  }, 1200);
}"""
new_settle = """function presentMomentReveal(vibe, playlistTitle){
  vibe=vibe||lastVibe||'';
  document.body.classList.add('scene-camera-lock');
  document.body.classList.remove('scene-camera-drift');
  const lo=$('listenOverlay');
  if(lo){ lo.classList.remove('visible'); lo.setAttribute('aria-hidden','true'); }
  const delay=Math.max(0, REVEAL_PAUSE_MS-(Date.now()-(_cinemaGoAt||Date.now()-REVEAL_PAUSE_MS)));
  _clearMomentTimer();
  _momentTimer=setTimeout(()=>{
    setMomentState('reveal');
    if(resultName) resultName.textContent=_cinematicTitleFromVibe(vibe)||playlistTitle||'';
    presentResultLayer();
    document.body.classList.add('world-settled');
  }, delay);
}"""
if old_settle in text:
    text = text.replace(old_settle, new_settle)
else:
    text = text.replace("presentResultWithSettle", "presentMomentReveal")

text = text.replace("  else renderScene('abstract_light_field');", "  else renderScene(DEFAULT_SCENE);")
text = text.replace("renderScene('abstract_light_field')", "renderScene(DEFAULT_SCENE)")

# setLoading
old_loading = """  if(on){
    _cinemaGoAt=Date.now();
    setMomentState('listening');
    const vibe=_activeGenVibe||vibeInput?.value||'';
    const sceneId=getSceneFromInput(vibe);
    const emotion=getEmotionForce(vibe);
    applyWorldEmotion(emotion);
    applyScenePerception(sceneId, emotion);
    setTimeout(()=>applyWorldEmotion(emotion), EMOTION_SETTLE_MS);
    runPerceptionSequence(sceneId, emotion);
    setTimeout(()=>renderSceneAck(sceneId), SCENE_ACK_MS);
    if(progLabel) progLabel.textContent=_FINDING_SOUND;"""

new_loading = """  if(on){
    _cinemaGoAt=Date.now();
    setMomentState('thinking');
    const vibe=_activeGenVibe||vibeInput?.value||'';
    const sceneId=getSceneFromInput(vibe);
    applyWorldEmotion(getEmotionForce(vibe));
    renderScene(sceneId);
    document.body.classList.remove('scene-camera-lock');
    document.body.classList.add('scene-camera-drift');
    if(progLabel) progLabel.textContent='Finding your moment…';
    _clearMomentTimer();
    _momentTimer=setTimeout(()=>{
      if(isGenerating) setMomentState('locked');
    }, LOCK_TRANSITION_MS);"""

text = text.replace(old_loading, new_loading)

text = text.replace("const _FINDING_SOUND='Finding your sound…';", "const _FINDING_SOUND='Finding your moment…';")

# showResult reveal
text = text.replace(
    """  const creditsDelay=momentCredits
    ? Math.max(0, CINEMA_CREDITS_MS-(Date.now()-(_cinemaGoAt||Date.now()-CINEMA_CREDITS_MS)))
    : 0;
  setTimeout(()=>presentResultWithSettle(vibe), creditsDelay);""",
    """  if(momentCredits){
    presentMomentReveal(vibe, displayName);
  } else {
    setMomentState('reveal');
    presentResultLayer();
  }""",
)

text = text.replace("body.moment-result", "body.moment-reveal")
text = text.replace("moment-result", "moment-reveal")
text = text.replace("moment-listening", "moment-thinking")

# showLanding state clear
text = text.replace(
    "['compose','listening','result'].forEach(s=>document.body.classList.remove('moment-'+s));",
    "['compose','thinking','locked','reveal'].forEach(s=>document.body.classList.remove('moment-'+s));",
)

# listen overlay CSS - simplify
text = text.replace(
    ".moment-listening .below-fold { opacity:0; }",
    ".moment-thinking .below-fold, .moment-locked .below-fold { opacity:0; }",
)

HTML.write_text(text, encoding="utf-8", newline="\n")
print("Patched", HTML)
