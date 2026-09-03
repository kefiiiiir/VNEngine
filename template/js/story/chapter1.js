/* ===========================================================
   VNengine - Chapter 1 (your novel, split into chapter files).

   Big novels get unwieldy as one file, so the script lives across
   js/story/chapter1.js, js/story/chapter2.js, ... - one per chapter.
   The op builders (say, bg, show, choice, ...) come from
   js/story/story-helpers.js, loaded once before any chapter file; use
   them here exactly as you would in a single-file script.

   Everything under `var ops = [...]` is an EXAMPLE. Replace it with
   your own story. See js/story/README.md for the full guide - how the
   chapter-file split works, plus the complete op reference.

   Labels must stay unique across ALL chapter files, not just this
   one - the engine merges every chapter into a single script before
   it boots. A chapterEnd's `next` may point at a label defined in a
   later chapter file (see the end of this file).
   =========================================================== */
(function (global) {
  'use strict';

  var ops = [

    label('start'),
    music('theme', { volume: 0.5, fade: 2 }),

    bg('black'),
    narr('This is VNengine. Everything you see is driven by js/story/chapter1.js and js/story/chapter2.js.'),
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
    // next is a label defined in chapter2.js - the engine merges every
    // chapter file into one script before it boots, so this just works.
    chapterEnd('Chapter 1 - Demo', 'chapter2_start')
  ];

  global.VNScript = global.VNScript || { ops: [] };
  global.VNScript.ops = global.VNScript.ops.concat(ops);
})(window);
