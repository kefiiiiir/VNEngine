/* ===========================================================
   VNengine - the script (your novel).

   A script is just an ordered array of "ops". The helper
   functions below build those op objects; the engine walks the
   array top to bottom, jumping on label / jump / if / choice.

   Everything under `var ops = [...]` is an EXAMPLE. Replace it
   with your own story. See VNengine.md for the full op reference.

   Text tokens:  {first}  {last}  {name}  -> the player's name.
   =========================================================== */
(function (global) {
  'use strict';

  /* ---- op builders -------------------------------------------------- */
  function say(who, text, expr) { return { op: 'say', who: who, text: text, expr: expr }; }
  function narr(text)           { return { op: 'say', who: null, text: text }; }   // narration
  function mc(text)             { return { op: 'say', who: 'mc', text: text }; }    // player's own voice
  function bg(name)             { return { op: 'scene', bg: name }; }
  function show(who, expr, pos) { return { op: 'show', who: who, expr: expr || 'idle', pos: pos || 'center' }; }
  function hide(who)            { return { op: 'hide', who: who }; }
  function label(name)          { return { op: 'label', name: name }; }
  function jump(to)             { return { op: 'jump', to: to }; }
  function iff(cond, to)        { return { op: 'if', cond: cond, to: to }; }
  function set(vars)            { return { op: 'set', vars: vars }; }
  function choice(options)      { return { op: 'choice', options: options }; }
  function music(name, opts)    { return { op: 'music', name: name, opts: opts || {} }; }
  function stopMusic(opts)      { return { op: 'stopMusic', opts: opts || {} }; }
  function sfx(name, opts)      { return { op: 'sfx', name: name, opts: opts || {} }; }
  function pause(ms)            { return { op: 'pause', ms: ms }; }
  function fx(effect, opt)      { var o = { op: 'fx', effect: effect }; if (opt) for (var k in opt) o[k] = opt[k]; return o; }
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
    hide('mio'),
    say('ari', 'Watch - the screen can react too.', 'point'),
    fx('shake'),
    fx('flash', { color: 'white' }),

    say('ari', 'And so can the music.', 'talk'),
    fx('crushmusic', { on: true }),
    say('ari', 'Lo-fi now. This is the one audio effect kept as an example.', 'idle'),
    fx('crushmusic', { on: false }),
    say('ari', 'Back to normal.', 'talk'),

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
