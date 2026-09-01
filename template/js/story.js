/* ===========================================================
   VNengine - the script (your novel).

   A script is just an ordered array of "ops". The helper
   functions below build those op objects; the engine walks the
   array top to bottom, jumping on label / jump / if / choice.

   Everything under `var ops = [...]` is an EXAMPLE. Replace it
   with your own story. See VNengine.md for the full op reference.

   Text tokens:  {first} {last} {name}  -> the player's name
                 {anyVar}             -> a value from set({ ... })
   Text markup:  [b]bold[/b]  [i]italic[/i]  [c=#ff8ec4]colour[/c]
   =========================================================== */
(function (global) {
  'use strict';

  /* ---- op builders -------------------------------------------------- */
  // say(who, text, expr, voice) - `voice` is an optional SfxBank file name
  // (register it in VNData.SFX_FILES) played while the line is on screen.
  function say(who, text, expr, voice) { return { op: 'say', who: who, text: text, expr: expr, voice: voice }; }
  function narr(text)           { return { op: 'say', who: null, text: text }; }   // narration
  function mc(text)             { return { op: 'say', who: 'mc', text: text }; }    // player's own voice
  function bg(name)             { return { op: 'scene', bg: name }; }
  // `where` for show/move is a position NAME ('left' | 'center' | 'right' |
  // any name from VNData.POSITIONS) OR an options object.  An options object
  // (as `where`, or as an extra 4th/3rd arg after a name) may carry:
  //   pos        a position name
  //   x, y       inline coords - x = sprite centre (share of stage width),
  //              y = lift off the floor (positive = up)
  //   scale      sprite size, 100 = normal; overrides / adds to the name's
  //   transition show/hide: 'fade' (default) | 'rise' | 'slide-left' | 'slide-right'
  //              move:      'glide' (default) | 'linear' | 'ease-in' | 'ease-out'
  //   duration   ms for the transition / glide (show/hide default 300; 0 = snap)
  function placement(where, opts) {
    var w = (where && typeof where === 'object') ? where : {};
    var o = opts || {};
    var pick = function (k) { return o[k] != null ? o[k] : w[k]; };
    return {
      pos: (typeof where === 'string' ? where : w.pos) || null,
      x: pick('x'), y: pick('y'), scale: pick('scale'),
      transition: pick('transition'), duration: pick('duration')
    };
  }
  // show(who, expr, 'left')  /  show(who, expr, { pos:'left', scale:120 })
  //   /  show(who, expr, 'left', { scale:120, transition:'rise' })
  function show(who, expr, where, opts) {
    var p = placement(where, opts);
    return {
      op: 'show', who: who, expr: expr || 'idle',
      pos: p.pos || 'center', x: p.x, y: p.y, scale: p.scale,
      transition: p.transition, duration: p.duration
    };
  }
  // hide(who) or hide(who, { transition, duration }) - same transition names
  // as show; the character exits that way instead of a plain fade.
  function hide(who, opts) {
    opts = opts || {};
    return { op: 'hide', who: who, transition: opts.transition, duration: opts.duration };
  }
  // move(who, dest[, opts]) - reposition an already-shown character WITHOUT
  // hide/show.  `dest` is a name or an options object; `opts` is an optional
  // extra object when `dest` is a name.  duration (ms) smooths the glide -
  // x, y AND scale all animate together; absent or 0 = instant jump.  Does
  // not pause the script - use pause(ms) to wait for it.
  function move(who, dest, opts) {
    var p = placement(dest, opts);
    return {
      op: 'move', who: who,
      pos: p.pos, x: p.x, y: p.y, scale: p.scale,
      transition: p.transition, duration: p.duration
    };
  }
  function label(name)          { return { op: 'label', name: name }; }
  function jump(to)             { return { op: 'jump', to: to }; }
  function iff(cond, to)        { return { op: 'if', cond: cond, to: to }; }
  function set(vars)            { return { op: 'set', vars: vars }; }
  function abs(n)               { return { __set: n }; }   // set({ gold: abs(0) }) assigns instead of adding
  // choice([ { text, to, set, show } ]) - `show` is an optional s => bool;
  // an option whose show() returns false is hidden.  e.g.
  //   { text: 'Ask about the ring', to: 'ring', show: function (s) { return s.vars.warmth > 2; } }
  function choice(options)      { return { op: 'choice', options: options }; }
  function music(name, opts)    { return { op: 'music', name: name, opts: opts || {} }; }
  function stopMusic(opts)      { return { op: 'stopMusic', opts: opts || {} }; }
  function sfx(name, opts)      { return { op: 'sfx', name: name, opts: opts || {} }; }
  function pause(ms)            { return { op: 'pause', ms: ms }; }
  function fx(effect, opt)      { var o = { op: 'fx', effect: effect }; if (opt) for (var k in opt) o[k] = opt[k]; return o; }
  // PlayTestLog(message, level) - print a line to the playtest.py terminal as
  // the story runs (dev only; a shipped game has no console and drops it).
  //   message : a string, OR a function that returns something to show (it is
  //             passed the state object: s => `warmth is ${s.vars.warmth}`),
  //             OR any value - objects are JSON-stringified.
  //   level   : 'normal' (default, dim) | 'warning' (amber) | 'critical' (red)
  function PlayTestLog(message, level) { return { op: 'log', message: message, level: level || 'normal' }; }
  function saveOp(label)        { return { op: 'save', label: label || null }; }
  function chapterEnd(t, next)  { return { op: 'chapterEnd', title: t, next: next || null }; }
  function toMenu()             { return { op: 'toTitle' }; }

  /* ---- the story -------------------------------------------------- */
  var ops = [

    label('start'),
    music('theme', { volume: 0.5, fade: 2 }),

    bg('black'),
    narr('This is VNengine. Everything you see is driven by js/story.js.'),
    narr('Press Space, Enter, or click to advance.'),

    bg('room'),
    show('ari', 'idle', 'left'),
    say('ari', 'Hi, {first}! Good to finally meet you.', 'talk'),
    say('ari', 'I have real sprite art, so I show up as a picture.', 'idle'),

    show('mio', 'idle', 'right'),
    say('mio', 'I have no art yet, so the engine draws me as a card. Nothing breaks.', 'idle'),

    mc('(Two people, one question already.)'),

    set({ coins: 3 }),
    // PlayTestLog prints to the playtest.py terminal, not the game screen.
    PlayTestLog('demo: reached the coins scene'),
    PlayTestLog(function (s) { return 'demo: coins=' + s.vars.coins + ' player=' + s.player.first; }),
    narr('You have [b]{coins}[/b] coins in your pocket - [i]{name}[/i]-level wealth.'),

    say('ari', 'Quick one: are we friends?', 'talk'),
    choice([
      { text: 'Of course we are', to: 'friendly', set: { warmth: 1 } },
      { text: "Let's see how it goes", to: 'cool', set: { warmth: 0 } }
    ]),

    label('friendly'),
    say('ari', 'Ha! I knew it.', 'talk'),
    jump('after_choice'),

    label('cool'),
    say('ari', 'Fair. Honest, at least.', 'bad'),

    label('after_choice'),
    PlayTestLog(function (s) { return 'demo: warmth after the choice = ' + (s.vars.warmth || 0); }, 'warning'),
    PlayTestLog('demo: this is what a "critical" line looks like', 'critical'),
    hide('mio'),

    // --- positions & movement demo -------------------------------------
    say('ari', 'Watch this - Mio can slide back in instead of popping.', 'talk'),
    show('mio', 'idle', { pos: 'right', transition: 'slide-left', duration: 450 }),
    say('mio', 'Slid in from the edge.', 'idle'),
    move('mio', { pos: 'doorway', duration: 700 }),
    say('mio', 'And now I am on "doorway" - a spot this project defined in data.js.', 'idle'),
    say('ari', 'My turn. Watch me cross the stage - no hide, no re-show.', 'point'),
    move('ari', { pos: 'right', duration: 900 }),
    say('ari', 'Smooth glide.', 'talk'),
    move('ari', { pos: 'center', duration: 600, transition: 'ease-out' }),
    say('ari', 'Centre stage, easing to a stop.', 'talk'),
    move('ari', 'center', { scale: 128, duration: 500 }),
    say('ari', 'Same spot - just leaning in. That is the scale param.', 'talk'),
    move('ari', 'closeup', { duration: 500 }),
    say('ari', 'And "closeup" bakes its own scale straight into the position.', 'talk'),
    move('ari', 'center', { duration: 400 }),
    hide('mio', { transition: 'slide-left', duration: 400 }),
    say('ari', 'And Mio slid back out the way she came.', 'idle'),
    // -----------------------------------------------------------------

    say('ari', 'Watch - the screen can react too.', 'point'),
    fx('shake'),
    fx('flash', { color: 'white' }),

    say('ari', 'And so can the music.', 'talk'),
    fx('crushmusic', { on: true }),
    say('ari', 'Lo-fi now. This is the one audio effect kept as an example.', 'idle'),
    fx('crushmusic', { on: false }),
    say('ari', 'Back to normal.', 'talk'),

    say('ari', 'One last thing, {first}.', 'talk'),
    choice([
      { text: 'Ask what it is', to: 'finish_common' },
      // this option only appears if you picked "Of course we are" earlier
      { text: 'Hug goodbye', to: 'end_warm',
        show: function (s) { return s.vars.warmth > 0; } },
      // abs() assigns instead of adding - here it zeroes the coins
      { text: 'Hand Ari your coins', to: 'finish_common', set: { coins: abs(0) } }
    ]),
    label('finish_common'),

    iff(function (s) { return s.vars.warmth > 0; }, 'end_warm'),
    narr('You kept your distance. Ari waves and heads off.'),
    jump('finish'),

    label('end_warm'),
    narr('You said yes without thinking. Ari grins the whole way out.'),

    label('finish'),
    saveOp('Demo - end of chapter 1'),
    chapterEnd('Chapter 1 - Demo', null)   // next: null  ->  returns to the title screen
  ];

  global.VNScript = { ops: ops };
})(window);
